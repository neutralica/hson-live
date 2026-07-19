import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { HsonNode, Primitive } from "../src/core/types.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function is_node(value: HsonNode | Primitive): value is HsonNode {
  return typeof value === "object" && value !== null && "$_tag" in value;
}

function assert_detached_graph(copy: HsonNode, owned: HsonNode): void {
  assert.notEqual(copy, owned);
  assert.notEqual(copy.$_content, owned.$_content);
  assert.deepEqual(copy, owned);

  if (copy.$_attrs !== undefined && owned.$_attrs !== undefined) {
    assert.notEqual(copy.$_attrs, owned.$_attrs);
  }
  if (copy.$_meta !== undefined && owned.$_meta !== undefined) {
    assert.notEqual(copy.$_meta, owned.$_meta);
  }

  for (let index = 0; index < copy.$_content.length; index += 1) {
    const copyChild = copy.$_content[index];
    const ownedChild = owned.$_content[index];
    if (copyChild !== undefined && ownedChild !== undefined && is_node(copyChild) && is_node(ownedChild)) {
      assert_detached_graph(copyChild, ownedChild);
    }
  }
}

function find_node(root: HsonNode, tag: string): HsonNode | undefined {
  if (root.$_tag === tag) return root;
  for (const child of root.$_content) {
    if (!is_node(child)) continue;
    const found = find_node(child, tag);
    if (found !== undefined) return found;
  }
  return undefined;
}

function replace_first_primitive(root: HsonNode, value: Primitive): boolean {
  for (let index = 0; index < root.$_content.length; index += 1) {
    const child = root.$_content[index];
    if (is_node(child)) {
      if (replace_first_primitive(child, value)) return true;
      continue;
    }
    root.$_content[index] = value;
    return true;
  }
  return false;
}

check("JSON value and HTML serialization finalizers expose no parse method", () => {
  const node = hson.fromJson({ a: 1, nested: [true, null] }).toNode();
  const json = hson.fromNode(node).toJson();
  const html = hson.fromNode(node).toHtml();

  assert.equal("value" in json, true);
  assert.equal("parse" in json, false);
  assert.deepEqual(json.value(), { a: 1, nested: [true, null] });
  const detachedValue = json.value() as { a: number; nested: Array<boolean | null> };
  detachedValue.a = 9;
  detachedValue.nested.push(false);
  assert.deepEqual(json.value(), { a: 1, nested: [true, null] });
  assert.deepEqual(JSON.parse(json.serialize()), { a: 1, nested: [true, null] });
  assert.equal("parse" in html, false);
});

check("LiveMap exposes detached root copies and debug-only live node access", () => {
  const node = hson.fromHson(
    `<button id="primary" data-_quid="button-q" data-_custom="kept" "hello"/>`,
  ).toNode();
  const map = hson.liveMap.fromNode(node);

  assert.equal("node" in map, false);
  assert.equal("debug" in map, true);
  assert.equal(typeof map.debug.node, "function");

  const owned = map.debug.node([]).must();
  const ownedButton = find_node(owned, "button");
  assert.ok(ownedButton?.$_attrs);
  Object.assign(ownedButton.$_attrs, {
    style: { color: "red", ":hover": { color: "blue" } },
  });
  const copy = map.root();
  const before = map.capture();
  const beforeRev = map.rev;
  assert_detached_graph(copy, owned);

  const copiedButton = find_node(copy, "button");
  assert.ok(copiedButton);
  assert.notEqual(copiedButton.$_attrs?.style, ownedButton.$_attrs.style);
  assert.notEqual(
    copiedButton.$_attrs?.style?.[":hover"],
    ownedButton.$_attrs.style?.[":hover"],
  );
  assert.equal(copiedButton.$_meta?.["data-_quid"], "button-q");
  copiedButton.$_attrs = { ...copiedButton.$_attrs, id: "mutated" };
  copiedButton.$_meta = { ...copiedButton.$_meta, "data-_quid": "changed" };
  assert.equal(replace_first_primitive(copiedButton, "changed"), true);
  copy.$_content.push({ $_tag: "detached", $_content: [] });

  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, beforeRev);
  assert.deepEqual(map.root(), owned);
});

check("debug.node preserves unsafe live mutation and bypass behavior", () => {
  const map = hson.liveMap.fromNode(hson.fromJson({ a: { b: 1 } }).toNode());
  const feedEvents: unknown[] = [];
  const subEvents: unknown[] = [];
  const stopFeed = map.feed([], (event) => feedEvents.push(event));
  const stopSub = map.sub((value) => subEvents.push(value));
  const beforeRev = map.rev;
  const handle = map.debug.node(["a", "b"]);
  const liveNode = handle.must();

  assert.equal(map.debug.node(["a", "b"]).get(), liveNode);
  assert.equal(replace_first_primitive(liveNode, 2), true);
  assert.deepEqual(map.snap(), { a: { b: 2 } });
  assert.equal(map.rev, beforeRev);
  assert.deepEqual(feedEvents, []);
  assert.deepEqual(subEvents, []);

  stopFeed();
  stopSub();
});

process.stdout.write(`# ${checks} public boundary checks passed\n`);

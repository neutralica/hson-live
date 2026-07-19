import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { HsonNode, NodeContent, Primitive } from "../src/core/types.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function is_node(value: HsonNode | Primitive): value is HsonNode {
  return typeof value === "object" && value !== null && "$_tag" in value;
}

function find_nodes(root: HsonNode, tag: string): HsonNode[] {
  const found: HsonNode[] = [];
  const visit = (node: HsonNode): void => {
    if (node.$_tag === tag) found.push(node);
    for (const child of node.$_content) if (is_node(child)) visit(child);
  };
  visit(root);
  return found;
}

function assert_fully_detached(left: HsonNode, right: HsonNode): void {
  assert.notEqual(left, right);
  assert.notEqual(left.$_content, right.$_content);
  assert.deepEqual(left, right);
  if (left.$_attrs !== undefined && right.$_attrs !== undefined) {
    assert.notEqual(left.$_attrs, right.$_attrs);
    if (typeof left.$_attrs.style === "object" && left.$_attrs.style !== null
      && typeof right.$_attrs.style === "object" && right.$_attrs.style !== null) {
      assert.notEqual(left.$_attrs.style, right.$_attrs.style);
    }
  }
  if (left.$_meta !== undefined && right.$_meta !== undefined) {
    assert.notEqual(left.$_meta, right.$_meta);
  }
  for (let index = 0; index < left.$_content.length; index += 1) {
    const leftChild = left.$_content[index];
    const rightChild = right.$_content[index];
    if (leftChild !== undefined && rightChild !== undefined && is_node(leftChild) && is_node(rightChild)) {
      assert_fully_detached(leftChild, rightChild);
    }
  }
}

function mutate_graph(root: HsonNode): void {
  root.$_tag = "mutated-root";
  root.$_meta = { "data-_quid": "mutated-root-q" };
  const nodes = find_nodes(root, "main");
  const main = nodes[0];
  if (main !== undefined) {
    main.$_tag = "changed-main";
    main.$_attrs = { id: "changed", style: { color: "purple", ":hover": { color: "orange" } } };
    main.$_meta = { "data-_quid": "changed-q", "data-_custom": "changed" };
    main.$_content.push({ $_tag: "added", $_content: [] });
  }
  root.$_content.push({ $_tag: "detached", $_content: [] });
}

function mutate_content(content: readonly NodeContent[number][]): void {
  const mutable = content as NodeContent;
  const firstNode = mutable.find(is_node);
  if (firstNode !== undefined) {
    firstNode.$_tag = "changed";
    firstNode.$_content.push({ $_tag: "nested-change", $_content: [] });
    firstNode.$_attrs = { id: "changed" };
    firstNode.$_meta = { "data-_quid": "changed-q" };
  }
  mutable.push({ $_tag: "changed-content", $_content: [] });
}

check("flat document constructors are present without constructor namespaces", () => {
  assert.equal(typeof hson.liveMap.fromTrustedHtml, "function");
  assert.equal(typeof hson.liveMap.fromUntrustedHtml, "function");
  assert.equal(typeof hson.liveMap.fromNode, "function");
  assert.equal("element" in hson.liveMap, false);
  assert.equal("fragment" in hson.liveMap, false);
});

check("canonical roots classify as data-object, data-array, element, and fragment", () => {
  assert.equal(hson.liveMap.fromHson(`<user <name "Ada">>`).mode, "data-object");
  assert.equal(hson.liveMap.fromHson(`«1,true,null»`).mode, "data-array");
  assert.equal(hson.liveMap.fromHson(`<button "Save"/>`).mode, "element");
  assert.equal(hson.liveMap.fromHson(`<section <p "One"/> <p "Two"/>/>`).mode, "element");
  assert.equal(hson.liveMap.fromHson(`"text only"`).mode, "fragment");
  assert.equal(hson.liveMap.fromHson(`<div "One"/> <div "Two"/>`).mode, "fragment");
  assert.equal(hson.liveMap.fromHson(`"before" <em "middle"/> "after"`).mode, "fragment");
  assert.equal(hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] }).mode, "fragment");
});

check("malformed and unsupported canonical roots are rejected with causes", () => {
  assert.throws(
    () => hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [1] }),
    (error) => error instanceof Error
      && error.message.includes("malformed canonical HSON root")
      && error.cause instanceof Error,
  );
  assert.throws(
    () => hson.liveMap.fromNode({ $_tag: "button", $_content: [] }),
    /canonical root must be <_hson_root>/,
  );
});

check("fromNode takes detached ownership of the complete canonical graph", () => {
  const source = hson.fromHson(
    `<main id="original" style="color: red" data-_quid="main-q" data-_custom="kept" <p data-_quid="p-q" "x"/>/>`,
  ).toNode();
  const sourceMain = find_nodes(source, "main")[0];
  if (sourceMain !== undefined) {
    sourceMain.$_attrs = {
      ...sourceMain.$_attrs,
      style: { color: "red", ":hover": { color: "blue" } },
    };
  }
  const sourceBefore = structuredClone(source);
  const map = hson.liveMap.fromNode(source);
  assert.equal(map.mode, "element");
  const ownedBefore = map.root();
  assert.deepEqual(source, sourceBefore);
  assert_fully_detached(source, ownedBefore);

  mutate_graph(source);
  assert.deepEqual(map.root(), ownedBefore);
  assert.equal(map.rev, 0);
});

check("data fromNode construction also takes detached ownership", () => {
  const source = hson.fromJson({ user: { name: "Ada" }, values: [1, 2] }).toNode();
  const map = hson.liveMap.fromNode(source);
  assert.equal(map.mode, "data-object");
  const baseline = map.root();
  source.$_tag = "changed";
  source.$_content.length = 0;
  source.$_attrs = { style: { color: "red" } };
  source.$_meta = { "data-_quid": "caller-change" };
  assert.deepEqual(map.root(), baseline);
  assert.deepEqual(map.snap(), { user: { name: "Ada" }, values: [1, 2] });
});

check("element reads and captures are recursively detached", () => {
  const map = hson.liveMap.fromHson(
    `<main id="original" style="color: red" data-_quid="main-q" <p data-_quid="p-q" "x"/>/>`,
  );
  assert.equal(map.mode, "element");
  const baseline = map.root();
  const beforeRev = map.rev;
  const rootCopy = map.root();
  const capture = map.capture();
  const element = map.element.node();
  const content = map.element.content();

  assert.equal(capture.kind, "hson-document");
  assert.equal(capture.version, 1);
  assert.equal(capture.mode, "element");
  assert.equal(capture.rev, beforeRev);
  assert_fully_detached(rootCopy, capture.root);
  mutate_graph(rootCopy);
  mutate_graph(capture.root);
  element.$_tag = "changed-element";
  mutate_content(content);

  assert.deepEqual(map.root(), baseline);
  assert.equal(map.rev, beforeRev);
});

check("fragment reads preserve repeated siblings and mixed content in order", () => {
  const map = hson.liveMap.fromHson(
    `"before" <div id="a" data-_quid="a-q" "one"/> <div id="b" data-_quid="b-q" "two"/> "after"`,
  );
  assert.equal(map.mode, "fragment");
  const baseline = map.root();
  const content = map.fragment.content();
  assert.equal(content.length, 4);
  assert.deepEqual(content.map((item) => is_node(item) ? item.$_tag : item), [
    "_hson_str", "div", "div", "_hson_str",
  ]);
  const divs = content.filter((item): item is HsonNode => is_node(item) && item.$_tag === "div");
  assert.deepEqual(divs.map((node) => node.$_attrs?.id), ["a", "b"]);
  assert.deepEqual(divs.map((node) => node.$_meta?.["data-_quid"]), ["a-q", "b-q"]);

  mutate_content(content);
  assert.deepEqual(map.root(), baseline);
  assert.equal(map.rev, 0);
});

check("document identity is sparse and preserves only explicitly persisted QUIDs", () => {
  const map = hson.liveMap.fromHson(
    `<main data-_quid="main-q" <p "one"/> <p data-_quid="kept-q" "two"/>/>`,
  );
  assert.equal(map.mode, "element");
  const first = map.root();
  const second = map.root();
  const main = find_nodes(first, "main")[0];
  const paragraphs = find_nodes(first, "p");
  assert.equal(main?.$_meta?.["data-_quid"], "main-q");
  assert.equal(paragraphs[1]?.$_meta?.["data-_quid"], "kept-q");
  assert.equal(paragraphs[0]?.$_meta?.["data-_quid"], undefined);
  assert.deepEqual(second, first);
  assert.deepEqual(map.capture().root, first);
  assert.equal(map.element.byQuid("main-q")?.$_tag, "main");
  assert.equal(map.element.byQuid("kept-q")?.$_tag, "p");
  assert.equal(map.element.byQuid("unknown"), undefined);
  assert.equal(map.rev, 0);
});

check("unquidded construction and every detached read preserve identity absence", () => {
  const source = hson.fromHson(`<main <p "one"/> <p "two"/>/>`).toNode();
  const sourceBefore = structuredClone(source);
  const map = hson.liveMap.fromNode(source);
  assert.equal(map.mode, "element");
  const reads = [map.root(), map.capture().root, map.element.node(), ...map.element.content().filter(is_node)];
  for (const root of reads) {
    for (const node of find_nodes(root, "main").concat(find_nodes(root, "p"))) {
      assert.equal(node.$_meta?.["data-_quid"], undefined);
    }
  }
  assert.deepEqual(source, sourceBefore);
  assert.equal(map.element.byQuid("anything"), undefined);
  assert.equal(map.rev, 0);

  const fragment = hson.liveMap.fromHson(`"before" <div <span "one"/>/> <div "two"/> "after"`);
  assert.equal(fragment.mode, "fragment");
  for (const read of [fragment.root(), fragment.capture().root, ...fragment.fragment.content().filter(is_node)]) {
    for (const tag of ["div", "span"]) {
      for (const node of find_nodes(read, tag)) assert.equal(node.$_meta?.["data-_quid"], undefined);
    }
  }
  assert.equal(fragment.rev, 0);
});

check("duplicate and empty persisted document QUIDs are rejected", () => {
  assert.throws(
    () => hson.liveMap.fromHson(`<div data-_quid="same"/> <span data-_quid="same"/>`),
    /duplicate data-_quid "same"/,
  );
  assert.throws(
    () => hson.liveMap.fromHson(`<div data-_quid=""/>`),
    /invalid empty data-_quid/,
  );
  const malformed = hson.fromHson(`<div/>`).toNode();
  const div = find_nodes(malformed, "div")[0];
  if (div !== undefined) div.$_meta = { "data-_quid": 42 as unknown as string };
  assert.throws(
    () => hson.liveMap.fromNode(malformed),
    /malformed canonical HSON root/,
  );
});

check("document runtime façade omits projected data APIs", () => {
  const element = hson.liveMap.fromHson(`<button "Save"/>`);
  const fragment = hson.liveMap.fromHson(`<button/> <button/>`);
  for (const map of [element, fragment]) {
    for (const key of ["snap", "proxy", "set", "setMany", "splice", "replace", "delete", "batch", "apply", "replay", "feed", "sub", "schema", "at"]) {
      assert.equal(key in map, false, `${key} should not be exposed by a document façade`);
    }
    assert.equal("debug" in map, true);
    assert.equal(typeof map.debug.node, "function");
  }
});

check("data maps preserve their APIs and all normal constructors begin at revision zero", () => {
  const objectMap = hson.liveMap.fromJson({ a: 1 });
  const arrayMap = hson.liveMap.fromJson([1, 2]);
  assert.equal(objectMap.mode, "data-object");
  assert.equal(arrayMap.mode, "data-array");
  assert.equal(objectMap.rev, 0);
  assert.equal(arrayMap.rev, 0);
  assert.equal(objectMap.capture().rev, 0);
  assert.equal(arrayMap.capture().rev, 0);
  assert.deepEqual(objectMap.snap(), { a: 1 });
  assert.deepEqual(arrayMap.snap(), [1, 2]);
  for (const map of [objectMap, arrayMap]) {
    assert.equal(typeof map.proxy, "function");
    assert.equal(typeof map.set, "function");
    assert.equal(typeof map.apply, "function");
    assert.equal(typeof map.replay, "function");
  }

  const classified = [
    hson.liveMap.fromHson(`<user <name "Ada">>`),
    hson.liveMap.fromHson(`«1,2»`),
    hson.liveMap.fromNode(hson.fromJson({ a: 1 }).toNode()),
    hson.liveMap.fromNode(hson.fromJson([1, 2]).toNode()),
    hson.liveMap.fromHson(`<main "trusted"/>`),
    hson.liveMap.fromHson(`"before" <em "mixed"/> "after"`),
    hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] }),
  ];
  for (const map of classified) {
    assert.equal(map.rev, 0, `expected ${map.mode} construction at revision zero`);
    assert.equal(map.capture().rev, 0);
  }
});

check("first changed operations advance from zero to one exactly once", () => {
  const objectMap = hson.liveMap.fromJson({ value: 1 });
  const objectCommit = objectMap.set(["value"], 2);
  assert.deepEqual([objectCommit.prevRev, objectCommit.rev, objectMap.rev], [0, 1, 1]);

  const arrayMap = hson.liveMap.fromJson([1]);
  const arrayCommit = arrayMap.replace([1, 2]);
  assert.deepEqual([arrayCommit.prevRev, arrayCommit.rev, arrayMap.rev], [0, 1, 1]);

  const source = hson.liveMap.fromHson(`<main "new"/>`);
  const target = hson.liveMap.fromHson(`<aside "old"/>`);
  const documentCommit = target.install(source.capture());
  assert.deepEqual([documentCommit.prevRev, documentCommit.rev, target.rev], [0, 1, 1]);
});

check("unsafe debug node mutation remains live and revision-bypassing", () => {
  const map = hson.liveMap.fromHson(`<main data-_quid="main-q" "x"/>`);
  assert.equal(map.mode, "element");
  const beforeRev = map.rev;
  map.debug.node(["main"]).setAttr("class", "unsafe");
  assert.equal(find_nodes(map.root(), "main")[0]?.$_attrs?.class, "unsafe");
  assert.equal(map.rev, beforeRev);
});

process.stdout.write(`# ${checks} document LiveMap checks passed\n`);

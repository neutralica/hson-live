import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
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
  root.$_meta = { quid: "000000010" };
  const nodes = find_nodes(root, "main");
  const main = nodes[0];
  if (main !== undefined) {
    main.$_tag = "changed-main";
    main.$_attrs = { id: "changed", style: { color: "purple", ":hover": { color: "orange" } } };
    main.$_meta = { quid: "000000011" };
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
    firstNode.$_meta = { quid: "000000011" };
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

check("canonical roots classify as data-object, data-array, element, and multiNodeDocument", () => {
  assert.equal(hson.liveMap.fromHson(`<user <name "Ada">>`).mode, "data-object");
  assert.equal(hson.liveMap.fromHson(`«1,true,null»`).mode, "data-array");
  assert.equal(hson.liveMap.fromHson(`<button "Save"/>`).mode, "document");
  assert.equal(hson.liveMap.fromHson(`<section <p "One"/> <p "Two"/>/>`).mode, "document");
  assert.equal(hson.liveMap.fromHson(`"text only"`).mode, "document");
  assert.equal(hson.liveMap.fromHson(`<div "One"/> <div "Two"/>`).mode, "document");
  assert.equal(hson.liveMap.fromHson(`"before" <em "middle"/> "after"`).mode, "document");
  assert.equal(hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] }).mode, "document");
});

check("malformed and unsupported canonical roots are rejected with causes", () => {
  assert.throws(
    () => hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [1] }),
    (error) => error instanceof Error
      && error.message.includes("malformed canonical Hson root")
      && error.cause instanceof Error,
  );
  assert.throws(
    () => hson.liveMap.fromNode({ $_tag: "button", $_content: [] }),
    /canonical root must be <_hson_root>/,
  );
});

check("fromNode takes detached ownership of the complete canonical graph", () => {
  const source = hson.fromHson(
    `<main id="original" style="color: red" data-user="kept" @000000001 <p @000000002 "x"/>/>`,
  ).toNode();
  const sourceMain = find_nodes(source, "main")[0];
  if (sourceMain !== undefined) {
    sourceMain.$_attrs = {
      ...sourceMain.$_attrs,
      style: { color: "red", width: { value: 2, unit: "px" } },
    };
  }
  const sourceBefore = structuredClone(source);
  const map = hson.liveMap.fromNode(source);
  assert.equal(map.mode, "document");
  const ownedBefore = map.root();
  assert.deepEqual(source, sourceBefore);
  const ownedMain = find_nodes(ownedBefore, "main")[0];
  assert.notEqual(sourceMain, ownedMain);
  assert.deepEqual(sourceMain, ownedMain);

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
  source.$_meta = { quid: "000000012" };
  assert.deepEqual(map.root(), baseline);
  assert.deepEqual(map.snap(), { user: { name: "Ada" }, values: [1, 2] });
});

check("element reads and captures are recursively detached", () => {
  const map = hson.liveMap.fromHson(
    `<main id="original" style="color: red" @000000001 <p @000000002 "x"/>/>`,
  );
  assert.equal(map.mode, "document");
  const baseline = map.root();
  const beforeRev = map.rev;
  const rootCopy = map.root();
  const capture = map.capture();
  const element = map.root();
  const content = map.document.content();

  assert.equal(capture.kind, "hson-document");
  assert.equal(Object.hasOwn(capture, "version"), false);
  assert.equal(capture.mode, "document");
  assert.equal(capture.rev, beforeRev);
  assert_fully_detached(rootCopy, capture.root);
  mutate_graph(rootCopy);
  mutate_graph(capture.root);
  element.$_tag = "changed-element";
  mutate_content(content);

  assert.deepEqual(map.root(), baseline);
  assert.equal(map.rev, beforeRev);
});

check("multiNodeDocument reads preserve repeated siblings and mixed content in order", () => {
  const map = hson.liveMap.fromHson(
    `"before" <div id="a" @000000003 "one"/> <div id="b" @000000004 "two"/> "after"`,
  );
  assert.equal(map.mode, "document");
  const baseline = map.root();
  const content = map.document.content();
  assert.equal(content.length, 4);
  assert.deepEqual(content.map((item) => is_node(item) ? item.$_tag : item), [
    "_hson_str", "div", "div", "_hson_str",
  ]);
  const divs = content.filter((item): item is HsonNode => is_node(item) && item.$_tag === "div");
  assert.deepEqual(divs.map((node) => node.$_attrs?.id), ["a", "b"]);
  assert.deepEqual(divs.map((node) => node.$_meta?.["quid"]), ["000000003", "000000004"]);

  mutate_content(content);
  assert.deepEqual(map.root(), baseline);
  assert.equal(map.rev, 0);
});

check("document identity is sparse and preserves only explicitly persisted QUIDs", () => {
  const map = hson.liveMap.fromHson(
    `<main @000000001 <p "one"/> <p @000000005 "two"/>/>`,
  );
  assert.equal(map.mode, "document");
  const first = map.root();
  const second = map.root();
  const main = find_nodes(first, "main")[0];
  const paragraphs = find_nodes(first, "p");
  assert.equal(main?.$_meta?.["quid"], "000000001");
  assert.equal(paragraphs[1]?.$_meta?.["quid"], "000000005");
  assert.equal(paragraphs[0]?.$_meta?.["quid"], undefined);
  assert.deepEqual(second, first);
  assert.deepEqual(map.capture().root, first);
  assert.equal(map.document.byQuid("000000001")?.$_tag, "main");
  assert.equal(map.document.byQuid("000000005")?.$_tag, "p");
  assert.equal(map.document.byQuid("unknown"), undefined);
  assert.equal(map.rev, 0);
});

check("unquidded construction and every detached read preserve identity absence", () => {
  const source = hson.fromHson(`<main <p "one"/> <p "two"/>/>`).toNode();
  const sourceBefore = structuredClone(source);
  const map = hson.liveMap.fromNode(source);
  assert.equal(map.mode, "document");
  const reads = [map.root(), map.capture().root, map.root(), ...map.document.content().filter(is_node)];
  for (const root of reads) {
    for (const node of find_nodes(root, "main").concat(find_nodes(root, "p"))) {
      assert.equal(node.$_meta?.["quid"], undefined);
    }
  }
  assert.deepEqual(source, sourceBefore);
  assert.equal(map.document.byQuid("anything"), undefined);
  assert.equal(map.rev, 0);

  const multiNodeDocument = hson.liveMap.fromHson(`"before" <div <span "one"/>/> <div "two"/> "after"`);
  assert.equal(multiNodeDocument.mode, "document");
  for (const read of [multiNodeDocument.root(), multiNodeDocument.capture().root, ...multiNodeDocument.document.content().filter(is_node)]) {
    for (const tag of ["div", "span"]) {
      for (const node of find_nodes(read, tag)) assert.equal(node.$_meta?.["quid"], undefined);
    }
  }
  assert.equal(multiNodeDocument.rev, 0);
});

check("duplicate and malformed persisted document QUIDs are rejected", () => {
  assert.throws(
    () => hson.liveMap.fromHson(`<div @000000006/> <span @000000006/>`),
    /duplicate quid "000000006"/,
  );
  assert.throws(
    () => hson.liveMap.fromHson(`<div @/>`),
    /missing persisted QUID value after "@"/,
  );
  const malformed = hson.fromHson(`<div/>`).toNode();
  const div = find_nodes(malformed, "div")[0];
  if (div !== undefined) div.$_meta = { quid: 42 as unknown as string };
  assert.throws(
    () => hson.liveMap.fromNode(malformed),
    /malformed canonical Hson root/,
  );
});

check("document runtime façade omits data data APIs", () => {
  const element = hson.liveMap.fromHson(`<button "Save"/>`);
  const multiNodeDocument = hson.liveMap.fromHson(`<button/> <button/>`);
  for (const map of [element, multiNodeDocument]) {
    if (!("document" in map)) throw new Error("expected document map");
    for (const key of ["snap", "set", "setMany", "splice", "replace", "delete", "batch", "apply", "feed", "sub"]) {
      assert.equal(key in map, false, `${key} should not be exposed by a document façade`);
    }
    assert.deepEqual(Object.keys(map.schema), ["get", "use"]);
    assert.equal(map.schema.get(), undefined);
    assert.equal(typeof map.at, "function");
    assert.equal(typeof map.proxy, "function");
    assert.equal(typeof map.replay, "function");
    assert.equal(typeof map.restore, "function");
    assert.equal(typeof map.commits.observe, "function");
    assert.equal("debug" in map, false);
    assert.equal(typeof map.document.attrs.set, "function");
    assert.equal(typeof map.document.content, "function");
  }
  if (element.mode !== "document" || multiNodeDocument.mode !== "document") throw new Error("expected document modes");
  assert.equal("element" in element, false);
  assert.equal("fragment" in multiNodeDocument, false);
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
  if (source.mode !== "document" || target.mode !== "document") throw new Error("expected element document maps");
  const documentCommit = target.install(source.capture());
  assert.deepEqual([documentCommit.prevRev, documentCommit.rev, target.rev], [0, 1, 1]);
});

check("document root observation is detached from canonical ownership", () => {
  const map = hson.liveMap.fromHson(`<main @000000001 "x"/>`);
  assert.equal(map.mode, "document");
  const beforeRev = map.rev;
  const detached = map.root();
  const main = find_nodes(detached, "main")[0];
  if (main === undefined) throw new Error("expected detached main node");
  main.$_attrs = { ...main.$_attrs, class: "detached" };
  assert.equal(find_nodes(map.root(), "main")[0]?.$_attrs?.class, undefined);
  assert.equal(map.rev, beforeRev);
});

process.stdout.write(`# ${checks} document LiveMap checks passed\n`);
emit_hson_live_test_completion("livemap.document", checks, checks, 0);

import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { hson, LiveMapDocumentMutationError } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode, Primitive } from "../src/core/types.ts";
import type { DocumentLiveMapCapture, DocumentLiveMap, LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-mutation",
  title: "Document LiveMap mutation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "mutation", "attributes", "content"]),
});

const testEvents = create_test_event_emitter("livemap.document-mutation");
let checks = 0;
function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`expected element, observed ${map.mode}`);
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`expected multiNodeDocument, observed ${map.mode}`);
  return map;
}

const path = (...segments: number[]): LiveMapDocumentRequestTarget => Object.freeze({ kind: "path", path: Object.freeze(segments) });
const elementPath = (...segments: number[]): LiveMapDocumentRequestTarget => path(0, ...segments);
const quid = (value: string): LiveMapDocumentRequestTarget => Object.freeze({ kind: "quid", quid: value });

function nodes(root: HsonNode): HsonNode[] {
  const out: HsonNode[] = [];
  const stack: HsonNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    out.push(node);
    for (let index = node.$_content.length - 1; index >= 0; index -= 1) {
      const child = node.$_content[index];
      if (is_Node(child)) stack.push(child);
    }
  }
  return out;
}

function ordinary(source: string): HsonNode {
  const root = hson.fromHson(source).toNode();
  const node = nodes(root).find((candidate) => !candidate.$_tag.startsWith("_hson_"));
  assert.ok(node);
  return node;
}

function contentCluster(source: string): HsonNode {
  const node = ordinary(source);
  const cluster = node.$_content[0];
  if (!is_Node(cluster) || cluster.$_tag !== "_hson_elem") throw new Error("expected element content cluster");
  return cluster;
}

function errorCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (cause) => cause instanceof LiveMapDocumentMutationError && cause.code === code);
}

function assertAtomic(map: DocumentLiveMap, before: DocumentLiveMapCapture, fn: () => unknown): void {
  const rev = map.rev;
  assert.throws(fn);
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, rev);
}

function mustNode(value: HsonNode | Primitive | undefined, message: string): HsonNode {
  if (!is_Node(value)) throw new Error(message);
  return value;
}

function documentElement(map: DocumentLiveMap): HsonNode {
  return mustNode(map.at([]).snap(), "expected single document element");
}

function setAttrWithUnknownTarget(map: DocumentLiveMap, target: unknown): unknown {
  return Reflect.apply(map.document.attrs.set, map.document.attrs, [target, "id", "x"]);
}

function replaceWithUnknown(map: DocumentLiveMap, replacement: unknown): unknown {
  return Reflect.apply(map.document.content.replace, map.document.content, [elementPath(0), 0, replacement]);
}

function insertWithUnknown(map: DocumentLiveMap, content: unknown): unknown {
  return Reflect.apply(map.document.content.insert, map.document.content, [elementPath(0), 0, content]);
}

check("document capabilities use attrs and content namespaces only", () => {
  const map = element(`<main/>`);
  assert.equal(typeof map.document.attrs.set, "function");
  assert.equal(typeof map.document.attrs.drop, "function");
  assert.equal(typeof map.document.attrs.setMany, "function");
  assert.equal(typeof map.document.attrs.dropMany, "function");
  assert.equal(typeof map.document.attrs.clear, "function");
  assert.equal(typeof map.document.attrs.replace, "function");
  assert.equal(typeof map.document.content, "function");
  assert.equal(typeof map.document.content.replace, "function");
  assert.equal(typeof map.document.content.insert, "function");
  assert.equal(typeof map.document.content.remove, "function");
  assert.equal(typeof map.document.content.move, "function");
  assert.equal("element" in map, false);
  assert.equal("fragment" in map, false);
  const dataObject = hson.liveMap.fromJson({});
  const dataArray = hson.liveMap.fromJson([]);
  assert.equal("element" in dataObject, false);
  assert.equal("fragment" in dataArray, false);
  assert.equal("document" in dataObject, false);
  assert.equal("document" in dataArray, false);

  const multiNodeDocumentMap = multiNodeDocument(`<main/> <aside/>`);
  assert.equal(typeof multiNodeDocumentMap.document.attrs.set, "function");
  assert.equal(typeof multiNodeDocumentMap.document.content, "function");
  assert.equal("fragment" in multiNodeDocumentMap, false);
});

check("path and QUID targets resolve the same ordinary elements", () => {
  const byPath = element(`<main @000000001 <p id="old" @000000002 "x"/>/>`);
  const byIdentity = element(`<main @000000001 <p id="old" @000000002 "x"/>/>`);
  byPath.document.attrs.set(elementPath(0, 0), "id", "new");
  byIdentity.document.attrs.set(quid("000000002"), "id", "new");
  assert.deepEqual(byPath.root(), byIdentity.root());
  assert.equal(byIdentity.document.byQuid("000000002")?.$_attrs?.id, "new");

  errorCode(() => byPath.document.attrs.set({ kind: "path", path: [-1] }, "id", "x"), "INVALID_DOCUMENT_PATH_INDEX");
  errorCode(() => byPath.document.attrs.set({ kind: "path", path: [1.5] }, "id", "x"), "INVALID_DOCUMENT_PATH_INDEX");
  errorCode(() => byPath.document.attrs.set({ kind: "path", path: [Number.POSITIVE_INFINITY] }, "id", "x"), "INVALID_DOCUMENT_PATH_INDEX");
  errorCode(() => byPath.document.attrs.set(elementPath(9), "id", "x"), "DOCUMENT_PATH_OUT_OF_RANGE");
  errorCode(() => byPath.document.attrs.set(quid("00000000d"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");
  errorCode(() => byPath.document.attrs.set({ kind: "quid", quid: "" }, "id", "x"), "INVALID_DOCUMENT_TARGET");
  errorCode(() => setAttrWithUnknownTarget(byPath, { kind: "path", path: [], quid: "p" }), "INVALID_DOCUMENT_TARGET");
  errorCode(() => setAttrWithUnknownTarget(byPath, byPath.document.byQuid("000000002")), "INVALID_DOCUMENT_TARGET");
});

check("attribute endpoints reject primitives, wrappers, unquidded and foreign identity", () => {
  const map = element(`<main "text" <span/>/>`);
  errorCode(() => map.document.attrs.set(elementPath(0, 0), "id", "x"), "DOCUMENT_TARGET_KIND");
  errorCode(() => map.document.attrs.set(quid("00000000c"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");
  const other = element(`<aside @00000000b/>`);
  assert.equal(other.document.byQuid("00000000b")?.$_tag, "aside");
  errorCode(() => map.document.attrs.set(quid("00000000b"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");

  const frag = multiNodeDocument(`<div/> <span/>`);
  errorCode(() => frag.document.attrs.set(path(), "id", "x"), "DOCUMENT_TARGET_KIND");
  frag.document.attrs.set(path(0), "id", "div-id");
  assert.equal(mustNode(frag.document.content()[0], "expected first multiNodeDocument element").$_attrs?.id, "div-id");
});

check("attrs.set creates and replaces one canonical attribute with no-op equality", () => {
  const map = element(`<main id="old" title="kept" style="color: red" data-user="meta" @000000001 "text"/>`);
  const beforeContent = documentElement(map).$_content;
  const first = map.document.attrs.set(elementPath(), "id", "new");
  assert.deepEqual(first, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target: elementPath(), name: "id", value: "new" }],
  });
  const node = documentElement(map);
  assert.equal(node.$_attrs?.id, "new");
  assert.equal(node.$_attrs?.title, "kept");
  assert.equal(node.$_attrs?.["data-user"], "meta");
  assert.deepEqual(node.$_content, beforeContent);
  assert.deepEqual(node.$_meta, { quid: "000000001" });

  assert.deepEqual(map.document.attrs.set(elementPath(), "id", "new"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  const created = map.document.attrs.set(elementPath(), "role", "main");
  assert.equal(created.ops[0]?.op, "set-attr");
  assert.equal(documentElement(map).$_attrs?.role, "main");
});

check("structured attribute input and commit payload are detached", () => {
  const map = element(`<main/>`);
  const style = { color: "red", width: { value: 2, unit: "px" } };
  const commit = map.document.attrs.set(elementPath(), "style", style);
  style.color = "changed";
  style.width.value = 3;
  const styleOp = commit.ops[0];
  if (styleOp?.op !== "set-attr" || typeof styleOp.value !== "object" || styleOp.value === null) throw new Error("expected structured set-attr op");
  Reflect.set(styleOp.value, "color", "commit-change");
  assert.deepEqual(documentElement(map).$_attrs?.style, { color: "red", width: { value: 2, unit: "px" } });

  const before = map.capture();
  assertAtomic(map, before, () => map.document.attrs.set(elementPath(), "bad name", "x"));
  errorCode(() => map.document.attrs.set(elementPath(), "count", { nope: true }), "INVALID_DOCUMENT_ATTRIBUTE_VALUE");
  errorCode(() => map.document.attrs.set(elementPath(), "count", Number.NaN), "INVALID_DOCUMENT_ATTRIBUTE_VALUE");
  map.document.attrs.set(elementPath(), "data-_quid", "application");
  assert.equal(map.document.attrs.get(elementPath(), "data-_quid"), "application");
  errorCode(() => map.document.attrs.set(elementPath(), "hson:quid", "new"), "PROTECTED_DOCUMENT_METADATA");
  errorCode(() => map.document.attrs.set(elementPath(), "hson:unknown", "new"), "PROTECTED_DOCUMENT_METADATA");
});

check("attrs.drop removes only existing ordinary attributes", () => {
  const map = element(`<main id="drop" title="keep" @000000001 "x"/>`);
  const changed = map.document.attrs.drop(quid("000000001"), "id");
  assert.deepEqual(changed, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{
      domain: "graph",
      op: "remove-attr",
      target: { kind: "path", path: [0], witness: { quid: "000000001" } },
      name: "id",
    }],
  });
  assert.deepEqual(documentElement(map).$_attrs, { title: "keep" });
  assert.equal(map.document.byQuid("000000001")?.$_tag, "main");
  assert.deepEqual(map.document.attrs.drop(elementPath(), "absent"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  errorCode(() => map.document.attrs.drop(elementPath(), "bad name"), "INVALID_DOCUMENT_ATTRIBUTE_NAME");
  errorCode(() => map.document.attrs.drop(elementPath(), "hson:quid"), "PROTECTED_DOCUMENT_METADATA");
});

check("attrs.setMany preserves unspecified attrs and emits one atomic replace-attrs", () => {
  const map = element(`<main id="old" title="kept" @000000020/>`);
  const observations: unknown[] = [];
  map.commits.observe((event) => observations.push(event));
  assert.deepEqual(map.document.attrs.setMany(elementPath(), {}), {
    changed: false, prevRev: 0, rev: 0, ops: [],
  });
  const values = {
    id: "new",
    hidden: false,
    count: 0,
    nullable: null,
    style: { color: "red", width: { value: 2, unit: "px" } },
  };
  const commit = map.document.attrs.setMany(elementPath(), values);
  assert.equal(commit.changed, true);
  assert.equal(commit.rev, 1);
  assert.equal(commit.ops.length, 1);
  assert.equal(commit.ops[0]?.op, "replace-attrs");
  if (commit.ops[0]?.op !== "replace-attrs") throw new Error("expected replace-attrs");
  assert.deepEqual(commit.ops[0].attrs, {
    count: 0,
    hidden: false,
    id: "new",
    nullable: null,
    style: { width: { unit: "px", value: 2 }, color: "red" },
    title: "kept",
  });
  assert.equal(observations.length, 1);
  assert.equal(map.document.byQuid("000000020")?.$_meta?.["quid"], "000000020");
  values.id = "caller-mutated";
  values.style.color = "blue";
  assert.equal(documentElement(map).$_attrs?.id, "new");
  assert.equal(documentElement(map).$_attrs?.style?.color, "red");
  assert.deepEqual(map.document.attrs.setMany(elementPath(), {
    id: "new", hidden: false, count: 0, nullable: null,
    style: { width: { unit: "px", value: 2 }, color: "red" },
  }), { changed: false, prevRev: 1, rev: 1, ops: [] });
});

check("attrs.setMany rejects every invalid bag atomically without partial application", () => {
  const invalid = [
    { good: "x", "bad name": "last" },
    { "bad name": "first", good: "x" },
    { good: "x", bad: undefined },
    { good: "x", "hson:unknown": "protected" },
    { good: "x", style: { color: [] } },
    { good: "x", style: { _hover: { color: "blue" } } },
  ];
  for (const values of invalid) {
    const map = element(`<main id="kept" @000000021/>`);
    const before = map.capture();
    assertAtomic(map, before, () => Reflect.apply(map.document.attrs.setMany, map.document.attrs, [elementPath(), values]));
    assert.equal(map.document.byQuid("000000021")?.$_attrs?.id, "kept");
  }
});

check("attrs.dropMany validates all names, ignores absence and duplicates, and compacts", () => {
  const map = element(`<main id="drop" title="keep" class="drop" @000000022/>`);
  assert.deepEqual(map.document.attrs.dropMany(elementPath(), []), {
    changed: false, prevRev: 0, rev: 0, ops: [],
  });
  assert.deepEqual(map.document.attrs.dropMany(elementPath(), ["absent"]), {
    changed: false, prevRev: 0, rev: 0, ops: [],
  });
  const commit = map.document.attrs.dropMany(quid("000000022"), ["id", "absent", "class", "id"]);
  assert.equal(commit.changed, true);
  assert.equal(commit.rev, 1);
  assert.equal(commit.ops.length, 1);
  assert.equal(commit.ops[0]?.op, "replace-attrs");
  assert.deepEqual(documentElement(map).$_attrs, { title: "keep" });
  const before = map.capture();
  assertAtomic(map, before, () => Reflect.apply(
    map.document.attrs.dropMany,
    map.document.attrs,
    [elementPath(), ["title", "bad name"]],
  ));
  assertAtomic(map, before, () => Reflect.apply(
    map.document.attrs.dropMany,
    map.document.attrs,
    [elementPath(), ["title", "hson:quid"]],
  ));
  const cleared = map.document.attrs.dropMany(elementPath(), ["title"]);
  assert.equal(cleared.ops[0]?.op, "replace-attrs");
  assert.equal(Object.prototype.hasOwnProperty.call(documentElement(map), "$_attrs"), false);
});

check("attrs.clear preserves metadata, identity, tag and content with compact no-op semantics", () => {
  const map = element(`<main id="old" style="color: red" @000000023 "text"/>`);
  const beforeContent = documentElement(map).$_content;
  const commit = map.document.attrs.clear(elementPath());
  assert.equal(commit.changed, true);
  assert.equal(commit.rev, 1);
  assert.deepEqual(commit.ops, [{ domain: "graph", op: "replace-attrs", target: elementPath(), attrs: {} }]);
  const node = documentElement(map);
  assert.equal(node.$_tag, "main");
  assert.deepEqual(node.$_content, beforeContent);
  assert.deepEqual(node.$_meta, { quid: "000000023" });
  assert.equal(Object.prototype.hasOwnProperty.call(node, "$_attrs"), false);
  assert.equal(map.document.byQuid("000000023")?.$_tag, "main");
  assert.deepEqual(map.document.attrs.clear(elementPath()), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
});

check("attrs.replace installs the exact canonical bag on multiNodeDocument and nested targets", () => {
  const map = multiNodeDocument(`<section id="old" title="removed" @000000024/> "tail"`);
  const values = {
    empty: "",
    hidden: false,
    count: 0,
    nullable: null,
    style: { color: "red" },
  };
  const commit = map.document.attrs.replace(quid("000000024"), values);
  assert.equal(commit.ops.length, 1);
  assert.equal(commit.ops[0]?.op, "replace-attrs");
  assert.deepEqual(map.document.byQuid("000000024")?.$_attrs, {
    count: 0, empty: "", hidden: false, nullable: null, style: { color: "red" },
  });
  values.style.color = "caller-mutated";
  assert.equal(map.document.byQuid("000000024")?.$_attrs?.style?.color, "red");
  assert.deepEqual(map.document.attrs.replace(path(0), {
    style: { color: "red" }, nullable: null, hidden: false, empty: "", count: 0,
  }), { changed: false, prevRev: 1, rev: 1, ops: [] });
  const before = map.capture();
  assertAtomic(map, before, () => Reflect.apply(
    map.document.attrs.replace,
    map.document.attrs,
    [path(0), { good: "x", "hson:index": "protected" }],
  ));
  assertAtomic(map, before, () => Reflect.apply(
    map.document.attrs.replace,
    map.document.attrs,
    [path(0), { style: { color: [] } }],
  ));
  const cleared = map.document.attrs.replace(path(0), {});
  assert.equal(cleared.ops[0]?.op, "replace-attrs");
  assert.equal(Object.prototype.hasOwnProperty.call(map.document.content()[0], "$_attrs"), false);
});

check("content.replace changes exactly one existing physical content slot", () => {
  const map = element(`<main @000000001 "one" <b @000000003 "two"/> "three"/>`);
  const clusterBefore = mustNode(documentElement(map).$_content[0], "expected element cluster before replacement");
  assert.equal(clusterBefore.$_content.length, 3);
  const replacement = ordinary(`<em @000000004 "middle"/>`);
  const commit = map.document.content.replace(elementPath(0), 1, replacement);
  assert.equal(commit.changed, true);
  assert.equal(commit.prevRev, 0);
  assert.equal(commit.rev, 1);
  assert.equal(commit.ops.length, 1);
  assert.deepEqual(commit.ops[0], {
    domain: "graph",
    op: "replace-content",
    target: elementPath(0),
    index: 1,
    replacement,
  });
  const cluster = mustNode(documentElement(map).$_content[0], "expected element cluster after replacement");
  assert.equal(cluster.$_content.length, 3);
  assert.equal(mustNode(cluster.$_content[0], "expected first text node").$_content[0], "one");
  assert.equal(mustNode(cluster.$_content[1], "expected replacement node").$_tag, "em");
  assert.equal(mustNode(cluster.$_content[2], "expected final text node").$_content[0], "three");
  assert.equal(documentElement(map).$_meta?.["quid"], "000000001");
  assert.equal(map.document.byQuid("000000003"), undefined);
  assert.equal(map.document.byQuid("000000004")?.$_tag, "em");

  replacement.$_tag = "caller-mutated";
  const replaceOp = commit.ops[0];
  if (replaceOp?.op !== "replace-content" || !is_Node(replaceOp.replacement)) throw new Error("expected replace-content node op");
  replaceOp.replacement.$_tag = "commit-mutated";
  assert.equal(map.document.byQuid("000000004")?.$_tag, "em");
});

check("primitive slots replace canonically and identical replacements are no-ops", () => {
  const map = element(`<main "text"/>`);
  const changed = map.document.content.replace(elementPath(0, 0), 0, "next");
  assert.deepEqual([changed.prevRev, changed.rev, map.rev], [0, 1, 1]);
  const outer = mustNode(documentElement(map).$_content[0], "expected outer element cluster");
  const inner = mustNode(outer.$_content[0], "expected inner element cluster");
  assert.equal(inner.$_content[0], "next");
  assert.deepEqual(map.document.content.replace(elementPath(0, 0), 0, "next"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });

  const clonedCurrent = structuredClone(inner);
  assert.deepEqual(map.document.content.replace(elementPath(0), 0, clonedCurrent), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  for (const index of [-1, 0.5, Number.POSITIVE_INFINITY]) {
    errorCode(() => map.document.content.replace(elementPath(0), index, ordinary(`<b/>`)), "INVALID_DOCUMENT_CONTENT_INDEX");
  }
  errorCode(() => map.document.content.replace(elementPath(0), 9, ordinary(`<b/>`)), "INVALID_DOCUMENT_CONTENT_INDEX");
  errorCode(() => replaceWithUnknown(map, undefined), "INVALID_DOCUMENT_REPLACEMENT");
});

check("content identity preflight handles removal, addition, collision, duplication and explicit continuity atomically", () => {
  const map = element(`<main @000000001 <old @000000005/> <keep @000000006/>/>`);
  const before = map.capture();

  const colliding = ordinary(`<new @000000006/>`);
  assertAtomic(map, before, () => map.document.content.replace(elementPath(0), 0, colliding));
  errorCode(() => map.document.content.replace(elementPath(0), 0, colliding), "DOCUMENT_IDENTITY_COLLISION");

  const duplicate = ordinary(`<section @000000007 <i @000000008/> <b @000000009/>/>`);
  const duplicateNode = nodes(duplicate).find((node) => node.$_tag === "b");
  if (duplicateNode === undefined) throw new Error("expected duplicate fixture node");
  duplicateNode.$_meta = { quid: "000000008" };
  errorCode(() => map.document.content.replace(elementPath(0), 0, duplicate), "DOCUMENT_IDENTITY_COLLISION");
  assert.deepEqual(map.capture(), before);

  const malformed = ordinary(`<section/>`);
  Reflect.set(malformed, "$_meta", { quid: 42 });
  errorCode(() => map.document.content.replace(elementPath(0), 0, malformed), "INVALID_DOCUMENT_IDENTITY");
  assert.deepEqual(map.capture(), before);

  const continuity = ordinary(`<new @000000005 <child/>/>`);
  const changed = map.document.content.replace(elementPath(0), 0, continuity);
  assert.equal(changed.changed, true);
  assert.equal(map.document.byQuid("000000005")?.$_tag, "new");
  assert.equal(map.document.byQuid("000000006")?.$_tag, "keep");
  assert.equal(nodes(map.root()).some((node) => node.$_tag === "child" && node.$_meta?.["quid"] !== undefined), false);
});

check("content.insert supports beginning, middle, append, empty, primitive and canonical node slots", () => {
  const map = element(`<main @000000010 "b" "d"/>`);
  const target = elementPath(0);
  const beginning = map.document.content.insert(target, 0, "a");
  assert.deepEqual(beginning, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "insert-content", target, index: 0, content: "a" }],
  });
  const inserted = ordinary(`<c @000000011/>`);
  const middle = map.document.content.insert(target, 2, inserted);
  assert.equal(middle.ops[0]?.op, "insert-content");
  const clusterBeforeAppend = mustNode(documentElement(map).$_content[0], "expected content cluster");
  const appended = map.document.content.insert(target, clusterBeforeAppend.$_content.length, "e");
  assert.deepEqual([beginning.rev, middle.rev, appended.rev, map.rev], [1, 2, 3, 3]);
  assert.equal(map.document.byQuid("000000011")?.$_tag, "c");
  const cluster = mustNode(documentElement(map).$_content[0], "expected appended content cluster");
  assert.deepEqual(cluster.$_content.map((item) => is_Node(item) ? item.$_tag : item), ["_hson_str", "_hson_str", "c", "_hson_str", "_hson_str"]);

  inserted.$_tag = "caller-mutated";
  const insertOp = middle.ops[0];
  if (insertOp?.op !== "insert-content" || !is_Node(insertOp.content)) throw new Error("expected node insert operation");
  insertOp.content.$_tag = "commit-mutated";
  assert.equal(map.document.byQuid("000000011")?.$_tag, "c");

  const empty = element(`<main/>`);
  const emptyCommit = empty.document.content.insert(elementPath(), 0, contentCluster(`<span "only"/>`));
  assert.equal(emptyCommit.changed, true);
  assert.equal(mustNode(documentElement(empty).$_content[0], "expected empty cluster").$_content.length, 1);
});

check("content.insert validates bounds, canonical identity and mode atomically", () => {
  const map = element(`<main @000000012 <keep @000000013/>/>`);
  const before = map.capture();
  for (const index of [-1, 0.5, Number.POSITIVE_INFINITY, 2]) {
    errorCode(() => map.document.content.insert(elementPath(0), index, "x"), "INVALID_DOCUMENT_CONTENT_INDEX");
  }
  const duplicate = ordinary(`<new @000000013/>`);
  errorCode(() => map.document.content.insert(elementPath(0), 1, duplicate), "DOCUMENT_IDENTITY_COLLISION");
  errorCode(() => insertWithUnknown(map, { $_tag: "bad" }), "INVALID_DOCUMENT_REPLACEMENT");
  assert.deepEqual(map.capture(), before);

  const multiNodeDocumentRoot = multiNodeDocument(`"left"`);
  const node = ordinary(`<aside @000000014/>`);
  multiNodeDocumentRoot.document.content.insert(path(), 1, node);
  assert.equal(multiNodeDocumentRoot.document.byQuid("000000014")?.$_tag, "aside");
});

check("content.remove supports every existing slot, QUID targets and mode-safe only-slot removal", () => {
  const map = element(`<main @000000015 "a" <b @000000016/> "c"/>`);
  const target = elementPath(0);
  assert.deepEqual(map.document.content.remove(target, 0).ops, [
    { domain: "graph", op: "remove-content", target, index: 0 },
  ]);
  assert.equal(map.document.content.remove(target, 1).changed, true);
  assert.equal(map.document.content.remove(elementPath(), 0).changed, true);
  assert.equal(map.document.byQuid("000000016"), undefined);
  assert.equal(documentElement(map).$_content.length, 0);

  const multiNodeDocumentOnly = multiNodeDocument(`"only"`);
  const multiNodeDocumentRemoval = multiNodeDocumentOnly.document.content.remove(path(), 0);
  assert.equal(multiNodeDocumentRemoval.ops[0]?.op, "remove-content");
  assert.equal(multiNodeDocumentOnly.mode, "document");
  assert.deepEqual(multiNodeDocumentOnly.root(), { $_tag: "_hson_root", $_content: [] });

  const byQuid = element(`<main @000000017/>`);
  byQuid.document.content.insert(quid("000000017"), 0, contentCluster(`<aside "x"/>`));
  assert.equal(byQuid.document.content.remove(quid("000000017"), 0).changed, true);
  for (const index of [-1, 0.5, 1, 9]) {
    errorCode(() => multiNodeDocument(`"only"`).document.content.remove(path(), index), "INVALID_DOCUMENT_CONTENT_INDEX");
  }
});

check("content.move uses final-position semantics and preserves QUID identity", () => {
  const forward = multiNodeDocument(`<a/> <b @000000018/> <c/> <d/>`);
  const forwardCommit = forward.document.content.move(path(), 1, 3);
  assert.deepEqual(forwardCommit, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "move-content", target: path(), from: 1, to: 3 }],
  });
  assert.deepEqual(forward.document.content().map((item) => mustNode(item, "expected element").$_tag), ["a", "c", "d", "b"]);
  assert.equal(forward.document.byQuid("000000018")?.$_tag, "b");

  const backward = multiNodeDocument(`<a/> <b/> <c/> <d @000000019/>`);
  backward.document.content.move(path(), 3, 1);
  assert.deepEqual(backward.document.content().map((item) => mustNode(item, "expected element").$_tag), ["a", "d", "b", "c"]);
  backward.document.content.move(path(), 0, 3);
  backward.document.content.move(path(), 3, 0);
  assert.equal(backward.document.byQuid("000000019")?.$_tag, "d");

  const byQuid = element(`<main @00000001a/>`);
  byQuid.document.content.insert(quid("00000001a"), 0, contentCluster(`<aside "x"/>`));
  assert.equal(byQuid.document.content.move(quid("00000001a"), 0, 0).changed, false);
});

check("same-position move is a complete no-op and invalid move indexes are atomic", () => {
  const map = multiNodeDocument(`<a/> <b @00000001b/>`);
  const observations: unknown[] = [];
  map.commits.observe((event) => observations.push(event));
  const before = map.capture();
  assert.deepEqual(map.document.content.move(path(), 1, 1), {
    changed: false, prevRev: 0, rev: 0, ops: [],
  });
  assert.deepEqual(map.capture(), before);
  assert.equal(observations.length, 0);
  for (const [from, to] of [[-1, 0], [0, -1], [2, 0], [0, 2], [0.5, 1]]) {
    errorCode(() => map.document.content.move(path(), from, to), "INVALID_DOCUMENT_CONTENT_INDEX");
    assert.deepEqual(map.capture(), before);
  }
});

check("multi-node document replacement preserves document authority and capture interoperability", () => {
  const map = multiNodeDocument(`"before" <div @000000009 "one"/> "after"`);
  const beforeCount = map.document.content().length;
  const replacement = ordinary(`<span @00000000a "middle"/>`);
  const changed = map.document.content.replace(path(), 1, replacement);
  assert.equal(changed.changed, true);
  assert.equal(map.document.content().length, beforeCount);
  assert.equal(map.document.byQuid("000000009"), undefined);
  assert.equal(map.document.byQuid("00000000a")?.$_tag, "span");

  const capture = map.capture();
  const target = multiNodeDocument(`"left" <b/> "right"`);
  const installed = target.install(capture);
  assert.equal(installed.ops[0]?.op, "replace-root");
  assert.deepEqual(target.root(), map.root());

  const textOnly = multiNodeDocument(`"text"`);
  const replacementCommit = textOnly.document.content.replace(path(), 0, ordinary(`<main/>`));
  assert.equal(replacementCommit.changed, true);
  assert.equal(textOnly.mode, "document");
  assert.equal(mustNode(textOnly.document.content()[0], "expected replacement element").$_tag, "main");
});

check("sequential changes advance once while failures and no-ops consume no revision", () => {
  const map = element(`<main id="a" "x"/>`);
  assert.equal(map.rev, 0);
  assert.deepEqual(map.document.attrs.set(elementPath(), "id", "b"), {
    changed: true, prevRev: 0, rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target: elementPath(), name: "id", value: "b" }],
  });
  assert.deepEqual(map.document.attrs.drop(elementPath(), "id"), {
    changed: true, prevRev: 1, rev: 2,
    ops: [{ domain: "graph", op: "remove-attr", target: elementPath(), name: "id" }],
  });
  assert.deepEqual(map.document.attrs.drop(elementPath(), "id"), { changed: false, prevRev: 2, rev: 2, ops: [] });
  errorCode(() => map.document.content.replace(elementPath(), 99, "bad"), "INVALID_DOCUMENT_CONTENT_INDEX");
  assert.equal(map.rev, 2);
});

process.stdout.write(`# ${checks} LiveMap document mutation checks passed\n`);
testEvents.terminal("pass");

import assert from "node:assert/strict";
import { hson, LiveMapDocumentMutationError } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode, Primitive } from "../src/core/types.ts";
import type { DocumentLiveMap, DocumentLiveMapCapture, ElementLiveMap, FragmentLiveMap, LiveMapDocumentTarget } from "../src/types/livemap.types.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`expected element, observed ${map.mode}`);
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`expected fragment, observed ${map.mode}`);
  return map;
}

const path = (...segments: number[]): LiveMapDocumentTarget => Object.freeze({ kind: "path", path: Object.freeze(segments) });
const quid = (value: string): LiveMapDocumentTarget => Object.freeze({ kind: "quid", quid: value });

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

function setAttrWithUnknownTarget(map: ElementLiveMap, target: unknown): unknown {
  return Reflect.apply(map.element.attrs.set, map.element.attrs, [target, "id", "x"]);
}

function replaceWithUnknown(map: ElementLiveMap, replacement: unknown): unknown {
  return Reflect.apply(map.element.content.replace, map.element.content, [path(0), 0, replacement]);
}

function insertWithUnknown(map: ElementLiveMap, content: unknown): unknown {
  return Reflect.apply(map.element.content.insert, map.element.content, [path(0), 0, content]);
}

check("document capabilities use attrs and content namespaces only", () => {
  const map = element(`<main/>`);
  assert.equal(typeof map.element.attrs.set, "function");
  assert.equal(typeof map.element.attrs.drop, "function");
  assert.equal(typeof map.element.content, "function");
  assert.equal(typeof map.element.content.replace, "function");
  assert.equal(typeof map.element.content.insert, "function");
  assert.equal(typeof map.element.content.remove, "function");
  assert.equal(typeof map.element.content.move, "function");
  for (const key of ["setAttr", "setAttrs", "removeAttr", "removeAttrs", "replaceContent"]) {
    assert.equal(key in map.element, false);
  }
  const dataObject = hson.liveMap.fromJson({});
  const dataArray = hson.liveMap.fromJson([]);
  assert.equal("element" in dataObject, false);
  assert.equal("fragment" in dataArray, false);
});

check("path and QUID targets resolve the same ordinary elements", () => {
  const byPath = element(`<main data-_quid="0000000000000001" <p id="old" data-_quid="0000000000000002" "x"/>/>`);
  const byIdentity = element(`<main data-_quid="0000000000000001" <p id="old" data-_quid="0000000000000002" "x"/>/>`);
  byPath.element.attrs.set(path(0, 0), "id", "new");
  byIdentity.element.attrs.set(quid("0000000000000002"), "id", "new");
  assert.deepEqual(byPath.root(), byIdentity.root());
  assert.equal(byIdentity.element.byQuid("0000000000000002")?.$_attrs?.id, "new");

  errorCode(() => byPath.element.attrs.set({ kind: "path", path: [-1] }, "id", "x"), "INVALID_DOCUMENT_PATH");
  errorCode(() => byPath.element.attrs.set({ kind: "path", path: [1.5] }, "id", "x"), "INVALID_DOCUMENT_PATH");
  errorCode(() => byPath.element.attrs.set({ kind: "path", path: [Number.POSITIVE_INFINITY] }, "id", "x"), "INVALID_DOCUMENT_PATH");
  errorCode(() => byPath.element.attrs.set(path(9), "id", "x"), "DOCUMENT_PATH_OUT_OF_RANGE");
  errorCode(() => byPath.element.attrs.set(quid("000000000000000d"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");
  errorCode(() => byPath.element.attrs.set({ kind: "quid", quid: "" }, "id", "x"), "INVALID_DOCUMENT_TARGET");
  errorCode(() => setAttrWithUnknownTarget(byPath, { kind: "path", path: [], quid: "p" }), "INVALID_DOCUMENT_TARGET");
  errorCode(() => setAttrWithUnknownTarget(byPath, byPath.element.byQuid("0000000000000002")), "INVALID_DOCUMENT_TARGET");
});

check("attribute endpoints reject primitives, wrappers, unquidded and foreign identity", () => {
  const map = element(`<main "text" <span/>/>`);
  errorCode(() => map.element.attrs.set(path(0, 0), "id", "x"), "DOCUMENT_TARGET_KIND");
  errorCode(() => map.element.attrs.set(quid("000000000000000c"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");
  const other = element(`<aside data-_quid="000000000000000b"/>`);
  assert.equal(other.element.byQuid("000000000000000b")?.$_tag, "aside");
  errorCode(() => map.element.attrs.set(quid("000000000000000b"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");

  const frag = fragment(`<div/> <span/>`);
  errorCode(() => frag.fragment.attrs.set(path(), "id", "x"), "DOCUMENT_TARGET_KIND");
  frag.fragment.attrs.set(path(0), "id", "div-id");
  assert.equal(mustNode(frag.fragment.content()[0], "expected first fragment element").$_attrs?.id, "div-id");
});

check("attrs.set creates and replaces one canonical attribute with no-op equality", () => {
  const map = element(`<main id="old" title="kept" style="color: red" data-_quid="0000000000000001" data-_custom="meta" "text"/>`);
  const beforeContent = map.element.node().$_content;
  const first = map.element.attrs.set(path(), "id", "new");
  assert.deepEqual(first, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target: path(), name: "id", value: "new" }],
  });
  const node = map.element.node();
  assert.equal(node.$_attrs?.id, "new");
  assert.equal(node.$_attrs?.title, "kept");
  assert.deepEqual(node.$_content, beforeContent);
  assert.deepEqual(node.$_meta, { "data-_quid": "0000000000000001", "data-_custom": "meta" });

  assert.deepEqual(map.element.attrs.set(path(), "id", "new"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  const created = map.element.attrs.set(path(), "role", "main");
  assert.equal(created.ops[0]?.op, "set-attr");
  assert.equal(map.element.node().$_attrs?.role, "main");
});

check("structured attribute input and commit payload are detached", () => {
  const map = element(`<main/>`);
  const style = { color: "red", _hover: { color: "blue" } };
  const commit = map.element.attrs.set(path(), "style", style);
  style.color = "changed";
  style._hover.color = "changed";
  const styleOp = commit.ops[0];
  if (styleOp?.op !== "set-attr" || typeof styleOp.value !== "object" || styleOp.value === null) throw new Error("expected structured set-attr op");
  Reflect.set(styleOp.value, "color", "commit-change");
  assert.deepEqual(map.element.node().$_attrs?.style, { color: "red", _hover: { color: "blue" } });

  const before = map.capture();
  assertAtomic(map, before, () => map.element.attrs.set(path(), "bad name", "x"));
  errorCode(() => map.element.attrs.set(path(), "count", { nope: true }), "INVALID_DOCUMENT_ATTRIBUTE_VALUE");
  errorCode(() => map.element.attrs.set(path(), "count", Number.NaN), "INVALID_DOCUMENT_ATTRIBUTE_VALUE");
  errorCode(() => map.element.attrs.set(path(), "data-_quid", "new"), "PROTECTED_DOCUMENT_METADATA");
  errorCode(() => map.element.attrs.set(path(), "data-_custom", "new"), "PROTECTED_DOCUMENT_METADATA");
});

check("attrs.drop removes only existing ordinary attributes", () => {
  const map = element(`<main id="drop" title="keep" data-_quid="0000000000000001" "x"/>`);
  const changed = map.element.attrs.drop(quid("0000000000000001"), "id");
  assert.deepEqual(changed, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "remove-attr", target: quid("0000000000000001"), name: "id" }],
  });
  assert.deepEqual(map.element.node().$_attrs, { title: "keep" });
  assert.equal(map.element.byQuid("0000000000000001")?.$_tag, "main");
  assert.deepEqual(map.element.attrs.drop(path(), "absent"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  errorCode(() => map.element.attrs.drop(path(), "bad name"), "INVALID_DOCUMENT_ATTRIBUTE_NAME");
  errorCode(() => map.element.attrs.drop(path(), "data-_quid"), "PROTECTED_DOCUMENT_METADATA");
});

check("content.replace changes exactly one existing physical content slot", () => {
  const map = element(`<main data-_quid="0000000000000001" "one" <b data-_quid="0000000000000003" "two"/> "three"/>`);
  const clusterBefore = mustNode(map.element.node().$_content[0], "expected element cluster before replacement");
  assert.equal(clusterBefore.$_content.length, 3);
  const replacement = ordinary(`<em data-_quid="0000000000000004" "middle"/>`);
  const commit = map.element.content.replace(path(0), 1, replacement);
  assert.equal(commit.changed, true);
  assert.equal(commit.prevRev, 0);
  assert.equal(commit.rev, 1);
  assert.equal(commit.ops.length, 1);
  assert.deepEqual(commit.ops[0], {
    domain: "graph",
    op: "replace-content",
    target: path(0),
    index: 1,
    replacement,
  });
  const cluster = mustNode(map.element.node().$_content[0], "expected element cluster after replacement");
  assert.equal(cluster.$_content.length, 3);
  assert.equal(mustNode(cluster.$_content[0], "expected first text node").$_content[0], "one");
  assert.equal(mustNode(cluster.$_content[1], "expected replacement node").$_tag, "em");
  assert.equal(mustNode(cluster.$_content[2], "expected final text node").$_content[0], "three");
  assert.equal(map.element.node().$_meta?.["data-_quid"], "0000000000000001");
  assert.equal(map.element.byQuid("0000000000000003"), undefined);
  assert.equal(map.element.byQuid("0000000000000004")?.$_tag, "em");

  replacement.$_tag = "caller-mutated";
  const replaceOp = commit.ops[0];
  if (replaceOp?.op !== "replace-content" || !is_Node(replaceOp.replacement)) throw new Error("expected replace-content node op");
  replaceOp.replacement.$_tag = "commit-mutated";
  assert.equal(map.element.byQuid("0000000000000004")?.$_tag, "em");
});

check("primitive slots replace canonically and identical replacements are no-ops", () => {
  const map = element(`<main "text"/>`);
  const changed = map.element.content.replace(path(0, 0), 0, "next");
  assert.deepEqual([changed.prevRev, changed.rev, map.rev], [0, 1, 1]);
  const outer = mustNode(map.element.node().$_content[0], "expected outer element cluster");
  const inner = mustNode(outer.$_content[0], "expected inner element cluster");
  assert.equal(inner.$_content[0], "next");
  assert.deepEqual(map.element.content.replace(path(0, 0), 0, "next"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });

  const clonedCurrent = structuredClone(inner);
  assert.deepEqual(map.element.content.replace(path(0), 0, clonedCurrent), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  for (const index of [-1, 0.5, Number.POSITIVE_INFINITY]) {
    errorCode(() => map.element.content.replace(path(0), index, ordinary(`<b/>`)), "INVALID_DOCUMENT_CONTENT_INDEX");
  }
  errorCode(() => map.element.content.replace(path(0), 9, ordinary(`<b/>`)), "INVALID_DOCUMENT_CONTENT_INDEX");
  errorCode(() => replaceWithUnknown(map, undefined), "INVALID_DOCUMENT_REPLACEMENT");
});

check("content identity preflight handles removal, addition, collision, duplication and displaced reuse atomically", () => {
  const map = element(`<main data-_quid="0000000000000001" <old data-_quid="0000000000000005"/> <keep data-_quid="0000000000000006"/>/>`);
  const before = map.capture();

  const colliding = ordinary(`<new data-_quid="0000000000000006"/>`);
  assertAtomic(map, before, () => map.element.content.replace(path(0), 0, colliding));
  errorCode(() => map.element.content.replace(path(0), 0, colliding), "INVALID_DOCUMENT_IDENTITY");

  const duplicate = ordinary(`<section data-_quid="0000000000000007" <i data-_quid="0000000000000008"/> <b data-_quid="0000000000000008"/>/>`);
  errorCode(() => map.element.content.replace(path(0), 0, duplicate), "INVALID_DOCUMENT_IDENTITY");
  assert.deepEqual(map.capture(), before);

  const malformed = ordinary(`<section/>`);
  Reflect.set(malformed, "$_meta", { "data-_quid": 42 });
  errorCode(() => map.element.content.replace(path(0), 0, malformed), "INVALID_DOCUMENT_IDENTITY");
  assert.deepEqual(map.capture(), before);

  const reuse = ordinary(`<new data-_quid="0000000000000005" <child/>/>`);
  const changed = map.element.content.replace(path(0), 0, reuse);
  assert.equal(changed.changed, true);
  assert.equal(map.element.byQuid("0000000000000005")?.$_tag, "new");
  assert.equal(map.element.byQuid("0000000000000006")?.$_tag, "keep");
  assert.equal(nodes(map.root()).some((node) => node.$_tag === "child" && node.$_meta?.["data-_quid"] !== undefined), false);
});

check("content.insert supports beginning, middle, append, empty, primitive and canonical node slots", () => {
  const map = element(`<main data-_quid="0000000000000010" "b" "d"/>`);
  const target = path(0);
  const beginning = map.element.content.insert(target, 0, "a");
  assert.deepEqual(beginning, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "insert-content", target, index: 0, content: "a" }],
  });
  const inserted = ordinary(`<c data-_quid="0000000000000011"/>`);
  const middle = map.element.content.insert(target, 2, inserted);
  assert.equal(middle.ops[0]?.op, "insert-content");
  const clusterBeforeAppend = mustNode(map.element.node().$_content[0], "expected content cluster");
  const appended = map.element.content.insert(target, clusterBeforeAppend.$_content.length, "e");
  assert.deepEqual([beginning.rev, middle.rev, appended.rev, map.rev], [1, 2, 3, 3]);
  assert.equal(map.element.byQuid("0000000000000011")?.$_tag, "c");
  const cluster = mustNode(map.element.node().$_content[0], "expected appended content cluster");
  assert.deepEqual(cluster.$_content.map((item) => is_Node(item) ? item.$_tag : item), ["_hson_str", "_hson_str", "c", "_hson_str", "_hson_str"]);

  inserted.$_tag = "caller-mutated";
  const insertOp = middle.ops[0];
  if (insertOp?.op !== "insert-content" || !is_Node(insertOp.content)) throw new Error("expected node insert operation");
  insertOp.content.$_tag = "commit-mutated";
  assert.equal(map.element.byQuid("0000000000000011")?.$_tag, "c");

  const empty = element(`<main/>`);
  const emptyCommit = empty.element.content.insert(path(0), 0, "only");
  assert.equal(emptyCommit.changed, true);
  assert.equal(mustNode(empty.element.node().$_content[0], "expected empty cluster").$_content.length, 1);
});

check("content.insert validates bounds, canonical identity and mode atomically", () => {
  const map = element(`<main data-_quid="0000000000000012" <keep data-_quid="0000000000000013"/>/>`);
  const before = map.capture();
  for (const index of [-1, 0.5, Number.POSITIVE_INFINITY, 2]) {
    errorCode(() => map.element.content.insert(path(0), index, "x"), "INVALID_DOCUMENT_CONTENT_INDEX");
  }
  const duplicate = ordinary(`<new data-_quid="0000000000000013"/>`);
  errorCode(() => map.element.content.insert(path(0), 1, duplicate), "INVALID_DOCUMENT_IDENTITY");
  errorCode(() => insertWithUnknown(map, { $_tag: "bad" }), "INVALID_DOCUMENT_REPLACEMENT");
  assert.deepEqual(map.capture(), before);

  const fragmentRoot = fragment(`"left"`);
  const node = ordinary(`<aside data-_quid="0000000000000014"/>`);
  fragmentRoot.fragment.content.insert(path(), 1, node);
  assert.equal(fragmentRoot.fragment.byQuid("0000000000000014")?.$_tag, "aside");
});

check("content.remove supports every existing slot, QUID targets and mode-safe only-slot removal", () => {
  const map = element(`<main data-_quid="0000000000000015" "a" <b data-_quid="0000000000000016"/> "c"/>`);
  const target = path(0);
  assert.deepEqual(map.element.content.remove(target, 0).ops, [
    { domain: "graph", op: "remove-content", target, index: 0 },
  ]);
  assert.equal(map.element.content.remove(target, 1).changed, true);
  assert.equal(map.element.content.remove(target, 0).changed, true);
  assert.equal(map.element.byQuid("0000000000000016"), undefined);
  assert.equal(mustNode(map.element.node().$_content[0], "expected emptied cluster").$_content.length, 0);

  const fragmentOnly = fragment(`"only"`);
  assert.equal(fragmentOnly.fragment.content.remove(path(), 0).changed, true);
  assert.equal(fragmentOnly.mode, "fragment");
  assert.equal(fragmentOnly.fragment.content().length, 0);

  const byQuid = element(`<main data-_quid="0000000000000017"/>`);
  byQuid.element.content.insert(quid("0000000000000017"), 1, contentCluster(`<aside/>`));
  assert.equal(byQuid.element.content.remove(quid("0000000000000017"), 1).changed, true);
  for (const index of [-1, 0.5, 1, 9]) {
    errorCode(() => fragmentOnly.fragment.content.remove(path(), index), "INVALID_DOCUMENT_CONTENT_INDEX");
  }
});

check("content.move uses final-position semantics and preserves QUID identity", () => {
  const forward = fragment(`<a/> <b data-_quid="0000000000000018"/> <c/> <d/>`);
  const forwardCommit = forward.fragment.content.move(path(), 1, 3);
  assert.deepEqual(forwardCommit, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "move-content", target: path(), from: 1, to: 3 }],
  });
  assert.deepEqual(forward.fragment.content().map((item) => mustNode(item, "expected element").$_tag), ["a", "c", "d", "b"]);
  assert.equal(forward.fragment.byQuid("0000000000000018")?.$_tag, "b");

  const backward = fragment(`<a/> <b/> <c/> <d data-_quid="0000000000000019"/>`);
  backward.fragment.content.move(path(), 3, 1);
  assert.deepEqual(backward.fragment.content().map((item) => mustNode(item, "expected element").$_tag), ["a", "d", "b", "c"]);
  backward.fragment.content.move(path(), 0, 3);
  backward.fragment.content.move(path(), 3, 0);
  assert.equal(backward.fragment.byQuid("0000000000000019")?.$_tag, "d");

  const byQuid = element(`<main data-_quid="000000000000001a"/>`);
  byQuid.element.content.insert(quid("000000000000001a"), 1, contentCluster(`<aside "x"/>`));
  assert.equal(byQuid.element.content.move(quid("000000000000001a"), 0, 1).changed, true);
});

check("same-position move is a complete no-op and invalid move indexes are atomic", () => {
  const map = fragment(`<a/> <b data-_quid="000000000000001b"/>`);
  const observations: unknown[] = [];
  map.commits.observe((event) => observations.push(event));
  const before = map.capture();
  assert.deepEqual(map.fragment.content.move(path(), 1, 1), {
    changed: false, prevRev: 0, rev: 0, ops: [],
  });
  assert.deepEqual(map.capture(), before);
  assert.equal(observations.length, 0);
  for (const [from, to] of [[-1, 0], [0, -1], [2, 0], [0, 2], [0.5, 1]]) {
    errorCode(() => map.fragment.content.move(path(), from, to), "INVALID_DOCUMENT_CONTENT_INDEX");
    assert.deepEqual(map.capture(), before);
  }
});

check("fragment root replacement preserves mode and supports capture/install interoperability", () => {
  const map = fragment(`"before" <div data-_quid="0000000000000009" "one"/> "after"`);
  const beforeCount = map.fragment.content().length;
  const replacement = ordinary(`<span data-_quid="000000000000000a" "middle"/>`);
  const changed = map.fragment.content.replace(path(), 1, replacement);
  assert.equal(changed.changed, true);
  assert.equal(map.fragment.content().length, beforeCount);
  assert.equal(map.fragment.byQuid("0000000000000009"), undefined);
  assert.equal(map.fragment.byQuid("000000000000000a")?.$_tag, "span");

  const capture = map.capture();
  const target = fragment(`"left" <b/> "right"`);
  const installed = target.install(capture);
  assert.equal(installed.ops[0]?.op, "replace-root");
  assert.deepEqual(target.root(), map.root());

  const textOnly = fragment(`"text"`);
  const prior = textOnly.capture();
  errorCode(() => textOnly.fragment.content.replace(path(), 0, ordinary(`<main/>`)), "DOCUMENT_MODE_MISMATCH");
  assert.deepEqual(textOnly.capture(), prior);
});

check("sequential changes advance once while failures and no-ops consume no revision", () => {
  const map = element(`<main id="a" "x"/>`);
  assert.equal(map.rev, 0);
  assert.deepEqual(map.element.attrs.set(path(), "id", "b"), {
    changed: true, prevRev: 0, rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target: path(), name: "id", value: "b" }],
  });
  assert.deepEqual(map.element.attrs.drop(path(), "id"), {
    changed: true, prevRev: 1, rev: 2,
    ops: [{ domain: "graph", op: "remove-attr", target: path(), name: "id" }],
  });
  assert.deepEqual(map.element.attrs.drop(path(), "id"), { changed: false, prevRev: 2, rev: 2, ops: [] });
  errorCode(() => map.element.content.replace(path(), 99, "bad"), "INVALID_DOCUMENT_CONTENT_INDEX");
  assert.equal(map.rev, 2);
});

process.stdout.write(`# ${checks} LiveMap document mutation checks passed\n`);

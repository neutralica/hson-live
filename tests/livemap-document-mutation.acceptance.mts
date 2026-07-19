import assert from "node:assert/strict";
import { hson, LiveMapDocumentMutationError } from "../src/index.ts";

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source) {
  const map = hson.liveMap.fromHson(source);
  assert.equal(map.mode, "element");
  return map;
}

function fragment(source) {
  const map = hson.liveMap.fromHson(source);
  assert.equal(map.mode, "fragment");
  return map;
}

const path = (...segments) => Object.freeze({ kind: "path", path: Object.freeze(segments) });
const quid = (value) => Object.freeze({ kind: "quid", quid: value });

function nodes(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    out.push(node);
    for (let index = node.$_content.length - 1; index >= 0; index -= 1) {
      const child = node.$_content[index];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return out;
}

function ordinary(source) {
  const root = hson.fromHson(source).toNode();
  const node = nodes(root).find((candidate) => !candidate.$_tag.startsWith("_hson_"));
  assert.ok(node);
  return node;
}

function contentCluster(source) {
  const node = ordinary(source);
  const cluster = node.$_content[0];
  assert.ok(cluster && typeof cluster === "object" && cluster.$_tag === "_hson_elem");
  return cluster;
}

function errorCode(fn, code) {
  assert.throws(fn, (cause) => cause instanceof LiveMapDocumentMutationError && cause.code === code);
}

function assertAtomic(map, before, fn) {
  const rev = map.rev;
  assert.throws(fn);
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, rev);
}

check("document capabilities use attrs and content namespaces only", () => {
  const map = element(`<main/>`);
  assert.equal(typeof map.element.attrs.set, "function");
  assert.equal(typeof map.element.attrs.drop, "function");
  assert.equal(typeof map.element.content, "function");
  assert.equal(typeof map.element.content.replace, "function");
  for (const key of ["setAttr", "setAttrs", "removeAttr", "removeAttrs", "replaceContent"]) {
    assert.equal(key in map.element, false);
  }
  const dataObject = hson.liveMap.fromJson({});
  const dataArray = hson.liveMap.fromJson([]);
  assert.equal("element" in dataObject, false);
  assert.equal("fragment" in dataArray, false);
});

check("path and QUID targets resolve the same ordinary elements", () => {
  const byPath = element(`<main data-_quid="main" <p id="old" data-_quid="p" "x"/>/>`);
  const byIdentity = element(`<main data-_quid="main" <p id="old" data-_quid="p" "x"/>/>`);
  byPath.element.attrs.set(path(0, 0), "id", "new");
  byIdentity.element.attrs.set(quid("p"), "id", "new");
  assert.deepEqual(byPath.root(), byIdentity.root());
  assert.equal(byIdentity.element.byQuid("p")?.$_attrs?.id, "new");

  errorCode(() => byPath.element.attrs.set({ kind: "path", path: [-1] }, "id", "x"), "INVALID_DOCUMENT_PATH");
  errorCode(() => byPath.element.attrs.set({ kind: "path", path: [1.5] }, "id", "x"), "INVALID_DOCUMENT_PATH");
  errorCode(() => byPath.element.attrs.set({ kind: "path", path: [Number.POSITIVE_INFINITY] }, "id", "x"), "INVALID_DOCUMENT_PATH");
  errorCode(() => byPath.element.attrs.set(path(9), "id", "x"), "DOCUMENT_PATH_OUT_OF_RANGE");
  errorCode(() => byPath.element.attrs.set(quid("missing"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");
  errorCode(() => byPath.element.attrs.set({ kind: "quid", quid: "" }, "id", "x"), "INVALID_DOCUMENT_TARGET");
  errorCode(() => byPath.element.attrs.set({ kind: "path", path: [], quid: "p" }, "id", "x"), "INVALID_DOCUMENT_TARGET");
  errorCode(() => byPath.element.attrs.set(byPath.element.byQuid("p"), "id", "x"), "INVALID_DOCUMENT_TARGET");
});

check("attribute endpoints reject primitives, wrappers, unquidded and foreign identity", () => {
  const map = element(`<main "text" <span/>/>`);
  errorCode(() => map.element.attrs.set(path(0, 0), "id", "x"), "DOCUMENT_TARGET_KIND");
  errorCode(() => map.element.attrs.set(quid("absent"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");
  const other = element(`<aside data-_quid="foreign"/>`);
  assert.equal(other.element.byQuid("foreign")?.$_tag, "aside");
  errorCode(() => map.element.attrs.set(quid("foreign"), "id", "x"), "DOCUMENT_TARGET_NOT_FOUND");

  const frag = fragment(`<div/> <span/>`);
  errorCode(() => frag.fragment.attrs.set(path(), "id", "x"), "DOCUMENT_TARGET_KIND");
  frag.fragment.attrs.set(path(0), "id", "div-id");
  assert.equal(frag.fragment.content()[0].$_attrs.id, "div-id");
});

check("attrs.set creates and replaces one canonical attribute with no-op equality", () => {
  const map = element(`<main id="old" title="kept" style="color: red" data-_quid="main" data-_custom="meta" "text"/>`);
  const beforeContent = map.element.node().$_content;
  const first = map.element.attrs.set(path(), "id", "new");
  assert.deepEqual(first, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target: path(), name: "id", value: "new" }],
  });
  const node = map.element.node();
  assert.equal(node.$_attrs.id, "new");
  assert.equal(node.$_attrs.title, "kept");
  assert.deepEqual(node.$_content, beforeContent);
  assert.deepEqual(node.$_meta, { "data-_quid": "main", "data-_custom": "meta" });

  assert.deepEqual(map.element.attrs.set(path(), "id", "new"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  const created = map.element.attrs.set(path(), "role", "main");
  assert.equal(created.ops[0].op, "set-attr");
  assert.equal(map.element.node().$_attrs.role, "main");
});

check("structured attribute input and commit payload are detached", () => {
  const map = element(`<main/>`);
  const style = { color: "red", _hover: { color: "blue" } };
  const commit = map.element.attrs.set(path(), "style", style);
  style.color = "changed";
  style._hover.color = "changed";
  commit.ops[0].value.color = "commit-change";
  assert.deepEqual(map.element.node().$_attrs.style, { color: "red", _hover: { color: "blue" } });

  const before = map.capture();
  assertAtomic(map, before, () => map.element.attrs.set(path(), "bad name", "x"));
  errorCode(() => map.element.attrs.set(path(), "count", { nope: true }), "INVALID_DOCUMENT_ATTRIBUTE_VALUE");
  errorCode(() => map.element.attrs.set(path(), "count", Number.NaN), "INVALID_DOCUMENT_ATTRIBUTE_VALUE");
  errorCode(() => map.element.attrs.set(path(), "data-_quid", "new"), "PROTECTED_DOCUMENT_METADATA");
  errorCode(() => map.element.attrs.set(path(), "data-_custom", "new"), "PROTECTED_DOCUMENT_METADATA");
});

check("attrs.drop removes only existing ordinary attributes", () => {
  const map = element(`<main id="drop" title="keep" data-_quid="main" "x"/>`);
  const changed = map.element.attrs.drop(quid("main"), "id");
  assert.deepEqual(changed, {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "remove-attr", target: quid("main"), name: "id" }],
  });
  assert.deepEqual(map.element.node().$_attrs, { title: "keep" });
  assert.equal(map.element.byQuid("main").$_tag, "main");
  assert.deepEqual(map.element.attrs.drop(path(), "absent"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  errorCode(() => map.element.attrs.drop(path(), "bad name"), "INVALID_DOCUMENT_ATTRIBUTE_NAME");
  errorCode(() => map.element.attrs.drop(path(), "data-_quid"), "PROTECTED_DOCUMENT_METADATA");
});

check("content.replace changes exactly one existing physical content slot", () => {
  const map = element(`<main data-_quid="main" "one" <b data-_quid="b" "two"/> "three"/>`);
  const clusterBefore = map.element.node().$_content[0];
  assert.equal(clusterBefore.$_content.length, 3);
  const replacement = ordinary(`<em data-_quid="em" "middle"/>`);
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
  const cluster = map.element.node().$_content[0];
  assert.equal(cluster.$_content.length, 3);
  assert.equal(cluster.$_content[0].$_content[0], "one");
  assert.equal(cluster.$_content[1].$_tag, "em");
  assert.equal(cluster.$_content[2].$_content[0], "three");
  assert.equal(map.element.node().$_meta["data-_quid"], "main");
  assert.equal(map.element.byQuid("b"), undefined);
  assert.equal(map.element.byQuid("em").$_tag, "em");

  replacement.$_tag = "caller-mutated";
  commit.ops[0].replacement.$_tag = "commit-mutated";
  assert.equal(map.element.byQuid("em").$_tag, "em");
});

check("primitive slots replace canonically and identical replacements are no-ops", () => {
  const map = element(`<main "text"/>`);
  const changed = map.element.content.replace(path(0, 0), 0, "next");
  assert.deepEqual([changed.prevRev, changed.rev, map.rev], [0, 1, 1]);
  assert.equal(map.element.node().$_content[0].$_content[0].$_content[0], "next");
  assert.deepEqual(map.element.content.replace(path(0, 0), 0, "next"), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });

  const clonedCurrent = structuredClone(map.element.node().$_content[0].$_content[0]);
  assert.deepEqual(map.element.content.replace(path(0), 0, clonedCurrent), {
    changed: false, prevRev: 1, rev: 1, ops: [],
  });
  for (const index of [-1, 0.5, Number.POSITIVE_INFINITY]) {
    errorCode(() => map.element.content.replace(path(0), index, ordinary(`<b/>`)), "INVALID_DOCUMENT_CONTENT_INDEX");
  }
  errorCode(() => map.element.content.replace(path(0), 9, ordinary(`<b/>`)), "INVALID_DOCUMENT_CONTENT_INDEX");
  errorCode(() => map.element.content.replace(path(0), 0, undefined), "INVALID_DOCUMENT_REPLACEMENT");
});

check("content identity preflight handles removal, addition, collision, duplication and displaced reuse atomically", () => {
  const map = element(`<main data-_quid="main" <old data-_quid="old"/> <keep data-_quid="keep"/>/>`);
  const before = map.capture();

  const colliding = ordinary(`<new data-_quid="keep"/>`);
  assertAtomic(map, before, () => map.element.content.replace(path(0), 0, colliding));
  errorCode(() => map.element.content.replace(path(0), 0, colliding), "INVALID_DOCUMENT_IDENTITY");

  const duplicate = ordinary(`<section data-_quid="new" <i data-_quid="dup"/> <b data-_quid="dup"/>/>`);
  errorCode(() => map.element.content.replace(path(0), 0, duplicate), "INVALID_DOCUMENT_IDENTITY");
  assert.deepEqual(map.capture(), before);

  const malformed = ordinary(`<section/>`);
  malformed.$_meta = { "data-_quid": 42 };
  errorCode(() => map.element.content.replace(path(0), 0, malformed), "INVALID_DOCUMENT_IDENTITY");
  assert.deepEqual(map.capture(), before);

  const reuse = ordinary(`<new data-_quid="old" <child/>/>`);
  const changed = map.element.content.replace(path(0), 0, reuse);
  assert.equal(changed.changed, true);
  assert.equal(map.element.byQuid("old").$_tag, "new");
  assert.equal(map.element.byQuid("keep").$_tag, "keep");
  assert.equal(nodes(map.root()).some((node) => node.$_tag === "child" && node.$_meta?.["data-_quid"] !== undefined), false);
});

check("fragment root replacement preserves mode and supports capture/install interoperability", () => {
  const map = fragment(`"before" <div data-_quid="div" "one"/> "after"`);
  const beforeCount = map.fragment.content().length;
  const replacement = ordinary(`<span data-_quid="span" "middle"/>`);
  const changed = map.fragment.content.replace(path(), 1, replacement);
  assert.equal(changed.changed, true);
  assert.equal(map.fragment.content().length, beforeCount);
  assert.equal(map.fragment.byQuid("div"), undefined);
  assert.equal(map.fragment.byQuid("span").$_tag, "span");

  const capture = map.capture();
  const target = fragment(`"left" <b/> "right"`);
  const installed = target.install(capture);
  assert.equal(installed.ops[0].op, "replace-root");
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

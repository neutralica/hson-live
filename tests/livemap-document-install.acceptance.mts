import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type {
  DocumentLiveMapCapture,
  DocumentLiveMap,
} from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import { internal_livemap_node } from "../src/api/livemap/livemap.internal.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-install",
  title: "Document LiveMap installation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "installation", "identity"]),
});

const testEvents = create_test_event_emitter("livemap.document-install");
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
  if (map.mode !== "document") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected multiNodeDocument, observed ${map.mode}`);
  return map;
}

function nodes(root: HsonNode): HsonNode[] {
  const result: HsonNode[] = [];
  const visit = (node: HsonNode): void => {
    result.push(node);
    for (const item of node.$_content) {
      if (typeof item === "object" && item !== null) visit(item);
    }
  };
  visit(root);
  return result;
}

function quids(root: HsonNode): string[] {
  return nodes(root)
    .map((node) => node.$_meta?.["quid"])
    .filter((quid): quid is string => quid !== undefined);
}

function lookup(map: DocumentLiveMap, quid: string): HsonNode | undefined {
  return map.mode === "document" ? map.document.byQuid(quid) : map.document.byQuid(quid);
}

function assert_unchanged(
  map: DocumentLiveMap,
  before: DocumentLiveMapCapture,
  knownQuids: readonly string[],
): void {
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, before.rev);
  for (const quid of knownQuids) assert.notEqual(lookup(map, quid), undefined);
}

function invalid_capture(value: unknown): DocumentLiveMapCapture {
  return value as DocumentLiveMapCapture;
}

check("element install atomically replaces root, identity, revision, and returns one graph op", () => {
  const source = element(`<main @000000007 <p @000000008 "new"/>/>`);
  const target = element(`<aside @000000009 "old"/>`);
  const sourceCapture = source.capture();
  const beforeRev = target.rev;
  const commit = target.install(sourceCapture);

  assert.equal(commit.changed, true);
  assert.equal(commit.prevRev, beforeRev);
  assert.equal(commit.rev, beforeRev + 1);
  assert.equal(target.rev, beforeRev + 1);
  assert.equal(commit.ops.length, 1);
  assert.deepEqual(commit.ops[0], {
    domain: "graph",
    op: "replace-root",
    mode: "document",
    root: sourceCapture.root,
  });
  assert.deepEqual(target.root(), sourceCapture.root);
  assert.equal(target.document.byQuid("000000007")?.$_tag, "main");
  assert.equal(target.document.byQuid("000000008")?.$_tag, "p");
  assert.equal(target.document.byQuid("000000009"), undefined);
  assert.notEqual(commit.ops[0]?.root, target.root());
});

check("multiNodeDocument install preserves canonical document varieties", () => {
  const sources: DocumentLiveMap[] = [
    (() => {
      const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
      if (map.mode !== "document") throw new Error(`Expected multiNodeDocument, observed ${map.mode}`);
      return map;
    })(),
    multiNodeDocument(`"text only"`),
    multiNodeDocument(`<div @000000003/> <div @000000004/>`),
    multiNodeDocument(`"before" <section class="x" style="color: red" data-user="kept" @000000005 <em @000000006 "middle"/>/> "after"`),
  ];
  for (const source of sources) {
    const target = multiNodeDocument(`"target"`);
    const capture = source.capture();
    const commit = target.install(capture);
    assert.equal(commit.changed, true);
    assert.deepEqual(target.capture().root, capture.root);
    assert.equal(target.capture().mode, capture.mode);
    for (const quid of quids(capture.root)) assert.notEqual(target.document.byQuid(quid), undefined);
  }
});

check("one/many document captures interoperate and obsolete mode declarations roll back", () => {
  const target = element(`<main @00000000a/>`);
  const commit = target.install(multiNodeDocument(`"text" <aside @00000000b/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(target.mode, "document");
  assert.equal(target.document.content().length, 2);
  assert.equal(target.document.byQuid("00000000b")?.$_tag, "aside");

  const before = target.capture();
  const known = quids(before.root);
  const obsoleteDeclaration = { ...element(`<button @00000000c/>`).capture(), mode: "element" };
  assert.throws(
    () => target.install(invalid_capture(obsoleteDeclaration)),
    /unsupported capture mode "element"/,
  );
  assert_unchanged(target, before, known);
});

check("capture envelope fields are validated at runtime", () => {
  const target = multiNodeDocument(`"target"`);
  const valid = target.capture();
  const invalid = [
    { ...valid, kind: "other" },
    { ...valid, version: 1 },
    { ...valid, rev: -1 },
    { ...valid, rev: 1.5 },
    { ...valid, mode: "fragment" },
    { ...valid, root: null },
    { ...valid, root: { $_tag: "_hson_root", $_content: [1] } },
  ];
  for (const capture of invalid) {
    const before = target.capture();
    assert.throws(() => target.install(invalid_capture(capture)));
    assert.deepEqual(target.capture(), before);
  }
});

check("expectedRev is target-local and rejects stale, future, and invalid values", () => {
  const sourceCapture = element(`<main @00000000c/>`).capture();
  const target = element(`<aside @00000000a/>`);
  target.install(element(`<article @00000000d/>`).capture());
  const initial = target.capture();

  for (const expectedRev of [target.rev - 1, target.rev + 1]) {
    assert.throws(
      () => target.install(sourceCapture, { expectedRev }),
      (error) => error instanceof Error
        && error.name === "LiveMapRevError"
        && "expectedRev" in error
        && error.expectedRev === expectedRev,
    );
    assert.deepEqual(target.capture(), initial);
  }
  for (const expectedRev of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () => target.install(sourceCapture, { expectedRev }),
      /expectedRev must be a non-negative integer/,
    );
    assert.deepEqual(target.capture(), initial);
  }

  const sourceWithForeignRev = { ...sourceCapture, rev: 14 };
  const freshTarget = element(`<aside @00000000e/>`);
  const commit = freshTarget.install(sourceWithForeignRev, { expectedRev: 0 });
  assert.equal(commit.prevRev, 0);
  assert.equal(commit.rev, 1);
  assert.equal(freshTarget.rev, 1);
  assert.notEqual(freshTarget.rev, sourceWithForeignRev.rev);
});

check("install accepts sparse identity and rejects invalid present identity", () => {
  const target = element(`<main @00000000a/>`);
  const base = element(`<section @000000005 <p @000000002/>/>`).capture();

  const sparse = structuredClone(base);
  delete nodes(sparse.root).find((node) => node.$_tag === "p")?.$_meta?.["quid"];
  const sparseCommit = target.install(sparse);
  assert.equal(sparseCommit.changed, true);
  assert.equal(target.rev, 1);
  assert.equal(target.document.byQuid("00000000a"), undefined);
  assert.equal(target.document.byQuid("000000005")?.$_tag, "section");
  assert.equal(nodes(target.capture().root).find((node) => node.$_tag === "p")?.$_meta?.["quid"], undefined);

  const empty = structuredClone(base);
  const emptyNode = nodes(empty.root).find((node) => node.$_tag === "p");
  if (emptyNode?.$_meta !== undefined) emptyNode.$_meta["quid"] = "";
  const duplicate = structuredClone(base);
  const duplicateNodes = nodes(duplicate.root).filter((node) => node.$_tag === "section" || node.$_tag === "p");
  if (duplicateNodes[0]?.$_meta !== undefined) duplicateNodes[0].$_meta["quid"] = "same";
  if (duplicateNodes[1]?.$_meta !== undefined) duplicateNodes[1].$_meta["quid"] = "same";
  const malformed = structuredClone(base);
  const malformedNode = nodes(malformed.root).find((node) => node.$_tag === "p");
  if (malformedNode !== undefined) malformedNode.$_meta = { quid: 42 as unknown as string };
  for (const capture of [empty, duplicate, malformed]) {
    const invalidTarget = element(`<main/>`);
    const before = invalidTarget.capture();
    assert.throws(() => invalidTarget.install(capture));
    assert.deepEqual(invalidTarget.capture(), before);
    assert.equal(invalidTarget.rev, 0);
  }
});

check("install and recapture preserve completely unquidded document graphs", () => {
  const source = element(`<main <p "one"/> <p "two"/>/>`);
  const target = element(`<aside @00000000f/>`);
  const capture = source.capture();
  assert.deepEqual(quids(capture.root), []);
  const commit = target.install(capture);
  assert.deepEqual([commit.prevRev, commit.rev, target.rev], [0, 1, 1]);
  assert.deepEqual(quids(target.root()), []);
  assert.deepEqual(quids(target.capture().root), []);
  assert.equal(target.document.byQuid("00000000f"), undefined);
  assert.equal(target.document.byQuid("anything"), undefined);
});

check("installed ownership and graph commit payload are recursively detached", () => {
  const sourceNode = hson.fromHson(
    `<main id="original" data-user="meta" @000000001 <p @000000002 "x"/>/>`,
  ).toNode();
  const main = nodes(sourceNode).find((node) => node.$_tag === "main");
  if (main !== undefined) main.$_attrs = { ...main.$_attrs, style: { color: "red" } };
  const source = hson.liveMap.fromNode(sourceNode);
  if (source.mode !== "document") throw new Error("Expected element source");
  const capture = source.capture();
  const target = element(`<aside @00000000f/>`);
  const commit = target.install(capture);
  const installed = target.root();

  const captureMain = nodes(capture.root).find((node) => node.$_tag === "main");
  if (captureMain !== undefined) {
    captureMain.$_tag = "capture-mutated";
    captureMain.$_content.length = 0;
    captureMain.$_attrs = { id: "changed", style: { color: "blue" } };
    captureMain.$_meta = { quid: "000000011" };
  }
  const opRoot = commit.ops[0]?.root;
  if (opRoot !== undefined) {
    opRoot.$_content.length = 0;
    opRoot.$_meta = { quid: "000000012" };
  }
  assert.deepEqual(target.root(), installed);
  assert.equal(target.document.byQuid("000000001")?.$_tag, "main");
  assert.equal(target.document.byQuid("000000002")?.$_tag, "p");
});

check("canonical identical install follows data replace no-op policy", () => {
  const target = element(`<main @000000001/>`);
  const before = target.capture();
  const commit = target.install(before);
  assert.deepEqual(commit, { changed: false, prevRev: before.rev, rev: before.rev, ops: [] });
  assert.deepEqual(target.capture(), before);
});

check("valid install replaces a target damaged through internal malformed-state setup", () => {
  const target = element(`<main @00000000f/>`);
  const liveMeta = internal_livemap_node(target, ["main"])?.$_meta;
  if (liveMeta === undefined) throw new Error("Expected live metadata");
  liveMeta["quid"] = "damaged";
  assert.equal(target.document.byQuid("00000000f")?.$_meta?.["quid"], "damaged");

  const sourceCapture = element(`<section @000000010/>`).capture();
  target.install(sourceCapture);
  assert.equal(target.document.byQuid("00000000f"), undefined);
  assert.equal(target.document.byQuid("000000010")?.$_tag, "section");
});

check("data façades do not expose document install at runtime", () => {
  assert.equal("install" in hson.liveMap.fromJson({}), false);
  assert.equal("install" in hson.liveMap.fromJson([]), false);
  const document = element(`<main @000000001/>`);
  for (const key of ["set", "replace", "apply", "applyGraph", "replayGraph", "installGraph"]) {
    assert.equal(key in document, false);
  }
  assert.equal(typeof document.proxy, "function");
  assert.equal(typeof document.install, "function");
  assert.equal(typeof document.replay, "function");
  assert.equal(typeof document.restore, "function");
});

process.stdout.write(`# ${checks} document install checks passed\n`);
testEvents.terminal("pass");

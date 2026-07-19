import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type {
  DocumentLiveMap,
  DocumentLiveMapCapture,
  ElementLiveMap,
  FragmentLiveMap,
  HsonNode,
} from "../src/index.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
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
    .map((node) => node.$_meta?.["data-_quid"])
    .filter((quid): quid is string => quid !== undefined);
}

function lookup(map: DocumentLiveMap, quid: string): HsonNode | undefined {
  return map.mode === "element" ? map.element.byQuid(quid) : map.fragment.byQuid(quid);
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
  const source = element(`<main data-_quid="new-main" <p data-_quid="new-p" "new"/>/>`);
  const target = element(`<aside data-_quid="old-aside" "old"/>`);
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
    mode: "element",
    root: sourceCapture.root,
  });
  assert.deepEqual(target.root(), sourceCapture.root);
  assert.equal(target.element.byQuid("new-main")?.$_tag, "main");
  assert.equal(target.element.byQuid("new-p")?.$_tag, "p");
  assert.equal(target.element.byQuid("old-aside"), undefined);
  assert.notEqual(commit.ops[0]?.root, target.root());
});

check("fragment install preserves canonical document varieties", () => {
  const sources: FragmentLiveMap[] = [
    (() => {
      const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
      if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
      return map;
    })(),
    fragment(`"text only"`),
    fragment(`<div data-_quid="a"/> <div data-_quid="b"/>`),
    fragment(`"before" <section class="x" style="color: red" data-_quid="section" data-_custom="kept" <em data-_quid="em" "middle"/>/> "after"`),
  ];
  for (const source of sources) {
    const target = fragment(`"target"`);
    const capture = source.capture();
    const commit = target.install(capture);
    assert.equal(commit.changed, true);
    assert.deepEqual(target.capture().root, capture.root);
    assert.equal(target.capture().mode, capture.mode);
    for (const quid of quids(capture.root)) assert.notEqual(target.fragment.byQuid(quid), undefined);
  }
});

check("mode mismatches and declaration mismatches roll back completely", () => {
  const target = element(`<main data-_quid="target"/>`);
  const before = target.capture();
  const known = quids(before.root);
  assert.throws(() => target.install(fragment(`"text"`).capture()), /target mode element cannot install fragment/);
  assert_unchanged(target, before, known);

  const elementCapture = element(`<button data-_quid="button"/>`).capture();
  const falselyDeclared = { ...elementCapture, mode: "fragment" };
  assert.throws(
    () => target.install(invalid_capture(falselyDeclared)),
    /declares mode fragment, but its root classifies as element/,
  );
  assert_unchanged(target, before, known);
});

check("capture envelope fields are validated at runtime", () => {
  const target = fragment(`"target"`);
  const valid = target.capture();
  const invalid = [
    { ...valid, kind: "other" },
    { ...valid, version: 2 },
    { ...valid, rev: -1 },
    { ...valid, rev: 1.5 },
    { ...valid, mode: "document" },
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
  const sourceCapture = element(`<main data-_quid="source"/>`).capture();
  const target = element(`<aside data-_quid="target"/>`);
  target.install(element(`<article data-_quid="intermediate"/>`).capture());
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
  const freshTarget = element(`<aside data-_quid="fresh"/>`);
  const commit = freshTarget.install(sourceWithForeignRev, { expectedRev: 0 });
  assert.equal(commit.prevRev, 0);
  assert.equal(commit.rev, 1);
  assert.equal(freshTarget.rev, 1);
  assert.notEqual(freshTarget.rev, sourceWithForeignRev.rev);
});

check("install accepts sparse identity and rejects invalid present identity", () => {
  const target = element(`<main data-_quid="target"/>`);
  const base = element(`<section data-_quid="section" <p data-_quid="p"/>/>`).capture();

  const sparse = structuredClone(base);
  delete nodes(sparse.root).find((node) => node.$_tag === "p")?.$_meta?.["data-_quid"];
  const sparseCommit = target.install(sparse);
  assert.equal(sparseCommit.changed, true);
  assert.equal(target.rev, 1);
  assert.equal(target.element.byQuid("target"), undefined);
  assert.equal(target.element.byQuid("section")?.$_tag, "section");
  assert.equal(nodes(target.capture().root).find((node) => node.$_tag === "p")?.$_meta?.["data-_quid"], undefined);

  const empty = structuredClone(base);
  const emptyNode = nodes(empty.root).find((node) => node.$_tag === "p");
  if (emptyNode?.$_meta !== undefined) emptyNode.$_meta["data-_quid"] = "";
  const duplicate = structuredClone(base);
  const duplicateNodes = nodes(duplicate.root).filter((node) => node.$_tag === "section" || node.$_tag === "p");
  if (duplicateNodes[0]?.$_meta !== undefined) duplicateNodes[0].$_meta["data-_quid"] = "same";
  if (duplicateNodes[1]?.$_meta !== undefined) duplicateNodes[1].$_meta["data-_quid"] = "same";
  const malformed = structuredClone(base);
  const malformedNode = nodes(malformed.root).find((node) => node.$_tag === "p");
  if (malformedNode !== undefined) malformedNode.$_meta = { "data-_quid": 42 as unknown as string };
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
  const target = element(`<aside data-_quid="old"/>`);
  const capture = source.capture();
  assert.deepEqual(quids(capture.root), []);
  const commit = target.install(capture);
  assert.deepEqual([commit.prevRev, commit.rev, target.rev], [0, 1, 1]);
  assert.deepEqual(quids(target.root()), []);
  assert.deepEqual(quids(target.capture().root), []);
  assert.equal(target.element.byQuid("old"), undefined);
  assert.equal(target.element.byQuid("anything"), undefined);
});

check("installed ownership and graph commit payload are recursively detached", () => {
  const sourceNode = hson.fromHson(
    `<main id="original" data-_quid="main" data-_custom="meta" <p data-_quid="p" "x"/>/>`,
  ).toNode();
  const main = nodes(sourceNode).find((node) => node.$_tag === "main");
  if (main !== undefined) main.$_attrs = { ...main.$_attrs, style: { color: "red" } };
  const source = hson.liveMap.fromNode(sourceNode);
  if (source.mode !== "element") throw new Error("Expected element source");
  const capture = source.capture();
  const target = element(`<aside data-_quid="old"/>`);
  const commit = target.install(capture);
  const installed = target.root();

  const captureMain = nodes(capture.root).find((node) => node.$_tag === "main");
  if (captureMain !== undefined) {
    captureMain.$_tag = "capture-mutated";
    captureMain.$_content.length = 0;
    captureMain.$_attrs = { id: "changed", style: { color: "blue" } };
    captureMain.$_meta = { "data-_quid": "changed" };
  }
  const opRoot = commit.ops[0]?.root;
  if (opRoot !== undefined) {
    opRoot.$_content.length = 0;
    opRoot.$_meta = { "data-_quid": "op-mutated" };
  }
  assert.deepEqual(target.root(), installed);
  assert.equal(target.element.byQuid("main")?.$_tag, "main");
  assert.equal(target.element.byQuid("p")?.$_tag, "p");
});

check("canonical identical install follows data replace no-op policy", () => {
  const target = element(`<main data-_quid="main"/>`);
  const before = target.capture();
  const commit = target.install(before);
  assert.deepEqual(commit, { changed: false, prevRev: before.rev, rev: before.rev, ops: [] });
  assert.deepEqual(target.capture(), before);
});

check("valid install replaces a target damaged through unsafe debug access", () => {
  const target = element(`<main data-_quid="old"/>`);
  const liveMeta = target.debug.node(["main"]).meta();
  if (liveMeta === undefined) throw new Error("Expected live metadata");
  liveMeta["data-_quid"] = "damaged";
  assert.equal(target.element.byQuid("old")?.$_meta?.["data-_quid"], "damaged");

  const sourceCapture = element(`<section data-_quid="new"/>`).capture();
  target.install(sourceCapture);
  assert.equal(target.element.byQuid("old"), undefined);
  assert.equal(target.element.byQuid("new")?.$_tag, "section");
});

check("data façades do not expose document install at runtime", () => {
  assert.equal("install" in hson.liveMap.fromJson({}), false);
  assert.equal("install" in hson.liveMap.fromJson([]), false);
  const document = element(`<main data-_quid="main"/>`);
  for (const key of ["set", "replace", "proxy", "apply", "replay", "applyGraph", "replayGraph", "installGraph"]) {
    assert.equal(key in document, false);
  }
  assert.equal(typeof document.install, "function");
});

process.stdout.write(`# ${checks} document install checks passed\n`);

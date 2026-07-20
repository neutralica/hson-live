import assert from "node:assert/strict";
import {
  hson,
  LiveMapDocumentAttributeNotFoundError,
  LiveMapDocumentMutationError,
} from "../src/index.ts";
import type {
  DocumentLiveMap,
  ElementLiveMap,
  FragmentLiveMap,
  LiveMapDocumentTarget,
} from "../src/types/livemap.types.ts";

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

const path = (...segments: number[]): LiveMapDocumentTarget =>
  Object.freeze({ kind: "path", path: Object.freeze(segments) });
const quid = (value: string): LiveMapDocumentTarget => Object.freeze({ kind: "quid", quid: value });

function errorCode(fn: () => unknown, code: string, operation?: string): void {
  assert.throws(fn, (cause) => cause instanceof LiveMapDocumentMutationError
    && cause.code === code
    && (operation === undefined || cause.operation === operation));
}

function assertNoReadEffects(map: DocumentLiveMap, fn: () => void): void {
  const before = map.capture();
  const beforeRoot = map.debug.node([]).get();
  const observations: unknown[] = [];
  map.commits.observe((event) => observations.push(event));
  fn();
  assert.equal(map.rev, before.rev);
  assert.deepEqual(map.capture(), before);
  assert.equal(map.debug.node([]).get(), beforeRoot);
  assert.deepEqual(observations, []);
}

check("get preserves every canonical value distinction and detaches structured style", () => {
  const map = element(`<main data-_quid="0000000000000101"/>`);
  map.document.attrs.replace(path(), {
    empty: "",
    enabled: true,
    disabled: false,
    positive: 7,
    zero: 0,
    nullable: null,
    style: { color: "red", _hover: { color: "blue" } },
  });
  assertNoReadEffects(map, () => {
    assert.equal(map.document.attrs.get(path(), "empty"), "");
    assert.equal(map.document.attrs.get(path(), "enabled"), true);
    assert.equal(map.document.attrs.get(path(), "disabled"), false);
    assert.equal(map.document.attrs.get(path(), "positive"), 7);
    assert.equal(map.document.attrs.get(path(), "zero"), 0);
    assert.equal(map.document.attrs.get(path(), "nullable"), null);
    assert.equal(map.document.attrs.get(path(), "absent"), undefined);
    assert.equal(map.document.attrs.get(quid("0000000000000101"), "positive"), 7);

    const style = map.document.attrs.get(path(), "style");
    const styleAgain = map.document.attrs.get(path(), "style");
    assert.deepEqual(style, { _hover: { color: "blue" }, color: "red" });
    assert.notEqual(style, styleAgain);
    assert.equal(Object.isFrozen(style), true);
    assert.equal(typeof style === "object" && style !== null && Object.isFrozen(style._hover), true);
    assert.equal(Reflect.set(style as object, "color", "purple"), false);
    assert.deepEqual(map.document.attrs.get(path(), "style"), {
      _hover: { color: "blue" },
      color: "red",
    });
  });
});

check("has tests own-key presence without truthiness", () => {
  const map = element(`<main/>`);
  map.document.attrs.replace(path(), { empty: "", disabled: false, zero: 0, nullable: null });
  assertNoReadEffects(map, () => {
    for (const name of ["empty", "disabled", "zero", "nullable"]) {
      assert.equal(map.document.attrs.has(path(), name), true);
    }
    assert.equal(map.document.attrs.has(path(), "absent"), false);
  });
});

check("keys is lexical, public-only, fresh, and does not create absent storage", () => {
  const map = element(`<main data-_quid="0000000000000102" data-_custom="system"/>`);
  assert.equal(map.element.node().$_attrs, undefined);
  const first = map.document.attrs.keys(path());
  assert.deepEqual(first, []);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(map.element.node().$_attrs, undefined);

  map.document.attrs.replace(path(), { zeta: 1, style: { color: "red" }, alpha: 2 });
  const keys = map.document.attrs.keys(quid("0000000000000102"));
  const again = map.document.attrs.keys(path());
  assert.deepEqual(keys, ["alpha", "style", "zeta"]);
  assert.notEqual(keys, again);
  assert.equal(keys.includes("data-_quid"), false);
  assert.equal(keys.includes("data-_custom"), false);
  assert.equal(Reflect.set(keys as string[], 0, "changed"), false);
  assert.deepEqual(map.document.attrs.keys(path()), ["alpha", "style", "zeta"]);
});

check("must.get shares canonical reads and reports only valid absence as not found", () => {
  const target = path();
  const map = element(`<main id="present"/>`);
  map.document.attrs.set(target, "style", { color: "red", _hover: { color: "blue" } });
  assert.equal(map.document.attrs.must, map.document.attrs.must);
  assert.equal(Object.isFrozen(map.document.attrs.must), true);
  assert.equal(map.document.attrs.must.get(target, "id"), "present");
  const style = map.document.attrs.must.get(target, "style");
  assert.deepEqual(style, { _hover: { color: "blue" }, color: "red" });
  assert.equal(Object.isFrozen(style), true);
  assert.notEqual(style, map.document.attrs.get(target, "style"));

  assert.throws(
    () => map.document.attrs.must.get(target, "missing"),
    (cause) => cause instanceof LiveMapDocumentAttributeNotFoundError
      && cause.code === "DOCUMENT_ATTRIBUTE_NOT_FOUND"
      && cause.operation === "must-get-attr"
      && cause.attributeName === "missing"
      && cause.target.kind === "path"
      && cause.target.path.length === 0,
  );
  errorCode(() => map.document.attrs.must.get(target, "bad name"), "INVALID_DOCUMENT_ATTRIBUTE_NAME", "must-get-attr");
  errorCode(() => map.document.attrs.must.get(target, "data-_quid"), "PROTECTED_DOCUMENT_METADATA", "must-get-attr");
  errorCode(() => map.document.attrs.must.get(path(99), "id"), "DOCUMENT_PATH_OUT_OF_RANGE", "must-get-attr");
});

check("all reads share target and name validation", () => {
  const map = element(`<main "text"/>`);
  for (const read of [
    () => map.document.attrs.get(path(), "bad name"),
    () => map.document.attrs.has(path(), "bad name"),
  ]) errorCode(read, "INVALID_DOCUMENT_ATTRIBUTE_NAME");
  for (const read of [
    () => map.document.attrs.get(path(), "data-_index"),
    () => map.document.attrs.has(path(), "data-_custom"),
  ]) errorCode(read, "PROTECTED_DOCUMENT_METADATA");
  errorCode(() => map.document.attrs.keys(path(99)), "DOCUMENT_PATH_OUT_OF_RANGE", "list-attrs");
  errorCode(() => map.document.attrs.get(quid("0000000000000199"), "id"), "DOCUMENT_TARGET_NOT_FOUND", "get-attr");
  errorCode(() => map.document.attrs.get(path(0, 0), "id"), "DOCUMENT_TARGET_KIND", "get-attr");
  errorCode(
    () => Reflect.apply(map.document.attrs.get, map.document.attrs, [{ path: [] }, "id"]),
    "INVALID_DOCUMENT_TARGET",
    "get-attr",
  );
});

check("fragment and element modes support root, nested, path, and QUID targets", () => {
  const elementMap = element(`<main id="root" <p title="nested" data-_quid="0000000000000103"/>/>`);
  assert.equal(elementMap.document.attrs.get(path(), "id"), "root");
  assert.equal(elementMap.document.attrs.get(path(0, 0), "title"), "nested");
  assert.equal(elementMap.document.attrs.has(quid("0000000000000103"), "title"), true);

  const fragmentMap = fragment(`<section id="first" data-_quid="0000000000000104"/> <aside title="second"/>`);
  assert.equal(fragmentMap.document.attrs.get(path(0), "id"), "first");
  assert.deepEqual(fragmentMap.document.attrs.keys(path(1)), ["title"]);
  assert.equal(fragmentMap.document.attrs.must.get(quid("0000000000000104"), "id"), "first");
});

check("reads over absent attrs remain complete no-ops", () => {
  const map = element(`<main data-_quid="0000000000000105"/>`);
  const beforeLookup = map.document.byQuid("0000000000000105");
  assertNoReadEffects(map, () => {
    assert.equal(map.document.attrs.get(path(), "id"), undefined);
    assert.equal(map.document.attrs.has(path(), "id"), false);
    assert.deepEqual(map.document.attrs.keys(path()), []);
  });
  assert.deepEqual(map.document.byQuid("0000000000000105"), beforeLookup);
});

check("local reads through a hosted authority create no history or publication", () => {
  const host = hson.liveHost.create({
    map: element(`<main id="local" data-_quid="0000000000000106"/>`),
  });
  let publications = 0;
  host.stream.on_commit(() => { publications += 1; });
  const beforeRev = host.map.rev;
  const beforeHistory = host.stream.history.debug().retainedCommitCount;
  assert.equal(host.map.document.attrs.get(path(), "id"), "local");
  assert.equal(host.map.document.attrs.has(path(), "id"), true);
  assert.deepEqual(host.map.document.attrs.keys(path()), ["id"]);
  assert.equal(host.map.document.attrs.must.get(path(), "id"), "local");
  assert.equal(host.map.rev, beforeRev);
  assert.equal(host.stream.headRev, beforeRev);
  assert.equal(host.stream.history.debug().retainedCommitCount, beforeHistory);
  assert.equal(publications, 0);
});

process.stdout.write(`# ${checks} Document LiveMap attrs read checks passed\n`);

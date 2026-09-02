import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import {
  hson,
  LiveMapDocumentAttributeNotFoundError,
  LiveMapDocumentMutationError,
} from "../src/index.ts";
import type {
  DocumentLiveMap,
  LiveMapDocumentRequestTarget,
} from "../src/types/livemap.types.ts";
import { internal_livemap_root } from "../src/api/livemap/livemap.internal.ts";
import { is_Node } from "../src/core/node-guards.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-attrs-read",
  title: "Document LiveMap attribute reads",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "attributes", "reads"]),
});

const testEvents = create_test_event_emitter("livemap.document-attrs-read");
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

const path = (...segments: number[]): LiveMapDocumentRequestTarget =>
  Object.freeze({ kind: "path", path: Object.freeze(segments) });
const elementPath = (...segments: number[]): LiveMapDocumentRequestTarget => path(0, ...segments);
const quid = (value: string): LiveMapDocumentRequestTarget => Object.freeze({ kind: "quid", quid: value });

function ordinaryRoot(map: DocumentLiveMap) {
  const candidate = map.root().$_content[0];
  if (!is_Node(candidate)) throw new Error("Expected one ordinary document root element");
  return candidate;
}

function errorCode(fn: () => unknown, code: string, operation?: string): void {
  assert.throws(fn, (cause) => cause instanceof LiveMapDocumentMutationError
    && cause.code === code
    && (operation === undefined || cause.operation === operation));
}

function assertNoReadEffects(map: DocumentLiveMap, fn: () => void): void {
  const before = map.capture();
  const beforeRoot = internal_livemap_root(map);
  const observations: unknown[] = [];
  map.commits.observe((event) => observations.push(event));
  fn();
  assert.equal(map.rev, before.rev);
  assert.deepEqual(map.capture(), before);
  assert.equal(internal_livemap_root(map), beforeRoot);
  assert.deepEqual(observations, []);
}

check("get preserves every canonical value distinction and detaches structured style", () => {
  const map = element(`<main @000000101/>`);
  map.document.attrs.replace(elementPath(), {
    empty: "",
    enabled: true,
    disabled: false,
    positive: 7,
    zero: 0,
    nullable: null,
    style: { color: "red", width: { value: 2, unit: "px" } },
  });
  assertNoReadEffects(map, () => {
    assert.equal(map.document.attrs.get(elementPath(), "empty"), "");
    assert.equal(map.document.attrs.get(elementPath(), "enabled"), true);
    assert.equal(map.document.attrs.get(elementPath(), "disabled"), false);
    assert.equal(map.document.attrs.get(elementPath(), "positive"), 7);
    assert.equal(map.document.attrs.get(elementPath(), "zero"), 0);
    assert.equal(map.document.attrs.get(elementPath(), "nullable"), null);
    assert.equal(map.document.attrs.get(elementPath(), "absent"), undefined);
    assert.equal(map.document.attrs.get(quid("000000101"), "positive"), 7);

    const style = map.document.attrs.get(elementPath(), "style");
    const styleAgain = map.document.attrs.get(elementPath(), "style");
    assert.deepEqual(style, { color: "red", width: { value: 2, unit: "px" } });
    assert.notEqual(style, styleAgain);
    assert.equal(Object.isFrozen(style), true);
    assert.equal(typeof style === "object" && style !== null && Object.isFrozen(style.width), true);
    assert.equal(Reflect.set(style as object, "color", "purple"), false);
    assert.deepEqual(map.document.attrs.get(elementPath(), "style"), {
      width: { value: 2, unit: "px" },
      color: "red",
    });
  });
});

check("has tests own-key presence without truthiness", () => {
  const map = element(`<main/>`);
  map.document.attrs.replace(elementPath(), { empty: "", disabled: false, zero: 0, nullable: null });
  assertNoReadEffects(map, () => {
    for (const name of ["empty", "disabled", "zero", "nullable"]) {
      assert.equal(map.document.attrs.has(elementPath(), name), true);
    }
    assert.equal(map.document.attrs.has(elementPath(), "absent"), false);
  });
});

check("keys is lexical, public-only, fresh, and does not create absent storage", () => {
  const map = element(`<main @000000102/>`);
  assert.equal(ordinaryRoot(map).$_attrs, undefined);
  const first = map.document.attrs.keys(elementPath());
  assert.deepEqual(first, []);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(ordinaryRoot(map).$_attrs, undefined);

  map.document.attrs.replace(elementPath(), {
    zeta: 1,
    style: { color: "red" },
    alpha: 2,
    "data-_quid": "application",
  });
  const keys = map.document.attrs.keys(quid("000000102"));
  const again = map.document.attrs.keys(elementPath());
  assert.deepEqual(keys, ["alpha", "data-_quid", "style", "zeta"]);
  assert.notEqual(keys, again);
  assert.equal(map.document.attrs.get(elementPath(), "data-_quid"), "application");
  assert.equal(Reflect.set(keys as string[], 0, "changed"), false);
  assert.deepEqual(map.document.attrs.keys(elementPath()), ["alpha", "data-_quid", "style", "zeta"]);
});

check("must.get shares canonical reads and reports only valid absence as not found", () => {
  const target = elementPath();
  const map = element(`<main id="present"/>`);
  map.document.attrs.set(target, "style", { color: "red", width: { value: 2, unit: "px" } });
  assert.equal(map.document.attrs.must, map.document.attrs.must);
  assert.equal(Object.isFrozen(map.document.attrs.must), true);
  assert.equal(map.document.attrs.must.get(target, "id"), "present");
  const style = map.document.attrs.must.get(target, "style");
  assert.deepEqual(style, { color: "red", width: { value: 2, unit: "px" } });
  assert.equal(Object.isFrozen(style), true);
  assert.notEqual(style, map.document.attrs.get(target, "style"));

  assert.throws(
    () => map.document.attrs.must.get(target, "missing"),
    (cause) => cause instanceof LiveMapDocumentAttributeNotFoundError
      && cause.code === "DOCUMENT_ATTRIBUTE_NOT_FOUND"
      && cause.operation === "must-get-attr"
      && cause.attributeName === "missing"
      && cause.target.kind === "path"
      && cause.target.path.length === 1
      && cause.target.path[0] === 0,
  );
  errorCode(() => map.document.attrs.must.get(target, "bad name"), "INVALID_DOCUMENT_ATTRIBUTE_NAME", "must-get-attr");
  errorCode(() => map.document.attrs.must.get(target, "hson:quid"), "PROTECTED_DOCUMENT_METADATA", "must-get-attr");
  errorCode(() => map.document.attrs.must.get(path(99), "id"), "DOCUMENT_PATH_OUT_OF_RANGE", "must-get-attr");
});

check("all reads share target and name validation", () => {
  const map = element(`<main "text"/>`);
  for (const read of [
    () => map.document.attrs.get(elementPath(), "bad name"),
    () => map.document.attrs.has(elementPath(), "bad name"),
  ]) errorCode(read, "INVALID_DOCUMENT_ATTRIBUTE_NAME");
  for (const read of [
    () => map.document.attrs.get(elementPath(), "hson:index"),
    () => map.document.attrs.has(elementPath(), "hson:unknown"),
  ]) errorCode(read, "PROTECTED_DOCUMENT_METADATA");
  errorCode(() => map.document.attrs.keys(path(99)), "DOCUMENT_PATH_OUT_OF_RANGE", "list-attrs");
  errorCode(() => map.document.attrs.get(quid("000000199"), "id"), "DOCUMENT_TARGET_NOT_FOUND", "get-attr");
  errorCode(() => map.document.attrs.get(path(0, 0), "id"), "DOCUMENT_TARGET_KIND", "get-attr");
  errorCode(
    () => Reflect.apply(map.document.attrs.get, map.document.attrs, [{ path: [] }, "id"]),
    "INVALID_DOCUMENT_TARGET",
    "get-attr",
  );
});

check("multiNodeDocument and element modes support root, nested, path, and QUID targets", () => {
  const elementMap = element(`<main id="root" <p title="nested" @000000103/>/>`);
  assert.equal(elementMap.document.attrs.get(elementPath(), "id"), "root");
  assert.equal(elementMap.document.attrs.get(elementPath(0, 0), "title"), "nested");
  assert.equal(elementMap.document.attrs.has(quid("000000103"), "title"), true);

  const multiNodeDocumentMap = multiNodeDocument(`<section id="first" @000000104/> <aside title="second"/>`);
  assert.equal(multiNodeDocumentMap.document.attrs.get(path(0), "id"), "first");
  assert.deepEqual(multiNodeDocumentMap.document.attrs.keys(path(1)), ["title"]);
  assert.equal(multiNodeDocumentMap.document.attrs.must.get(quid("000000104"), "id"), "first");
});

check("reads over absent attrs remain complete no-ops", () => {
  const map = element(`<main @000000105/>`);
  const beforeLookup = map.document.byQuid("000000105");
  assertNoReadEffects(map, () => {
    assert.equal(map.document.attrs.get(elementPath(), "id"), undefined);
    assert.equal(map.document.attrs.has(elementPath(), "id"), false);
    assert.deepEqual(map.document.attrs.keys(elementPath()), []);
  });
  assert.deepEqual(map.document.byQuid("000000105"), beforeLookup);
});

check("local reads through a hosted authority create no history or publication", () => {
  const host = hson.locus.create({
    map: element(`<main id="local" @000000106/>`),
  });
  let publications = 0;
  host.stream.on_commit(() => { publications += 1; });
  const beforeRev = host.map.rev;
  const beforeHistory = host.stream.history.debug().retainedCommitCount;
  assert.equal(host.map.document.attrs.get(elementPath(), "id"), "local");
  assert.equal(host.map.document.attrs.has(elementPath(), "id"), true);
  assert.deepEqual(host.map.document.attrs.keys(elementPath()), ["id"]);
  assert.equal(host.map.document.attrs.must.get(elementPath(), "id"), "local");
  assert.equal(host.map.rev, beforeRev);
  assert.equal(host.stream.headRev, beforeRev);
  assert.equal(host.stream.history.debug().retainedCommitCount, beforeHistory);
  assert.equal(publications, 0);
});

process.stdout.write(`# ${checks} Document LiveMap attrs read checks passed\n`);
testEvents.terminal("pass");

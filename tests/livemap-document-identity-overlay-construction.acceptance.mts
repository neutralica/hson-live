// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { HSON_META_QUID } from "../src/core/constants.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  build_livemap_document_identity_overlay,
  livemap_document_identity_overlay_for,
  LiveMapDocumentIdentityError,
} from "../src/api/livemap/livemap.document.identity.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-identity-overlay-construction",
  title: "Sparse document identity overlay construction",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "path", "sparse-identity", "construction", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-identity-overlay-construction");
let checks = 0;
function check(name: string, run: () => void): void {

  testEvents.case_begin(name, name);
  try {
    run();
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

const Q1 = "000000001";
const Q2 = "000000002";
const Q3 = "000000003";

function element(source: string) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected element map");
  return map;
}

function multiNodeDocument(source: string) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected multiNodeDocument map");
  return map;
}

function node(tag: string, content: HsonNode["$_content"] = [], quid?: string): HsonNode {
  return quid === undefined
    ? { $_tag: tag, $_content: content }
    : { $_tag: tag, $_content: content, $_meta: { [HSON_META_QUID]: quid } };
}

check("empty element documents retain an empty overlay", () => {
  assert.equal(livemap_document_identity_overlay_for(element(`<main/>`)).size, 0);
});

check("empty multiNodeDocuments retain an empty overlay", () => {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  if (map.mode !== "document") throw new Error("Expected empty multiNodeDocument map");
  assert.equal(livemap_document_identity_overlay_for(map).size, 0);
});

check("nested QUID-free graphs retain no per-node identity entries", () => {
  const map = element(`<main <section <p "text"/>/>/>`);
  assert.equal(livemap_document_identity_overlay_for(map).size, 0);
});

check("one root QUID maps to its document-content slot", () => {
  assert.deepEqual(livemap_document_identity_overlay_for(element(`<main @${Q1}/>`)).pathForQuid(Q1), [0]);
});

check("one multiNodeDocument sibling QUID maps to its direct cluster slot", () => {
  assert.deepEqual(livemap_document_identity_overlay_for(multiNodeDocument(`<a/> <b @${Q1}/>`)).pathForQuid(Q1), [1]);
});

check("nested element paths include canonical content carriers exactly", () => {
  const overlay = livemap_document_identity_overlay_for(element(`<main <section @${Q1}/>/` + `>`));
  assert.deepEqual(overlay.pathForQuid(Q1), [0, 0, 0]);
});

check("sparse documents retain exactly their present QUID count", () => {
  const map = element(`<main @${Q1} <a/> <b @${Q2}/> <c <d @${Q3}/>/>/>`);
  assert.equal(livemap_document_identity_overlay_for(map).size, 3);
});

check("sparse forward paths are exact at root and nested locations", () => {
  const overlay = livemap_document_identity_overlay_for(
    element(`<main @${Q1} <a @${Q2}/> <b <c @${Q3}/>/>/>`),
  );
  assert.deepEqual(overlay.pathForQuid(Q1), [0]);
  assert.deepEqual(overlay.pathForQuid(Q2), [0, 0, 0]);
  assert.deepEqual(overlay.pathForQuid(Q3), [0, 0, 1, 0, 0]);
});

check("sparse reverse lookup agrees at every retained path", () => {
  const overlay = livemap_document_identity_overlay_for(multiNodeDocument(`<a @${Q1}/> "x" <b @${Q2}/>`));
  assert.equal(overlay.quidAtPath(validate_document_path([0])), Q1);
  assert.equal(overlay.quidAtPath(validate_document_path([2])), Q2);
});

check("moderate QUID-free fixtures remain storage-constant", () => {
  const source = `<main ${Array.from({ length: 80 }, (_, index) => `<n data=${JSON.stringify(index)}/>`).join("")}/>`;
  assert.equal(livemap_document_identity_overlay_for(element(source)).size, 0);
});

check("moderate sparse fixtures retain only three entries", () => {
  const source = `<main ${Array.from({ length: 80 }, (_, index) =>
    `<n${index === 1 ? ` @${Q1}` : index === 40 ? ` @${Q2}` : index === 79 ? ` @${Q3}` : ""}/>`).join("")}/>`;
  assert.equal(livemap_document_identity_overlay_for(element(source)).size, 3);
});

check("duplicate QUIDs reject during overlay construction", () => {
  assert.throws(() => multiNodeDocument(`<a @${Q1}/> <b @${Q1}/>`), (error: unknown) =>
    error instanceof LiveMapDocumentIdentityError && error.code === "DUPLICATE_QUID");
});

check("malformed QUID syntax rejects during overlay construction", () => {
  const root = node("_hson_root", [node("_hson_elem", [node("main", [], "short")])]);
  assert.throws(() => build_livemap_document_identity_overlay(root, "document"), (error: unknown) =>
    error instanceof LiveMapDocumentIdentityError && error.code === "MALFORMED_QUID");
});

check("ineligible QUID placement rejects during overlay construction", () => {
  const invalid = node("_hson_elem", [node("main")], Q1);
  const root = node("_hson_root", [invalid]);
  assert.throws(() => build_livemap_document_identity_overlay(root, "document"), (error: unknown) =>
    error instanceof LiveMapDocumentIdentityError && error.code === "MALFORMED_QUID");
});

check("returned paths are detached from graph storage and frozen", () => {
  const path = livemap_document_identity_overlay_for(element(`<main @${Q1}/>`)).pathForQuid(Q1);
  assert.deepEqual(path, [0]);
  assert.equal(Object.isFrozen(path), true);
});

check("returned paths cannot be mutated", () => {
  const path = livemap_document_identity_overlay_for(multiNodeDocument(`<a @${Q1}/> <b/>`)).pathForQuid(Q1);
  assert.throws(() => Reflect.apply(Array.prototype.push, path ?? [], [1]), TypeError);
});

check("overlay facade exposes no graph node or backing Map", () => {
  const overlay = livemap_document_identity_overlay_for(element(`<main @${Q1}/>`));
  assert.deepEqual(Object.keys(overlay).sort(), ["pathForQuid", "quidAtPath", "size"]);
  assert.equal(Object.values(overlay).some((value) => value instanceof Map), false);
});

check("unquidded paths have no reverse overlay entry", () => {
  const overlay = livemap_document_identity_overlay_for(element(`<main @${Q1} <span/>/>`));
  assert.equal(overlay.quidAtPath(validate_document_path([0, 0, 0])), undefined);
});

check("overlay construction never invokes QUID minting", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  let calls = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues<T extends ArrayBufferView | null>(value: T): T { calls += 1; return value; } },
  });
  try {
    element(`<main @${Q1} <span/>/>`);
    assert.equal(calls, 0);
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "crypto");
    else Object.defineProperty(globalThis, "crypto", descriptor);
  }
});

check("direct scanner construction never invokes QUID minting", () => {
  const root = element(`<main @${Q1}/>`).root();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    assert.equal(build_livemap_document_identity_overlay(root, "document").size, 1);
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "crypto");
    else Object.defineProperty(globalThis, "crypto", descriptor);
  }
});

check("repeated construction is deterministic in both directions", () => {
  const root = multiNodeDocument(`<a @${Q1}/> <b @${Q2}/>`).root();
  const first = build_livemap_document_identity_overlay(root, "document");
  const second = build_livemap_document_identity_overlay(root, "document");
  assert.deepEqual(first.pathForQuid(Q2), second.pathForQuid(Q2));
  assert.equal(first.quidAtPath(validate_document_path([0])), second.quidAtPath(validate_document_path([0])));
});

check("one-node and multi-node document paths share one rooted coordinate model", () => {
  assert.deepEqual(livemap_document_identity_overlay_for(element(`<main @${Q1}/>`)).pathForQuid(Q1), [0]);
  assert.deepEqual(livemap_document_identity_overlay_for(multiNodeDocument(`<main @${Q1}/> <aside/>`)).pathForQuid(Q1), [0]);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.document-identity-overlay-construction", checks, checks, 0);

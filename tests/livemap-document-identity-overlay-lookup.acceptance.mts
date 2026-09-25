import { element } from "./helpers/mirror-unit6.mts";
// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import type { LiveMapDocumentLibrary, LiveMapDocumentPath } from "../src/types/livemap.types.ts";
import {
  assert_livemap_document_identity_overlay,
  livemap_document_identity_overlay_build_count,
  livemap_document_identity_overlay_for,
  LiveMapDocumentIdentityError,
  type LiveMapDocumentIdentityOverlay,
} from "../src/api/livemap/livemap.document.identity.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-identity-overlay-lookup",
  title: "Document identity overlay lookup and agreement",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "path", "lookup", "invariants", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-identity-overlay-lookup");
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

const Q1 = "000000101";
const Q2 = "000000102";
const Q3 = "000000103";
const rootPath = validate_document_path([0]);

function fakeOverlay(
  size: number,
  pathForQuid: (quid: string) => LiveMapDocumentPath | undefined,
  quidAtPath: (path: LiveMapDocumentPath) => string | undefined,
): LiveMapDocumentIdentityOverlay {
  return Object.freeze({ size, pathForQuid, quidAtPath });
}

check("QUID-to-path lookup resolves the canonical root", () => {
  assert.deepEqual(livemap_document_identity_overlay_for(element(`<main @${Q1}/>`)).pathForQuid(Q1), [0]);
});

check("QUID-to-path lookup resolves a nested canonical element", () => {
  const overlay = livemap_document_identity_overlay_for(element(`<main <span @${Q1}/>/` + `>`));
  assert.deepEqual(overlay.pathForQuid(Q1), [0, 0, 0]);
});

check("path-to-QUID lookup reverses the same root correspondence", () => {
  assert.equal(livemap_document_identity_overlay_for(element(`<main @${Q1}/>`)).quidAtPath(rootPath), Q1);
});

check("path-to-QUID lookup reverses the same nested correspondence", () => {
  const overlay = livemap_document_identity_overlay_for(element(`<main <span @${Q1}/>/` + `>`));
  assert.equal(overlay.quidAtPath(validate_document_path([0, 0, 0])), Q1);
});

check("missing QUID lookup returns undefined", () => {
  assert.equal(livemap_document_identity_overlay_for(element(`<main @${Q1}/>`)).pathForQuid(Q2), undefined);
});

check("an unquidded canonical path has no reverse correspondence", () => {
  const overlay = livemap_document_identity_overlay_for(element(`<main @${Q1} <span/>/>`));
  assert.equal(overlay.quidAtPath(validate_document_path([0, 0, 0])), undefined);
});

check("document.byQuid resolves through the current overlay and returns a clone", () => {
  const map = element(`<main <span @${Q1} id="one"/>/>`);
  const first = map.document.byQuid(Q1);
  const second = map.document.byQuid(Q1);
  assert.equal(first?.$_tag, "span");
  assert.notEqual(first, second);
});

check("repeated document.byQuid lookup performs no overlay rebuild", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  for (let index = 0; index < 50; index += 1) assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(livemap_document_identity_overlay_build_count(), before);
});

check("selected libraries expose no public replay or QUID-target mutation", () => {
  const page = element(`<main @${Q1}/>`);
  assert.equal("replay" in page, false);
  assert.throws(() => page.document.attrs.set({ kind: "quid", quid: Q1 } as never, "title", "seen"));
  assert.equal(page.rev, 0);
});

check("path requests remain path-authoritative beside sparse identity", () => {
  const map = element(`<main <span @${Q1}/>/` + `>`);
  const commit = map.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "id", "target");
  assert.deepEqual(commit.operations[0]?.operation.target, { kind: "path", path: [0, 0, 0] });
});

check("raw-QUID requests reject without building an overlay", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  assert.throws(() => map.document.attrs.set({ kind: "quid", quid: Q2 } as never, "id", "x"));
  assert.equal(livemap_document_identity_overlay_build_count(), before);
});

check("portable registry restore clears source and prior lookup identity", () => {
  const Schema = Hson.schema`<type "document" tag "main" content "empty">`;
  const source = hsonLiveMap.fromLibraries({ page: { document: '<main title="new"/>', schema: Schema } });
  const target = hsonLiveMap.fromLibraries({ page: { document: '<main/>', schema: Schema } });
  target.restore(source.capture());
  assert.equal(target.lib("page").document.byQuid(Q1), undefined);
  assert.equal(target.lib("page").document.byQuid(Q2), undefined);
});

check("a stale detached old node cannot influence new overlay resolution", () => {
  const Schema = Hson.schema`<type "document" tag "main" content "empty">`;
  const target = hsonLiveMap.fromLibraries({ page: { document: '<main/>', schema: Schema } });
  const stale = target.lib("page").root();
  const source = hsonLiveMap.fromLibraries({ page: { document: '<main title="next"/>', schema: Schema } });
  target.restore(source.capture());
  if (stale !== undefined) stale.$_tag = "tampered";
  assert.equal(target.lib("page").document.byQuid(Q1), undefined);
  assert.equal(target.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), "next");
});

check("agreement assertion accepts a freshly constructed overlay", () => {
  const map = element(`<main @${Q1} <span @${Q2}/>/` + `>`);
  assert.doesNotThrow(() => assert_livemap_document_identity_overlay(
    map.root(), map.mode, livemap_document_identity_overlay_for(map),
  ));
});

check("agreement assertion rejects an omitted graph QUID", () => {
  const map = element(`<main @${Q1}/>`);
  const missing = fakeOverlay(0, () => undefined, () => undefined);
  assert.throws(() => assert_livemap_document_identity_overlay(map.root(), map.mode, missing), (error: unknown) =>
    error instanceof LiveMapDocumentIdentityError && error.code === "OVERLAY_INVARIANT");
});

check("agreement assertion rejects a wrong forward path", () => {
  const map = element(`<main @${Q1} <span/>/>`);
  const wrong = fakeOverlay(1, () => validate_document_path([0, 0]), () => Q1);
  assert.throws(() => assert_livemap_document_identity_overlay(map.root(), map.mode, wrong), LiveMapDocumentIdentityError);
});

check("agreement assertion rejects a wrong reverse QUID", () => {
  const map = element(`<main @${Q1}/>`);
  const wrong = fakeOverlay(1, () => rootPath, () => Q2);
  assert.throws(() => assert_livemap_document_identity_overlay(map.root(), map.mode, wrong), LiveMapDocumentIdentityError);
});

check("agreement assertion rejects an overlay entry on a QUID-free graph", () => {
  const map = element(`<main/>`);
  const extra = fakeOverlay(1, () => rootPath, () => Q1);
  assert.throws(() => assert_livemap_document_identity_overlay(map.root(), map.mode, extra), LiveMapDocumentIdentityError);
});

check("agreement assertion rejects a same-size foreign QUID substitution", () => {
  const map = element(`<main @${Q1}/>`);
  const foreign = fakeOverlay(1, (quid) => quid === Q3 ? rootPath : undefined, () => Q3);
  assert.throws(() => assert_livemap_document_identity_overlay(map.root(), map.mode, foreign), LiveMapDocumentIdentityError);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");

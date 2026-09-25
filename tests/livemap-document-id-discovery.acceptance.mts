// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import * as publicApi from "../src/index.ts";
import { find_internal_document_id } from "../src/api/livemap/livemap.document.id-discovery.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveMapDocumentLibrary, LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-id-discovery", title: "Internal named document ID discovery",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["document", "path", "traversal", "discovery", "canonical-graph", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-id-discovery");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}
const Empty = Hson.schema`<type "document" tag "main" content "empty">`;
const Nested = Hson.schema`<type "document" tag "main" content <sequence [<tag "section" content <sequence [<tag "button" content "empty">]>>]>>`;
const Items = Hson.schema`<type "document" tag "main" content <repeat <tag "item" attrs <props <id <optional "string">>> content "empty">>>`;
const Multi = Hson.schema`<type "document" content <repeat <tag "item" attrs <props <id <optional "string">>> content "empty">>>`;
const Text = Hson.schema`<type "document" tag "main" content "string">`;
const registry = (document: string, schema = Items) => hsonLiveMap.fromLibraries({ page: { document, schema } });
const find = (page: LiveMapDocumentLibrary, id: string, scope: readonly number[] = []) => find_internal_document_id(page, page.at(scope), id);
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const item = (id?: string): HsonNode => ({ $_tag: "item", ...(id === undefined ? {} : { $_attrs: { id } }), $_content: [] });

check("root discovery includes the ordinary root", () => {
  const page = registry('<main id="root"/>', Empty).lib("page");
  assert.deepEqual(find(page, "root")?.path(), []);
});
check("nested descendant discovery uses logical edges", () => {
  const page = registry('<main <section <button id="x"/>/>/>', Nested).lib("page");
  assert.deepEqual(find(page, "x")?.path(), [0, 0]);
});
check("multi-root discovery visits later content", () => {
  const page = registry('<item/> <item id="later"/>', Multi).lib("page");
  assert.deepEqual(find(page, "later")?.path(), [1]);
});
check("missing and out-of-range scopes return undefined", () => {
  const page = registry('<main <item/>/>').lib("page");
  assert.equal(find(page, "missing"), undefined);
  assert.equal(find(page, "missing", [9]), undefined);
});
check("duplicate IDs choose first preorder match", () => {
  const page = registry('<main <item id="x"/> <item id="x"/>/>').lib("page");
  assert.deepEqual(find(page, "x")?.path(), [0]);
});
check("scope includes itself and excludes siblings and ancestors", () => {
  const page = registry('<main id="root" <item id="scope"/> <item id="outside"/>/>').lib("page");
  assert.deepEqual(find(page, "scope", [0])?.path(), [0]);
  assert.equal(find(page, "root", [0]), undefined);
  assert.equal(find(page, "outside", [0]), undefined);
});
check("text and QUID metadata are never ID candidates", () => {
  const text = registry('<main "id=x"/>', Text).lib("page");
  assert.equal(find(text, "x"), undefined);
  const page = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime('<main @00000000f/>', { allowTopLevelDocumentText: true }), schema: Empty },
  }).lib("page");
  assert.equal(find(page, "00000000f"), undefined);
});
check("ID matching is exact and case-sensitive", () => {
  const page = registry('<main <item id="Target"/>/>').lib("page");
  assert.equal(find(page, "target"), undefined);
  assert.deepEqual(find(page, "Target")?.path(), [0]);
});
check("empty string IDs remain discoverable", () => {
  const page = registry('<main id=""/>', Empty).lib("page");
  assert.deepEqual(find(page, "")?.path(), []);
});
check("discovery returns an interned selected-library location", () => {
  const page = registry('<main <item id="x"/>/>').lib("page");
  assert.equal(find(page, "x"), page.at([0]));
  assert.equal(find(page, "x"), page.at([]).id("x"));
});
check("insertion and movement refresh search without moving old locations", () => {
  const page = registry('<main <item id="x"/> <item/>/>').lib("page");
  const old = find(page, "x");
  page.document.content.insert(target(0, 0), 0, item());
  assert.equal((old?.snap() as HsonNode)?.$_attrs?.id, undefined);
  assert.deepEqual(find(page, "x")?.path(), [1]);
  page.document.content.move(target(0, 0), 1, 2);
  assert.deepEqual(find(page, "x")?.path(), [2]);
});
check("removal and replacement update fresh discovery", () => {
  const page = registry('<main <item id="x"/> <item/>/>').lib("page");
  page.document.content.replace(target(0, 0), 0, item("y"));
  assert.equal(find(page, "x"), undefined);
  assert.deepEqual(find(page, "y")?.path(), [0]);
  page.document.content.remove(target(0, 0), 0);
  assert.equal(find(page, "y"), undefined);
});
check("registry restore refreshes search", () => {
  const map = registry('<main <item id="x"/> <item/>/>');
  const initial = map.capture();
  const page = map.lib("page");
  page.document.content.move(target(0, 0), 0, 1);
  assert.deepEqual(find(page, "x")?.path(), [1]);
  map.restore(initial);
  assert.deepEqual(find(page, "x")?.path(), [0]);
});
check("internal discovery is non-minting and absent from public exports", () => {
  const map = registry('<main <item id="x"/>/>');
  const page = map.lib("page");
  const before = page.root();
  void find(page, "x");
  assert.deepEqual(page.root(), before);
  assert.equal(map.rev, 0);
  assert.equal(JSON.stringify(before).includes("quid"), false);
  assert.equal("find_internal_document_id" in publicApi, false);
  assert.equal("id" in page.document, false);
});
process.stdout.write(`# ${checks} internal named document ID discovery checks passed\n`);
events.terminal("pass");

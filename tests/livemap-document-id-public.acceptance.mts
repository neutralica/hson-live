// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-id-public", title: "Named document canonical ID discovery",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["document", "path", "proxy", "discovery", "public-api", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-id-public");
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
const Root = Hson.schema`<type "document" tag "main" content "empty">`;
const Button = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const Section = Hson.schema`<type "document" tag "main" content <sequence [<tag "section" content <sequence [<tag "button" content "empty">]>>]>>`;
const Items = Hson.schema`<type "document" tag "main" content <repeat <tag "item" attrs <props <id <optional "string">>> content "empty">>>`;
const Multi = Hson.schema`<type "document" content <repeat <tag "item" attrs <props <id <optional "string">>> content "empty">>>`;
const registry = (document: string, schema = Items) => hsonLiveMap.fromLibraries({ page: { document, schema } });
const item = (id?: string): HsonNode => ({ $_tag: "item", ...(id === undefined ? {} : { $_attrs: { id } }), $_content: [] });
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const tag = (value: unknown): string | undefined => typeof value === "object" && value !== null && "$_tag" in value ? String(value.$_tag) : undefined;

check("root document locations discover their own ID", () => {
  const page = registry('<main id="root"/>', Root).lib("page");
  assert.equal(page.at([]).id("root"), page.at([]));
});
check("root locations discover direct children", () => {
  const page = registry('<main <button id="submit"/>/>', Button).lib("page");
  assert.deepEqual(page.at([]).id("submit")?.path(), [0]);
});
check("root locations discover nested descendants", () => {
  const page = registry('<main <section <button id="submit"/>/>/>', Section).lib("page");
  assert.deepEqual(page.at([]).id("submit")?.path(), [0, 0]);
});
check("multi-root documents search actual top-level content", () => {
  const page = registry('<item/> <item id="submit"/>', Multi).lib("page");
  assert.deepEqual(page.at([]).id("submit")?.path(), [1]);
});
check("missing IDs and non-string arguments reject appropriately", () => {
  const page = registry('<main <button/>/>', Button).lib("page");
  assert.equal(page.at([]).id("missing"), undefined);
  assert.throws(() => Reflect.apply(page.at([]).id, page.at([]), [7]), /not a string/);
});
check("duplicate IDs choose the first canonical preorder match", () => {
  const page = registry('<main <item id="x"/> <item id="x"/>/>').lib("page");
  assert.deepEqual(page.at([]).id("x")?.path(), [0]);
});
check("scoped endpoints include themselves", () => {
  const page = registry('<main <item id="scope"/>/>').lib("page");
  assert.equal(page.at([0]).id("scope"), page.at([0]));
});
check("scoped endpoints cannot inspect siblings or ancestors", () => {
  const page = registry('<main id="root" <item/> <item id="outside"/>/>').lib("page");
  assert.equal(page.at([0]).id("outside"), undefined);
  assert.equal(page.at([0]).id("root"), undefined);
});
check("ID matching is exact and case-sensitive", () => {
  const page = registry('<main <item id="Submit"/>/>').lib("page");
  assert.equal(page.at([]).id("submit"), undefined);
  assert.deepEqual(page.at([]).id("Submit")?.path(), [0]);
});
check("successful discovery returns the existing interned location", () => {
  const page = registry('<main <item id="x"/>/>').lib("page");
  const found = page.at([]).id("x");
  assert.equal(found, page.at(found?.path() ?? []));
  assert.equal(page.proxy().$_.id("x"), found);
});
check("insertion shifts fresh discovery without moving an old location", () => {
  const page = registry('<main <item id="x"/> <item/>/>').lib("page");
  const old = page.at([]).id("x");
  page.document.content.insert(target(0, 0), 0, item());
  assert.equal((old?.snap() as HsonNode)?.$_attrs?.id, undefined);
  assert.deepEqual(page.at([]).id("x")?.path(), [1]);
});
check("movement leaves returned locations at their coordinates", () => {
  const page = registry('<main <item id="x"/> <item/>/>').lib("page");
  const old = page.at([]).id("x");
  page.document.content.move(target(0, 0), 0, 1);
  assert.equal(tag(old?.snap()), "item");
  assert.equal((old?.snap() as HsonNode)?.$_attrs?.id, undefined);
  assert.deepEqual(page.at([]).id("x")?.path(), [1]);
});
check("removal leaves old coordinate passive and fresh discovery missing", () => {
  const page = registry('<main <item/> <item id="x"/>/>').lib("page");
  const old = page.at([]).id("x");
  page.document.content.remove(target(0, 0), 1);
  assert.equal(old?.snap(), undefined);
  assert.equal(page.at([]).id("x"), undefined);
});
check("replacement is visible to fresh discovery", () => {
  const page = registry('<main <item id="x"/>/>').lib("page");
  const old = page.at([]).id("x");
  page.document.content.replace(target(0, 0), 0, item("y"));
  assert.equal(page.at([]).id("x"), undefined);
  assert.equal(page.at([]).id("y"), old);
});
check("registry restore refreshes canonical discovery", () => {
  const map = registry('<main <item id="x"/> <item/>/>');
  const initial = map.capture();
  const page = map.lib("page");
  page.document.content.move(target(0, 0), 0, 1);
  const moved = page.at([]).id("x");
  map.restore(initial);
  assert.equal((moved?.snap() as HsonNode)?.$_attrs?.id, undefined);
  assert.deepEqual(page.at([]).id("x")?.path(), [0]);
});
check("discovery neither mints QUIDs nor advances revision", () => {
  const map = registry('<main <item id="x"/>/>');
  const before = map.lib("page").root();
  void map.lib("page").at([]).id("x");
  void map.lib("page").proxy().$_.id("x");
  assert.deepEqual(map.lib("page").root(), before);
  assert.equal(JSON.stringify(before).includes("quid"), false);
  assert.equal(map.rev, 0);
});
check("data locations do not gain document ID discovery", () => {
  const Data = Hson.schema`<type "data" content <id "string">>`;
  const data = hsonLiveMap.fromLibraries({ state: { data: { id: "x" }, schema: Data } }).lib("state");
  const page = registry('<main id="x"/>', Root).lib("page");
  assert.equal("id" in data.at([]), false);
  assert.equal("id" in page.document, false);
  assert.equal(Reflect.get(page.proxy(), "id"), undefined);
});
process.stdout.write(`# ${checks} named document ID discovery checks passed\n`);
events.terminal("pass");

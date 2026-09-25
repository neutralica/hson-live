// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, projected_element } from "./helpers/mirror-unit6.mts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/_tests/diagnostics-internal.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-logical-traversal",
  title: "Registry document logical traversal",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "path", "traversal", "content", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-logical-traversal");
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
const Items = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const Multi = Hson.schema`<type "document" content <repeat <tag "item" content "empty">>>`;
const Text = Hson.schema`<type "document" tag "main" content "string">`;
const registry = (document: string, schema = Items) => hsonLiveMap.fromLibraries({ page: { document, schema } });

check("logical root resolves the ordinary document element", () => {
  const page = registry('<main <item id="a"/>/>').lib("page");
  assert.equal((page.at([]).snap() as { $_tag: string }).$_tag, "main");
  assert.equal(page.at([]).asElement()?.kind(), "element");
});

check("logical child paths hide physical content carriers", () => {
  const page = registry('<main <item id="a"/> <item id="b"/>/>').lib("page");
  assert.equal((page.at([0]).snap() as { $_tag: string }).$_tag, "item");
  assert.equal(page.at([0]).asElement()?.attrs.get("id"), "a");
  assert.equal(page.at([1]).asElement()?.attrs.get("id"), "b");
});

check("nested logical traversal descends through each canonical carrier", () => {
  const page = element('<main <section <item id="nested"/>/>/>');
  assert.equal(page.at([0, 0]).asElement()?.attrs.get("id"), "nested");
  assert.equal((page.at([0]).snap() as { $_tag: string }).$_tag, "section");
});

check("multi-node document root is an ordered content container", () => {
  const page = hsonLiveMap.fromLibraries({ page: { document: '<item id="a"/> <item id="b"/>', schema: Multi } }).lib("page");
  assert.equal(page.at([]).asRoot()?.kind(), "root");
  assert.equal(page.at([0]).asElement()?.attrs.get("id"), "a");
  assert.equal(page.at([1]).asElement()?.attrs.get("id"), "b");
});

check("empty document root stays addressable", () => {
  const page = hsonLiveMap.fromLibraries({ page: { document: '', schema: Multi } }).lib("page");
  assert.equal(page.at([]).asRoot()?.kind(), "root");
  assert.equal(page.at([0]).snap(), undefined);
});

check("text content resolves the authored string rather than its carrier", () => {
  const page = hsonLiveMap.fromLibraries({ page: { document: '<main "hello"/>', schema: Text } }).lib("page");
  assert.equal(page.at([0]).snap(), "hello");
  assert.equal(page.at([0]).asText()?.kind(), "text");
});

check("out-of-range logical locations report missing state", () => {
  const page = registry('<main <item/>/>').lib("page");
  assert.equal(page.at([2]).snap(), undefined);
  assert.equal(page.at([2]).present(), undefined);
});

check("location handles stay fixed while occupants move", () => {
  const page = registry('<main <item id="a"/> <item id="b"/>/>').lib("page");
  const first = page.at([0]);
  page.at([]).asElement()!.move(0, 1);
  assert.equal(first, page.at([0]));
  assert.equal(first.asElement()?.attrs.get("id"), "b");
});

check("insertion before a fixed location changes the current occupant", () => {
  const page = registry('<main <item id="a"/>/>').lib("page");
  const first = page.at([0]);
  page.at([]).asElement()!.insert(0, projected_element('<item id="new"/>'));
  assert.equal(first.asElement()?.attrs.get("id"), "new");
});

check("empty element content materializes on the first valid insertion", () => {
  const page = registry('<main/>').lib("page");
  const commit = page.at([]).asElement()!.insert(0, projected_element('<item/>'));
  assert.equal(commit.operations[0]?.operation.op, "insert-content");
  assert.equal((page.at([0]).snap() as { $_tag: string }).$_tag, "item");
});

check("invalid insertion index leaves an empty element unchanged", () => {
  const map = registry('<main/>');
  const before = map.capture();
  assert.throws(() => map.lib("page").at([]).asElement()!.insert(1, projected_element('<item/>')));
  assert.deepEqual(map.capture(), before);
});

check("first empty-document insertion lowers through root content", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: '', schema: Multi } });
  map.lib("page").at([]).asRoot()!.insert(0, projected_element('<item/>'));
  assert.match(map.render(), /<item/);
});

check("Mirror consumes first element content materialization", () => {
  const page = registry('<main/>').lib("page");
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), page);
  page.at([]).asElement()!.insert(0, projected_element('<item/>'));
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  binding.dispose();
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry logical traversal checks passed\n`);

import { document_hson_value } from "./helpers/document-hson-value.mts";
// @hson-live-external-test
import assert from "node:assert/strict";
import { document_graph_operation } from "./helpers/document-library.mts";
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
const Items = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content <repeat <tag "item" content "empty">>>]>>]>>`;
const Multi = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content <repeat <tag "item" content "empty">>>]>>]>>`;
const Text = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content "string">]>>]>>`;
const registry = (document: string, schema = Items) => hsonLiveMap.fromLibraries({ page: { document, schema } });

check("logical root resolves the ordinary document element", () => {
  const page = registry('<main <item id="a"/>/>').doc.must("page");
  assert.equal((document_hson_value(page.at([1, 0]).hson()) as { $_tag: string }).$_tag, "main");
  assert.equal(page.at([1, 0]).asElement()?.kind(), "element");
});

check("logical child paths hide physical content carriers", () => {
  const page = registry('<main <item id="a"/> <item id="b"/>/>').doc.must("page");
  assert.equal((document_hson_value(page.at([1, 0, 0]).hson()) as { $_tag: string }).$_tag, "item");
  assert.equal(page.at([1, 0, 0]).asElement()?.attrs.get("id"), "a");
  assert.equal(page.at([1, 0, 1]).asElement()?.attrs.get("id"), "b");
});

check("nested logical traversal descends through each canonical carrier", () => {
  const page = element('<main <section <item id="nested"/>/>/>');
  assert.equal(page.at([1, 0, 0, 0]).asElement()?.attrs.get("id"), "nested");
  assert.equal((document_hson_value(page.at([1, 0, 0]).hson()) as { $_tag: string }).$_tag, "section");
});

check("explicit body content is an ordered container", () => {
  const page = hsonLiveMap.fromLibraries({ page: { document: '<main <item id="a"/> <item id="b"/>/>', schema: Multi } }).doc.must("page");
  assert.equal(page.at([1, 0]).asElement()?.kind(), "element");
  assert.equal(page.at([1, 0, 0]).asElement()?.attrs.get("id"), "a");
  assert.equal(page.at([1, 0, 1]).asElement()?.attrs.get("id"), "b");
});

check("empty authored main stays addressable", () => {
  const page = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: Multi } }).doc.must("page");
  assert.equal(page.at([1, 0]).asElement()?.kind(), "element");
  assert.equal(page.at([1, 0, 0]).snap(), undefined);
});

check("text content resolves the authored string rather than its carrier", () => {
  const page = hsonLiveMap.fromLibraries({ page: { document: '<main "hello"/>', schema: Text } }).doc.must("page");
  assert.equal(page.at([1, 0, 0]).snap(), "hello");
  assert.equal(page.at([1, 0, 0]).asText()?.kind(), "text");
});

check("out-of-range logical locations report missing state", () => {
  const page = registry('<main <item/>/>').doc.must("page");
  assert.equal(page.at([1, 0, 2]).snap(), undefined);
  assert.equal(page.at([1, 0, 2]).present(), undefined);
});

check("location handles stay fixed while occupants move", () => {
  const page = registry('<main <item id="a"/> <item id="b"/>/>').doc.must("page");
  const first = page.at([1, 0, 0]);
  page.at([1, 0]).asElement()!.move(0, 1);
  assert.equal(first, page.at([1, 0, 0]));
  assert.equal(first.asElement()?.attrs.get("id"), "b");
});

check("insertion before a fixed location changes the current occupant", () => {
  const page = registry('<main <item id="a"/>/>').doc.must("page");
  const first = page.at([1, 0, 0]);
  page.at([1, 0]).asElement()!.insert(0, projected_element('<item id="new"/>'));
  assert.equal(first.asElement()?.attrs.get("id"), "new");
});

check("empty element content materializes on the first valid insertion", () => {
  const page = registry('<main/>').doc.must("page");
  const commit = page.at([1, 0]).asElement()!.insert(0, projected_element('<item/>'));
  assert.equal(document_graph_operation(commit).op, "insert-content");
  assert.equal((document_hson_value(page.at([1, 0, 0]).hson()) as { $_tag: string }).$_tag, "item");
});

check("invalid insertion index leaves an empty element unchanged", () => {
  const map = registry('<main/>');
  const before = map.capture();
  assert.throws(() => map.doc.must("page").at([1, 0]).asElement()!.insert(1, projected_element('<item/>')));
  assert.deepEqual(map.capture(), before);
});

check("first empty-main insertion lowers through element content", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: Multi } });
  map.doc.must("page").at([1, 0]).asElement()!.insert(0, projected_element('<item/>'));
  assert.match(map.doc.must("page").render(), /<item/);
});

check("Mirror consumes first element content materialization", () => {
  const page = registry('<main/>').doc.must("page");
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), page);
  page.at([1, 0]).asElement()!.insert(0, projected_element('<item/>'));
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  binding.dispose();
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry logical traversal checks passed\n`);

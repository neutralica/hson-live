// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/_tests/diagnostics-internal.ts";
import { LiveMapDocumentMutationError } from "../src/api/livemap/livemap.error.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-location-content", title: "Named document location content convergence",
  category: "LiveMap", runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "path", "mutation", "proxy", "reflection", "public-api", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-location-content");
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
const Items = Hson.schema`<type "document" tag "main" content <repeat <tag "item" attrs <props <id "string">> content "empty">>>`;
const Sections = Hson.schema`<type "document" tag "main" content <sequence [<tag "section" content <repeat <tag "item" attrs <props <id "string">> content "empty">>>]>>`;
const MultiItems = Hson.schema`<type "document" content <repeat <tag "item" attrs <props <id "string">> content "empty">>>`;
const Text = Hson.schema`<type "document" tag "main" content "string">`;
const registry = (document: string, schema = Items) => hsonLiveMap.fromLibraries({ page: { document, schema } });
const item = (id: string): HsonNode => ({ $_tag: "item", $_attrs: { id }, $_content: [] });
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const ids = (root: HsonNode): string[] => {
  const found: string[] = [];
  const visit = (node: HsonNode): void => {
    if (node.$_tag === "item") { found.push(String(node.$_attrs?.id)); return; }
    for (const child of node.$_content) if (typeof child === "object" && child !== null) visit(child);
  };
  visit(root);
  return found;
};
const code = (run: () => unknown, expected: LiveMapDocumentMutationError["code"]): void =>
  assert.throws(run, (error: unknown) => error instanceof LiveMapDocumentMutationError && error.code === expected);

check("element insert owns ordered authored content", () => {
  const map = registry('<main <item id="b"/>/>');
  map.lib("page").at([]).asElement()!.insert(0, item("a"));
  assert.deepEqual(ids(map.lib("page").at([]).snap() as HsonNode), ["a", "b"]);
});
check("first insert materializes an empty element's content", () => {
  const map = registry("<main/>");
  const commit = map.lib("page").at([]).asElement()!.insert(0, item("a"));
  assert.equal(commit.operations[0]?.operation.op, "insert-content");
  assert.deepEqual(ids(map.lib("page").at([]).snap() as HsonNode), ["a"]);
});
check("nested insert owns only selected section content", () => {
  const map = registry('<main <section <item id="b"/>/>/>', Sections);
  map.lib("page").at([0]).asElement()!.insert(0, item("a"));
  assert.deepEqual(ids(map.lib("page").at([0]).snap() as HsonNode), ["a", "b"]);
});
check("document root insert owns top-level content", () => {
  const map = registry('<item id="a"/> <item id="c"/>', MultiItems);
  map.lib("page").at([]).asRoot()!.insert(1, item("b"));
  assert.deepEqual(ids(map.lib("page").root()), ["a", "b", "c"]);
});
check("invalid insert index rejects exactly", () => {
  code(() => registry("<main/>").lib("page").at([]).asElement()!.insert(1, item("a")), "INVALID_DOCUMENT_CONTENT_INDEX");
});
check("primitive endpoint has no element insertion capability", () => {
  const page = registry('<main "text"/>', Text).lib("page");
  assert.equal(page.at([0]).asElement(), undefined);
});
check("move uses final indexes and retains item identity", () => {
  const map = registry('<main <item id="a"/> <item id="b"/> <item id="c"/>/>');
  map.lib("page").at([]).asElement()!.move(0, 2);
  assert.deepEqual(ids(map.lib("page").at([]).snap() as HsonNode), ["b", "c", "a"]);
});
check("nested move leaves other content in place", () => {
  const map = registry('<main <section <item id="a"/> <item id="b"/>/>/>', Sections);
  map.lib("page").at([0]).asElement()!.move(1, 0);
  assert.deepEqual(ids(map.lib("page").at([0]).snap() as HsonNode), ["b", "a"]);
});
check("document root move operates on top-level content", () => {
  const map = registry('<item id="a"/> <item id="b"/> <item id="c"/>', MultiItems);
  map.lib("page").at([]).asRoot()!.move(2, 0);
  assert.deepEqual(ids(map.lib("page").root()), ["c", "a", "b"]);
});
check("child location remains fixed after movement", () => {
  const page = registry('<main <item id="a"/> <item id="b"/>/>').lib("page");
  const first = page.at([0]);
  page.at([]).asElement()!.move(0, 1);
  assert.equal(first, page.at([0]));
  assert.equal((first.snap() as HsonNode).$_attrs?.id, "b");
});
check("proxy escape uses the selected library content capability", () => {
  const page = registry('<main <item id="a"/> <item id="b"/>/>').lib("page");
  assert.equal(page.proxy().$_, page.at([]));
  const commit = page.proxy().$_.asElement()!.move(0, 1);
  assert.equal(commit.operations[0]?.operation.op, "move-content");
});
check("location insert matches document API and registry commit", () => {
  const left = registry('<main <item id="a"/>/>');
  const right = registry('<main <item id="a"/>/>');
  const first = left.lib("page").at([]).asElement()!.insert(1, item("b"));
  const second = right.lib("page").document.content.insert(target(0, 0), 1, item("b"));
  assert.deepEqual(first, second);
  assert.deepEqual(left.capture(), right.capture());
});
check("location move restores without special cases", () => {
  const source = registry('<main <item id="a"/> <item id="b"/>/>');
  const receiver = registry('<main <item id="a"/> <item id="b"/>/>');
  source.lib("page").at([]).asElement()!.move(0, 1);
  receiver.restore(source.capture());
  assert.deepEqual(receiver.lib("page").root(), source.lib("page").root());
});
check("Mirror consumes selected document location commits", () => {
  const map = registry('<main <item id="a"/>/>');
  const page = map.lib("page");
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), page);
  page.at([]).asElement()!.insert(1, item("b"));
  assert.deepEqual(ids(binding.tree.node), ["a", "b"]);
  binding.dispose();
});
check("acquiring content capabilities does not mint QUIDs", () => {
  const map = registry('<main <item id="a"/>/>');
  const location = map.lib("page").at([]).asElement()!;
  void location.insert; void location.move;
  assert.equal(JSON.stringify(map.lib("page").root()).includes("quid"), false);
  assert.equal(map.rev, 0);
});
process.stdout.write(`# ${checks} named document location content checks passed\n`);
events.terminal("pass");

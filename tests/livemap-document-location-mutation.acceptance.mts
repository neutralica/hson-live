// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, projected_element, raw_node } from "./helpers/mirror-unit6.mts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/_tests/diagnostics-internal.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-location-mutation",
  title: "Registry document location replacement and deletion",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "path", "mutation", "proxy", "mirror", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-location-mutation");
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
const fixture = () => element('<main <item id="a"/> <item id="b"/>/>');

check("replace changes exactly one logical element", () => {
  const map = fixture();
  map.at([0]).replace(projected_element('<item id="new"/>'));
  assert.equal(map.at([0]).asElement()?.attrs.get("id"), "new");
  assert.equal(map.at([1]).asElement()?.attrs.get("id"), "b");
});

check("nested replacement uses the same logical coordinates", () => {
  const map = element('<main <section <item id="a"/> <item id="b"/>/>/>');
  map.at([0, 1]).replace(projected_element('<item id="next"/>'));
  assert.equal(map.at([0, 1]).asElement()?.attrs.get("id"), "next");
});

check("authored text replacement stays a string location", () => {
  const map = element('<main "before"/>');
  const commit = map.at([0]).replace("after");
  assert.equal(map.at([0]).snap(), "after");
  assert.equal(commit.operations[0]?.operation.op, "replace-content");
});

check("off-Schema replacement fails without advancing revision", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.at([0]).replace(projected_element('<aside/>')));
  assert.deepEqual(map.capture(), before);
});

check("missing location and document root cannot be replaced", () => {
  const map = fixture();
  assert.throws(() => map.at([99]).replace(projected_element('<item/>')));
  assert.throws(() => map.at([]).replace(projected_element('<item/>')));
});

check("location replacement advances the global revision once", () => {
  const map = fixture();
  const commit = map.at([0]).replace(projected_element('<item id="new"/>'));
  assert.deepEqual([commit.prevRev, commit.rev, map.rev], [0, 1, 1]);
});

check("a location remains attached to its coordinate after replacement", () => {
  const map = fixture();
  const location = map.at([0]);
  location.replace(projected_element('<item id="new"/>'));
  assert.equal(location, map.at([0]));
  assert.equal(location.asElement()?.attrs.get("id"), "new");
});

check("delete shifts the next logical occupant into the fixed coordinate", () => {
  const map = fixture();
  const location = map.at([0]);
  const commit = location.delete();
  assert.equal(commit.operations[0]?.operation.op, "remove-content");
  assert.equal(location, map.at([0]));
  assert.equal(location.asElement()?.attrs.get("id"), "b");
});

check("nested deletion preserves remaining sibling", () => {
  const map = element('<main <section <item id="a"/> <item id="b"/>/>/>');
  map.at([0, 1]).delete();
  assert.equal(map.at([0, 0]).asElement()?.attrs.get("id"), "a");
  assert.equal(map.at([0, 1]).snap(), undefined);
});

check("missing location and document root cannot be deleted", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.at([99]).delete());
  assert.throws(() => map.at([]).delete());
  assert.deepEqual(map.capture(), before);
});

check("Mirror consumes location replacement and deletion", () => {
  const map = fixture();
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  map.at([0]).replace(projected_element('<item id="new"/>'));
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.id, "new");
  map.at([0]).delete();
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.id, "b");
  binding.dispose();
});

check("proxy paths share selected library locations", () => {
  const map = fixture();
  assert.equal(map.proxy([0]).$_, map.at([0]));
  map.proxy([0]).$_.replace(projected_element('<item id="proxy"/>'));
  assert.equal(map.at([0]).asElement()?.attrs.get("id"), "proxy");
});

check("location acquisition does not mint QUIDs or widen data capabilities", () => {
  const map = fixture();
  map.at([0]);
  assert.equal(JSON.stringify(map.root()).includes("quid"), false);
  const data = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: Hson.schema`<type "data" content <value "number">>` } });
  assert.equal(typeof data.lib("state").at(["value"]).replace, "function");
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry document location mutation checks passed\n`);

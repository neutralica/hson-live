// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { ordered_projected_array, ordered_projected_object } from "../src/core/ordered-projected-value.ts";
import { decode_livemap_replay_payload, encode_projected_value_transport } from "../src/api/livemap/livemap.transport.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import type { JsonValue } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.projected-intent-propagation",
  title: "Named data library intent and observation closure",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["projected-value", "rename", "move", "feeds", "capture", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.projected-intent-propagation");
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
const Schema = Hson.schema`<type "data" content <
  source <optional "any"> destination <optional "any"> items <optional "any">
  kept <optional "any"> left <optional "any"> right <optional "any">
  copy <optional "any"> other <optional "any"> value <optional "any">
  a <optional "any"> z <optional "any">
>>`;
const registry = (data: string | JsonValue) => hsonLiveMap.fromLibraries({ state: { data, schema: Schema } });
const state = (map: ReturnType<typeof registry>) => map.lib("state");

check("rename intent reaches the named registry commit stream", () => {
  const map = registry({ source: 1 });
  let observed: string | undefined;
  map.commits.observe((commit) => { const op = commit.operations[0]?.operation; observed = op !== undefined && "kind" in op ? op.kind : undefined; });
  state(map).at([]).asObject()!.renameKey("source", "destination");
  assert.equal(observed, "rename");
});
check("move intent reaches the named registry commit stream", () => {
  const map = registry({ items: [1, 2] });
  let observed: string | undefined;
  map.commits.observe((commit) => { const op = commit.operations[0]?.operation; observed = op !== undefined && "kind" in op ? op.kind : undefined; });
  state(map).at(["items"]).asArray()!.move(0, 1);
  assert.equal(observed, "move");
});
check("rename intent reaches a selected path feed", () => {
  const map = registry({ source: 1 });
  let observed: string | undefined;
  state(map).at([]).feed((event) => { observed = event.op.kind; });
  state(map).at([]).asObject()!.renameKey("source", "destination");
  assert.equal(observed, "rename");
});
check("move intent reaches a selected array feed", () => {
  const map = registry({ items: [1, 2] });
  let observed: string | undefined;
  state(map).at(["items"]).feed((event) => { observed = event.op.kind; });
  state(map).at(["items"]).asArray()!.move(0, 1);
  assert.equal(observed, "move");
});
check("feed mutation cannot alter canonical rename state", () => {
  const map = registry({ source: { value: 1 } });
  state(map).at([]).feed((event) => {
    if (event.op.kind === "rename") (event.op.next as { destination: { value: number } }).destination.value = 9;
  });
  state(map).at([]).asObject()!.renameKey("source", "destination");
  assert.deepEqual(state(map).snap(), { destination: { value: 1 } });
});
check("rename restores as an exact named library state", () => {
  const source = registry({ source: 1 });
  const target = registry({ source: 1 });
  state(source).at([]).asObject()!.renameKey("source", "destination");
  target.restore(source.capture());
  assert.deepEqual(state(target).snap(), state(source).snap());
  assert.equal(canonical_hson_graph_equal(state(target).root(), state(source).root()), true);
});
check("move restores as an exact named library state", () => {
  const source = registry({ items: [1, 2, 3] });
  const target = registry({ items: [1, 2, 3] });
  state(source).at(["items"]).asArray()!.move(0, 2);
  target.restore(source.capture());
  assert.deepEqual(state(target).snap(), { items: [2, 3, 1] });
});
check("path watch sees one changed rename and no no-op move", () => {
  const map = registry({ items: [1, 2], source: 1 });
  let calls = 0;
  state(map).at([]).watch(() => { calls += 1; });
  state(map).at(["items"]).asArray()!.move(0, 0);
  state(map).at([]).asObject()!.renameKey("source", "destination");
  assert.equal(calls, 1);
});
check("same-position move publishes neither a commit nor feed", () => {
  const map = registry({ items: [1, 2] });
  let commits = 0;
  let feeds = 0;
  map.commits.observe(() => { commits += 1; });
  state(map).at(["items"]).feed(() => { feeds += 1; });
  state(map).at(["items"]).asArray()!.move(0, 0);
  assert.deepEqual([commits, feeds, map.rev], [0, 0, 0]);
});
check("malformed exact move indexes reject", () => {
  const malformed = ordered_projected_array([ordered_projected_object([
    ["kind", "move"], ["path", ordered_projected_array(["items"])], ["from", -1], ["to", 0],
    ["prev", ordered_projected_array([1, 2])], ["next", ordered_projected_array([2, 1])],
  ])]);
  assert.throws(() => decode_livemap_replay_payload(encode_projected_value_transport(malformed).payload), /non-negative safe integer/);
});
check("malformed exact rename witnesses reject", () => {
  const malformed = ordered_projected_array([ordered_projected_object([
    ["kind", "rename"], ["path", ordered_projected_array([])], ["from", "source"], ["to", "destination"],
    ["prev", ordered_projected_array([1])], ["next", ordered_projected_array([1])],
  ])]);
  assert.throws(() => decode_livemap_replay_payload(encode_projected_value_transport(malformed).payload), /prev is not an object/);
});
check("rename and move preserve strict canonical graph equality through restore", () => {
  const source = registry({ source: { items: [1, 2, 3] } });
  state(source).at([]).asObject()!.renameKey("source", "destination");
  state(source).at(["destination", "items"]).asArray()!.move(0, 2);
  const target = registry({ source: { items: [1, 2, 3] } });
  target.restore(source.capture());
  assert.equal(canonical_hson_graph_equal(state(source).root(), state(target).root()), true);
  assert.equal(JSON.stringify(state(target).root()).includes("quid"), false);
});
process.stdout.write(`# ${checks} named data library intent checks passed\n`);
events.terminal("pass");

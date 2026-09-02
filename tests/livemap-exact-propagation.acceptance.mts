import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import { link_livemap } from "../src/api/livemap/livemap.link.ts";
import { make_livemap_store_api } from "../src/api/livemap/livemap.store.ts";
import { livemap_projected_propagation } from "../src/api/livemap/livemap.projected-propagation.ts";
import { decode_projected_value_payload } from "../src/api/livemap/livemap.transport.ts";
import { make_locus_canonical_stream } from "../src/api/locus/locus.history.ts";
import { make_locus_recovery_planner } from "../src/api/locus/locus.recovery.ts";
import { make_locus_sync_manager } from "../src/api/locus/locus.sync.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import {
  projected_value_from_hson_node,
  projected_value_to_hson_root,
} from "../src/core/projected-value-graph.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { JsonValue } from "../src/core/types.ts";
import type { LocusCanonicalCommit, LocusServerSyncMessage } from "../src/types/locus.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.exact-propagation",
  title: "LiveMap exact carrier propagation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "feed", "link", "store", "locus", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.exact-propagation");
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

const object = (entries: readonly (readonly [string, OrderedProjectedValue])[]): OrderedProjectedObject =>
  ordered_projected_object(entries);
const map = (value: OrderedProjectedValue) => make_livemap_core(projected_value_to_hson_root(value));
const carrier = (valueMap: ReturnType<typeof map>) => projected_value_from_hson_node(valueMap.root());
const keys = (value: OrderedProjectedValue | undefined): readonly string[] => {
  if (!is_ordered_projected_object(value)) throw new Error("Expected ordered object.");
  return value.entries.map(([key]) => key);
};
const capability = (valueMap: ReturnType<typeof map>) => {
  const value = livemap_projected_propagation(valueMap);
  if (value === undefined) throw new Error("Missing projected propagation capability.");
  return value;
};

const ordered = object([["10", 10], ["2", 2], ["1", 1]]);
const dangerous = object([["__proto__", object([["10", -0], ["2", 2]])], ["constructor", 3], ["prototype", "\ud800"]]);

check("private feeds deliver exact ordered carriers", () => {
  const source = map(object([["value", object([["a", 1]])]]));
  let observed: OrderedProjectedValue | undefined;
  capability(source).feed(["value"], (event) => { observed = event.value; });
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.deepEqual(keys(observed), ["10", "2", "1"]);
});

check("private feeds preserve negative zero", () => {
  const source = map(object([["value", 0]]));
  let observed: OrderedProjectedValue | undefined;
  capability(source).feed(["value"], (event) => { observed = event.value; });
  capability(source).commit([{ kind: "set", path: ["value"], value: -0 }]);
  assert.equal(Object.is(observed, -0), true);
});

check("private feeds preserve nested dangerous keys", () => {
  const source = map(object([["value", object([])]]));
  let observed: OrderedProjectedValue | undefined;
  capability(source).feed(["value"], (event) => { observed = event.value; });
  capability(source).commit([{ kind: "replace", path: ["value"], value: dangerous }]);
  assert.deepEqual(keys(observed), ["__proto__", "constructor", "prototype"]);
});

check("public feed values are fresh per listener", () => {
  const source = map(object([["value", object([["a", 1]])]]));
  let second: unknown;
  source.feed(["value"], (event) => { (event.value as Record<string, JsonValue>).a = 99; });
  source.feed(["value"], (event) => { second = (event.value as Record<string, JsonValue>).a; });
  capability(source).commit([{ kind: "replace", path: ["value"], value: object([["a", 2]]) }]);
  assert.equal(second, 2);
  assert.equal(source.snap(["value", "a"]), 2);
});

check("public feed operation values are fresh per listener", () => {
  const source = map(object([["value", object([["a", 1]])]]));
  let second: unknown;
  source.feed(["value"], (event) => { ((event.op.next as Record<string, JsonValue>).a) = 99; });
  source.feed(["value"], (event) => { second = (event.op.next as Record<string, JsonValue>).a; });
  capability(source).commit([{ kind: "replace", path: ["value"], value: object([["a", 2]]) }]);
  assert.equal(second, 2);
});

check("public integer-key enumeration cannot rewrite canonical order", () => {
  const source = map(object([["value", object([])]]));
  let publicKeys: readonly string[] = [];
  source.feed(["value"], (event) => { publicKeys = Object.keys(event.value as object); });
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.deepEqual(publicKeys, ["1", "2", "10"]);
  assert.deepEqual(keys(capability(source).read(["value"])), ["10", "2", "1"]);
});

check("listener mutation cannot alter linked propagation", () => {
  const source = map(object([["value", object([])]]));
  const target = map(object([["value", object([])]]));
  source.feed(["value"], (event) => { (event.value as Record<string, JsonValue>)["1"] = 99; });
  link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.deepEqual(keys(capability(target).read(["value"])), ["10", "2", "1"]);
});

check("direct links preserve exact source order", () => {
  const source = map(object([["value", object([])]]));
  const target = map(object([["value", object([])]]));
  link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.deepEqual(keys(capability(target).read(["value"])), ["10", "2", "1"]);
});

check("mapped links preserve exact source order", () => {
  const source = map(object([["from", object([])]]));
  const target = map(object([["to", object([])]]));
  link_livemap(source, target, { from: ["from"], to: ["to"] });
  capability(source).commit([{ kind: "replace", path: ["from"], value: ordered }]);
  assert.deepEqual(keys(capability(target).read(["to"])), ["10", "2", "1"]);
});

check("links preserve negative zero", () => {
  const source = map(object([["value", 0]]));
  const target = map(object([["value", 0]]));
  link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "set", path: ["value"], value: -0 }]);
  assert.equal(Object.is(capability(target).read(["value"]), -0), true);
});

check("links preserve dangerous names and isolated surrogates", () => {
  const source = map(object([["value", object([])]]));
  const target = map(object([["value", object([])]]));
  link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "replace", path: ["value"], value: dangerous }]);
  assert.deepEqual(keys(capability(target).read(["value"])), ["__proto__", "constructor", "prototype"]);
});

check("links preserve objects inside arrays", () => {
  const value = ordered_projected_array([ordered]);
  const source = map(object([["value", ordered_projected_array([])]]));
  const target = map(object([["value", ordered_projected_array([])]]));
  link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "replace", path: ["value"], value }]);
  const linked = capability(target).read(["value"]);
  assert.equal(Array.isArray(linked), true);
  if (!Array.isArray(linked)) throw new Error("Expected array.");
  assert.deepEqual(keys(linked[0]), ["10", "2", "1"]);
});

check("links preserve arrays inside objects", () => {
  const value = object([["items", ordered_projected_array([1, -0, dangerous])]]);
  const source = map(object([["value", object([])]]));
  const target = map(object([["value", object([])]]));
  link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "replace", path: ["value"], value }]);
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});

check("array splice links replace the exact linked scope", () => {
  const source = map(object([["items", ordered_projected_array([ordered])]]));
  const target = map(object([["items", ordered_projected_array([ordered])]]));
  link_livemap(source, target, { path: ["items"] });
  capability(source).commit([{ kind: "splice", path: ["items"], start: 1, deleteCount: 0, items: [dangerous] }]);
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});

check("repeated link propagation is deterministic", () => {
  const source = map(object([["value", object([])]]));
  const target = map(object([["value", object([])]]));
  link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  const first = target.capture().payload;
  capability(source).commit([{ kind: "replace", path: ["value"], value: dangerous }]);
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.equal(target.capture().payload, first);
});

check("path-handle links use the carrier channel", () => {
  const source = map(object([["value", object([])]]));
  const target = map(object([["value", object([])]]));
  source.at(["value"]).linkTo(target.at(["value"]));
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.deepEqual(keys(capability(target).read(["value"])), ["10", "2", "1"]);
});

check("failed target propagation leaves the target atomic", () => {
  const source = map(object([["value", 0]]));
  const target = map(object([["other", 1]]));
  link_livemap(source, target, { from: ["value"], to: ["missing", "child"] });
  assert.throws(() => capability(source).commit([{ kind: "set", path: ["value"], value: 2 }]));
  assert.equal(source.snap(["value"]), 2);
  assert.equal(target.rev, 0);
  assert.deepEqual(target.snap(), { other: 1 });
});

check("store snapshots are detached from canonical state", () => {
  const valueMap = map(object([["value", object([["a", 1]])]]));
  const store = make_livemap_store_api(valueMap);
  const snapshot = store.snapshot() as Record<string, JsonValue>;
  (snapshot.value as Record<string, JsonValue>).a = 9;
  assert.equal(valueMap.snap(["value", "a"]), 1);
});

check("store diff suppresses unchanged exact state", () => {
  const valueMap = map(object([["value", ordered]]));
  const store = make_livemap_store_api(valueMap);
  let calls = 0;
  store.subscribeDiff(() => { calls += 1; });
  capability(valueMap).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.equal(calls, 0);
});

check("store diff publishes order-only changes", () => {
  const valueMap = map(object([["value", object([["a", 1], ["b", 2]])]]));
  const store = make_livemap_store_api(valueMap);
  let calls = 0;
  store.subscribeDiff(() => { calls += 1; });
  capability(valueMap).commit([{ kind: "replace", path: ["value"], value: object([["b", 2], ["a", 1]]) }]);
  assert.equal(calls, 1);
});

check("store path publishes positive zero to negative zero", () => {
  const valueMap = map(object([["value", 0]]));
  const store = make_livemap_store_api(valueMap);
  let next: unknown;
  store.subscribePath(["value"], (value) => { next = value; });
  capability(valueMap).commit([{ kind: "set", path: ["value"], value: -0 }]);
  assert.equal(Object.is(next, -0), true);
});

check("store path suppresses negative zero to negative zero", () => {
  const valueMap = map(object([["value", -0]]));
  const store = make_livemap_store_api(valueMap);
  let calls = 0;
  store.subscribePath(["value"], () => { calls += 1; });
  capability(valueMap).commit([{ kind: "set", path: ["value"], value: -0 }]);
  assert.equal(calls, 0);
});

check("store listener mutation cannot affect dangerous-key state", () => {
  const valueMap = map(object([["value", object([])]]));
  const store = make_livemap_store_api(valueMap);
  store.subscribePath(["value"], (next) => {
    Object.defineProperty(next as object, "__proto__", { value: 99, enumerable: true });
  });
  capability(valueMap).commit([{ kind: "replace", path: ["value"], value: dangerous }]);
  assert.deepEqual(keys(capability(valueMap).read(["value"])), ["__proto__", "constructor", "prototype"]);
});

check("Locus canonical commits retain exact payloads", () => {
  const valueMap = map(object([["value", object([])]]));
  const stream = make_locus_canonical_stream(valueMap, { logicalMapId: "map", incarnationId: "inc" });
  let canonical: LocusCanonicalCommit | undefined;
  stream.on_commit((commit) => { canonical = commit; });
  capability(valueMap).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.equal(canonical?.format, "structural-json");
  assert.equal(typeof canonical?.payload, "string");
});

check("Locus sync and recovery use exact projected transport", () => {
  const valueMap = map(object([["value", ordered]]));
  const sent: LocusServerSyncMessage[] = [];
  const sync = make_locus_sync_manager(valueMap);
  assert.equal(sync.add_session("session", (message) => { sent.push(message); }).ok, true);
  assert.equal(sync.subscribe("session", ["value"], 1).ok, true);
  assert.deepEqual(keys(decode_projected_value_payload(sent[0]!.payload!)), ["10", "2", "1"]);

  const stream = make_locus_canonical_stream(valueMap, { logicalMapId: "recovery-map", incarnationId: "recovery-inc" });
  const recovery = make_locus_recovery_planner(valueMap, stream);
  const plan = recovery.plan({ logicalMapId: stream.logicalMapId });
  assert.equal(plan.outcome, "snapshot");
  if (plan.outcome !== "snapshot" || !("hson" in plan.body)) throw new Error("Expected Hson snapshot.");
  const restored = make_livemap_core(parse_hson(plan.body.hson));
  assert.deepEqual(keys(capability(restored).read(["value"])), ["10", "2", "1"]);
  plan.dispose();
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} exact LiveMap propagation checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.exact-propagation", checks, checks, 0);

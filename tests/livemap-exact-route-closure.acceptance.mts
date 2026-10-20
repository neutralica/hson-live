import { is_Node } from "../src/core/node-guards.ts";
import { strict_tagged_receiver_controls } from "./helpers/strict-tagged-receivers.mts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { ANY_DATA } from "../src/api/schema/hson-schema.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import {
  make_livemap_from_canonical_libraries_internal,
  make_livemap_mirror_from_snapshot_internal,
  make_livemap_hosted_mirror_from_snapshot_internal,
  make_livemap_mirror_from_portable_aggregate_internal,
  make_livemap_mirror_from_semantic_checkpoint_internal,
  make_livemap_client_composition_from_portable_aggregate_internal,
  portable_aggregate_inputs_internal,
} from "../src/api/livemap/livemap.libraries.ts";
import { make_portable_aggregate_snapshot, encode_hosted_root, decode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { orderedRootReconstructionFixtures, forbid_structural_js_enumeration } from "./fixtures/structural-json-order-fixtures.mts";
// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_public_attrs_equal, decode_public_attrs } from "../src/core/public-attrs.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import type { HsonNode, JsonValue } from "../src/core/types.ts";
import type { LiveMapDataLibrary } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.exact-route-closure", title: "Registry exact multi-route closure",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["projected-value", "capture", "restore", "closure", "externally-discoverable"]),
});
const testEvents = create_test_event_emitter("livemap.exact-route-closure");
let checks = 0;
function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try { run(); testEvents.case_end(name, "pass"); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error;
  }
  checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}

const WideSchema = Hson.schema`<type "data" content <
  value <optional "any"> items <optional "any"> nested <optional "any">
  a <optional "any"> other <optional "any"> left <optional "any"> right <optional "any">
  '10' <optional "any"> '2' <optional "any"> '1' <optional "any">
  '__proto__' <optional "any"> constructor <optional "any"> prototype <optional "any">
>>`;
const registry = (data: string | Record<string, unknown>) => hsonLiveMap.fromLibraries({ state: { data: data as JsonValue, schema: WideSchema } });
const dataLibrary = (map: ReturnType<typeof registry>): LiveMapDataLibrary<unknown> => map.data.must("state");
const root = (map: ReturnType<typeof registry>) => dataLibrary(map).root();
const payload = (map: ReturnType<typeof registry>) => map.capture().libraries[0]!.root.payload;
const same = (left: ReturnType<typeof registry>, right: ReturnType<typeof registry>) => {
  assert.equal(canonical_hson_graph_equal(root(left), root(right)), true);
  assert_invariants(root(left), "registry exact route closure");
};

check("capture restores an exact ordered graph", () => {
  const source = registry('{"value":{"10":10,"2":2,"1":1,"tail":-0}}');
  const target = registry('{"value":{"old":true}}');
  target.restore(source.capture());
  same(source, target);
  assert.equal(payload(source), payload(target));
});
check("repeated complete captures are byte-stable", () => {
  const map = registry('{"value":{"10":10,"2":2,"1":1}}');
  assert.deepEqual(map.capture(), map.capture());
  assert.equal(map.rev, 0);
});
check("invalid capture shape rejects atomically", () => {
  const map = registry('{"value":1}');
  const before = map.capture();
  assert.throws(() => map.restore({ ...before, format: "wrong" } as never));
  assert.deepEqual(map.capture(), before);
});
check("integer-like order remains exact across registry capture", () => {
  const source = registry('{"10":"ten","2":"two","1":"one"}');
  const target = registry('{}');
  target.restore(source.capture());
  same(source, target);
  assert.deepEqual(source.data.must("state").at([]).asObject()!.object.keys(), ["10", "2", "1"]);
});
check("dangerous names retain ordinary data semantics", () => {
  const source = registry('{"__proto__":"data","constructor":-0,"prototype":true}');
  const target = registry('{}'); target.restore(source.capture());
  same(source, target);
  const value = target.data.must("state").snap() as Record<string, unknown>;
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(Object.is(value.constructor, -0), true);
});
check("nested arrays, unusual strings, and negative zero remain exact", () => {
  const source = registry({ nested: { items: [1, -0, { value: "\ud800x\udfff" }] } });
  const target = registry('{}'); target.restore(source.capture());
  same(source, target);
  const value = target.data.must("state").snap() as { nested: { items: [number, number, { value: string }] } };
  assert.equal(Object.is(value.nested.items[1], -0), true);
  assert.equal(value.nested.items[2].value, "\ud800x\udfff");
});
check("repeated source references are detached structural occurrences", () => {
  const child = { value: 1 };
  const source = registry({ left: child, right: child });
  const target = registry('{}'); target.restore(source.capture());
  child.value = 9;
  same(source, target);
  assert.deepEqual(target.data.must("state").snap(), { left: { value: 1 }, right: { value: 1 } });
});
check("null-prototype input remains exact", () => {
  const input = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(input, "value", { value: -0, enumerable: true });
  const source = registry(input); const target = registry('{}');
  target.restore(source.capture()); same(source, target);
});
check("feed values are detached while canonical order remains exact", () => {
  const map = registry('{"value":{}}');
  let observed: unknown;
  map.data.must("state").at(["value"]).feed((event) => {
    observed = event.value;
    (event.value as Record<string, unknown>).tail = 99;
  });
  map.data.must("state").at(["value"]).replace({ "10": 10, "2": 2, "1": 1, tail: -0 });
  assert.deepEqual(Object.keys(observed as object), ["1", "2", "10", "tail"]);
  assert.equal((map.data.must("state").snap() as { value: { tail: number } }).value.tail, -0);
});
check("detached root mutation cannot bypass commits", () => {
  const map = registry({ a: { value: 1 } });
  let commits = 0;
  map.commits.observe(() => { commits += 1; });
  const detached = root(map); detached.$_content.length = 0;
  assert.deepEqual(map.data.must("state").snap(), { a: { value: 1 } });
  assert.equal(map.rev, 0); assert.equal(commits, 0);
});
check("plain object materialization can lose integer-key order", () => {
  const source = registry('{"10":10,"2":2,"1":1}');
  const target = registry(source.data.must("state").snap() as Record<string, unknown>);
  assert.deepEqual(source.data.must("state").at([]).asObject()!.object.keys(), ["10", "2", "1"]);
  assert.deepEqual(target.data.must("state").at([]).asObject()!.object.keys(), ["1", "2", "10"]);
  assert.equal(canonical_hson_graph_equal(root(source), root(target)), false);
});
check("document attribute equality is unordered by name", () => {
  const left = decode_public_attrs({ a: 1, b: "two" });
  const right = decode_public_attrs({ b: "two", a: 1 });
  if (left === undefined || right === undefined) throw new Error("Expected attrs.");
  assert.equal(canonical_public_attrs_equal(left, right), true);
});

for (const fixture of orderedRootReconstructionFixtures) {
  check(`ordered-root receiving paths: ${fixture.id}`, () => {
    const original: HsonNode = { $_tag: "_hson_root", $_content: [fixture.graph] };
    const source = hsonLiveMap.fromLibraries({ state: { data: fixture.expectedJson } });
    assert.equal(canonical_hson_graph_equal(source.data.must("state").root(), original), true);
    const engine = internal_livemap_aggregate_authority(source);
    const snapshot = source.capture();
    const hosted = engine.captureHosted();
    const portable = make_portable_aggregate_snapshot(hosted);
    const checkpoint = engine.captureSemanticCheckpoint();
    const admitted = portable_aggregate_inputs_internal(portable);
    assert.equal(canonical_hson_graph_equal(admitted.inputs[0]!.root, original), true);
    const receivers = [
      () => make_livemap_from_canonical_libraries_internal([{ name: "state", family: "data", root: original, schema: ANY_DATA }]),
      () => make_livemap_mirror_from_snapshot_internal(snapshot),
      () => make_livemap_hosted_mirror_from_snapshot_internal(hosted),
      () => make_livemap_mirror_from_portable_aggregate_internal(portable),
      () => make_livemap_mirror_from_semantic_checkpoint_internal(checkpoint),
      () => make_livemap_client_composition_from_portable_aggregate_internal(portable),
    ];
    for (const receive of receivers) {
      const stop = forbid_structural_js_enumeration();
      try {
        const reconstructed = receive();
        const observed = reconstructed.data.must("state").root();
        assert.equal(canonical_hson_graph_equal(observed, original), true);
        const value = observed.$_content[0];
        assert.ok(is_Node(value));
        assert.equal(hsonTransform.fromNode(value).toHson().serialize(), hsonTransform.fromNode(fixture.graph).toHson().serialize());
        assert.equal(reconstructed.capture().libraries[0]!.root.payload, snapshot.libraries[0]!.root.payload);
      } finally { stop(); }
    }
    const js = hsonTransform.fromNode(fixture.graph).toJson().value();
    assert.deepEqual(source.data.must("state").snap(), js);
    const fromObject = hsonLiveMap.fromLibraries({ state: { data: js } });
    assert.equal(canonical_hson_graph_equal(fromObject.data.must("state").root(), hsonTransform.fromJson(js).toNode()), true);
    assert.equal(canonical_hson_graph_equal(source.data.must("state").root(), original), true);
    assert.equal(canonical_hson_graph_equal(decode_hosted_root(encode_hosted_root(original)), original), true);
    assert.equal(canonical_hson_graph_equal(hsonTransform.fromBinary(hsonTransform.fromJson(fixture.expectedJson).toBinary().serialize()).toNode(), fixture.graph), true);
    assert.equal(canonical_hson_graph_equal(hsonTransform.fromHson(hsonTransform.fromNode(fixture.graph).toHson().serialize()).toNode(), fixture.graph), true);
  });
}

check("malformed tagged snapshots, document actions and portable replay reject before publication", () => {
  assert.deepEqual(strict_tagged_receiver_controls(), { snapshotRejections: 5, actionRejections: 14, replayRejections: 7 });
});

process.stdout.write(`# ${checks} exact registry closure checks passed\n`);
testEvents.terminal("pass");

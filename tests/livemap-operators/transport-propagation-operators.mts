import assert from "node:assert/strict";
import { hson } from "../../src/hson.ts";
import { link_livemap } from "../../src/api/livemap/livemap.link.ts";
import { own_record, lifecycle_operator, error_code, store_for, type DeterministicLiveMapOperator, type OperatorResult } from "./operator-catalog.mts";
import type { JsonValue, LiveMapCore } from "../../src/types/index.ts";

type Map = LiveMapCore<JsonValue | undefined>;

function exact(map: Map): string {
  const capture = map.capture();
  return JSON.stringify({ format: capture.format, payload: capture.payload });
}

function result(classification: OperatorResult["classification"], before: string, input: string, after: string, revisionDelta: number, publications: number, evidence: readonly string[] = []): OperatorResult {
  return Object.freeze({ classification, before, input, after, revisionDelta, publications, evidence: Object.freeze([...evidence]) });
}

function system(source: Map, target: Map): string {
  return JSON.stringify({ source: JSON.parse(exact(source)), target: JSON.parse(exact(target)) });
}

const INITIAL = '{"value":{"a":1,"b":2}}';
const ORDERED = own_record([["10", 10], ["2", 2], ["1", 1], ["__proto__", -0]]);

function changed_source(): Map {
  const map = hson.liveMap.fromJson(INITIAL);
  map.replace(["value"], ORDERED);
  return map;
}

export const transport_propagation_operators: readonly DeterministicLiveMapOperator[] = Object.freeze([
  lifecycle_operator("transport/capture-stable", "capture exact state", "Repeated exact captures are byte-stable and non-mutating.", "Map contains an admitted projected root.", "accept", () => {
    const map = changed_source(); const before = exact(map); const first = map.capture(); const second = map.capture(); assert.equal(first.payload, second.payload); return result("accept", before, "capture() twice", exact(map), 0, 0, ["payloads byte-identical"]);
  }),
  lifecycle_operator("transport/restore-exact", "restore an exact capture", "Restore adopts exact ordered carrier state.", "Capture is the canonical structural-json representation.", "change", () => {
    const source = changed_source(); const target = hson.liveMap.fromJson(INITIAL); const before = exact(target); target.restore(source.capture()); assert.equal(exact(target), exact(source)); return result("change", before, "source.capture()", exact(target), target.rev, 0, ["target payload equals source"]);
  }),
  lifecycle_operator("transport/apply-exact", "apply an exact snapshot", "Apply reconstructs exact captured state at the expected revision.", "Expected revision matches and envelope is valid.", "change", () => {
    const source = changed_source(); const capture = source.capture(); const target = hson.liveMap.fromJson(INITIAL); const before = exact(target); let publications = 0; target.commits.observe(() => { publications += 1; }); target.apply({ prevRev: 0, format: capture.format, payload: capture.payload }); assert.equal(exact(target), exact(source)); return result("change", before, "prevRev=0 plus exact capture", exact(target), target.rev, publications);
  }),
  lifecycle_operator("transport/replay-change", "replay an exact changed commit", "Replay verifies prev and installs next exactly.", "Target matches operation strict previous witness.", "change", () => {
    const source = hson.liveMap.fromJson(INITIAL); const target = hson.liveMap.fromJson(INITIAL); const before = exact(target); const commit = source.replace(["value"], ORDERED); const replayed = target.replay(commit); assert.equal(exact(target), exact(source)); return result(replayed.changed ? "change" : "no-op", before, "exact replace commit", exact(target), target.rev, 1, [`ops=${replayed.ops.length}`]);
  }),
  lifecycle_operator("transport/replay-order-conflict", "reject a replay order conflict", "Differently ordered previous objects conflict.", "Pairs match but strict previous entry order differs.", "conflict", () => {
    const source = hson.liveMap.fromJson('{"value":{"a":1,"b":2}}'); const target = hson.liveMap.fromJson('{"value":{"b":2,"a":1}}'); const before = exact(target); const commit = source.replace(["value"], { a: 9, b: 2 }); let code = "missing"; try { target.replay(commit); } catch (error) { code = error_code(error); } assert.equal(code, "REPLAY_CONFLICT"); return result("conflict", before, "commit prev order=[a,b]; target order=[b,a]", exact(target), 0, 0, [code]);
  }),
  lifecycle_operator("transport/replay-zero-conflict", "reject a replay zero-sign conflict", "Positive and negative zero are distinct replay witnesses.", "Commit prev is +0 and target stores -0.", "conflict", () => {
    const source = hson.liveMap.fromJson({ value: 0 }); const target = hson.liveMap.fromJson({ value: -0 }); const before = exact(target); const commit = source.set(["value"], 1); let code = "missing"; try { target.replay(commit); } catch (error) { code = error_code(error); } assert.equal(code, "REPLAY_CONFLICT"); return result("conflict", before, "commit prev=+0 next=1", exact(target), 0, 0, [code]);
  }),
  lifecycle_operator("transport/reject-format", "reject an unsupported exact format", "Unknown exact format never falls back.", "Restore carries format=wrong.", "rejection", () => {
    const map = hson.liveMap.fromJson(INITIAL); const before = exact(map); let code = "missing"; try { map.restore({ rev: 1, format: "wrong", payload: "null", root: map.root() } as never); } catch (error) { code = error_code(error); } assert.equal(exact(map), before); return result("rejection", before, "format=wrong payload=null", exact(map), 0, 0, [code]);
  }),
  lifecycle_operator("transport/reject-capture-payload", "reject malformed capture structural text", "Malformed exact capture is atomic.", "Payload is incomplete text {.", "rejection", () => {
    const map = hson.liveMap.fromJson(INITIAL); const before = exact(map); let code = "missing"; try { map.restore({ rev: 1, format: "structural-json", payload: "{", root: map.root() }); } catch (error) { code = error_code(error); } assert.equal(exact(map), before); return result("rejection", before, "format=structural-json payload={", exact(map), 0, 0, [code]);
  }),
  lifecycle_operator("transport/reject-replay-shape", "reject malformed replay operation shape", "Replay payload must decode to an operation array.", "Exact payload decodes to object {}.", "rejection", () => {
    const map = hson.liveMap.fromJson(INITIAL); const before = exact(map); let code = "missing"; try { map.replay({ prevRev: 0, format: "structural-json", payload: "{}" }); } catch (error) { code = error_code(error); } assert.equal(exact(map), before); return result("rejection", before, "exact replay payload={}", exact(map), 0, 0, [code]);
  }),
  lifecycle_operator("transport/removed-projection", "reject a removed compatibility value", "The canonical reader rejects the historical value projection.", "Capture includes the removed value field.", "rejection", () => {
    const map = hson.liveMap.fromJson(INITIAL); const before = exact(map); let code = "missing"; try { map.restore({ rev: 1, format: "structural-json", payload: "{", root: map.root(), value: { valid: true } } as never); } catch (error) { code = error_code(error); } assert.equal(exact(map), before); return result("rejection", before, "canonical capture plus removed value field", exact(map), 0, 0, [code]);
  }),
  lifecycle_operator("propagation/feed-change", "publish a changed feed value", "One changed commit delivers one detached public feed event.", "Listener observes changed path value.", "change", () => {
    const map = hson.liveMap.fromJson(INITIAL); const before = exact(map); let feeds = 0; map.feed(["value"], (event) => { feeds += 1; (event.value as Record<string, JsonValue>)["10"] = 99; }); const commit = map.replace(["value"], ORDERED); assert.equal(feeds, 1); assert.equal((map.snap(["value"]) as Record<string, JsonValue>)["10"], 10); return result(commit.changed ? "change" : "no-op", before, "replace value with ordered dangerous object", exact(map), map.rev, 1, ["feeds=1", "listener mutation detached"]);
  }),
  lifecycle_operator("propagation/feed-noop", "suppress a no-op feed", "SameValue replacement publishes neither commit nor feed.", "Candidate equals selected ordered value.", "no-op", () => {
    const map = hson.liveMap.fromJson(INITIAL); const before = exact(map); let feeds = 0; map.feed(["value"], () => { feeds += 1; }); const commit = map.replace(["value"], { a: 1, b: 2 }); assert.equal(feeds, 0); return result(commit.changed ? "change" : "no-op", before, "replace with same ordered object", exact(map), map.rev, 0, ["feeds=0"]);
  }),
  lifecycle_operator("propagation/feed-rejection", "keep feeds silent on admission rejection", "Rejected input leaves state, revision, commits, and feeds unchanged.", "Candidate owns an enumerable accessor.", "rejection", () => {
    const map = hson.liveMap.fromJson(INITIAL); const before = exact(map); let feeds = 0; let publications = 0; map.feed([], () => { feeds += 1; }); map.commits.observe(() => { publications += 1; }); const bad = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 }); let code = "missing"; try { map.set(["value"], bad as JsonValue); } catch (error) { code = error_code(error); } assert.equal(exact(map), before); assert.equal(feeds, 0); assert.equal(publications, 0); return result("rejection", before, "enumerable getter object", exact(map), 0, publications, [code, "feeds=0"]);
  }),
  lifecycle_operator("propagation/link-order", "propagate exact order through a link", "Target receives source carrier without public-object reconstruction.", "Source and target linked paths are compatible objects.", "change", () => {
    const source = hson.liveMap.fromJson(INITIAL); const target = hson.liveMap.fromJson(INITIAL); link_livemap(source, target, { path: ["value"] }); const before = system(source, target); const commit = source.replace(["value"], ORDERED); assert.equal(exact(source), exact(target)); return result(commit.changed ? "change" : "no-op", before, "linked replace ordered keys 10,2,1,__proto__", system(source, target), source.rev, 2, ["source payload equals target"]);
  }),
  lifecycle_operator("propagation/link-negative-zero", "propagate negative zero through a link", "SameValue-significant zero survives link propagation.", "Both linked paths initially store +0.", "change", () => {
    const source = hson.liveMap.fromJson({ value: 0 }); const target = hson.liveMap.fromJson({ value: 0 }); link_livemap(source, target, { path: ["value"] }); const before = system(source, target); const commit = source.set(["value"], -0); assert.equal(Object.is(target.snap(["value"]), -0), true); return result(commit.changed ? "change" : "no-op", before, "value=-0", system(source, target), source.rev, 2, ["target Object.is(-0)=true"]);
  }),
  lifecycle_operator("propagation/link-target-rejection", "isolate a failed link target", "Source may commit while invalid target remains atomic.", "Target destination parent is missing.", "rejection", () => {
    const source = hson.liveMap.fromJson({ value: 0 }); const target = hson.liveMap.fromJson({ other: 1 }); link_livemap(source, target, { from: ["value"], to: ["missing", "child"] }); const before = system(source, target); let code = "missing"; try { source.set(["value"], 2); } catch (error) { code = error_code(error); } assert.equal(source.snap(["value"]), 2); assert.deepEqual(target.snap(), { other: 1 }); return result("rejection", before, "source value=2 to missing.child", system(source, target), source.rev, 1, [code, "target unchanged"]);
  }),
  lifecycle_operator("propagation/store-change", "publish an ordered store diff", "An order-changing replacement notifies store once.", "Diff subscriber observes root state.", "change", () => {
    const map = hson.liveMap.fromJson(INITIAL); const store = store_for(map); const before = exact(map); let calls = 0; store.subscribeDiff(() => { calls += 1; }); const commit = map.replace(["value"], own_record([["b", 2], ["a", 1]])); assert.equal(calls, 1); return result(commit.changed ? "change" : "no-op", before, 'ordered entries=[["b",2],["a",1]]', exact(map), map.rev, 1, ["store calls=1"]);
  }),
  lifecycle_operator("propagation/store-noop", "suppress an unchanged store diff", "Ordered SameValue equality suppresses unchanged state.", "Replacement equals current ordered value.", "no-op", () => {
    const map = hson.liveMap.fromJson(INITIAL); const store = store_for(map); const before = exact(map); let calls = 0; store.subscribeDiff(() => { calls += 1; }); const commit = map.replace(["value"], { a: 1, b: 2 }); assert.equal(calls, 0); return result(commit.changed ? "change" : "no-op", before, "same ordered object", exact(map), map.rev, 0, ["store calls=0"]);
  }),
  lifecycle_operator("propagation/store-negative-zero", "publish negative zero through a path store", "Path comparison distinguishes zero signs.", "Subscribed path initially stores +0.", "change", () => {
    const map = hson.liveMap.fromJson({ value: 0 }); const store = store_for(map); const before = exact(map); let observed: unknown; store.subscribePath(["value"], (value) => { observed = value; }); const commit = map.set(["value"], -0); assert.equal(Object.is(observed, -0), true); return result(commit.changed ? "change" : "no-op", before, "value=-0", exact(map), map.rev, 1, ["observed Object.is(-0)=true"]);
  }),
  lifecycle_operator("transport/capture-restore-replay-closure", "close capture, restore, and replay", "Independent exact restore and replay produce the same result.", "Both targets begin at strict previous state.", "accept", () => {
    const source = hson.liveMap.fromJson(INITIAL); const commit = source.replace(["value"], ORDERED); const restored = hson.liveMap.fromJson(INITIAL); restored.restore(source.capture()); const replayed = hson.liveMap.fromJson(INITIAL); replayed.replay(commit); assert.equal(exact(restored), exact(replayed)); return result("accept", exact(hson.liveMap.fromJson(INITIAL)), "replace commit plus exact capture", exact(restored), 0, 0, ["restore payload equals replay payload"]);
  }),
]);

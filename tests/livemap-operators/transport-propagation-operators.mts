import assert from "node:assert/strict";
import { exact, registry, own_record, lifecycle_operator, error_code, type DeterministicLiveMapOperator, type OperatorResult } from "./operator-catalog.mts";
import type { JsonValue } from "../../src/core/types.ts";

const INITIAL = '{"value":{"a":1,"b":2}}';
const ORDERED = own_record([["10", 10], ["2", 2], ["1", 1], ["__proto__", -0]]);
const witness = (map: ReturnType<typeof registry>) => exact(map.lib("state"));
const result = (
  classification: OperatorResult["classification"], before: string, input: string,
  after: string, revisionDelta: number, publications = 0, evidence: readonly string[] = [],
): OperatorResult => Object.freeze({ classification, before, input, after, revisionDelta, publications, evidence: Object.freeze([...evidence]) });
const changed = () => {
  const map = registry(INITIAL);
  map.lib("state").at(["value"]).replace(ORDERED);
  return map;
};
const restore = (source: ReturnType<typeof registry>, target: ReturnType<typeof registry>) => {
  const before = witness(target);
  target.restore(source.capture());
  assert.equal(witness(target), witness(source));
  return result("change", before, "registry snapshot", witness(target), target.rev);
};
const reject = (input: string, makeInvalid: (capture: ReturnType<ReturnType<typeof registry>["capture"]>) => unknown) => {
  const map = registry(INITIAL);
  const before = witness(map);
  const capture = map.capture();
  let code = "missing";
  try { map.restore(makeInvalid(capture) as never); } catch (error) { code = error_code(error); }
  assert.notEqual(code, "missing");
  assert.deepEqual(map.capture(), capture);
  return result("rejection", before, input, witness(map), 0, 0, [code]);
};
const feed = (initial: string | JsonValue, input: string, act: (map: ReturnType<typeof registry>) => Readonly<{ changed: boolean }>, expected: "change" | "no-op") => {
  const map = registry(initial);
  const before = witness(map);
  let publications = 0;
  map.lib("state").at([]).feed(() => { publications += 1; });
  const commit = act(map);
  assert.equal(commit.changed, expected === "change");
  return result(expected, before, input, witness(map), map.rev, publications);
};

export const transport_propagation_operators: readonly DeterministicLiveMapOperator[] = Object.freeze([
  lifecycle_operator("transport/capture-stable", "capture exact state", "Repeated complete snapshots are stable.", "One named data library is admitted.", "accept", () => {
    const map = changed(); const before = witness(map);
    assert.deepEqual(map.capture(), map.capture());
    return result("accept", before, "capture() twice", witness(map), 0, 0, ["snapshots equal"]);
  }),
  lifecycle_operator("transport/restore-exact", "restore exact state", "Registry restore adopts ordered canonical state.", "Registry contracts match.", "change", () => restore(changed(), registry(INITIAL))),
  lifecycle_operator("transport/restore-revision", "restore exact revision", "Registry restore adopts source revision.", "Registry contracts match.", "change", () => {
    const source = changed(); const target = registry(INITIAL); const before = witness(target);
    target.restore(source.capture()); assert.equal(target.rev, source.rev);
    return result("change", before, "revision=1", witness(target), target.rev, 0, ["revision adopted"]);
  }),
  lifecycle_operator("transport/rename-capture", "capture semantic rename", "Rename survives complete registry capture.", "Source key exists.", "change", () => {
    const source = registry({ a: 1, b: 2 }); const target = registry({ a: 1, b: 2 }); const before = witness(target);
    source.lib("state").at([]).asObject()!.renameKey("a", "d"); target.restore(source.capture());
    assert.deepEqual(target.lib("state").snap(), { d: 1, b: 2 });
    return result("change", before, "rename a→d", witness(target), target.rev);
  }),
  lifecycle_operator("transport/order-capture", "preserve object order", "Ordered keys survive registry restore.", "JSON source has exact order.", "change", () => {
    const source = registry('{"10":10,"2":2,"1":1}'); const target = registry('{}'); const before = witness(target);
    target.restore(source.capture()); assert.equal(witness(target), witness(source));
    return result("change", before, "10,2,1", witness(target), target.rev);
  }),
  lifecycle_operator("transport/negative-zero-capture", "preserve negative zero", "Negative zero survives registry restore.", "Value is finite.", "change", () => {
    const source = registry({ value: -0 }); const target = registry({ value: 0 }); const before = witness(target);
    target.restore(source.capture()); assert.equal(Object.is(target.lib("state").snap(["value"]), -0), true);
    return result("change", before, "value=-0", witness(target), target.rev);
  }),
  lifecycle_operator("transport/reject-format", "reject unsupported format", "Invalid snapshot format is atomic.", "Format is wrong.", "rejection", () => reject("format=wrong", (capture) => ({ ...capture, format: "wrong" }))),
  lifecycle_operator("transport/reject-digest", "reject registry digest mismatch", "A wrong registry fence is atomic.", "Digest is wrong.", "rejection", () => reject("digest=wrong", (capture) => ({ ...capture, registryDigest: "wrong" }))),
  lifecycle_operator("transport/reject-library-name", "reject library name mismatch", "A wrong library name is atomic.", "Name is absent.", "rejection", () => reject("library=other", (capture) => ({ ...capture, libraries: [{ ...capture.libraries[0], name: "other" }] }))),
  lifecycle_operator("transport/reject-root-payload", "reject malformed root payload", "Malformed exact root is atomic.", "Payload is incomplete.", "rejection", () => reject("payload={", (capture) => ({ ...capture, libraries: [{ ...capture.libraries[0], root: { format: "hson-exact-value", payload: "{" } }] }))),
  lifecycle_operator("propagation/feed-change", "publish a changed path feed", "A selected path feed sees one changed value.", "Selected value changes.", "change", () => feed(INITIAL, "replace ordered value", (map) => map.lib("state").at(["value"]).replace(ORDERED), "change")),
  lifecycle_operator("propagation/feed-noop", "suppress an unchanged feed", "SameValue replacement emits no feed.", "Selected value is unchanged.", "no-op", () => feed(INITIAL, "replace equal value", (map) => map.lib("state").at(["value"]).replace({ a: 1, b: 2 }), "no-op")),
  lifecycle_operator("propagation/feed-rejection", "suppress feeds on rejection", "Rejected admission emits no feed or commit.", "Candidate owns a getter.", "rejection", () => {
    const map = registry(INITIAL); const before = witness(map); let feeds = 0; let commits = 0;
    map.lib("state").at([]).feed(() => { feeds += 1; }); map.commits.observe(() => { commits += 1; });
    const bad = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 });
    assert.throws(() => map.lib("state").at(["value"]).set(bad as JsonValue));
    assert.deepEqual([feeds, commits, map.rev], [0, 0, 0]);
    return result("rejection", before, "getter value", witness(map), 0, 0, ["feeds=0"]);
  }),
  lifecycle_operator("propagation/selected-value", "publish selected value", "Path feed scopes to one library value.", "Selected value changes.", "change", () => feed({ value: 0 }, "value=1", (map) => map.lib("state").at(["value"]).set(1), "change")),
  lifecycle_operator("propagation/negative-zero", "publish negative zero", "Feed snapshots retain the zero sign.", "Selected value starts at +0.", "change", () => {
    const map = registry({ value: 0 }); const before = witness(map); let observed: unknown;
    map.lib("state").at(["value"]).watch((next) => { observed = next; });
    map.lib("state").at(["value"]).set(-0); assert.equal(Object.is(observed, -0), true);
    return result("change", before, "value=-0", witness(map), map.rev, 1, ["watch observed -0"]);
  }),
  lifecycle_operator("propagation/rename", "publish rename intent", "Selected root feed reports semantic rename.", "Source key exists.", "change", () => {
    const map = registry({ a: 1 }); const before = witness(map); let kind: string | undefined;
    map.lib("state").at([]).feed((event) => { kind = event.op.kind; });
    map.lib("state").at([]).asObject()!.renameKey("a", "d"); assert.equal(kind, "rename");
    return result("change", before, "rename a→d", witness(map), map.rev, 1, ["kind=rename"]);
  }),
  lifecycle_operator("propagation/move", "publish move intent", "Selected array feed reports semantic movement.", "Array has two items.", "change", () => {
    const map = registry({ items: [1, 2] }); const before = witness(map); let kind: string | undefined;
    map.lib("state").at(["items"]).feed((event) => { kind = event.op.kind; });
    map.lib("state").at(["items"]).asArray()!.move(0, 1); assert.equal(kind, "move");
    return result("change", before, "move 0→1", witness(map), map.rev, 1, ["kind=move"]);
  }),
  lifecycle_operator("propagation/detached-feed", "detach feed payload", "Listener mutation cannot alter canonical state.", "Feed receives an object value.", "change", () => {
    const map = registry(INITIAL); const before = witness(map);
    map.lib("state").at(["value"]).feed((event) => { (event.value as Record<string, JsonValue>)["10"] = 99; });
    map.lib("state").at(["value"]).replace(ORDERED);
    assert.equal((map.lib("state").snap(["value"]) as Record<string, JsonValue>)["10"], 10);
    return result("change", before, "detached feed", witness(map), map.rev, 1);
  }),
  lifecycle_operator("transport/restore-silence", "restore without mutation commit", "Snapshot installation does not invent a mutation commit.", "Complete snapshot matches registry.", "change", () => {
    const source = changed(); const target = registry(INITIAL); const before = witness(target); let commits = 0;
    target.commits.observe(() => { commits += 1; }); target.restore(source.capture()); assert.equal(commits, 0);
    return result("change", before, "snapshot restore", witness(target), target.rev, commits);
  }),
  lifecycle_operator("transport/capture-restore-closure", "close repeated restore", "Two targets install the same exact snapshot.", "Targets share registry contract.", "accept", () => {
    const source = changed(); const first = registry(INITIAL); const second = registry(INITIAL); const before = witness(first);
    first.restore(source.capture()); second.restore(source.capture()); assert.equal(witness(first), witness(second));
    return result("accept", before, "same capture twice", witness(first), 0, 0, ["targets equal"]);
  }),
]);

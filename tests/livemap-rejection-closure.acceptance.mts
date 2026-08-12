import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { link_livemap } from "../src/api/livemap/livemap.link.ts";
import { make_livemap_store_api } from "../src/api/livemap/livemap.store.ts";
import { make_livehost_canonical_stream } from "../src/api/livehost/livehost.history.ts";
import { ProjectedValueAdmissionError, admit_projected_value, type ProjectedValueAdmissionCode } from "../src/core/projected-value-admission.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { JsonValue } from "../src/core/types.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}

type MutationRoute = "set" | "setMany" | "replace" | "update" | "batch" | "object" | "array";

function own_data(entries: readonly (readonly [PropertyKey, unknown])[]): Record<PropertyKey, unknown> {
  const value = {} as Record<PropertyKey, unknown>;
  for (const [key, child] of entries) {
    Object.defineProperty(value, key, { value: child, enumerable: true, writable: true, configurable: true });
  }
  return value;
}

function route_initial(route: MutationRoute): JsonValue {
  if (route === "object") return {};
  if (route === "array") return [];
  return 1;
}

function mutate(route: MutationRoute, map: ReturnType<typeof hson.liveMap.fromJson>, witness: unknown): void {
  if (route === "set") { map.set(["value"], witness as JsonValue); return; }
  if (route === "setMany") { map.setMany([], own_data([["value", witness]]) as Record<string, JsonValue>); return; }
  if (route === "replace") { map.replace(["value"], witness as JsonValue); return; }
  if (route === "update") { map.at(["value"]).update(() => witness as JsonValue); return; }
  if (route === "batch") { map.batch((tx) => { tx.set(["value"], witness as JsonValue); }); return; }
  if (route === "object") { map.at(["value"]).object.setKey("bad", witness as never); return; }
  map.at(["value"]).array.push(witness as never);
}

function assert_rejection_closure(
  witness: unknown,
  code: ProjectedValueAdmissionCode,
  route: MutationRoute,
): void {
  assert.throws(() => admit_projected_value(witness), (error: unknown) => (
    error instanceof ProjectedValueAdmissionError && error.code === code
  ));
  assert.throws(() => hson.fromJson(witness as JsonValue));
  assert.throws(() => hson.liveMap.fromJson(witness as JsonValue));
  assert.equal(hson.liveMap.schema.define((s) => s.unknown).validateRoot(witness as JsonValue).ok, false);

  const initial = { value: route_initial(route), guard: 1 };
  const source = hson.liveMap.fromJson(initial);
  const target = hson.liveMap.fromJson(initial);
  source.schema.use(hson.liveMap.schema.define((s) => ({ value: s.unknown, guard: s.number })));
  link_livemap(source, target, { path: ["value"] });
  const sourceBefore = source.root();
  const sourceCapture = source.capture();
  const targetCapture = target.capture();
  let commits = 0;
  let feeds = 0;
  let stores = 0;
  let hostCommits = 0;
  source.commits.observe(() => { commits += 1; });
  source.feed([], () => { feeds += 1; });
  make_livemap_store_api(source).subscribe(() => { stores += 1; });
  make_livehost_canonical_stream(source, { logicalMapId: "unit-f", incarnationId: "rejection" })
    .on_commit(() => { hostCommits += 1; });

  assert.throws(() => mutate(route, source, witness));
  assert.equal(canonical_hson_graph_equal(source.root(), sourceBefore), true);
  assert.deepEqual(source.capture(), sourceCapture);
  assert.deepEqual(target.capture(), targetCapture);
  assert.equal(source.rev, 0);
  assert.equal(commits, 0);
  assert.equal(feeds, 0);
  assert.equal(stores, 0);
  assert.equal(hostCommits, 0);
}

const routes: readonly MutationRoute[] = ["set", "setMany", "replace", "update", "batch", "object", "array"];
let routeIndex = 0;
function assert_next_rejection(witness: unknown, code: ProjectedValueAdmissionCode): void {
  const route = routes[routeIndex % routes.length] as MutationRoute;
  routeIndex += 1;
  assert_rejection_closure(witness, code, route);
}

check("undefined rejects across admission schema construction and mutation", () => { assert_next_rejection(undefined, "UNDEFINED_VALUE"); });
check("NaN rejects across admission schema construction and mutation", () => { assert_next_rejection(Number.NaN, "NONFINITE_NUMBER"); });
check("positive and negative infinity reject equivalently", () => {
  assert_rejection_closure(Infinity, "NONFINITE_NUMBER", routes[routeIndex++ % routes.length]!);
  assert_rejection_closure(-Infinity, "NONFINITE_NUMBER", routes[routeIndex++ % routes.length]!);
});
check("bigint rejects without coercion", () => { assert_next_rejection(1n, "UNSUPPORTED_TYPE"); });
check("symbol primitives reject without coercion", () => { assert_next_rejection(Symbol("value"), "UNSUPPORTED_TYPE"); });
check("functions reject without execution", () => { assert_next_rejection(function unsupported() { return 1; }, "UNSUPPORTED_TYPE"); });
check("boxed primitives reject by prototype", () => { assert_next_rejection(new Number(1), "UNSUPPORTED_PROTOTYPE"); });
check("custom prototypes reject", () => { assert_next_rejection(Object.create({ inherited: true }), "UNSUPPORTED_PROTOTYPE"); });
check("class instances reject", () => { assert_next_rejection(new (class Value { field = 1; })(), "UNSUPPORTED_PROTOTYPE"); });
check("Date rejects", () => { assert_next_rejection(new Date(0), "UNSUPPORTED_PROTOTYPE"); });
check("Map rejects", () => { assert_next_rejection(new Map([["a", 1]]), "UNSUPPORTED_PROTOTYPE"); });
check("Set rejects", () => { assert_next_rejection(new Set([1]), "UNSUPPORTED_PROTOTYPE"); });
check("Promise rejects", () => { assert_next_rejection(Promise.resolve(1), "UNSUPPORTED_PROTOTYPE"); });
check("accessor properties reject without getter execution", () => {
  let calls = 0;
  const value = {};
  Object.defineProperty(value, "field", { enumerable: true, get: () => { calls += 1; return 1; } });
  Object.defineProperty(value, "calls", { enumerable: false, get: () => calls });
  assert_next_rejection(value, "ACCESSOR_PROPERTY");
  assert.equal(calls, 0);
});
check("nonenumerable properties reject", () => { assert_next_rejection(Object.defineProperty({}, "hidden", { value: 1, enumerable: false }), "NONENUMERABLE_PROPERTY"); });
check("symbol-keyed properties reject", () => { assert_next_rejection(own_data([[Symbol("hidden"), 1]]), "SYMBOL_KEY"); });
check("sparse arrays reject", () => { const value = new Array(2); value[1] = 1; assert_next_rejection(value, "SPARSE_ARRAY"); });
check("explicit array undefined rejects", () => { assert_next_rejection([1, undefined], "UNDEFINED_VALUE"); });
check("extra named array properties reject", () => { const value = [1]; Object.defineProperty(value, "named", { value: 2, enumerable: true }); assert_next_rejection(value, "EXTRA_ARRAY_PROPERTY"); });
check("array accessors reject", () => { const value = [1]; Object.defineProperty(value, "0", { enumerable: true, get: () => 1 }); assert_next_rejection(value, "ACCESSOR_PROPERTY"); });
check("subclassed arrays reject", () => { assert_next_rejection(new (class Values extends Array<number> {})(1, 2), "UNSUPPORTED_PROTOTYPE"); });
check("cycles reject with recursion-stack evidence", () => { const value: Record<string, unknown> = {}; value.self = value; assert_next_rejection(value, "CYCLE"); });

check("malformed exact envelopes reject atomically without legacy downgrade", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const before = map.capture();
  assert.throws(() => map.restore({ rev: 4, format: "structural-json", value: { value: 9 } } as never));
  assert.deepEqual(map.capture(), before);
  assert.throws(() => map.apply({ prevRev: 0, format: "structural-json", formatVersion: 1, value: { value: 9 } } as never));
  assert.deepEqual(map.capture(), before);
});

check("malformed structural payloads reject restore apply and replay atomically", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const before = map.capture();
  const malformed = { format: "structural-json", formatVersion: 1, payload: "{not-json" } as const;
  assert.throws(() => map.restore({ rev: 2, ...malformed }));
  assert.throws(() => map.apply({ prevRev: 0, ...malformed }));
  assert.throws(() => map.replay({ prevRev: 0, ...malformed }));
  assert.deepEqual(map.capture(), before);
});

assert.equal(checks, 24);
process.stdout.write(`# ${checks} projected-value rejection closure checks passed\n`);
emit_hson_live_test_completion("livemap.rejection-closure", checks, checks, 0);

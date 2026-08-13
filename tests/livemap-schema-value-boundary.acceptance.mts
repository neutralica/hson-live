import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { projected_value_to_hson_root } from "../src/core/projected-value-graph.ts";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import { hson } from "../src/hson.ts";
import type { JsonValue } from "../src/core/types.ts";
import { decode_public_attrs } from "../src/core/public-attrs.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const map = (value: unknown) => make_livemap_core(projected_value_to_hson_root(admit_projected_value(value)));
const own_data = (entries: readonly (readonly [string, unknown])[], prototype: object | null = Object.prototype) => {
  const value = Object.create(prototype) as Record<string, unknown>;
  for (const [key, item] of entries) {
    Object.defineProperty(value, key, { value: item, enumerable: true, writable: true, configurable: true });
  }
  return value;
};

check("direct validation admits plain objects", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.number }));
  assert.equal(schema.validateRoot({ value: 1 }).ok, true);
});

check("direct validation admits null-prototype objects", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.string }));
  assert.equal(schema.validateRoot(own_data([["value", "ok"]], null) as JsonValue).ok, true);
});

check("direct and attached validation accept the same finite value", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.number }));
  const valueMap = map({ value: 1 });
  assert.equal(schema.validateRoot({ value: 2 }).ok, true);
  valueMap.schema.use(schema);
  assert.equal(valueMap.set(["value"], 2).changed, true);
});

check("direct and attached validation reject NaN", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.number }));
  assert.equal(schema.validateRoot({ value: Number.NaN } as JsonValue).ok, false);
  const valueMap = map({ value: 1 });
  valueMap.schema.use(schema);
  assert.throws(() => valueMap.set(["value"], Number.NaN), (error: unknown) => (
    typeof error === "object" && error !== null && (error as { reasonCode?: unknown }).reasonCode === "NONFINITE_NUMBER"
  ));
});

check("direct validation rejects both infinities", () => {
  const schema = hson.liveMap.schema.define((s) => s.number);
  assert.equal(schema.validateRoot(Infinity).ok, false);
  assert.equal(schema.validateRoot(-Infinity).ok, false);
});

check("negative-zero literal accepts only negative zero", () => {
  const schema = hson.liveMap.schema.define((s) => s.literal(-0));
  assert.equal(schema.validateRoot(-0).ok, true);
  assert.equal(schema.validateRoot(0).ok, false);
});

check("positive-zero literal rejects negative zero", () => {
  const schema = hson.liveMap.schema.define((s) => s.literal(0));
  assert.equal(schema.validateRoot(0).ok, true);
  assert.equal(schema.validateRoot(-0).ok, false);
});

check("optional means an object property may be missing", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.number.optional }));
  assert.equal(schema.validateRoot({}).ok, true);
});

check("present undefined is invalid even for an optional property", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.number.optional }));
  const result = schema.validateRoot(own_data([["value", undefined]]) as JsonValue);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.received, "undefined");
});

check("direct optional value validation rejects explicit undefined", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.number.optional }));
  assert.equal(schema.validateValue(["value"], undefined).ok, false);
});

check("sparse arrays reject before schema traversal", () => {
  const schema = hson.liveMap.schema.define((s) => s.array(s.number));
  const sparse = new Array(2);
  sparse[1] = 1;
  assert.equal(schema.validateRoot(sparse as JsonValue).ok, false);
});

check("ordinary accessors reject without executing", () => {
  let calls = 0;
  const value = {};
  Object.defineProperty(value, "field", { enumerable: true, get: () => { calls += 1; return 1; } });
  const schema = hson.liveMap.schema.define((s) => s.unknown);
  assert.equal(schema.validateRoot(value as JsonValue).ok, false);
  assert.equal(calls, 0);
});

check("custom prototypes and exotic values reject", () => {
  const schema = hson.liveMap.schema.define((s) => s.unknown);
  assert.equal(schema.validateRoot(Object.create({ inherited: true }) as JsonValue).ok, false);
  assert.equal(schema.validateRoot(new Date() as unknown as JsonValue).ok, false);
});

check("symbol-keyed properties reject", () => {
  const value = { field: 1 } as Record<PropertyKey, unknown>;
  value[Symbol("extra")] = 2;
  assert.equal(hson.liveMap.schema.define((s) => s.unknown).validateRoot(value as JsonValue).ok, false);
});

check("nonenumerable properties reject", () => {
  const value = { field: 1 };
  Object.defineProperty(value, "hidden", { value: 2, enumerable: false });
  assert.equal(hson.liveMap.schema.define((s) => s.unknown).validateRoot(value as JsonValue).ok, false);
});

check("cycles reject but repeated acyclic references admit", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const schema = hson.liveMap.schema.define((s) => s.unknown);
  assert.equal(schema.validateRoot(cycle as JsonValue).ok, false);
  const shared = { value: 1 };
  assert.equal(schema.validateRoot({ left: shared, right: shared }).ok, true);
});

check("exact dangerous schema keys use own membership", () => {
  const schema = hson.liveMap.schema.define((s) => s.exact(own_data([
    ["__proto__", s.string],
    ["constructor", s.number],
    ["prototype", s.boolean],
  ], null) as never));
  const value = own_data([["__proto__", "data"], ["constructor", 1], ["prototype", true]]);
  assert.equal(schema.validateRoot(value as JsonValue).ok, true);
  const attrs = decode_public_attrs(own_data([["__proto__", "data"], ["constructor", "ctor"]]));
  assert.notEqual(attrs, undefined);
  assert.equal(Object.hasOwn(attrs as object, "__proto__"), true);
  assert.equal(Reflect.getOwnPropertyDescriptor(attrs as object, "__proto__")?.value, "data");
  assert.equal(Object.getPrototypeOf(attrs), Object.prototype);
});

check("inherited constructor cannot satisfy a required own key", () => {
  const schema = hson.liveMap.schema.define((s) => s.exact(
    own_data([["constructor", s.number]], null) as never,
  ));
  const result = schema.validateRoot({});
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.code, "MISSING_REQUIRED");
});

check("exact shape rejects an unknown dangerous own key", () => {
  const schema = hson.liveMap.schema.define((s) => s.exact({ value: s.number }));
  const result = schema.validateRoot(own_data([["value", 1], ["__proto__", 2]]) as JsonValue);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "UNKNOWN_KEY" && issue.path[0] === "__proto__"), true);
});

check("ordered object literals distinguish entry order", () => {
  const schema = hson.liveMap.schema.define((s) => s.literal({ a: 1, b: 2 }));
  assert.equal(schema.validateRoot({ a: 1, b: 2 }).ok, true);
  assert.equal(schema.validateRoot({ b: 2, a: 1 }).ok, false);
});

check("dangerous literal keys remain ordinary data", () => {
  const literal = own_data([["__proto__", "data"], ["constructor", -0]]);
  const schema = hson.liveMap.schema.define((s) => s.literal(literal as JsonValue));
  assert.equal(schema.validateRoot(own_data([["__proto__", "data"], ["constructor", -0]]) as JsonValue).ok, true);
  assert.equal(schema.validateRoot(own_data([["__proto__", "data"], ["constructor", 0]]) as JsonValue).ok, false);
});

check("schema literals detach from later caller mutation", () => {
  const literal = { nested: { value: 1 } };
  const schema = hson.liveMap.schema.define((s) => s.literal(literal));
  literal.nested.value = 9;
  assert.equal(schema.validateRoot({ nested: { value: 1 } }).ok, true);
  assert.equal(schema.validateRoot({ nested: { value: 9 } }).ok, false);
});

check("nested constraints receive independent detached values", () => {
  let outerValue: unknown;
  const schema = hson.liveMap.schema.define((s) => s.constrain(
    s.constrain(s.unknown, "inner", (value) => {
      (value as Record<string, JsonValue>).field = 99;
      return true;
    }),
    "outer",
    (value) => {
      outerValue = (value as Record<string, JsonValue>).field;
      return true;
    },
  ));
  assert.equal(schema.validateRoot({ field: 1 }).ok, true);
  assert.equal(outerValue, 1);
});

check("attached constraint mutation cannot affect the candidate", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({
    value: s.constrain(s.unknown, "detached", (input) => {
      (input as Record<string, JsonValue>).field = 99;
      return true;
    }),
  }));
  const valueMap = map({ value: { field: 1 } });
  valueMap.schema.use(schema);
  valueMap.replace(["value"], { field: 2 });
  assert.equal(valueMap.snap(["value", "field"]), 2);
});

check("schema rejection is atomic across state revision and publication", () => {
  const schema = hson.liveMap.schema.define((s) => s.object({ value: s.number }));
  const valueMap = map({ value: 1 });
  valueMap.schema.use(schema);
  let feeds = 0;
  let commits = 0;
  valueMap.feed([], () => { feeds += 1; });
  valueMap.commits.observe(() => { commits += 1; });
  const before = valueMap.capture();
  assert.throws(() => valueMap.set(["value"], "wrong"));
  assert.equal(valueMap.capture().payload, before.payload);
  assert.equal(valueMap.rev, before.rev);
  assert.equal(feeds, 0);
  assert.equal(commits, 0);
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} LiveMap schema value-boundary checks passed\n`);
emit_hson_live_test_completion("livemap.schema-value-boundary", checks, checks, 0);

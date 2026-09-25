import assert from "node:assert/strict";
import type { JsonValue } from "../../src/core/types.ts";
import {
  admission_operator,
  atomic_rejection_operator,
  observe_map,
  operator,
  own_record,
  schema_number_map,
  type DeterministicLiveMapOperator,
} from "./operator-catalog.mts";

export const admission_schema_operators: readonly DeterministicLiveMapOperator[] = Object.freeze([
  admission_operator("admission/plain-object", "admit a plain object", "Enumerable own data properties are snapshotted once.", "Prototype is exactly Object.prototype.", "accept", 'entries=[["value",-0]]', () => ({ value: -0 }), (map) => assert.equal(Object.is(map.snap(["value", "value"]), -0), true)),
  admission_operator("admission/null-prototype-object", "admit a null-prototype object", "Prototype-safe own keys remain ordinary data.", "Prototype is null and all own properties are enumerable data descriptors.", "accept", 'prototype=null entries=[["__proto__","data"]]', () => own_record([["__proto__", "data"]], null), (map) => { const value = map.snap(["value"]) as Record<string, JsonValue>; assert.equal(value.__proto__, "data"); assert.equal(Object.getPrototypeOf(value), Object.prototype); }),
  admission_operator("admission/dense-array", "admit a dense ordinary array", "Every index is copied in order.", "Prototype is Array.prototype and indexes 0..length-1 are own data properties.", "accept", 'array=[1,-0,{"nested":true}]', () => [1, -0, { nested: true }], (map) => assert.equal(Object.is((map.snap(["value"]) as JsonValue[])[1], -0), true)),
  admission_operator("admission/repeated-reference", "copy a repeated acyclic reference", "Each occurrence is copied structurally without preserving DAG identity.", "Repeated object is not on the active recursion stack.", "accept", 'root.left===root.right; child={"value":1}', () => { const child = { value: 1 }; return { left: child, right: child }; }, (map) => { const value = map.snap(["value"]) as Record<string, JsonValue>; assert.notEqual(value.left, value.right); assert.deepEqual(value.left, value.right); }),
  atomic_rejection_operator("admission/reject-accessor", "reject an accessor property", "Descriptor inspection rejects accessors without invoking ordinary getters.", "Candidate owns enumerable getter value.", 'descriptor value={enumerable:true,get(){calls++}}', (map) => { let calls = 0; const value = Object.defineProperty({}, "value", { enumerable: true, get: () => { calls += 1; return 2; } }); try { map.at(["value"]).set(value as JsonValue); } finally { assert.equal(calls, 0); } }),
  atomic_rejection_operator("admission/reject-symbol-key", "reject a symbol-keyed property", "Projected objects contain string keys only.", "Candidate owns enumerable Symbol(key).", 'ownKeys=["Symbol(key)"]', (map) => map.at(["value"]).set(Object.defineProperty({}, Symbol("key"), { value: 1, enumerable: true }) as JsonValue)),
  atomic_rejection_operator("admission/reject-nonenumerable", "reject a nonenumerable property", "Admission does not silently omit own string properties.", "Candidate owns nonenumerable hidden.", 'descriptor hidden={value:1,enumerable:false}', (map) => map.at(["value"]).set(Object.defineProperty({}, "hidden", { value: 1, enumerable: false }) as JsonValue)),
  atomic_rejection_operator("admission/reject-custom-prototype", "reject a custom prototype", "Only Object.prototype and null are admitted object prototypes.", "Candidate prototype owns inherited=true.", 'prototype={"inherited":true}', (map) => map.at(["value"]).set(Object.create({ inherited: true }) as JsonValue)),
  atomic_rejection_operator("admission/reject-boxed-primitive", "reject a boxed primitive", "Boxed primitives are arbitrary objects, not primitive data values.", "Candidate is new Number(1).", 'new Number(1)', (map) => map.at(["value"]).set(new Number(1) as unknown as JsonValue)),
  atomic_rejection_operator("admission/reject-date", "reject a Date", "Exotic built-ins are outside the projected-value domain.", "Candidate is Date at epoch 0.", 'new Date(0)', (map) => map.at(["value"]).set(new Date(0) as unknown as JsonValue)),
  atomic_rejection_operator("admission/reject-function", "reject a function", "Functions are outside the primitive domain.", "Candidate is callable.", 'function(){return 1}', (map) => map.at(["value"]).set((() => 1) as unknown as JsonValue)),
  atomic_rejection_operator("admission/reject-bigint", "reject a bigint", "Bigints are outside the primitive domain.", "Candidate is 1n.", '1n', (map) => map.at(["value"]).set(1n as unknown as JsonValue)),
  atomic_rejection_operator("admission/reject-nan", "reject NaN", "Only finite primitive numbers admit.", "Candidate is NaN.", 'NaN', (map) => map.at(["value"]).set(Number.NaN)),
  atomic_rejection_operator("admission/reject-infinity", "reject Infinity", "Only finite primitive numbers admit.", "Candidate is positive Infinity.", 'Infinity', (map) => map.at(["value"]).set(Infinity)),
  atomic_rejection_operator("admission/reject-sparse-array", "reject a sparse array", "Canonical arrays are dense.", "Length is 2 and own index 0 is absent.", 'length=2 ownIndexes=[1] values=[<hole>,1]', (map) => { const value = new Array(2); value[1] = 1; map.at(["value"]).set(value as JsonValue); }),
  atomic_rejection_operator("admission/reject-undefined-item", "reject explicit undefined array data", "Present undefined is not a data value.", "Own index 0 stores undefined.", 'length=1 values=[undefined]', (map) => map.at(["value"]).set([undefined] as unknown as JsonValue)),
  atomic_rejection_operator("admission/reject-extra-array-key", "reject an extra array property", "Arrays contain only dense indexes and length.", "Dense candidate additionally owns enumerable extra=2.", 'array=[1] own extra=2', (map) => { const value = [1] as number[] & { extra?: number }; value.extra = 2; map.at(["value"]).set(value as unknown as JsonValue); }),
  atomic_rejection_operator("admission/reject-cycle", "reject a cycle", "An object already on the active recursion stack rejects deterministically.", "Candidate self property points to candidate.", 'root={}; root.self=root', (map) => { const value: Record<string, unknown> = {}; value.self = value; map.at(["value"]).set(value as JsonValue); }),
  operator("schema/valid-number-change", "admission-schema", "apply a schema-valid mutation", "Attached schema constrains the admitted carrier and permits a finite number.", "Map has exact value:number rule and candidate is 2.", "change", () => {
    const map = schema_number_map();
    return observe_map(map, "path=[\"value\"] value=2", () => {
      const commit = map.at(["value"]).set(2);
      return { classification: commit.changed ? "change" as const : "no-op" as const, evidence: [`ops=${commit.operations.length}`] };
    });
  }),
  operator("schema/invalid-string-rejection", "admission-schema", "reject a schema-invalid mutation", "Schema rejection is atomic after shared admission.", "Map has exact value:number rule and candidate is string wrong.", "rejection", () => {
    const map = schema_number_map();
    return observe_map(map, 'path=["value"] value="wrong"', () => {
      try { map.at(["value"]).set("wrong"); } catch (error) { return { classification: "rejection" as const, evidence: [String((error as { name?: unknown }).name ?? "Error")] }; }
      throw new Error("expected schema rejection");
    });
  }),
]);

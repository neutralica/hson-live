import assert from "node:assert/strict";
import { Hson, HsonData, hson } from "../src/index.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

check("ordinary scalar and container admission is exact and immutable", () => {
  for (const value of ["x", true, null, 2.5, 0, -0] as const) {
    const data = HsonData.from(value);
    assert.equal(Object.is(data.scalar(), value), true);
    assert.equal(Object.isFrozen(data), true);
    assert.equal(HsonData.from(data), data);
  }
  const mixed = HsonData.from([[], {}, [1, { nested: null }]]);
  assert.equal(mixed.kind, "array");
  assert.equal(mixed.items()?.length, 3);
  assert.equal(Object.isFrozen(mixed.items()), true);
  assert.throws(() => Reflect.construct(HsonData, ["forged"]), /construction is controlled/);
  assert.throws(() => HsonData.from(Object.create(HsonData.prototype)));
});

check("strict ordinary admission rejects unsupported runtime behavior", () => {
  const sparse = Array(1);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let getterRuns = 0;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() { getterRuns += 1; return 1; },
  });
  class Instance { value = 1; }
  for (const invalid of [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol("x"), sparse, cyclic, accessor, new Instance(), new Date()]) {
    assert.throws(() => HsonData.from(invalid));
  }
  assert.equal(getterRuns, 0);
  assert.throws(() => HsonData.from(Object.assign({}, { [Symbol("semantic")]: 1 })));
});

check("ordinary own names are safe and detached", () => {
  const input = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(input, "__proto__", { value: { nested: true }, enumerable: true, writable: true });
  Object.defineProperty(input, "constructor", { value: 1, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(input, "prototype", { value: 2, enumerable: true, writable: true });
  const data = HsonData.from(input);
  Object.defineProperty(input, "constructor", { value: 9, enumerable: true, writable: true });
  assert.deepEqual(data.entries()?.map(([name]) => name), ["__proto__", "constructor", "prototype"]);
  const first = data.materialize() as Record<string, unknown>;
  const second = data.materialize() as Record<string, unknown>;
  assert.notEqual(first, second);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.hasOwn(first, "__proto__"), true);
  assert.deepEqual(first.__proto__, { nested: true });
  assert.equal(first.constructor, 1);
});

check("Hson authoring preserves signed zero, exact order, integer names, and dangerous names", () => {
  const canonical = Hson`<'10' 10 '2' 2 '1' 1 __proto__ <nested -0> constructor true prototype null>`;
  const data = HsonData.fromHson(canonical);
  assert.deepEqual(data.entries()?.map(([name]) => name), ["10", "2", "1", "__proto__", "constructor", "prototype"]);
  const proto = data.entries()?.[3]?.[1];
  assert.equal(Object.is(proto?.entries()?.[0]?.[1].scalar(), -0), true);
  const roundTrip = HsonData.fromHson(data.toHson());
  assert.equal(roundTrip.equals(data), true);
  const materialized = data.materialize();
  assert.deepEqual(Object.keys(materialized as object).slice(0, 3), ["1", "2", "10"]);
  assert.deepEqual(data.entries()?.slice(0, 3).map(([name]) => name), ["10", "2", "1"]);
  const forward = HsonData.fromHson(Hson`<a 1 b 2>`);
  const reversed = HsonData.fromHson(Hson`<b 2 a 1>`);
  assert.equal(forward.equals(reversed), false);
  const integerReversed = HsonData.fromHson(Hson`<'1' 1 '2' 2 '10' 10>`);
  assert.equal(data.equals(integerReversed), false);
  const mixed = HsonData.fromHson(Hson`<'10' 1 normal 2 '1' 3 '' true>`);
  assert.deepEqual(mixed.entries()?.map(([name]) => name), ["10", "normal", "1", ""]);
});

check("document Hson rejects the data-only boundary", () => {
  assert.throws(() => HsonData.fromHson(Hson`<main "text"/>`), /data-mode Hson/);
});

check("LiveMap exact data reads preserve Hson-authored identity", () => {
  const authored = Hson`<value <'10' -0 '2' <__proto__ true> tail [1,<constructor 2 prototype 3>]>>`;
  const map = hson.liveMap.fromHson(authored);
  if (map.mode === "document") throw new Error("Expected data LiveMap.");
  const exact = map.data();
  const nested = map.at(["value"]).data();
  assert.ok(exact instanceof HsonData);
  assert.ok(nested instanceof HsonData);
  assert.deepEqual(nested.entries()?.map(([name]) => name), ["10", "2", "tail"]);
  assert.equal(Object.is(nested.entries()?.[0]?.[1].scalar(), -0), true);
  assert.equal(Object.hasOwn(nested.entries()?.[1]?.[1].materialize() as object, "__proto__"), true);
});

process.stdout.write(`1..${checks}\n`);

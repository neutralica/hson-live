import assert from "node:assert/strict";
import * as publicApi from "../src/index.ts";
import { Hson, hson, type HsonData } from "../src/index.ts";
import { serialize_hson_owned_document_content } from "../src/api/transform/serializers/serialize-hson.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function entries(value: HsonData): readonly (readonly [string, HsonData])[] {
  return Hson.data.entries(value) ?? [];
}

check("ordinary scalar and container admission is exact", () => {
  for (const value of ["x", true, null, 2.5, 0, -0] as const) {
    const data = Hson.data.from(value);
    assert.equal(typeof data, "string");
    assert.equal(Object.is(Hson.data.materialize(data), value), true);
    assert.equal(Hson.data.fromHson(data), data);
  }
  const mixed = Hson.data.from([[], {}, [1, { nested: null }]]);
  assert.equal((Hson.data.materialize(mixed) as unknown[]).length, 3);
  assert.equal(Object.hasOwn(publicApi, "HsonData"), false);
  assert.throws(() => Hson.data.from(Object.create(null, { x: { get() { return 1; }, enumerable: true } })));
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
    assert.throws(() => Hson.data.from(invalid));
  }
  assert.equal(getterRuns, 0);
  assert.throws(() => Hson.data.from(Object.assign({}, { [Symbol("semantic")]: 1 })));
});

check("canonical data names reject only the reserved Hson namespace", () => {
  for (const key of ["_hson_root", "_hson_obj", "_hson_arr", "_hson_application"]) {
    assert.throws(() => Hson.data.from({ [key]: 1 }), /Reserved Hson prefix/);
  }
  assert.throws(() => Hson.data.from({ nested: { _hson_root: 1 } }), /Reserved Hson prefix/);
  const valid = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of [
    ["ordinary", 1], ["", 2], ["10", 3], ["__proto__", 4],
    ["constructor", 5], ["prototype", 6], ["_application", 7],
  ] as const) Object.defineProperty(valid, key, { value, enumerable: true, writable: true, configurable: true });
  assert.deepEqual(entries(Hson.data.from(valid)).map(([name]) => name), ["10", "ordinary", "", "__proto__", "constructor", "prototype", "_application"]);
});

check("ordinary own names are safe and detached", () => {
  const input = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(input, "__proto__", { value: { nested: true }, enumerable: true, writable: true });
  Object.defineProperty(input, "constructor", { value: 1, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(input, "prototype", { value: 2, enumerable: true, writable: true });
  const data = Hson.data.from(input);
  Object.defineProperty(input, "constructor", { value: 9, enumerable: true, writable: true });
  assert.deepEqual(entries(data).map(([name]) => name), ["__proto__", "constructor", "prototype"]);
  const first = Hson.data.materialize(data) as Record<string, unknown>;
  const second = Hson.data.materialize(data) as Record<string, unknown>;
  assert.notEqual(first, second);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.hasOwn(first, "__proto__"), true);
  assert.deepEqual(first.__proto__, { nested: true });
  assert.equal(first.constructor, 1);
});

check("Hson authoring preserves signed zero, exact order, integer names, and dangerous names", () => {
  const canonical = Hson.canonical`<'10' 10 '2' 2 '1' 1 __proto__ <nested -0> constructor true prototype null>`;
  const data = Hson.data.fromHson(canonical);
  assert.deepEqual(entries(data).map(([name]) => name), ["10", "2", "1", "__proto__", "constructor", "prototype"]);
  assert.equal(Object.is(Hson.data.materialize(entries(entries(data)[3]![1])[0]![1]), -0), true);
  assert.equal(Hson.data.fromHson(data), data);
  const materialized = Hson.data.materialize(data);
  assert.deepEqual(Object.keys(materialized as object).slice(0, 3), ["1", "2", "10"]);
  assert.deepEqual(entries(data).slice(0, 3).map(([name]) => name), ["10", "2", "1"]);
  assert.notEqual(Hson.data`<a 1 b 2>`, Hson.data`<b 2 a 1>`);
  assert.notEqual(data, Hson.data`<'1' 1 '2' 2 '10' 10>`);
  assert.deepEqual(entries(Hson.data`<'10' 1 normal 2 '1' 3 '' true>`).map(([name]) => name), ["10", "normal", "1", ""]);
});

check("every representative admitted value closes through canonical Hson", () => {
  const representatives = [
    Hson.data.from("text"), Hson.data.from(true), Hson.data.from(null),
    Hson.data.from(0), Hson.data.from(-0), Hson.data.from([]), Hson.data.from([[], [1, null]]),
    Hson.data.from({ ordinary: 1, nested: { constructor: true, prototype: null } }),
    Hson.data`<'10' -0 '2' <__proto__ <constructor 1 prototype 2>> '' []>`,
  ];
  for (const value of representatives) assert.equal(Hson.data.fromHson(value), value);
});

check("forged noncanonical data brands reject at dynamic boundaries", () => {
  const forged = "<a  1>" as HsonData;
  assert.throws(() => Hson.data.fromHson(forged), /canonical/);
});

check("document Hson rejects the data-only boundary", () => {
  const emptyDocumentHson = serialize_hson_owned_document_content({ $_tag: "_hson_root", $_content: [] });
  assert.throws(() => Hson.data.fromHson(emptyDocumentHson), /data-mode Hson/);
  assert.throws(() => Hson.data.fromHson(Hson.canonical`<main "text"/>`), /data-mode Hson/);
  assert.throws(() => Hson.data.fromHson("<@not-data a 1>" as Parameters<typeof Hson.data.fromHson>[0]), /data-mode Hson/);
  assert.throws(() => Hson.data.fromHson("<a 1b 2>" as Parameters<typeof Hson.data.fromHson>[0]), /data-mode Hson/);
});

check("named data library exact reads preserve source order and values", () => {
  const map = hson.liveMap.fromLibraries({ state: {
    data: '{"value":{"10":-0,"2":{"__proto__":true},"tail":[1,{"constructor":2,"prototype":3}]}}',
    schema: Hson.schema`<type "data" content <value "any">>`,
  } });
  const exact = map.lib("state").at([]).data();
  const nested = map.lib("state").at(["value"]).data()!;
  assert.equal(typeof exact, "string");
  assert.equal(typeof nested, "string");
  assert.deepEqual(entries(nested).map(([name]) => name), ["10", "2", "tail"]);
  assert.equal(Object.is(Hson.data.materialize(entries(nested)[0]![1]), -0), true);
  assert.equal(Object.hasOwn(Hson.data.materialize(entries(nested)[1]![1]) as object, "__proto__"), true);
});

check("named data library rejects reserved names before state, revision, or publication", () => {
  const schema = Hson.schema`<type "data" content <nested "any">>`;
  assert.throws(() => hson.liveMap.fromLibraries({ state: { data: { _hson_root: 1 }, schema } }));
  const map = hson.liveMap.fromLibraries({ state: { data: { nested: { value: 1 } }, schema } });
  const state = map.lib("state");
  let publications = 0;
  const stop = map.commits.observe(() => { publications += 1; });
  const before = state.snap();
  assert.throws(() => state.at([]).asObject()!.setMany({ _hson_root: 1 }), /Reserved Hson prefix/);
  assert.throws(() => state.at(["nested"]).replace({ _hson_obj: 1 }), /Reserved Hson prefix/);
  assert.throws(() => state.at(["nested"]).asObject()!.setMany({ _hson_arr: 1 }), /Reserved Hson prefix/);
  const aggregate = internal_livemap_aggregate_authority(map);
  const library = aggregate.libraries()[0];
  if (library === undefined) throw new Error("Expected state library.");
  assert.throws(() => aggregate.commit([
    { target: aggregate.target(library, ["nested"]), kind: "set-key", key: "safe", value: 2 },
    { target: aggregate.target(library, ["nested"]), kind: "set-key", key: "_hson_batch", value: 3 },
  ]), /Reserved Hson prefix/);
  assert.equal(map.rev, 0);
  assert.deepEqual(state.snap(), before);
  assert.equal(publications, 0);
  assert.equal(state.at([]).data(), Hson.data`<nested <value 1>>`);
  stop();
});

process.stdout.write(`1..${checks}\n`);

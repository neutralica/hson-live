import assert from "node:assert/strict";
import * as publicApi from "../src/index.ts";
import { Hson, hson, type HsonDataValue } from "../src/index.ts";
import { HSON_MAX_NESTING } from "../src/core/constants.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function entries(value: HsonDataValue): readonly (readonly [string, HsonDataValue])[] {
  return (value).entries() ?? [];
}

check("ordinary scalar and container admission is exact", () => {
  for (const value of ["x", true, null, 2.5, 0, -0] as const) {
    const data = Hson.data.from(value);
    assert.equal(typeof data, "object");
    assert.equal(Object.is((data).materialize(), value), true);
    assert.equal((Hson.data.from(data)).toHson(), (data).toHson());
  }
  const mixed = Hson.data.from([[], {}, [1, { nested: null }]]);
  assert.equal(((mixed).materialize() as unknown[]).length, 3);
  assert.equal(Object.hasOwn(publicApi, "HsonDataValue"), true);
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
    assert.throws(() => Reflect.apply(Hson.data.from, Hson.data, [invalid]));
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
  assert.deepEqual(entries(Reflect.apply(Hson.data.from, Hson.data, [valid])).map(([name]) => name), ["10", "ordinary", "", "__proto__", "constructor", "prototype", "_application"]);
});

check("ordinary own names are safe and detached", () => {
  const input = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(input, "__proto__", { value: { nested: true }, enumerable: true, writable: true });
  Object.defineProperty(input, "constructor", { value: 1, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(input, "prototype", { value: 2, enumerable: true, writable: true });
  const data = Reflect.apply(Hson.data.from, Hson.data, [input]);
  assert.ok(data instanceof publicApi.HsonDataValue);
  Object.defineProperty(input, "constructor", { value: 9, enumerable: true, writable: true });
  assert.deepEqual(entries(data).map(([name]) => name), ["__proto__", "constructor", "prototype"]);
  const first = data.materialize() as Record<string, unknown>;
  const second = data.materialize() as Record<string, unknown>;
  assert.notEqual(first, second);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.hasOwn(first, "__proto__"), true);
  assert.deepEqual(first.__proto__, { nested: true });
  assert.equal(first.constructor, 1);
});

check("Hson authoring preserves signed zero, exact order, integer names, and dangerous names", () => {
  const canonical = Hson.canonical`<'10' 10 '2' 2 '1' 1 __proto__ <nested -0> constructor true prototype null>`;
  const data = Hson.data.fromSource(canonical);
  assert.deepEqual(entries(data).map(([name]) => name), ["10", "2", "1", "__proto__", "constructor", "prototype"]);
  assert.equal(Object.is((entries(entries(data)[3]![1])[0]![1]).materialize(), -0), true);
  assert.equal((Hson.data.from(data)).toHson(), (data).toHson());
  const materialized = (data).materialize();
  assert.deepEqual(Object.keys(materialized as object).slice(0, 3), ["1", "2", "10"]);
  assert.deepEqual(entries(data).slice(0, 3).map(([name]) => name), ["10", "2", "1"]);
  assert.notEqual((Hson.data.parse`<a 1 b 2>`).toHson(), (Hson.data.parse`<b 2 a 1>`).toHson());
  assert.notEqual((data).toHson(), (Hson.data.parse`<'1' 1 '2' 2 '10' 10>`).toHson());
  assert.deepEqual(entries(Hson.data.parse`<'10' 1 normal 2 '1' 3 '' true>`).map(([name]) => name), ["10", "normal", "1", ""]);
});

check("every representative admitted value closes through canonical Hson", () => {
  const representatives = [
    Hson.data.from("text"), Hson.data.from(true), Hson.data.from(null),
    Hson.data.from(0), Hson.data.from(-0), Hson.data.from([]), Hson.data.from([[], [1, null]]),
    Hson.data.from({ ordinary: 1, nested: { constructor: true, prototype: null } }),
    Hson.data.parse`<'10' -0 '2' <__proto__ <constructor 1 prototype 2>> '' []>`,
  ];
  for (const value of representatives) {
    assert.strictEqual(Hson.data.from(value), value);
    assert.ok(Hson.data.fromSource(value.toHson()).equals(value));
  }
});

check("equivalent data presentation normalizes at dynamic boundaries", () => {
  const forged = "<a  1>";
  assert.equal((Hson.data.fromSource(forged)).toHson(), (Hson.data.parse`<a 1>`).toHson());
});

check("data producers and shared parsing close at the same nesting boundary", () => {
  const nested = (depth: number, kind: "object" | "array" | "mixed"): unknown => {
    let value: unknown = -0;
    for (let index = 0; index < depth; index++) {
      value = kind === "array" || kind === "mixed" && index % 2 === 0 ? [value] : { level: value };
    }
    return value;
  };
  for (const kind of ["object", "array", "mixed"] as const) {
    for (const depth of [74, 75, 76, HSON_MAX_NESTING - 2, HSON_MAX_NESTING - 1]) {
      const value = nested(depth, kind);
      const source = Reflect.apply(Hson.data.from, Hson.data, [value]);
      assert.ok(source instanceof publicApi.HsonDataValue);
      assert.ok(Hson.data.fromSource(source.toHson()).equals(source));
      assert.equal((Hson.data.from(source)).toHson(), (source).toHson());
      assert.deepEqual((source).materialize(), value);
    }
    assert.throws(() => Reflect.apply(Hson.data.from, Hson.data, [nested(HSON_MAX_NESTING, kind)]), /nesting depth/);
  }
  const tooDeep = "<level ".repeat(HSON_MAX_NESTING) + "-0" + ">".repeat(HSON_MAX_NESTING);
  assert.throws(() => Hson.data.fromSource(tooDeep ), (error) =>
    error instanceof TypeError && error.cause instanceof Error && /nesting depth/.test(error.cause.message));
});

check("document Hson rejects the data-only boundary", () => {
  const emptySource = "" as Parameters<typeof Hson.data.fromSource>[0];
  assert.throws(() => Hson.data.fromSource(emptySource), /Data|data-mode Hson/);
  assert.throws(() => Hson.data.fromSource(Hson.canonical`<main "text"/>`), /Data|data-mode Hson/);
  assert.throws(() => Hson.data.fromSource("<@not-data a 1>" as Parameters<typeof Hson.data.fromSource>[0]), /Data|data-mode Hson/);
  assert.throws(() => Hson.data.fromSource("<a 1b 2>" as Parameters<typeof Hson.data.fromSource>[0]), /Data|data-mode Hson/);
});

check("data-only receiver retains grammar and rejects document attributes before decoding", () => {
  const text = (source: string) => source as Parameters<typeof Hson.data.fromSource>[0];
  const valid = [
    ['""', ""], ['-0', -0], ['false', false], ['null', null],
    ['<>', {}], ['[]', []], ['<empty "" zero -0 absent null>', { empty: "", zero: -0, absent: null }],
    ['<z [1, <inner true>, []] a <> >', { z: [1, { inner: true }, []], a: {} }],
    ['<style "width:min(var(--missing,2s),10px)">', { style: 'width:min(var(--missing,2s),10px)' }],
  ] as const;
  for (const [source, expected] of valid) {
    const data = Hson.data.fromSource(text(source));
    assert.equal((Hson.data.from(data)).toHson(), (data).toHson());
    assert.deepEqual((data).materialize(), expected);
  }
  const ordered = Hson.data.fromSource(text('<tail [] first "" zero -0>'));
  assert.deepEqual(entries(ordered).map(([key]) => key), ["tail", "first", "zero"]);
  assert.equal(Object.is((entries(ordered)[2]![1]).materialize(), -0), true);
  const invalid = [
    '<p style="color:red"/>', '<p style="broken"/>', '<p style/>', '<p title="text"/>',
    '<p/>', '<p "text"/>', '<_hson_elem/>', '<_hson_obj style="broken"/>',
    '<p @000000001/>', '<_hson_root @000000001/>',
    '<a 1 a 2>', '<a 1b 2>', '<a>', '<a 1', '[] []',
    'undefined', 'NaN', 'Infinity', '1e999', '"unterminated', '',
  ];
  for (const source of invalid) assert.throws(() => Hson.data.fromSource(text(source)), (error) =>
    error instanceof Error, source);
  for (const source of ['<p style="broken"/>', '<p title="x"/>']) {
    assert.throws(() => Hson.data.fromSource(text(source)), (error) =>
      error instanceof TypeError && error.cause instanceof TypeError && /attributes/.test(error.cause.message));
  }
});

check("named data library exact reads preserve source order and values", () => {
  const map = hson.liveMap.fromLibraries({ state: {
    json: Hson.data.fromSource('{"value":{"10":-0,"2":{"__proto__":true},"tail":[1,{"constructor":2,"prototype":3}]}}'),
    schema: Hson.schema`<type "data" content <value "any">>`,
  } });
  const exact = map.data.must("state").at([]).hson();
  const nested = Hson.data.fromSource(map.data.must("state").at(["value"]).hson()!);
  assert.equal(typeof exact, "string");
  assert.equal(typeof nested, "object");
  assert.deepEqual(entries(nested).map(([name]) => name), ["10", "2", "tail"]);
  assert.equal(Object.is((entries(nested)[0]![1]).materialize(), -0), true);
  assert.equal(Object.hasOwn((entries(nested)[1]![1]).materialize() as object, "__proto__"), true);
});

check("named data library rejects reserved names before state, revision, or publication", () => {
  const schema = Hson.schema`<type "data" content <nested "any">>`;
  assert.throws(() => hson.liveMap.fromLibraries({ state: { json: { _hson_root: 1 }, schema } }));
  const map = hson.liveMap.fromLibraries({ state: { json: { nested: { value: 1 } }, schema } });
  const state = map.data.must("state");
  let publications = 0;
  const stop = map.commits.observe(() => { publications += 1; });
  const before = state.snap();
  assert.throws(() => state.at([]).asObject()!.object.setMany({ _hson_root: 1 }), /Reserved Hson prefix/);
  assert.throws(() => state.at(["nested"]).replace({ _hson_obj: 1 }), /Reserved Hson prefix/);
  assert.throws(() => state.at(["nested"]).asObject()!.object.setMany({ _hson_arr: 1 }), /Reserved Hson prefix/);
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
  assert.equal(state.at([]).hson(), (Hson.data.parse`<nested <value 1>>`).toHson());
  stop();
});

process.stdout.write(`1..${checks}\n`);

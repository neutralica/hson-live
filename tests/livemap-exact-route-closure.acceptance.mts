// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_public_attrs_equal, decode_public_attrs } from "../src/core/public-attrs.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import type { JsonValue } from "../src/core/types.ts";
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
const dataLibrary = (map: ReturnType<typeof registry>): LiveMapDataLibrary<unknown> => map.lib("state");
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
  assert.deepEqual(source.lib("state").at([]).asObject()!.keys(), ["10", "2", "1"]);
});
check("dangerous names retain ordinary data semantics", () => {
  const source = registry('{"__proto__":"data","constructor":-0,"prototype":true}');
  const target = registry('{}'); target.restore(source.capture());
  same(source, target);
  const value = target.lib("state").snap() as Record<string, unknown>;
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(Object.is(value.constructor, -0), true);
});
check("nested arrays, unusual strings, and negative zero remain exact", () => {
  const source = registry({ nested: { items: [1, -0, { value: "\ud800x\udfff" }] } });
  const target = registry('{}'); target.restore(source.capture());
  same(source, target);
  const value = target.lib("state").snap() as { nested: { items: [number, number, { value: string }] } };
  assert.equal(Object.is(value.nested.items[1], -0), true);
  assert.equal(value.nested.items[2].value, "\ud800x\udfff");
});
check("repeated source references are detached structural occurrences", () => {
  const child = { value: 1 };
  const source = registry({ left: child, right: child });
  const target = registry('{}'); target.restore(source.capture());
  child.value = 9;
  same(source, target);
  assert.deepEqual(target.lib("state").snap(), { left: { value: 1 }, right: { value: 1 } });
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
  map.lib("state").at(["value"]).feed((event) => {
    observed = event.value;
    (event.value as Record<string, unknown>).tail = 99;
  });
  map.lib("state").at(["value"]).replace({ "10": 10, "2": 2, "1": 1, tail: -0 });
  assert.deepEqual(Object.keys(observed as object), ["1", "2", "10", "tail"]);
  assert.equal((map.lib("state").snap() as { value: { tail: number } }).value.tail, -0);
});
check("detached root mutation cannot bypass commits", () => {
  const map = registry({ a: { value: 1 } });
  let commits = 0;
  map.commits.observe(() => { commits += 1; });
  const detached = root(map); detached.$_content.length = 0;
  assert.deepEqual(map.lib("state").snap(), { a: { value: 1 } });
  assert.equal(map.rev, 0); assert.equal(commits, 0);
});
check("plain object materialization can lose integer-key order", () => {
  const source = registry('{"10":10,"2":2,"1":1}');
  const target = registry(source.lib("state").snap() as Record<string, unknown>);
  assert.deepEqual(source.lib("state").at([]).asObject()!.keys(), ["10", "2", "1"]);
  assert.deepEqual(target.lib("state").at([]).asObject()!.keys(), ["1", "2", "10"]);
  assert.equal(canonical_hson_graph_equal(root(source), root(target)), false);
});
check("document attribute equality is unordered by name", () => {
  const left = decode_public_attrs({ a: 1, b: "two" });
  const right = decode_public_attrs({ b: "two", a: 1 });
  if (left === undefined || right === undefined) throw new Error("Expected attrs.");
  assert.equal(canonical_public_attrs_equal(left, right), true);
});

process.stdout.write(`# ${checks} exact registry closure checks passed\n`);
testEvents.terminal("pass");

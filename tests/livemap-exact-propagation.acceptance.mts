// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { encode_exact_hson_value } from "../src/api/livemap/livemap.document.view-state-codec.ts";
import type { JsonValue } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.exact-propagation",
  title: "Registry exact data carrier propagation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "feed", "capture", "registry", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.exact-propagation");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}
const Schema = Hson.schema`<type "data" content <value "any">>`;
const registry = (value: JsonValue) => hsonLiveMap.fromLibraries({ state: { data: { value }, schema: Schema } });
const record = (entries: readonly (readonly [string, JsonValue])[]): Record<string, JsonValue> => {
  const result: Record<string, JsonValue> = Object.create(null);
  for (const [key, value] of entries) result[key] = value;
  return result;
};
const exact = (value: ReturnType<typeof registry>) => JSON.stringify(encode_exact_hson_value(value.lib("state").root()));

check("feed publishes an accepted value at the selected library path", () => {
  const map = registry({ a: 1 });
  let observed: unknown;
  map.lib("state").at(["value"]).feed((event) => { observed = event.value; });
  map.lib("state").at(["value"]).replace({ a: 2 });
  assert.deepEqual(observed, { a: 2 });
});

check("feed publication preserves negative zero", () => {
  const map = registry(0);
  let observed: unknown;
  map.lib("state").at(["value"]).feed((event) => { observed = event.value; });
  map.lib("state").at(["value"]).set(-0);
  assert.equal(Object.is(observed, -0), true);
  assert.equal(Object.is(map.lib("state").snap(["value"]), -0), true);
});

check("each feed listener receives detached public material", () => {
  const map = registry({ a: 1 });
  let second: unknown;
  map.lib("state").at(["value"]).feed((event) => { (event.value as { a: number }).a = 99; });
  map.lib("state").at(["value"]).feed((event) => { second = (event.value as { a: number }).a; });
  map.lib("state").at(["value"]).replace({ a: 2 });
  assert.equal(second, 2);
  assert.deepEqual(map.lib("state").snap(["value"]), { a: 2 });
});

check("dangerous property names remain data rather than prototypes", () => {
  const map = registry(record([["__proto__", { safe: true }], ["constructor", 3], ["prototype", "x"]]));
  const value = map.lib("state").snap(["value"]);
  assert.equal(Object.hasOwn(value as object, "__proto__"), true);
  assert.deepEqual(Object.keys(value as object), ["__proto__", "constructor", "prototype"]);
});

check("capture and restore preserve exact accepted data carrier", () => {
  const source = registry(record([["constructor", 3], ["prototype", "x"]]));
  const target = registry({});
  target.restore(source.capture());
  assert.equal(exact(target), exact(source));
});

check("array objects survive a portable registry round trip", () => {
  const source = registry([{ a: 1 }, { b: -0 }]);
  const target = registry([]);
  target.restore(source.capture());
  assert.deepEqual(target.lib("state").snap(["value"]), [{ a: 1 }, { b: -0 }]);
});

check("equal exact values do not advance revision or publish", () => {
  const map = registry({ a: 1 });
  let publications = 0;
  map.commits.observe(() => { publications += 1; });
  map.lib("state").at(["value"]).replace({ a: 1 });
  assert.equal(map.rev, 0);
  assert.equal(publications, 0);
});

check("accepted changes publish one named global operation", () => {
  const map = registry(0);
  const commit = map.lib("state").at(["value"]).set(1);
  assert.equal(commit.operations[0]?.library, "state");
  assert.equal(commit.rev, 1);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry exact carrier checks passed\n`);

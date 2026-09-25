import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-livemap-convergence",
  title: "Hson Schema LiveMap convergence",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "livemap", "convergence"]),
});

const testEvents = create_test_event_emitter("hson-schema-livemap-convergence");
let checks = 0;
const check = (name: string, run: () => void): void => {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } console.log(`ok ${++checks} - ${name}`); };

const PersonSchema: HsonSchema = Hson.schema`<type "data" content <name "string" age "number">>`;
const OtherSchema: HsonSchema = Hson.schema`<type "data" content <name "string">>`;

check("HsonSchema governs a named data library from admission", () => {
  const map = hsonLiveMap.fromLibraries({ person: { data: { name: "Ada", age: 37 }, schema: PersonSchema } });
  assert.equal(map.lib("person").schema.get(), PersonSchema);
  assert.equal(map.lib("person"), map.lib("person"));
});

check("HsonSchema rejects invalid mutation before changing state", () => {
  const map = hsonLiveMap.fromLibraries({ person: { data: { name: "Ada", age: 37 }, schema: PersonSchema } });
  assert.throws(() => map.lib("person").at(["age"]).set("wrong" as never));
  assert.deepEqual(map.lib("person").snap(), { name: "Ada", age: 37 });
});

check("alphabet refinement governs LiveMap admission and mutation through the shared evaluator", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <key <string <len 3 alphabet "abc">>>>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { key: "abc" }, schema } });
  map.lib("state").at(["key"]).set("cba");
  assert.deepEqual(map.lib("state").snap(), { key: "cba" });
  assert.throws(() => map.lib("state").at(["key"]).set("abd"));
  assert.deepEqual(map.lib("state").snap(), { key: "cba" });
  assert.throws(() => hsonLiveMap.fromLibraries({ state: { data: { key: "ab" }, schema } }));
});

check("any governs canonical data while preserving negative zero and object order", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <args "any" payload "any">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { args: -0, payload: { z: 1, a: [true, null, {}] } }, schema } });
  const state = map.lib("state");
  assert.equal(Object.is(state.snap(["args"]), -0), true);
  assert.deepEqual(Object.keys(state.snap(["payload"]) as object), ["z", "a"]);
  state.at(["payload"]).replace({ second: [], first: { nested: "ok" } });
  assert.deepEqual(Object.keys(state.snap(["payload"]) as object), ["second", "first"]);
  assert.throws(() => state.at(["args"]).set((() => "runtime capability") as never));
  assert.equal(Object.is(state.snap(["args"]), -0), true);
});

check("primitive union branches govern null values", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value <union ["string", "null"]>>>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: null }, schema } });
  assert.deepEqual(map.lib("state").snap(), { value: null });
  map.lib("state").at(["value"]).set("ready");
  assert.throws(() => map.lib("state").at(["value"]).set(1 as never));
});

check("one library has a fixed Schema while independent registries can reuse it", () => {
  const first = hsonLiveMap.fromLibraries({ person: { data: { name: "Ada", age: 37 }, schema: PersonSchema } });
  const second = hsonLiveMap.fromLibraries({ person: { data: { name: "Grace", age: 40 }, schema: PersonSchema } });
  assert.equal(first.lib("person").schema.get(), PersonSchema);
  assert.equal(second.lib("person").schema.get(), PersonSchema);
  assert.notEqual(first.lib("person"), second.lib("person"));
  assert.throws(() => hsonLiveMap.fromLibraries({ person: { data: { name: "Ada", age: 37 }, schema: OtherSchema } }));
});

check("document library admission consumes HsonSchema", () => {
  const schema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "section" content "string">]>>`;
  const map = hsonLiveMap.fromLibraries({ page: { document: '<main <section "body"/>/>', schema } });
  assert.equal(map.lib("page").mode, "document");
  assert.equal(map.lib("page").schema.get(), schema);
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: "<aside/>", schema } }));
});

check("duplicate LiveMap namespace certification is retired", () => {
  assert.equal("schema" in hsonLiveMap, false);
});

testEvents.terminal("pass");

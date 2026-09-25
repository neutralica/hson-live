// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import type { JsonValue } from "../src/core/types.ts";
import type { LiveMapDataLibrary } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.projected-rename-intent", title: "Named data library object rename intent",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["projected-value", "object", "rename", "externally-discoverable"]),
});
const testEvents = create_test_event_emitter("livemap.projected-rename-intent");
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

const RenameSchema = Hson.schema`<type "data" content <
  source <optional "any"> destination <optional "any"> a <optional "any">
  middle <optional "any"> z <optional "any"> kept <optional "any">
  outer <optional "any"> '__proto__' <optional "any"> constructor <optional "any">
  prototype <optional "any"> '10' <optional "any"> '2' <optional "any">
  '1' <optional "any"> '3' <optional "any">
>>`;
const library = (value: string | Record<string, unknown>): LiveMapDataLibrary<unknown> => hsonLiveMap.fromLibraries({ state: { data: value as JsonValue, schema: RenameSchema } }).lib("state");
const rename = (value: string | Record<string, unknown>, from: string, to: string) => {
  const target = library(value);
  const commit = target.at([]).asObject()!.renameKey(from, to);
  return { target, commit };
};

check("simple rename emits named semantic intent", () => {
  const { target, commit } = rename({ source: 1 }, "source", "destination");
  assert.equal(commit.operations[0]?.library, "state");
  assert.equal(commit.operations[0]?.operation.kind, "rename");
  assert.deepEqual(target.snap(), { destination: 1 });
});
check("rename retains source position and removes old destination", () => {
  const { target } = rename('{"a":1,"source":2,"middle":3,"destination":4,"z":5}', "source", "destination");
  assert.equal(canonical_hson_graph_equal(target.root(), library('{"a":1,"destination":2,"middle":3,"z":5}').root()), true);
});
check("rename replaces an earlier destination position", () => {
  const { target } = rename('{"destination":1,"middle":2,"source":3,"z":4}', "source", "destination");
  assert.equal(canonical_hson_graph_equal(target.root(), library('{"middle":2,"destination":3,"z":4}').root()), true);
});
check("rename preserves descendant values", () => {
  const { target } = rename({ source: { nested: { value: -0 } }, destination: false }, "source", "destination");
  const value = (target.snap() as { destination: { nested: { value: number } } }).destination.nested.value;
  assert.equal(Object.is(value, -0), true);
});
check("nested rename is path-authoritative", () => {
  const target = library({ outer: { source: 1, kept: 2 } });
  const commit = target.at(["outer"]).asObject()!.renameKey("source", "destination");
  assert.equal(commit.operations[0]?.library, "state");
  assert.deepEqual(target.snap(), { outer: { destination: 1, kept: 2 } });
});
check("dangerous keys remain ordinary data", () => {
  const { target } = rename('{"__proto__":{"safe":true},"constructor":2,"prototype":3}', "__proto__", "constructor");
  assert.equal(canonical_hson_graph_equal(target.root(), library('{"constructor":{"safe":true},"prototype":3}').root()), true);
});
check("integer-like keys retain exact graph order", () => {
  const { target } = rename('{"10":"ten","2":"two","source":"moved","1":"one"}', "source", "3");
  assert.equal(canonical_hson_graph_equal(target.root(), library('{"10":"ten","2":"two","3":"moved","1":"one"}').root()), true);
});
check("same-name rename is a no-op after source validation", () => {
  const { target, commit } = rename({ source: 1 }, "source", "source");
  assert.equal(commit.changed, false);
  assert.equal(target.rev, 0);
});
check("missing source rejects atomically", () => {
  const target = library({ kept: 1 });
  const before = target.root();
  assert.throws(() => target.at([]).asObject()!.renameKey("missing", "destination"));
  assert.equal(canonical_hson_graph_equal(target.root(), before), true);
  assert.equal(target.rev, 0);
});
for (const [name, from, to] of [
  ["invalid source", 1, "destination"], ["invalid destination", "source", null],
] as const) check(`${name} rejects`, () => {
  const target = library({ source: 1 });
  assert.throws(() => target.at([]).asObject()!.renameKey(from as never, to as never));
  assert.equal(target.rev, 0);
});
check("changed rename advances exactly one revision", () => {
  const { target, commit } = rename({ source: 1 }, "source", "destination");
  assert.deepEqual([commit.prevRev, commit.rev, target.rev], [0, 1, 1]);
});
check("rename does not mint QUID metadata", () => {
  assert.equal(JSON.stringify(rename({ source: { nested: true } }, "source", "destination").target.root()).includes("quid"), false);
});

process.stdout.write(`# ${checks} data object rename-intent checks passed\n`);
testEvents.terminal("pass");

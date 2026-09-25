// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import type { JsonValue } from "../src/core/types.ts";
import type { LiveMapDataLibrary } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.projected-array-move-intent",
  title: "Named data library array move intent",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["projected-value", "array", "move", "externally-discoverable"]),
});
const testEvents = create_test_event_emitter("livemap.projected-array-move-intent");
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

const ItemsSchema = Hson.schema`<type "data" content <items <array "any">>>`;
const library = (value: string | { items: readonly unknown[] }): LiveMapDataLibrary<unknown> => hsonLiveMap.fromLibraries({ state: { data: value as JsonValue, schema: ItemsSchema } }).lib("state");
const moved = (items: readonly unknown[], from: number, to: number) => {
  const target = library({ items });
  const commit = target.at(["items"]).asArray()!.move(from, to);
  return { target, commit };
};

for (const [name, items, from, to, expected] of [
  ["forward final index", ["a", "b", "c", "d"], 1, 3, ["a", "c", "d", "b"]],
  ["backward final index", ["a", "b", "c", "d"], 3, 1, ["a", "d", "b", "c"]],
  ["forward adjacent", ["a", "b", "c"], 0, 1, ["b", "a", "c"]],
  ["backward adjacent", ["a", "b", "c"], 2, 1, ["a", "c", "b"]],
  ["first to last", [1, 2, 3], 0, 2, [2, 3, 1]],
  ["last to first", [1, 2, 3], 2, 0, [3, 1, 2]],
] as const) check(name, () => assert.deepEqual(moved(items, from, to).target.snap(), { items: expected }));

check("same-position move is an exact no-op", () => {
  const { target, commit } = moved([1, 2, 3], 1, 1);
  assert.equal(commit.changed, false);
  assert.equal(target.rev, 0);
});
check("move emits named semantic intent and one revision", () => {
  const { target, commit } = moved([1, 2, 3], 0, 2);
  const operation = commit.operations[0];
  assert.equal(operation?.library, "state");
  assert.equal(operation?.operation.kind, "move");
  assert.deepEqual([commit.prevRev, commit.rev, target.rev], [0, 1, 1]);
});
for (const [name, from, to] of [
  ["negative source", -1, 0], ["negative destination", 0, -1],
  ["unsafe source", Number.MAX_SAFE_INTEGER + 1, 0],
  ["unsafe destination", 0, Number.MAX_SAFE_INTEGER + 1],
] as const) check(`${name} rejects`, () => assert.throws(() => moved([1, 2], from, to)));
check("out-of-range source rejects atomically", () => {
  const target = library({ items: [1, 2] });
  const before = target.root();
  assert.throws(() => target.at(["items"]).asArray()!.move(2, 0));
  assert.equal(canonical_hson_graph_equal(target.root(), before), true);
  assert.equal(target.rev, 0);
});
check("out-of-range destination rejects atomically", () => {
  const target = library({ items: [1, 2] });
  const before = target.root();
  assert.throws(() => target.at(["items"]).asArray()!.move(0, 2));
  assert.equal(canonical_hson_graph_equal(target.root(), before), true);
  assert.equal(target.rev, 0);
});
check("nested ordered objects move without rematerialization", () => {
  const target = library('{"items":[{"10":10,"2":2,"1":1},{"kept":true}]}');
  target.at(["items"]).asArray()!.move(0, 1);
  assert.equal(canonical_hson_graph_equal(target.root(), library('{"items":[{"kept":true},{"10":10,"2":2,"1":1}]}').root()), true);
});
check("moved values preserve positive and negative zero", () => {
  const value = moved([0, -0, 1], 1, 2).target.snap() as { items: number[] };
  assert.equal(Object.is(value.items[2], -0), true);
  assert.equal(Object.is(value.items[0], 0), true);
});
check("dangerous keys inside a moved object remain data", () => {
  const target = library('{"items":[{"__proto__":1,"constructor":2},false]}');
  target.at(["items"]).asArray()!.move(0, 1);
  assert.equal(canonical_hson_graph_equal(target.root(), library('{"items":[false,{"__proto__":1,"constructor":2}]}').root()), true);
});
check("an array inside an object moves as one subtree", () => {
  assert.deepEqual(moved([[1, 2], [3, 4]], 0, 1).target.snap(), { items: [[3, 4], [1, 2]] });
});
check("projected move does not mint QUID metadata", () => {
  assert.equal(JSON.stringify(moved([{ nested: true }, false], 0, 1).target.root()).includes("quid"), false);
});
process.stdout.write(`# ${checks} data array move-intent checks passed\n`);
testEvents.terminal("pass");

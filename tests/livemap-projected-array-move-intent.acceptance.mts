// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import {
  decode_livemap_replay_payload,
  encode_livemap_replay_transport,
} from "../src/api/livemap/livemap.transport.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.projected-array-move-intent",
  title: "Data array move intent",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "array", "move", "replay", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.projected-array-move-intent");
let checks = 0;
function check(name: string, run: () => void): void {

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
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const map = (value: Parameters<typeof hson.liveMap.fromJson>[0]) => hson.liveMap.fromJson(value);
const moved = (items: readonly unknown[], from: number, to: number) => {
  const target = map({ items } as never);
  const commit = target.at(["items"]).array.move(from, to);
  return { target, commit };
};

check("forward move uses the final post-removal index", () => {
  assert.deepEqual(moved(["a", "b", "c", "d"], 1, 3).target.snap(), { items: ["a", "c", "d", "b"] });
});

check("backward move uses the final post-removal index", () => {
  assert.deepEqual(moved(["a", "b", "c", "d"], 3, 1).target.snap(), { items: ["a", "d", "b", "c"] });
});

check("forward adjacent move shifts one sibling", () => {
  assert.deepEqual(moved(["a", "b", "c"], 0, 1).target.snap(), { items: ["b", "a", "c"] });
});

check("backward adjacent move shifts one sibling", () => {
  assert.deepEqual(moved(["a", "b", "c"], 2, 1).target.snap(), { items: ["a", "c", "b"] });
});

check("first item moves to last", () => {
  assert.deepEqual(moved([1, 2, 3], 0, 2).target.snap(), { items: [2, 3, 1] });
});

check("last item moves to first", () => {
  assert.deepEqual(moved([1, 2, 3], 2, 0).target.snap(), { items: [3, 1, 2] });
});

check("same-position move is an exact no-op", () => {
  const { target, commit } = moved([1, 2, 3], 1, 1);
  assert.equal(commit.changed, false);
  assert.equal(target.rev, 0);
});

check("move emits semantic intent", () => {
  const op = moved([1, 2, 3], 0, 2).commit.ops[0];
  assert.deepEqual(op?.kind === "move" ? [op.kind, op.from, op.to, op.path] : undefined, ["move", 0, 2, ["items"]]);
});

check("changed move advances exactly one revision", () => {
  const { target, commit } = moved([1, 2, 3], 0, 2);
  assert.deepEqual([commit.prevRev, commit.rev, target.rev], [0, 1, 1]);
});

check("negative source indexes reject structurally", () => {
  assert.throws(() => moved([1, 2], -1, 0), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_ARRAY_MOVE_SOURCE"
  ));
});

check("negative destination indexes reject structurally", () => {
  assert.throws(() => moved([1, 2], 0, -1), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_ARRAY_MOVE_DESTINATION"
  ));
});

check("unsafe source integers reject", () => {
  assert.throws(() => moved([1, 2], Number.MAX_SAFE_INTEGER + 1, 0));
});

check("unsafe destination integers reject", () => {
  assert.throws(() => moved([1, 2], 0, Number.MAX_SAFE_INTEGER + 1));
});

check("out-of-range source rejects atomically", () => {
  const target = map({ items: [1, 2] });
  const before = target.capture();
  assert.throws(() => target.at(["items"]).array.move(2, 0));
  assert.deepEqual(target.capture(), before);
});

check("out-of-range destination rejects atomically", () => {
  const target = map({ items: [1, 2] });
  const before = target.capture();
  assert.throws(() => target.at(["items"]).array.move(0, 2));
  assert.deepEqual(target.capture(), before);
});

check("nested ordered objects move without rematerialization", () => {
  const target = map('{"items":[{"10":10,"2":2,"1":1},{"kept":true}]}');
  target.at(["items"]).array.move(0, 1);
  assert.equal(target.capture().payload, map('{"items":[{"kept":true},{"10":10,"2":2,"1":1}]}').capture().payload);
});

check("moved values preserve positive and negative zero", () => {
  const value = moved([0, -0, 1], 1, 2).target.snap() as { items: number[] };
  assert.equal(Object.is(value.items[2], -0), true);
  assert.equal(Object.is(value.items[0], 0), true);
});

check("dangerous keys inside a moved object remain data", () => {
  const target = map('{"items":[{"__proto__":1,"constructor":2},false]}');
  target.at(["items"]).array.move(0, 1);
  assert.equal(target.capture().payload, map('{"items":[false,{"__proto__":1,"constructor":2}]}').capture().payload);
});

check("an array inside an object moves as one subtree", () => {
  assert.deepEqual(moved([[1, 2], [3, 4]], 0, 1).target.snap(), { items: [[3, 4], [1, 2]] });
});

check("move replay closes to the exact graph", () => {
  const source = map({ items: [{ value: 1 }, { value: 2 }, { value: 3 }] });
  const commit = source.at(["items"]).array.move(0, 2);
  const target = map({ items: [{ value: 1 }, { value: 2 }, { value: 3 }] });
  target.replay(commit);
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});

check("exact transport preserves move intent", () => {
  const commit = moved([1, 2, 3], 0, 2).commit;
  if (typeof commit.payload !== "string") throw new Error("Expected exact replay payload.");
  const op = decode_livemap_replay_payload(commit.payload)[0];
  assert.deepEqual(op?.kind === "move" ? [op.from, op.to] : undefined, [0, 2]);
});

check("staged replay resolves move indexes after an earlier splice", () => {
  const source = map({ items: ["a", "b", "c"] });
  const splice = source.splice(["items"], 1, 1, "x", "y");
  const move = source.at(["items"]).array.move(3, 0);
  if (typeof splice.payload !== "string" || typeof move.payload !== "string") throw new Error("Expected exact replay payloads.");
  const ops = [
    ...decode_livemap_replay_payload(splice.payload),
    ...decode_livemap_replay_payload(move.payload),
  ];
  const target = map({ items: ["a", "b", "c"] });
  target.replay({ prevRev: 0, ...encode_livemap_replay_transport(ops) });
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});

check("public move operation is detached from state", () => {
  const { target, commit } = moved([{ value: 1 }, { value: 2 }], 0, 1);
  const op = commit.ops[0];
  if (op?.kind !== "move") throw new Error("Expected move operation.");
  (op.next as { value: number }[])[0]!.value = 9;
  assert.deepEqual(target.snap(), { items: [{ value: 2 }, { value: 1 }] });
});

check("projected move never mints QUID metadata", () => {
  const { target } = moved([{ nested: true }, false], 0, 1);
  assert.equal(JSON.stringify(target.root()).includes("quid"), false);
});

process.stdout.write(`# ${checks} data array move-intent checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.projected-array-move-intent", checks, checks, 0);

// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { decode_livemap_replay_payload } from "../src/api/livemap/livemap.transport.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.projected-rename-intent",
  title: "Data object rename intent",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "object", "rename", "replay", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.projected-rename-intent");
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
const rename = (value: Parameters<typeof map>[0], from: string, to: string) => {
  const target = map(value);
  const commit = target.at([]).object.renameKey(from, to);
  return { target, commit };
};

check("simple rename emits semantic intent", () => {
  const { commit } = rename({ source: 1 }, "source", "destination");
  assert.equal(commit.ops[0]?.kind, "rename");
});

check("simple rename moves the source value", () => {
  assert.deepEqual(rename({ source: 1 }, "source", "destination").target.snap(), { destination: 1 });
});

check("rename retains the source position while replacing a destination", () => {
  const { target } = rename('{"a":1,"source":2,"middle":3,"destination":4,"z":5}', "source", "destination");
  assert.equal(target.capture().payload, map('{"a":1,"destination":2,"middle":3,"z":5}').capture().payload);
});

check("rename removes the old destination position", () => {
  const { target } = rename('{"destination":1,"middle":2,"source":3,"z":4}', "source", "destination");
  assert.equal(target.capture().payload, map('{"middle":2,"destination":3,"z":4}').capture().payload);
});

check("rename preserves a complete descendant subtree", () => {
  const { target } = rename({ source: { nested: { value: -0 } }, destination: false }, "source", "destination");
  const value = (target.snap() as { destination: { nested: { value: number } } }).destination.nested.value;
  assert.equal(Object.is(value, -0), true);
});

check("nested rename is path-authoritative", () => {
  const target = map({ outer: { source: 1, kept: 2 } });
  const commit = target.at(["outer"]).object.renameKey("source", "destination");
  assert.deepEqual(commit.ops[0]?.path, ["outer"]);
  assert.deepEqual(target.snap(), { outer: { destination: 1, kept: 2 } });
});

check("dangerous keys remain ordinary data", () => {
  const { target } = rename('{"__proto__":{"safe":true},"constructor":2,"prototype":3}', "__proto__", "constructor");
  assert.equal(target.capture().payload, map('{"constructor":{"safe":true},"prototype":3}').capture().payload);
});

check("integer-like key order remains exact", () => {
  const { target } = rename('{"10":"ten","2":"two","source":"moved","1":"one"}', "source", "3");
  assert.equal(target.capture().payload, map('{"10":"ten","2":"two","3":"moved","1":"one"}').capture().payload);
});

check("same-name rename is an exact no-op after source validation", () => {
  const target = map({ source: 1 });
  const commit = target.at([]).object.renameKey("source", "source");
  assert.equal(commit.changed, false);
  assert.equal(target.rev, 0);
});

check("missing rename source rejects structurally", () => {
  const target = map({ kept: 1 });
  assert.throws(() => target.at([]).object.renameKey("missing", "next"), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "OBJECT_RENAME_SOURCE_NOT_FOUND"
  ));
});

check("missing-source rejection is atomic", () => {
  const target = map({ kept: 1 });
  const before = target.capture();
  assert.throws(() => target.at([]).object.renameKey("missing", "next"));
  assert.deepEqual(target.capture(), before);
});

check("invalid source key rejects structurally", () => {
  const target = map({ source: 1 });
  assert.throws(() => target.at([]).object.renameKey(1 as never, "next"), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_OBJECT_RENAME_SOURCE"
  ));
});

check("invalid destination key rejects structurally", () => {
  const target = map({ source: 1 });
  assert.throws(() => target.at([]).object.renameKey("source", null as never), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_OBJECT_RENAME_DESTINATION"
  ));
});

check("changed rename advances exactly one revision", () => {
  const { target, commit } = rename({ source: 1 }, "source", "destination");
  assert.deepEqual([commit.prevRev, commit.rev, target.rev], [0, 1, 1]);
});

check("rename replay closes to the exact graph", () => {
  const source = map('{"a":1,"source":{"x":2},"destination":3}');
  const commit = source.at([]).object.renameKey("source", "destination");
  const target = map('{"a":1,"source":{"x":2},"destination":3}');
  target.replay(commit);
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});

check("exact transport preserves rename kind and keys", () => {
  const { commit } = rename({ source: 1 }, "source", "destination");
  if (typeof commit.payload !== "string") throw new Error("Expected exact replay payload.");
  const op = decode_livemap_replay_payload(commit.payload)[0];
  assert.deepEqual(op === undefined ? undefined : [op.kind, "from" in op ? op.from : undefined, "to" in op ? op.to : undefined], ["rename", "source", "destination"]);
});

check("repeated rename transitions emit deterministic bytes", () => {
  const left = rename('{"a":1,"source":2,"destination":3}', "source", "destination").commit;
  const right = rename('{"a":1,"source":2,"destination":3}', "source", "destination").commit;
  assert.equal(left.payload, right.payload);
});

check("public rename operation is detached from state", () => {
  const { target, commit } = rename({ source: { value: 1 } }, "source", "destination");
  const op = commit.ops[0];
  if (op?.kind !== "rename") throw new Error("Expected rename operation.");
  (op.next as { destination: { value: number } }).destination.value = 9;
  assert.deepEqual(target.snap(), { destination: { value: 1 } });
});

check("public rename envelope and path are immutable", () => {
  const { commit } = rename({ source: 1 }, "source", "destination");
  assert.equal(Object.isFrozen(commit.ops[0]), true);
  assert.equal(Object.isFrozen(commit.ops[0]?.path), true);
});

check("empty and unusual names remain ordered keys", () => {
  const { target } = rename('{"":1,"x-y":2}', "", "line\\nbreak");
  assert.equal(target.capture().payload, map('{"line\\\\nbreak":1,"x-y":2}').capture().payload);
});

check("capture after rename retains the exact revision and result", () => {
  const { target } = rename({ source: 1 }, "source", "destination");
  assert.equal(target.capture().rev, 1);
  assert.deepEqual(target.snap(), { destination: 1 });
});

check("projected rename never mints QUID metadata", () => {
  const { target } = rename({ source: { nested: true } }, "source", "destination");
  assert.equal(JSON.stringify(target.root()).includes("quid"), false);
});

process.stdout.write(`# ${checks} projected rename-intent checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.projected-rename-intent", checks, checks, 0);

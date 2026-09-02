// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { hson } from "../src/index.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.projected-identity-lifecycle",
  title: "Active-epoch data identity handle lifecycle",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "quid", "identity-handle", "lifecycle", "provenance", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.projected-identity-lifecycle");
let checks = 0;
const check = (name: string, run: () => void) => {
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
  } checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const map = (value: unknown) => hson.liveMap.fromJson(value as never);

check("nested scalar mutation preserves container identity", () => { const m = map({ a: { x: 1 } }); const h = acquire_projected_identity(m, ["a"]); m.set(["a", "x"], 2); assert.deepEqual(h.snap(), { x: 2 }); });
check("unrelated property insertion preserves identity", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m, ["a"]); m.at([]).object.setKey("b", 1); assert.deepEqual(h.path(), ["a"]); });
check("object rename follows exact source identity", () => { const m = map({ a: { x: 1 } }); const h = acquire_projected_identity(m, ["a"]); m.at([]).object.renameKey("a", "b"); assert.deepEqual(h.path(), ["b"]); });
check("rename retains source position semantics", () => { const m = map({ z: 0, a: {}, y: 2 }); const h = acquire_projected_identity(m, ["a"]); m.at([]).object.renameKey("a", "b"); assert.deepEqual(Object.keys(m.snap() as object), ["z", "b", "y"]); assert.deepEqual(h.path(), ["b"]); });
check("rename retires replaced destination identity", () => { const m = map({ a: {}, b: {} }); const source = acquire_projected_identity(m, ["a"]); const destination = acquire_projected_identity(m, ["b"]); m.at([]).object.renameKey("a", "b"); assert.equal(source.active, true); assert.equal(destination.active, false); });
check("descendant identity follows rename", () => { const m = map({ a: { child: {} } }); const h = acquire_projected_identity(m, ["a", "child"]); m.at([]).object.renameKey("a", "b"); assert.deepEqual(h.path(), ["b", "child"]); });
check("same-name rename is an identity no-op", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m, ["a"]); const rev = m.rev; m.at([]).object.renameKey("a", "a"); assert.equal(m.rev, rev); assert.equal(h.active, true); });
check("array forward move follows final index", () => { const m = map([{ a: 1 }, { b: 2 }, { c: 3 }]); const h = acquire_projected_identity(m, [0]); m.at([]).array.move(0, 2); assert.deepEqual(h.path(), [2]); });
check("array backward move follows final index", () => { const m = map([{ a: 1 }, { b: 2 }, { c: 3 }]); const h = acquire_projected_identity(m, [2]); m.at([]).array.move(2, 0); assert.deepEqual(h.path(), [0]); });
check("intervening siblings shift exactly once", () => { const m = map([{}, {}, {}]); const h = acquire_projected_identity(m, [1]); m.at([]).array.move(0, 2); assert.deepEqual(h.path(), [0]); });
check("descendant identity follows array move", () => { const m = map([{ child: {} }, {}]); const h = acquire_projected_identity(m, [0, "child"]); m.at([]).array.move(0, 1); assert.deepEqual(h.path(), [1, "child"]); });
check("insert before retained item shifts its path", () => { const m = map([{}, {}]); const h = acquire_projected_identity(m, [1]); m.at([]).array.insert(0, {}); assert.deepEqual(h.path(), [2]); });
check("splice before retained item shifts its path", () => { const m = map([{}, {}, {}]); const h = acquire_projected_identity(m, [2]); m.splice([], 0, 1, {}, {}); assert.deepEqual(h.path(), [3]); });
check("splice deletion invalidates removed identity", () => { const m = map([{}, {}]); const h = acquire_projected_identity(m, [0]); m.splice([], 0, 1); assert.equal(h.active, false); });
check("direct object deletion invalidates", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m, ["a"]); m.delete(["a"]); assert.equal(h.active, false); });
check("structurally equal replacement invalidates", () => { const m = map({ a: { x: 1 } }); const h = acquire_projected_identity(m, ["a"]); m.replace(["a"], { x: 1 }); assert.equal(h.active, false); });
check("ancestor replacement invalidates descendants", () => { const m = map({ a: { b: {} } }); const h = acquire_projected_identity(m, ["a", "b"]); m.replace(["a"], { b: {} }); assert.equal(h.active, false); });
check("ancestor rename follows descendants", () => { const m = map({ a: { b: [] } }); const h = acquire_projected_identity(m, ["a", "b"]); m.at([]).object.renameKey("a", "z"); assert.deepEqual(h.path(), ["z", "b"]); });
check("ancestor array move follows descendants", () => { const m = map([{ b: {} }, {}]); const h = acquire_projected_identity(m, [0, "b"]); m.at([]).array.move(0, 1); assert.deepEqual(h.path(), [1, "b"]); });
check("whole-root replacement fences the identity epoch", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m, ["a"]); m.replace({ a: {} }); assert.equal(h.active, false); });
check("durable restore fences old handles", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m, ["a"]); m.restore(m.capture()); assert.equal(h.active, false); });
check("exact same-epoch restore preserves continuity", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m, ["a"]); const c = m.capture({ identity: "same-epoch" }); m.restore(c, { identity: "same-epoch" }); assert.equal(h.active, true); });
check("copied same-epoch capture cannot preserve continuity", () => { const m = map({ a: {} }); acquire_projected_identity(m, ["a"]); const c = m.capture({ identity: "same-epoch" }); assert.throws(() => m.restore({ ...c }, { identity: "same-epoch" })); });

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");

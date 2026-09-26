// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { Hson, hson } from "../src/index.ts";
import type { JsonValue } from "../src/core/types.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";

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
const ObjectSchema = Hson.schema`<type "data" content <a <optional "any"> b <optional "any"> z <optional "any"> y <optional "any">>>`;
const ArraySchema = Hson.schema`<type "data" defs <Root <array "any">> content <ref "Root">>`;
const map = (value: JsonValue) => hson.liveMap.fromLibraries({ state: { data: value, schema: Array.isArray(value) ? ArraySchema : ObjectSchema } });

check("nested scalar mutation preserves container identity", () => { const m = map({ a: { x: 1 } }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.lib("state").at(["a", "x"]).set(2); assert.deepEqual(h.snap(), { x: 2 }); });
check("unrelated property insertion preserves identity", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.lib("state").at([]).asObject()!.setKey("b", 1); assert.deepEqual(h.path(), ["a"]); });
check("object rename follows exact source identity", () => { const m = map({ a: { x: 1 } }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.lib("state").at([]).asObject()!.renameKey("a", "b"); assert.deepEqual(h.path(), ["b"]); });
check("rename retains source position semantics", () => { const m = map({ z: 0, a: {}, y: 2 }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.lib("state").at([]).asObject()!.renameKey("a", "b"); assert.deepEqual(Object.keys(m.lib("state").snap() as object), ["z", "b", "y"]); assert.deepEqual(h.path(), ["b"]); });
check("rename retires replaced destination identity", () => { const m = map({ a: {}, b: {} }); const source = acquire_projected_identity(m.lib("state"), ["a"]); const destination = acquire_projected_identity(m.lib("state"), ["b"]); m.lib("state").at([]).asObject()!.renameKey("a", "b"); assert.equal(source.active, true); assert.equal(destination.active, false); });
check("descendant identity follows rename", () => { const m = map({ a: { child: {} } }); const h = acquire_projected_identity(m.lib("state"), ["a", "child"]); m.lib("state").at([]).asObject()!.renameKey("a", "b"); assert.deepEqual(h.path(), ["b", "child"]); });
check("same-name rename is an identity no-op", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m.lib("state"), ["a"]); const rev = m.rev; m.lib("state").at([]).asObject()!.renameKey("a", "a"); assert.equal(m.rev, rev); assert.equal(h.active, true); });
check("array forward move follows final index", () => { const m = map([{ a: 1 }, { b: 2 }, { c: 3 }]); const h = acquire_projected_identity(m.lib("state"), [0]); m.lib("state").at([]).asArray()!.move(0, 2); assert.deepEqual(h.path(), [2]); });
check("array backward move follows final index", () => { const m = map([{ a: 1 }, { b: 2 }, { c: 3 }]); const h = acquire_projected_identity(m.lib("state"), [2]); m.lib("state").at([]).asArray()!.move(2, 0); assert.deepEqual(h.path(), [0]); });
check("intervening siblings shift exactly once", () => { const m = map([{}, {}, {}]); const h = acquire_projected_identity(m.lib("state"), [1]); m.lib("state").at([]).asArray()!.move(0, 2); assert.deepEqual(h.path(), [0]); });
check("descendant identity follows array move", () => { const m = map([{ child: {} }, {}]); const h = acquire_projected_identity(m.lib("state"), [0, "child"]); m.lib("state").at([]).asArray()!.move(0, 1); assert.deepEqual(h.path(), [1, "child"]); });
check("insert before retained item shifts its path", () => { const m = map([{}, {}]); const h = acquire_projected_identity(m.lib("state"), [1]); m.lib("state").at([]).asArray()!.insert(0, {}); assert.deepEqual(h.path(), [2]); });
check("splice before retained item shifts its path", () => { const m = map([{}, {}, {}]); const h = acquire_projected_identity(m.lib("state"), [2]); m.lib("state").at([]).asArray()!.splice( 0, 1, {}, {}); assert.deepEqual(h.path(), [3]); });
check("splice deletion invalidates removed identity", () => { const m = map([{}, {}]); const h = acquire_projected_identity(m.lib("state"), [0]); m.lib("state").at([]).asArray()!.splice( 0, 1); assert.equal(h.active, false); });
check("direct object deletion invalidates", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.lib("state").at(["a"]).delete(); assert.equal(h.active, false); });
check("structurally equal replacement invalidates", () => { const m = map({ a: { x: 1 } }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.lib("state").at(["a"]).replace( { x: 1 }); assert.equal(h.active, false); });
check("ancestor replacement invalidates descendants", () => { const m = map({ a: { b: {} } }); const h = acquire_projected_identity(m.lib("state"), ["a", "b"]); m.lib("state").at(["a"]).replace( { b: {} }); assert.equal(h.active, false); });
check("ancestor rename follows descendants", () => { const m = map({ a: { b: [] } }); const h = acquire_projected_identity(m.lib("state"), ["a", "b"]); m.lib("state").at([]).asObject()!.renameKey("a", "z"); assert.deepEqual(h.path(), ["z", "b"]); });
check("ancestor array move follows descendants", () => { const m = map([{ b: {} }, {}]); const h = acquire_projected_identity(m.lib("state"), [0, "b"]); m.lib("state").at([]).asArray()!.move(0, 1); assert.deepEqual(h.path(), [1, "b"]); });
check("whole-root replacement fences the identity epoch", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.lib("state").at([]).replace({ a: {} }); assert.equal(h.active, false); });
check("durable restore fences old handles", () => { const m = map({ a: {} }); const h = acquire_projected_identity(m.lib("state"), ["a"]); m.restore(m.capture()); assert.equal(h.active, false); });
check("different registry capture cannot invalidate known topology", () => {
  const source = map({ a: { value: 1 } });
  acquire_projected_identity(source.lib("state"), ["a"]);
  const incompatible = hson.liveMap.fromLibraries({ other: { data: { a: { value: 1 } }, schema: ObjectSchema } }).capture();
  const target = map({ a: { value: 0 } });
  const oldState = target.lib("state");
  const oldIdentity = acquire_projected_identity(oldState, ["a"]);
  const before = target.capture();
  assert.throws(() => target.restore(incompatible), /current Library topology/);
  assert.deepEqual(target.capture(), before);
  assert.equal(oldIdentity.active, true);
  assert.deepEqual(oldState.snap(), { a: { value: 0 } });
  const installed = install_libraries_snapshot(incompatible).map;
  assert.deepEqual(installed.capture(), incompatible);
  assert.equal(livemap_identity_epoch_accounting(installed.lib("other")).issued, 0);
});
check("portable projected capture transfers state without overlay or ledger", () => {
  const source = map({ a: { value: 1 } });
  acquire_projected_identity(source.lib("state"), ["a"]);
  const portable = source.capture();
  assert.equal(JSON.stringify(portable).includes("quid"), false);
  const target = map({ a: { value: 0 } });
  target.restore(portable);
  assert.deepEqual(target.lib("state").snap(), source.lib("state").snap());
  assert.equal(target.rev, source.rev);
  assert.equal(livemap_identity_epoch_accounting(target.lib("state")).issued, 0);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");

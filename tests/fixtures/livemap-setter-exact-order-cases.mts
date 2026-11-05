import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.js";
import type { LiveMap, LivePath } from "../../src/types/livemap.types.js";
import type { JsonValue } from "../../src/core/types.js";
import { HsonDataValue, hson_data_text_from_value } from "../../src/api/data/hson-data.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { decode_hosted_root } from "../../src/api/livemap/livemap.hosted.js";
import { make_livemap_staged_writer } from "../../src/api/livemap/livemap.staged.js";
import { make_livemap_path_handle } from "../../src/api/livemap/livemap.handle.js";
import { register_livemap_projected_propagation, type LiveMapProjectedPropagationWrite } from "../../src/api/livemap/livemap.projected-propagation.js";
import { bind_locus_websocket } from "../../src/api/locus/locus.websocket.js";
import { create_echo_aggregate_client_internal } from "../../src/api/echo/echo.aggregate-replica.js";
import type { LocusWebSocketLike } from "../../src/types/locus.types.js";
import { test_echo_transport } from "../helpers/echo-websocket-transport.mts";
import { acquire_document_identity, acquire_projected_identity } from "../helpers/livemap-identity-internal.mts";
import { must_ordered_projected_value } from "../../src/api/livemap/livemap.guard.js";
import { admit_projected_value } from "../../src/core/projected-value-admission.js";
import { emit_ordered_json } from "../../src/core/exact-data-codec.js";
import { projected_value_from_hson_node } from "../../src/core/projected-value-graph.js";
import { ordered_projected_value_at } from "../../src/core/ordered-projected-value-mutation.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../src/core/ordered-projected-value.js";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
type Route = Readonly<{ name: string; path: LivePath; write: (map: LiveMap, value: JsonValue) => unknown }>;
const create = () => hsonLiveMap.fromLibraries({
  state: { data: { value: {}, spare: 0, items: [{}] } },
  page: { document: '<main title="old"/>' },
});
const state = (map: LiveMap) => map.data.must("state");

// Descriptor capture supports Proxy ownKeys ordering; ordinary object enumeration cannot witness it.
function ordered_input(): Record<string, JsonValue> {
  const nested: Record<string, JsonValue> = {
    "10": Number.MAX_VALUE, "2": Number.MIN_VALUE, emptyObject: {}, emptyArray: [],
    text: "雪🦊\ud800x\udfff", strings: ['{"a":1}', "<a 1>", "42", "true", "null"], extremes: [-Number.MAX_VALUE, -Number.MIN_VALUE],
  };
  const child = new Proxy(nested, { ownKeys: () => ["10", "2", "emptyObject", "emptyArray", "text", "strings", "extremes"] });
  return new Proxy({ "10": -0, "2": child }, { ownKeys: () => ["10", "2"] });
}

function deeply_frozen(value: OrderedProjectedValue): void {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  if (Array.isArray(value)) { for (const item of value) deeply_frozen(item); return; }
  assert.ok(is_ordered_projected_object(value));
  assert.ok(Object.isFrozen(value.entries));
  for (const pair of value.entries) { assert.ok(Object.isFrozen(pair)); deeply_frozen(pair[1]); }
}

function exact(map: LiveMap, path: LivePath, expected: OrderedProjectedValue): void {
  const library = state(map), hson = hson_data_text_from_value(expected), json = emit_ordered_json(expected);
  const graph = ordered_projected_value_at(projected_value_from_hson_node(library.root()), path);
  assert.notEqual(graph, undefined);
  assert.equal(emit_ordered_json(graph!), json);
  assert.equal(library.at(path).hson(), hson);
  const captured = map.capture().libraries.find(entry => entry.name === "state");
  assert.ok(captured);
  const snapshotGraph = ordered_projected_value_at(projected_value_from_hson_node(decode_hosted_root(captured.root)), path);
  assert.notEqual(snapshotGraph, undefined);
  assert.equal(emit_ordered_json(snapshotGraph!), json);
  const identity = internal_livemap_aggregate_authority(map).libraries()[0]!;
  const owned = internal_livemap_aggregate_authority(map).projectData(identity, path);
  assert.notEqual(owned, undefined); deeply_frozen(owned!);
}

const routes: readonly Route[] = [
  { name: "named handle replace", path: ["value"], write: (map, value) => state(map).at(["value"]).replace(value) },
  { name: "named handle set", path: ["value"], write: (map, value) => state(map).at(["value"]).set(value) },
  { name: "named handle update", path: ["value"], write: (map, value) => state(map).at(["value"]).update(() => value) },
  { name: "refined handle replace", path: ["value"], write: (map, value) => {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    return state(map).at(["value"]).asObject()!.replace(value);
  } },
  { name: "child handle replace", path: ["value"], write: (map, value) => state(map).at([]).at(["value"]).replace(value) },
  { name: "staged replace", path: ["value"], write: (map, value) => map.batch(tx => tx.data("state")!.at(["value"]).replace(value)) },
  { name: "staged must replace", path: ["value"], write: (map, value) => map.batch(tx => tx.data.must("state").at(["value"]).replace(value)) },
  { name: "staged set", path: ["value"], write: (map, value) => map.batch(tx => tx.data.must("state").at(["value"]).set(value)) },
  { name: "object setKey", path: ["value"], write: (map, value) => state(map).at([]).asObject()!.object.setKey("value", value) },
  { name: "object setMany", path: ["value"], write: (map, value) => state(map).at([]).asObject()!.object.setMany({ value }) },
  { name: "staged object setKey", path: ["value"], write: (map, value) => map.batch(tx => tx.data.must("state").at([]).asObject()!.object.setKey("value", value)) },
  { name: "staged object setMany", path: ["value"], write: (map, value) => map.batch(tx => tx.data.must("state").at([]).asObject()!.object.setMany({ value })) },
  { name: "array push", path: ["items", 1], write: (map, value) => state(map).at(["items"]).asArray()!.array.push(value) },
  { name: "array pushMany", path: ["items", 1], write: (map, value) => state(map).at(["items"]).asArray()!.array.pushMany([value]) },
  { name: "array unshift", path: ["items", 0], write: (map, value) => state(map).at(["items"]).asArray()!.array.unshift(value) },
  { name: "array insert", path: ["items", 0], write: (map, value) => state(map).at(["items"]).asArray()!.array.insert(0, value) },
  { name: "array replace", path: ["items", 0], write: (map, value) => state(map).at(["items"]).asArray()!.array.replace(0, value) },
  { name: "array splice", path: ["items", 0], write: (map, value) => state(map).at(["items"]).asArray()!.array.splice(0, 1, value) },
  { name: "staged array replace", path: ["items", 0], write: (map, value) => map.batch(tx => tx.data.must("state").at(["items"]).asArray()!.array.replace(0, value)) },
  { name: "staged array splice", path: ["items", 0], write: (map, value) => map.batch(tx => tx.data.must("state").at(["items"]).asArray()!.array.splice(0, 1, value)) },
];

export async function livemap_setter_exact_order_cases(check: Check): Promise<void> {
  await check("initial Library admission retains descriptor order in graph and serialized capture", () => {
    const input = ordered_input(), expected = admit_projected_value(input);
    const map = hsonLiveMap.fromLibraries({ state: { data: input } });
    assert.deepEqual(state(map).at([]).asObject()!.object.keys(), ["10", "2"]);
    exact(map, [], expected);
    assert.match(emit_ordered_json(expected), /^\{\s*"10": -0,\s*"2": \{\s*"10":/);
  });

  for (const route of routes) await check(`${route.name} preserves exact order and detached immutable values`, () => {
    const map = create(), input = ordered_input(), expected = admit_projected_value(input);
    const commit = route.write(map, input);
    assert.ok(commit); assert.equal(map.rev, 1);
    assert.deepEqual(state(map).at(route.path).asObject()!.object.keys(), ["10", "2"]);
    exact(map, route.path, expected);
    input["10"] = 99; input["2"] = { changed: true };
    exact(map, route.path, expected);
    state(map).at(["spare"]).set(1);
    exact(map, route.path, expected);
    assert.equal(map.rev, 2);
  });

  await check("root replacement preserves order while constructive set retains siblings", () => {
    const expected = admit_projected_value(ordered_input());
    for (const staged of [false, true]) {
      const map = hsonLiveMap.fromLibraries({ state: { data: {} } });
      if (staged) map.batch(tx => tx.data.must("state").at([]).replace(ordered_input()));
      else state(map).at([]).replace(ordered_input());
      exact(map, [], expected);
      assert.deepEqual(state(map).at([]).asObject()!.object.keys(), ["10", "2"]);
      const patch = new Proxy({ "10": 10, "2": 2 }, { ownKeys: () => ["10", "2"] });
      state(map).at([]).set({ retained: true });
      if (staged) map.batch(tx => tx.data.must("state").at([]).set(patch)); else state(map).at([]).set(patch);
      assert.deepEqual(state(map).at([]).asObject()!.object.keys(), ["10", "2", "retained"]);
      assert.equal(state(map).snap(["retained"]), true);
    }
  });

  await check("setters retain ordinary string values and factory-owned exact carrier identity", () => {
    for (const staged of [false, true]) {
      const map = create(), owner = internal_livemap_aggregate_authority(map), identity = owner.libraries()[0]!;
      for (const text of ['{"10":10,"2":2}', "<'10' 10 '2' 2>", "42", "null", "雪"]) {
        if (staged) map.batch(tx => tx.data.must("state").at(["value"]).replace(text));
        else state(map).at(["value"]).replace(text);
        assert.equal(state(map).snap(["value"]), text);
      }
      const value = admit_projected_value(ordered_input());
      if (staged) map.batch(tx => Reflect.apply(tx.data.must("state").at(["value"]).replace, undefined, [value]));
      else Reflect.apply(state(map).at(["value"]).replace, undefined, [value]);
      // Installed reads now project the graph; authentic input identity remains a carrier contract.
      assert.equal(must_ordered_projected_value(value, []), value);
      assert.equal(emit_ordered_json(owner.projectData(identity, ["value"])!), emit_ordered_json(value));
      exact(map, ["value"], value);
    }
  });

  await check("staged setters capture before caller mutation, revocation and deferred planning", async () => {
    const map = create(), owner = internal_livemap_aggregate_authority(map);
    const source = ordered_input(), expected = admit_projected_value(source);
    let descriptors = 0, gets = 0;
    const { proxy, revoke } = Proxy.revocable(source, {
      get() { gets++; throw new Error("Caller property get must not run."); },
      getOwnPropertyDescriptor(target, key) { descriptors++; return Reflect.getOwnPropertyDescriptor(target, key); },
    });
    const staged = make_livemap_staged_writer(owner);
    staged.writer.data.must("state").at(["value"]).replace(proxy);
    const count = descriptors; assert.equal(count, 2);
    source["10"] = 99; source["2"] = null; revoke();
    await Promise.resolve();
    staged.close();
    const writes = staged.writes();
    owner.commit(writes);
    assert.equal(descriptors, count); assert.equal(gets, 0);
    exact(map, ["value"], expected);
    const read = owner.projectData(owner.libraries()[0]!, ["value"]);
    const queued = writes.find(write => write.kind === "replace");
    assert.ok(queued && queued.kind === "replace");
    assert.equal(emit_ordered_json(read!), emit_ordered_json(must_ordered_projected_value(queued.value, [])));
  });

  await check("legacy path handles pass captured exact values directly to their existing planner capability", () => {
    const empty = admit_projected_value({});
    const sentinel = new Error("Recorded planner input.");
    const unexpected = () => { throw new Error("Unexpected materialized core write."); };
    const core: Parameters<typeof make_livemap_path_handle>[0] = {
      rev: 0, snap: () => ({}), at: unexpected, set: unexpected, replace: unexpected,
      setMany: unexpected, delete: unexpected, feed: unexpected, splice: unexpected, capture: unexpected,
    };
    let captured: readonly LiveMapProjectedPropagationWrite[] = [];
    register_livemap_projected_propagation(core, { read: () => empty, snap: () => ({}), kind: () => "object", keys: () => [], length: () => undefined, arrayRange: () => undefined, feed: () => () => {}, commit(writes) { captured = writes; throw sentinel; } });
    const handle = make_livemap_path_handle(core, ["value"], () => () => {});
    for (const method of ["set", "replace", "update"] as const) {
      const input = ordered_input(), expected = admit_projected_value(input);
      assert.throws(() => method === "update" ? handle.update(() => input) : handle[method](input), error => error === sentinel);
      assert.equal(captured.length, 1);
      const write = captured[0]; assert.ok(write?.kind === "set" || write?.kind === "replace");
      assert.equal(write.kind, method === "replace" ? "replace" : "set");
      assert.deepEqual(write.path, ["value"]);
      assert.equal(emit_ordered_json(write.value), emit_ordered_json(expected)); deeply_frozen(write.value);
      input["10"] = 99; assert.equal(emit_ordered_json(write.value), emit_ordered_json(expected));
    }
  });

  await check("changing descriptors are read once and the captured candidate governs Schema", () => {
    const schema = Hson.schema`<type "data" content <value <array "number"> spare "number">>`;
    for (const staged of [false, true]) for (const first of [1, "invalid"]) {
      const map = hsonLiveMap.fromLibraries({ state: { data: { value: [0], spare: 0 }, schema } });
      const before = map.capture(); let reads = 0, publications = 0;
      map.commits.observe(() => { publications++; });
      const input = new Proxy([0], { get() { throw new Error("No indexed reads."); }, getOwnPropertyDescriptor(target, key) {
        if (key !== "0") return Reflect.getOwnPropertyDescriptor(target, key);
        reads++; return { value: reads === 1 ? first : 2, enumerable: true, configurable: true, writable: true };
      } });
      const run = () => staged ? map.batch(tx => tx.data.must("state").at(["value"]).replace(input)) : state(map).at(["value"]).replace(input);
      if (first === "invalid") { assert.throws(run, /Schema|schema/); assert.deepEqual(map.capture(), before); assert.equal(publications, 0); }
      else { run(); assert.deepEqual(state(map).snap(["value"]), [1]); assert.equal(publications, 1); }
      assert.equal(reads, 1);
    }
  });

  await check("defensive admission rejects hostile values with no hooks, publication or identity changes", () => {
    let hooks = 0;
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { hooks++; return 1; } });
    const toJSON = { toJSON() { hooks++; return {}; } };
    const coercion = { [Symbol.toPrimitive]() { hooks++; return "coerced"; } };
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const carrier = admit_projected_value(ordered_input());
    assert.ok(is_ordered_projected_object(carrier));
    const forged = Object.freeze({ ...carrier });
    const rejected: unknown[] = [new Date(), Object.create({ inherited: true }), accessor, [1, , 2], cycle, NaN, Infinity, -Infinity,
      forged, Object.create(HsonDataValue.prototype), toJSON, coercion, { $_meta: { quid: "000000001" } }, { _hson_root: {} }, { nested: { $_future: 1 } }];
    for (const input of rejected) for (const staged of [false, true]) {
      const map = create(), owner = internal_livemap_aggregate_authority(map);
      const dataIdentity = acquire_projected_identity(state(map), ["value"]);
      const documentIdentity = acquire_document_identity(map.doc.must("page").document, { kind: "path", path: [0] });
      const before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued(), epoch = owner.identityEpoch().current();
      assert.ok(issued.size >= 2);
      let commits = 0, watches = 0;
      map.commits.observe(() => { commits++; }); state(map).at([]).watch(() => { watches++; });
      assert.throws(() => {
        if (staged) map.batch(tx => {
          tx.data.must("state").at(["spare"]).set(9);
          tx.doc.must("page").at([0]).asElement()!.attrs.set("title", "changed");
          Reflect.apply(tx.data.must("state").at(["value"]).replace, undefined, [input]);
        });
        else Reflect.apply(state(map).at(["value"]).replace, undefined, [input]);
      });
      assert.deepEqual(owner.captureSemanticCheckpoint(), before);
      assert.equal(owner.identityEpoch().current(), epoch); assert.equal(owner.identityEpoch().issued(), issued);
      assert.equal(dataIdentity.active, true); assert.equal(documentIdentity.active, true);
      assert.equal(map.rev, 0); assert.equal(commits, 0); assert.equal(watches, 0);
    }
    assert.equal(hooks, 0);
  });

  await check("late staged Schema failure rolls back exact Data and Document candidates together", () => {
    const schema = Hson.schema`<type "data" content <value "any" spare "number">>`;
    const map = hsonLiveMap.fromLibraries({ state: { data: { value: {}, spare: 0 }, schema }, page: { document: '<main title="old"/>' } });
    const owner = internal_livemap_aggregate_authority(map), before = owner.captureSemanticCheckpoint(), ledger = owner.identityEpoch().issued();
    let publications = 0; map.commits.observe(() => { publications++; });
    assert.throws(() => map.batch(tx => {
      tx.data.must("state").at(["value"]).replace(ordered_input());
      tx.doc.must("page").at([0]).asElement()!.attrs.set("title", "changed");
      Reflect.apply(tx.data.must("state").at(["spare"]).set, undefined, ["invalid"]);
    }), /Schema|schema/);
    assert.deepEqual(owner.captureSemanticCheckpoint(), before); assert.equal(owner.identityEpoch().issued(), ledger);
    assert.equal(map.rev, 0); assert.equal(publications, 0);
  });

  await check("Locus staged replacement and Echo replay retain exact captured order and reject atomically", async () => {
    const locus = hsonLiveMap.locus.create({ state: { data: { value: {}, spare: 0 }, access: "shared" } }, {
      defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }),
    });
    const toServer = new Set<(raw: string) => void>(), toClient = new Set<(raw: string) => void>();
    const client: LocusWebSocketLike = {
      send(raw) { for (const listener of toServer) listener(raw); }, close() {},
      onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; }, onClose() { return () => {}; },
    };
    const server: LocusWebSocketLike = {
      send(raw) { for (const listener of toClient) listener(raw); }, close() {},
      onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; }, onClose() { return () => {}; },
    };
    const detach = bind_locus_websocket(locus, server);
    const echo = create_echo_aggregate_client_internal({ transport: test_echo_transport(client), logicalMapId: locus.logicalMapId });
    try {
      await echo.connect(); assert.ok(echo.map);
      const source = ordered_input(), expected = admit_projected_value(source);
      const { proxy, revoke } = Proxy.revocable(source, {});
      await locus.stage(tx => {
        tx.data.must("state").at(["value"]).replace(proxy);
        source["10"] = 99; source["2"] = null; revoke();
        tx.data.must("state").at(["spare"]).set(1);
      });
      const equal = async () => {
        for (let turn = 0; echo.lastAppliedRev !== locus.rev && turn < 50; turn++) await new Promise<void>(resolve => setTimeout(resolve, 0));
        assert.equal(echo.lastAppliedRev, locus.rev);
        assert.equal(locus.data.must("state").at(["value"]).hson(), hson_data_text_from_value(expected));
        const authorityValue = ordered_projected_value_at(projected_value_from_hson_node(locus.data.must("state").root()), ["value"]);
        assert.ok(authorityValue); assert.equal(emit_ordered_json(authorityValue), emit_ordered_json(expected));
        exact(echo.map!, ["value"], expected);
      };
      await equal(); assert.equal(locus.rev, 1);
      const before = echo.map.capture(), authorityBefore = locus.data.must("state").root();
      let reads = 0, publications = 0; locus.commits.observe(() => { publications++; });
      const getter = Object.defineProperty({}, "value", { enumerable: true, get() { reads++; return 1; } });
      await assert.rejects(locus.stage(tx => {
        tx.data.must("state").at(["spare"]).set(9);
        tx.data.must("state").at(["value"]).replace(getter);
      }));
      await equal(); assert.equal(reads, 0); assert.equal(publications, 0); assert.equal(locus.rev, 1);
      assert.deepEqual(locus.data.must("state").root(), authorityBefore); assert.deepEqual(echo.map.capture(), before);
    } finally { echo.disconnect(); detach(); locus.dispose(); }
  });
}

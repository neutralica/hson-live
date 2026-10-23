import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import type { JsonValue } from "../src/core/types.ts";
import type { LiveMapDataLibrary, LiveMapCommit } from "../src/types/livemap.types.ts";
import type { LocusWebSocketLike } from "../src/types/locus.types.ts";
import { is_ordered_projected_value } from "../src/core/ordered-projected-value.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { projected_value_from_hson_node } from "../src/core/projected-value-graph.ts";
import { collection_commands, type CollectionCommand } from "../src/api/livemap/livemap.collection-command.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import { create_echo_aggregate_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.data-ownership",
  title: "LiveMap Data ownership and candidate coherence",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "ownership", "admission", "aggregate", "locus", "echo"]),
});

const events = create_test_event_emitter("livemap.data-ownership");
let checks = 0;
async function check(name: string, run: () => unknown): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", String(error).slice(0, 1_000));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

const schema = Hson.schema`<type "data" content "any">`;
const create = () => hsonLiveMap.fromLibraries({
  state: { data: { items: [[]], other: 0, nested: { value: [] } }, schema },
});

function canonical(state: Pick<LiveMapDataLibrary, "root"> & { snap: () => unknown }): JsonValue {
  const value = materialize_projected_value(projected_value_from_hson_node(state.root()));
  assert.deepEqual(state.snap(), value);
  return value;
}

const routes: ReadonlyArray<readonly [string, (state: LiveMapDataLibrary, input: JsonValue) => unknown]> = [
  ["set", (state, input) => state.at(["items"]).set(input)],
  ["replace", (state, input) => state.at(["items"]).replace(input)],
  ["object.setKey", (state, input) => state.at([]).asObject()!.object.setKey("items", input)],
  ["object.setMany", (state, input) => state.at([]).asObject()!.object.setMany({ items: input })],
  ["array.push", (state, input) => state.at(["items"]).asArray()!.array.push(input)],
  ["array.pushMany", (state, input) => state.at(["items"]).asArray()!.array.pushMany([input])],
  ["array.unshift", (state, input) => state.at(["items"]).asArray()!.array.unshift(input)],
  ["array.insert", (state, input) => state.at(["items"]).asArray()!.array.insert(0, input)],
  ["array.replace", (state, input) => state.at(["items"]).asArray()!.array.replace(0, input)],
  ["array.splice", (state, input) => state.at(["items"]).asArray()!.array.splice(0, 1, input)],
  ["nested object", (state, input) => state.at(["nested"]).asObject()!.object.setKey("value", input)],
  ["nested array", (state, input) => state.at(["items", 0]).asArray()!.array.push(input)],
];

for (const [name, write] of routes) {
  await check(`${name} owns nested ordinary and frozen inputs across later writes`, () => {
    for (const frozen of [false, true]) {
      const map = create(), state = map.data.must("state");
      const source = { deep: [{ value: -0 }] };
      const input: JsonValue = frozen ? [source] : source;
      if (frozen) Object.freeze(input);
      const publications: LiveMapCommit[] = [];
      map.commits.observe(commit => publications.push(commit));
      write(state, input);
      const accepted = canonical(state), firstPublication = structuredClone(publications[0]);
      assert.ok(accepted !== null && typeof accepted === "object" && !Array.isArray(accepted));
      source.deep[0]!.value = 9;
      source.deep.push({ value: 10 });
      assert.deepEqual(canonical(state), accepted);
      const commit = state.at(["other"]).set(1);
      assert.deepEqual(commit.operations.map(entry => entry.operation.path), [["other"]]);
      assert.deepEqual(canonical(state), { ...accepted, other: 1 });
      assert.deepEqual(publications[0], firstPublication);
      assert.equal(commit.prevRev, 1);
      assert.equal(commit.rev, map.rev);
      assert.equal(map.rev, 2);
      assert.equal(publications.length, 2);
    }
  });

  await check(`${name} rejects frozen accessors without evaluation or state changes`, () => {
    for (const result of ["successive", "second NaN", "NaN", "Infinity", "throw"] as const) {
      const map = create(), state = map.data.must("state");
      let reads = 0, publications = 0, watches = 0;
      const input: number[] = Object.defineProperty([], "0", {
        enumerable: true,
        get() {
          reads += 1;
          if (result === "throw") throw new Error("external getter");
          if (result === "NaN" || (result === "second NaN" && reads === 2)) return NaN;
          if (result === "Infinity") return Infinity;
          return result === "successive" ? reads : 1;
        },
      });
      Object.freeze(input);
      const before = map.capture();
      map.commits.observe(() => { publications += 1; });
      state.at([]).watch(() => { watches += 1; });
      assert.throws(() => write(state, input), { reasonCode: "ACCESSOR_PROPERTY" });
      assert.equal(reads, 0);
      assert.deepEqual(map.capture(), before);
      assert.equal(map.rev, 0);
      assert.equal(publications, 0);
      assert.equal(watches, 0);
      state.at(["other"]).set(1);
      assert.equal(map.rev, 1);
      assert.equal(publications, 1);
      assert.equal(watches, 1);
      assert.equal(reads, 0);
    }
  });
}

await check("custom array iteration is rejected without running it", () => {
  const map = create(), state = map.data.must("state");
  let iterations = 0;
  const input = Object.defineProperty([1], Symbol.iterator, {
    value: function* () { iterations += 1; yield 2; },
  });
  Object.freeze(input);
  const before = map.capture();
  assert.throws(() => state.at([]).asObject()!.object.setKey("items", input), { reasonCode: "SYMBOL_KEY" });
  assert.equal(iterations, 0);
  assert.equal(map.rev, 0);
  assert.deepEqual(map.capture(), before);
  state.at(["other"]).set(1);
  assert.deepEqual(state.snap(["items"]), [[]]);
});

await check("frozen Proxy arrays detach, publish the captured value and survive revocation", () => {
  const map = create(), state = map.data.must("state");
  let gets = 0, reflections = 0;
  const input = [-0, 1];
  Object.freeze(input);
  const { proxy, revoke } = Proxy.revocable(input, {
    get() { gets += 1; throw new Error("caller get"); },
    getOwnPropertyDescriptor(target, key) {
      reflections += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const watches: unknown[] = [], publications: LiveMapCommit[] = [];
  state.at(["items"]).watch(value => watches.push(value));
  map.commits.observe(commit => publications.push(commit));
  const commit = state.at([]).asObject()!.object.setKey("items", proxy);
  const operation = commit.operations[0]!.operation;
  assert.equal(operation.kind, "set");
  if (operation.kind !== "set") throw new Error("Expected set operation.");
  assert.deepEqual(operation.prev, [[]]);
  assert.deepEqual(operation.next, [-0, 1]);
  assert.deepEqual(watches, [[-0, 1]]);
  assert.deepEqual(publications[0]!.operations, commit.operations);
  assert.deepEqual(state.snap(["items"]), operation.next);
  const capturedReflections = reflections;
  revoke();
  assert.deepEqual(canonical(state), { items: [-0, 1], other: 0, nested: { value: [] } });
  state.at(["other"]).set(1);
  assert.deepEqual(state.snap(["items"]), [-0, 1]);
  assert.equal(map.rev, 2);
  assert.equal(watches.length, 1);
  assert.equal(gets, 0);
  assert.equal(reflections, capturedReflections);
});

await check("changing valid Proxy descriptors are captured once for graph, schema and operations", () => {
  const finiteSchema = Hson.schema`<type "data" content <items <array "number"> other "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { items: [], other: 0 }, schema: finiteSchema } });
  const state = map.data.must("state");
  let reads = 0;
  const input = new Proxy([0], {
    get() { throw new Error("No indexed reads or iteration allowed."); },
    getOwnPropertyDescriptor(target, key) {
      return key === "0" ? { value: ++reads, enumerable: true, writable: true, configurable: true }
        : Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const watches: unknown[] = [];
  state.at(["items"]).watch(value => watches.push(value));
  const commit = state.at([]).asObject()!.object.setKey("items", input);
  const operation = commit.operations[0]!.operation;
  if (operation.kind !== "set") throw new Error("Expected set operation.");
  assert.deepEqual(operation.next, [1]);
  assert.deepEqual(canonical(state), { items: [1], other: 0 });
  assert.deepEqual(watches, [[1]]);
  assert.equal(reads, 1);
  state.at(["other"]).set(1);
  assert.deepEqual(canonical(state), { items: [1], other: 1 });
  assert.equal(reads, 1);
  assert.equal(map.rev, 2);
});

await check("captured collection commands own arguments before deferred planning", () => {
  const map = create(), state = map.data.must("state");
  const aggregate = internal_livemap_aggregate_authority(map);
  const identity = aggregate.libraries()[0]!;
  const commands: CollectionCommand[] = [];
  const source = { value: 1 };
  const api = collection_commands(command => { commands.push(command); });
  const input = [source];
  Object.freeze(input);
  api.object.setKey("items", input);
  source.value = 2;
  assert.ok(is_ordered_projected_value(commands[0]!.args[1]));
  const commit = aggregate.commit(commands.map(command => ({
    kind: "collection", target: aggregate.target(identity, []), command,
  })));
  assert.deepEqual(canonical(state), { items: [{ value: 1 }], other: 0, nested: { value: [] } });
  const evidence = commit.operations[0]!.projected;
  if (evidence?.kind !== "set") throw new Error("Expected carrier-native set evidence.");
  assert.ok(is_ordered_projected_value(evidence.next));
  assert.equal(evidence.next, commands[0]!.args[1]);
  assert.deepEqual(materialize_projected_value(evidence.next), state.snap(["items"]));
  source.value = NaN;
  state.at(["other"]).set(1);
  assert.deepEqual(state.snap(["items"]), [{ value: 1 }]);
  const replacement = aggregate.commit([{
    kind: "replace", target: aggregate.target(identity, ["items"]), value: [3],
  }]);
  const installed = replacement.operations[0]!.projected;
  if (installed?.kind !== "replace") throw new Error("Expected carrier-native replacement evidence.");
  // The next mutation reads the exact carrier installed by the earlier commit.
  assert.equal(installed.prev, evidence.next);
  assert.deepEqual(materialize_projected_value(installed.prev), [{ value: 1 }]);
  assert.deepEqual(materialize_projected_value(installed.next), state.snap(["items"]));
  assert.deepEqual(canonical(state), { items: [3], other: 1, nested: { value: [] } });
});

await check("aggregate commands capture at enqueue time and late failures remain atomic", () => {
  const map = create(), state = map.data.must("state");
  const source = { value: 1 };
  const input = [source];
  Object.freeze(input);
  const commit = map.batch(writer => {
    const draft = writer.data.must("state");
    draft.at([]).asObject()!.object.setKey("items", input);
    source.value = 7;
    draft.at(["other"]).set(1);
  });
  assert.equal(commit.rev, 1);
  assert.equal(commit.operations.length, 2);
  assert.deepEqual(state.snap(["items"]), [{ value: 1 }]);
  const before = map.capture();
  let publications = 0, watches = 0;
  map.commits.observe(() => { publications += 1; });
  state.at([]).watch(() => { watches += 1; });
  const invalid = [NaN];
  Object.freeze(invalid);
  assert.throws(() => map.batch(writer => {
    const draft = writer.data.must("state");
    draft.at(["other"]).set(9);
    draft.at(["items"]).asArray()!.array.push(invalid);
  }));
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 1);
  assert.equal(publications, 0);
  assert.equal(watches, 0);
  state.at(["other"]).set(2);
  assert.deepEqual(state.snap(["items"]), [{ value: 1 }]);
  assert.equal(map.rev, 2);
});

await check("schema rejects the captured candidate before any installation or publication", () => {
  const map = hsonLiveMap.fromLibraries({ state: {
    data: { items: [1], other: 0 },
    schema: Hson.schema`<type "data" content <items <array "number"> other "number">>`,
  } });
  const state = map.data.must("state"), before = map.capture();
  let reads = 0, publications = 0;
  map.commits.observe(() => { publications += 1; });
  const input = new Proxy([0], {
    getOwnPropertyDescriptor(target, key) {
      if (key !== "0") return Reflect.getOwnPropertyDescriptor(target, key);
      reads += 1;
      return { value: reads === 1 ? "bad" : 2, enumerable: true, writable: true, configurable: true };
    },
  });
  assert.throws(() => state.at([]).asObject()!.object.setKey("items", input));
  assert.equal(reads, 1);
  assert.equal(publications, 0);
  assert.equal(map.rev, 0);
  assert.deepEqual(map.capture(), before);
  state.at(["other"]).set(1);
  assert.deepEqual(state.snap(["items"]), [1]);
});

await check("Locus and Echo keep complete canonical Data equal at matching authority revisions", async () => {
  const locus = hsonLiveMap.locus.create({ state: {
    data: { items: [], other: 0 }, schema, access: "shared",
  } }, { defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
  const toServer = new Set<(raw: string) => void>(), toClient = new Set<(raw: string) => void>();
  const client: LocusWebSocketLike = {
    send(raw) { for (const listener of toServer) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusWebSocketLike = {
    send(raw) { for (const listener of toClient) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const detach = bind_locus_websocket(locus, server);
  const echo = create_echo_aggregate_client_internal({ transport: test_echo_transport(client), logicalMapId: locus.logicalMapId });
  try {
    await echo.connect();
    assert.ok(echo.map);
    const authority = locus.data.must("state"), replica = echo.map.data.must("state");
    const equal = async () => {
      for (let turn = 0; echo.lastAppliedRev !== locus.rev && turn < 50; turn += 1) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      assert.equal(echo.lastAppliedRev, locus.rev);
      assert.deepEqual(canonical(replica), canonical(authority));
    };
    let reads = 0;
    const getter = Object.defineProperty([], "0", { enumerable: true, get() { return ++reads; } });
    Object.freeze(getter);
    await assert.rejects(async () => { await authority.at([]).asObject()!.object.setKey("items", getter); });
    assert.equal(reads, 0);
    assert.equal(locus.rev, 0);
    await equal();
    const source = { value: -0 };
    const input = [source];
    Object.freeze(input);
    const { proxy, revoke } = Proxy.revocable(input, {});
    await authority.at([]).asObject()!.object.setKey("items", proxy);
    await equal();
    assert.equal(locus.rev, 1);
    source.value = 2;
    revoke();
    await authority.at(["other"]).set(1);
    await equal();
    assert.equal(locus.rev, 2);
    assert.deepEqual(authority.snap(), { items: [{ value: -0 }], other: 1 });
    await authority.at(["items"]).asArray()!.array.replace(0, { value: 3 });
    await equal();
    assert.equal(locus.rev, 3);
    assert.deepEqual(replica.snap(), { items: [{ value: 3 }], other: 1 });
  } finally { echo.disconnect(); detach(); locus.dispose(); }
});

process.stdout.write(`1..${checks}\n`);
events.terminal("pass");

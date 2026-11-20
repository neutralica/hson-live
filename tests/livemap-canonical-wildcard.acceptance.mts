import assert from "node:assert/strict";
import { register } from "node:module";
import { inspect } from "node:util";
import type { LiveMapProjectedDataOp } from "../src/api/livemap/livemap.transport.ts";
import { encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { CANONICAL_SCHEMA_FORMAT } from "../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-canonical-wildcard",
  title: "LiveMap canonical object wildcard",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "canonical-schema", "mutation", "replay"]),
});

const events = create_test_event_emitter("livemap-canonical-wildcard");
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try {
    await run();
    events.case_end(name, "pass");
    console.log(`ok - ${name}`);
  } catch (error) {
    events.diagnostic(name, "assertion", String(error).slice(0, 1000));
    events.case_end(name, "fail");
    events.terminal("fail");
    throw error;
  }
}

const fixture = verify_canonical_schema_graph({
  format: CANONICAL_SCHEMA_FORMAT,
  capabilities: { projectedRoot: 0 },
  nodes: [
    { kind: "projected-object", exact: false, properties: [["id", 1], ["flex", 3]], additional: 4 },
    { kind: "projected-optional", base: 2 },
    { kind: "projected-string" },
    { kind: "projected-optional", base: 4 },
    { kind: "projected-object", exact: true, properties: [["items", 5], ["unique", 8]] },
    { kind: "projected-array", item: 6 },
    { kind: "projected-refinement", base: 7, rule: { kind: "number-lower-bound", inclusive: true, value: 0 } },
    { kind: "projected-number" },
    { kind: "projected-refinement", base: 9, rule: { kind: "array-unique-by-cases", by: "key",
      cases: [["left", ["L"]], ["right", ["R"]], ["a", ["K"]], ["b", ["K"]]] } },
    { kind: "projected-array", item: 10 },
    { kind: "projected-object", exact: true, properties: [["key", 2]] },
  ],
});
assert.ok(fixture.ok);

// Bind one authored placeholder to a verified graph in this test process.
// Snapshot restoration recompiles that placeholder through the same binding.
const compiler = new URL("../src/internal/hson-schema/compiler.ts", import.meta.url).href;
const codec = new URL("../src/internal/canonical-schema/encode-hson.ts", import.meta.url).href;
const testCompiler = "data:text/javascript," + encodeURIComponent(`
  import { compile_hson_schema as compile } from ${JSON.stringify(compiler)};
  import { decode_canonical_schema_graph_hson as decode } from ${JSON.stringify(codec)};
  const fixture = decode(${JSON.stringify(encode_canonical_schema_graph_hson(fixture.graph))});
  if (!fixture.ok) throw new Error("Invalid test graph");
  export function compile_hson_schema(source) {
    const result = compile(source);
    return result.ok && result.value.definitions.some(definition => definition.name === "CanonicalWildcardFixture")
      ? { ok: true, value: Object.freeze({ ...result.value, graph: fixture.graph }) }
      : result;
  }
`);
const handleModule = new URL("../src/api/schema/hson-schema.ts", import.meta.url).href;
const loader = "data:text/javascript," + encodeURIComponent(`
  let handleModule, testCompiler;
  export function initialize(fixture) {
    ({ handleModule, testCompiler } = fixture);
  }
  export function resolve(specifier, context, next) {
    if (context.parentURL === handleModule && specifier === "../../internal/hson-schema/compiler.js") {
      return { url: testCompiler, shortCircuit: true };
    }
    return next(specifier, context);
  }
`);
register(loader, { data: { handleModule, testCompiler } });
const { HsonSchema, compiled_hson_schema_of } = await import("../src/api/schema/hson-schema.ts");
const { hsonLiveMap } = await import("../src/index.ts");
const { HsonSchemaError } = await import("../src/api/livemap/livemap.error.ts");
const { internal_livemap_aggregate_authority: authority } = await import("../src/api/livemap/livemap.internal.ts");
const { make_portable_aggregate_commit, make_portable_aggregate_snapshot } = await import("../src/api/livemap/livemap.hosted.ts");
const { encode_livemap_replay_transport } = await import("../src/api/livemap/livemap.transport.ts");
const { create_persistent_locus_hosted_aggregate_internal, load_persistent_locus_hosted_aggregate_internal } =
  await import("../src/api/locus/locus.aggregate.persistence.ts");
const { LocusPersistenceError } = await import("../src/api/locus/locus.persistence.error.ts");
const { MemoryCheckpointAdapter } = await import("./helpers/memory-checkpoint-adapter.mts");

const schema = HsonSchema.fromHson('<type "data" defs <CanonicalWildcardFixture "boolean"> root "any">');
assert.deepEqual(compiled_hson_schema_of(schema).graph, fixture.graph);
const value = { items: [1, 2], unique: [{ key: "left" }, { key: "right" }] };
const makeMap = () => hsonLiveMap.fromLibraries({ state: { json: { id: "a", flex: value, x: value }, schema } });
const operation = (projected: LiveMapProjectedDataOp) => ({
  library: "state", domain: "data" as const, kind: projected.kind, ...encode_livemap_replay_transport([projected]),
});
const validWrite = operation({ kind: "set", path: ["x", "items", 1], prev: 2, next: 7 });
const invalidWrite = operation({ kind: "set", path: ["x", "items", 0], prev: 1, next: -1 });
const isSchemaFailure = (path: readonly (string | number)[], opIndex?: number, relatedPath?: readonly (string | number)[]) =>
  (error: unknown): boolean => {
    assert.ok(error instanceof HsonSchemaError, inspect(error));
    assert.equal(error.code, "SCHEMA_VALIDATION");
    assert.deepEqual(error.path, path);
    assert.equal(error.opIndex, opIndex);
    assert.deepEqual(error.issues[0]?.relatedPath, relatedPath);
    return true;
  };

await check("initial admission, insertion, replacement and rename use the destination Schema", () => {
  assert.throws(() => hsonLiveMap.fromLibraries({ state: { json: { x: false }, schema } }), isSchemaFailure(["x"]));
  const map = makeMap();
  const state = map.data.must("state");
  const root = state.at([]).asObject()!.object;
  root.setKey("extra", value);
  state.at(["extra"]).replace({ ...value, items: [-0] });
  assert.ok(Object.is(state.at(["extra", "items", 0]).snap(), -0));
  root.renameKey("flex", "moved");
  root.renameKey("moved", "flex");
  assert.deepEqual(state.at(["flex"]).snap(), value);

  let published = 0;
  const stop = map.commits.observe(() => { published += 1; });
  const owner = authority(map), id = owner.libraries()[0]!;
  const before = owner.root(id), rev = state.rev;
  try {
    assert.throws(() => root.setKey("bad", 1), isSchemaFailure(["bad"]));
    assert.throws(() => state.at(["extra"]).replace({ items: [] }), isSchemaFailure(["extra", "unique"]));
    assert.throws(() => root.renameKey("id", "wrong"), isSchemaFailure(["wrong"]));
    assert.throws(() => root.renameKey("extra", "id"), isSchemaFailure(["id"]));
    assert.equal(owner.root(id), before);
    assert.equal(state.rev, rev);
    assert.equal(published, 0);
  } finally { stop(); }
});

for (const route of ["hosted", "durable"] as const) {
  await check(`${route} replay attributes independent leaves and leaves composite failures unindexed`, () => {
    const sender = authority(makeMap());
    const snapshot = make_portable_aggregate_snapshot(sender.captureHosted());
    const id = sender.libraries()[0]!;
    const accepted = sender.accept(sender.prepare([{ target: sender.target(id, ["x", "items", 1]), kind: "set", value: 7 }])).commit;
    assert.ok(accepted.hosted);
    const valid = make_portable_aggregate_commit(accepted.hosted);
    assert.ok(valid);

    const map = makeMap(), receiver = authority(map);
    receiver.restoreClientHosted(snapshot);
    const state = map.data.must("state");
    const receivedId = receiver.libraries()[0]!;
    const replay = (operations: typeof valid.operations) => {
      if (route === "hosted") receiver.replayClientHosted({ ...valid, operations });
      else receiver.replayDurableHosted({ ...valid, operations });
    };
    const before = receiver.root(receivedId), rev = state.rev;
    let published = 0;
    const stop = map.commits.observe(() => { published += 1; });
    try {
      assert.throws(() => replay([validWrite, invalidWrite]), isSchemaFailure(["x", "items", 0], 1));
      assert.throws(() => replay([
        operation({ kind: "set", path: ["x", "unique", 0, "key"], prev: "left", next: "a" }),
        operation({ kind: "set", path: ["x", "unique", 1, "key"], prev: "right", next: "b" }),
      ]), isSchemaFailure(["x", "unique", 1, "key"], undefined, ["x", "unique", 0, "key"]));
      assert.equal(receiver.root(receivedId), before);
      assert.equal(state.rev, rev);
      assert.equal(published, 0);
      replay(valid.operations);
      assert.equal(state.rev, rev + 1);
      assert.deepEqual(state.at(["x", "items"]).snap(), [1, 7]);
      assert.equal(published, 1);
    } finally { stop(); }
  });
}

await check("checkpoint recovery validates a fixture graph reconstructed on replay", async () => {
  const persistence = new MemoryCheckpointAdapter();
  const host = await create_persistent_locus_hosted_aggregate_internal({ map: makeMap(), persistence });
  const logicalId = host.logicalMapId;
  try { await host.stage(writer => writer.data.must("state").at(["x", "items", 1]).set(7)); }
  finally { host.dispose(); }
  const saved = persistence.state(logicalId);
  assert.ok(saved);
  const record = saved.commits[0];
  assert.ok(record);
  const invalid = { ...saved, commits: [{ ...record, commit: {
    ...record.commit, operationCount: 2, operations: [validWrite, invalidWrite],
  } }] };
  persistence.seed(logicalId, invalid);
  await assert.rejects(load_persistent_locus_hosted_aggregate_internal(logicalId, { persistence }), error => {
    assert.ok(error instanceof LocusPersistenceError);
    assert.equal(error.code, "LOCUS_PERSISTED_STATE_INVALID");
    return isSchemaFailure(["x", "items", 0], 1)(error.cause);
  });
  assert.deepEqual(persistence.state(logicalId), invalid);
  persistence.seed(logicalId, saved);
  const restored = await load_persistent_locus_hosted_aggregate_internal(logicalId, { persistence });
  assert.ok(restored);
  try {
    assert.equal(restored.rev, record.commit.rev);
    assert.deepEqual(restored.map.data.must("state").at(["x", "items"]).snap(), [1, 7]);
  } finally { restored.dispose(); }
});

events.terminal("pass");

import assert from "node:assert/strict";
import test from "node:test";
import { bind_locus_http, decode_ssr_bootstrap, encode_ssr_bootstrap, hsonLiveMap } from "../../src/index.js";
import { HsonSchema, hson_schema_digest, compiled_hson_schema_of } from "../../src/api/schema/hson-schema.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { MemoryCheckpointAdapter } from "../../tests/helpers/memory-checkpoint-adapter.mjs";
import { compile_schema_source } from "./compile-source.js";

test("governed writes, SSR continuation, Echo reconciliation and durable recovery use the authored wildcard", async () => {
  const result = compile_schema_source("<data <object <any <number> 'id' <string>>>>");
  assert.ok(result.ok);
  const schema = HsonSchema.fromHson(result.schema1Source);
  const digest = "095d5e58ed3ed2cb083fe8a57decbb92485a25fe3f0e6d1f3071bb92bb559821";
  const inputs = { state: { json: { id: "a", x: 2 }, schema, access: "shared" },
    page: { document: '<main "Ready"/>', access: "shared" } } as const;
  const map = hsonLiveMap.fromLibraries({ state: { json: inputs.state.json, schema } });
  const state = map.data.must("state");
  const object = state.at([]).asObject()!.object;
  let publications = 0;
  const stop = map.commits.observe(() => { publications++; });
  try {
    object.setKey("added", -0);
    assert.ok(Object.is(state.snap(["added"]), -0));
    const before = map.capture();
    for (const mutation of [() => state.at(["id"]).replace(7), () => state.at(["x"]).replace(false),
      () => object.renameKey("id", "other")]) {
      assert.throws(mutation, HsonSchemaError);
      assert.deepEqual(map.capture(), before);
      assert.equal(publications, 1);
    }
  } finally { stop(); }

  const persistence = new MemoryCheckpointAdapter();
  const logicalMapId = "schema2-wildcard";
  const config = { logicalMapId, persistence, authorizeProjection: () => ({ libraries: ["page", "state"] }) };
  const locus = await hsonLiveMap.locus.resume(inputs, config);
  try {
    const session = await locus.session.create({ libraries: ["page","state"] }, { connection: { principalId: "reader" } });
    const cut = session.now({ html: "page" });
    assert.match(cut.html, /Ready/);
    const decoded = decode_ssr_bootstrap(encode_ssr_bootstrap(cut));
    assert.equal(decoded.kind, "hosted-projection");
    const now = decoded.bootstrap;
    const entry = now.libs.libraries.find(entry => entry.name === "state");
    assert.equal(entry?.schema, schema.toHson());
    assert.equal(entry.schemaDigest, digest);
    const libraries = now.libs.libraries.map(library => library === entry ? { ...entry, schemaDigest: "0".repeat(64) } : library);
    assert.throws(() => encode_ssr_bootstrap({ ...now, libs: { ...now.libs, libraries } }), { code: "SSR_BOOTSTRAP_INPUT_INVALID" });

    await locus.stage(draft => draft.data.must("state").at(["x"]).set(3));
    const binder = bind_locus_http(locus, { endpoint: "/_hson" });
    try {
      const transport = hsonLiveMap.echo.transport.http({ endpoint: "https://fixture.test/_hson",
        fetch: (url, init) => binder.handle(new Request(url, init), { principalId: "reader" }) });
      const echo = await hsonLiveMap.echo.create({ now, credential: session.credential!, transport });
      try {
        assert.equal(echo.sync.strategy, "reconcile");
        assert.equal(echo.sync.appliedRev, locus.rev);
        const replica = echo.data.must("state");
        assert.equal(replica.snap(["x"]), 3);
        const restored = replica.schema.get();
        assert.equal(hson_schema_digest(restored), digest);
        assert.deepEqual(compiled_hson_schema_of(restored).graph, result.compiled.graph);
      } finally { echo.dispose(); }
    } finally { binder.dispose(); }
    await hsonLiveMap.locus.checkpoint(locus);
    await locus.stage(draft => draft.data.must("state").at(["x"]).set(-0));
  } finally { locus.dispose(); }

  const saved = persistence.state(logicalMapId)!;
  assert.equal(saved.commits.length, 1);
  const checkpoint = saved.checkpoint;
  assert.equal(checkpoint.format, "hson-locus-durable-aggregate-checkpoint");
  assert.equal(checkpoint.registry.libraries.find(entry => entry.name === "state")?.schemaDigest, digest);
  const registry = { ...checkpoint.registry, libraries: checkpoint.registry.libraries.map(entry =>
    entry.name === "state" ? { ...entry, schemaDigest: "0".repeat(64) } : entry) };
  const schemaChunk = checkpoint.chunks.find(chunk => chunk.owner === "state" && chunk.part === "schema");
  assert.ok(schemaChunk);
  const chunks = checkpoint.chunks.map(chunk => chunk === schemaChunk ? { ...chunk, sha256: "0".repeat(64) } : chunk);
  for (const corrupt of [{ ...checkpoint, registry }, { ...checkpoint, registryDigest: "0".repeat(64) }, { ...checkpoint, chunks }]) {
    persistence.seed(logicalMapId, { ...saved, checkpoint: corrupt });
    await assert.rejects(hsonLiveMap.locus.resume(inputs, config), { code: "LOCUS_PERSISTED_STATE_INVALID" });
  }
  persistence.seed(logicalMapId, saved);
  const recovered = await hsonLiveMap.locus.resume(inputs, config);
  try {
    const state = recovered.data.must("state");
    assert.ok(Object.is(state.snap(["x"]), -0));
    assert.equal(hson_schema_digest(state.schema.get()), digest);
    const rev = recovered.rev;
    await assert.rejects(recovered.stage(draft => {
      const target = draft.data.must("state");
      target.at(["x"]).set(8);
      target.at(["id"]).set(8);
    }));
    assert.equal(recovered.rev, rev);
    assert.ok(Object.is(state.snap(["x"]), -0));
    assert.equal(persistence.state(logicalMapId)?.commits.length, 1);
  } finally { recovered.dispose(); }
});

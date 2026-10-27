import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.js";
import type { Locus, LocusDefinitions } from "../../src/types/locus.core.types.js";
import { locus_map_internal } from "../../src/internal/governor-maps.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { create_registry_locus_internal } from "../../src/api/locus/locus.registry.js";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.js";
import { MemoryCheckpointAdapter, deferred } from "../helpers/memory-checkpoint-adapter.mts";

const Count = Hson.schema`<type "data" content <count "number">>`;
const components = { button: { kind: "document" as const, document: '<button hson:part @:label "Hello"/>', stylesheet: ':scope{color:red}' } };
const document = '<html <head/> <body <hson-part lib="components" at="button"/>/>/>';
function capture(locus: Locus) {
  const authority = internal_livemap_aggregate_authority(locus_map_internal(locus));
  return { rev: locus.rev, cut: authority.captureSemanticCheckpoint(), registry: authority.hostedRegistry(), identities: authority.libraries(),
    epoch: authority.identityEpoch(), issued: authority.identityEpoch().issued() };
}
async function rejected(locus: Locus, definitions: unknown) {
  const before = capture(locus);
  let observed = 0;
  const stop = locus.commits.observe(() => observed++);
  try {
    await assert.rejects(locus.admit(definitions as never));
    const after = capture(locus);
    assert.deepEqual(after.cut, before.cut);
    assert.equal(after.rev, before.rev);
    assert.equal(after.registry, before.registry);
    assert.deepEqual(after.identities, before.identities);
    assert.equal(after.epoch.owner, before.epoch.owner);
    assert.equal(after.issued, before.issued);
    assert.equal(observed, 0);
  } finally { stop(); }
}
export async function flat_library_definition_cases() {
  for (const name of ["a/b", "/a", "a/", "a//b"]) {
    for (const definition of [{ data: 1 }, { document: "<main/>" }, { parts: components }]) {
      assert.throws(() => hsonLiveMap.fromLibraries({ [name]: definition }), /Library name .*must not contain/);
      assert.throws(() => hsonLiveMap.locus.create({ [name]: definition }), /Library name .*must not contain/);
    }
    const map = hsonLiveMap.fromLibraries({ valid: { data: 1 } });
    const before = map.capture();
    assert.throws(() => map.addLibraries({ earlier: { data: 1 }, [name]: { data: 2 } }), /Library name .*must not contain/);
    assert.deepEqual(map.capture(), before);
    assert.throws(() => map.data(name), /Library name .*must not contain/);
    const locus = hsonLiveMap.locus.create({ valid: { data: 1 } });
    await rejected(locus, { earlier: { data: 1 }, [name]: { data: 2 } });
    locus.dispose();
  }
  const literalNames = hsonLiveMap.fromLibraries({ "a\\b": { data: 1 }, "a%2Fb": { data: 2 } });
  assert.equal(literalNames.data.must("a\\b").snap(), 1);
  assert.equal(literalNames.data.must("a%2Fb").snap(), 2);
  const minimal = hsonLiveMap.locus.create({ first: { data: 1 } });
  assert.equal(await minimal.admit({ page: { document: "<main/>" } }), undefined);
  assert.equal(minimal.doc.must("page").render(), "<main></main>");
  assert.equal("addLibraries" in minimal, false);
  assert.equal("batch" in minimal.admit, false);
  minimal.dispose();

  for (const reverse of [false, true]) for (const dynamic of [false, true]) {
    const entries = [["page", { document, stylesheet: "body{margin:0}", access: "shared" }], ["components", { parts: components }]] as const;
    const definitions: LocusDefinitions = Object.fromEntries(reverse ? [...entries].reverse() : entries);
    const locus = hsonLiveMap.locus.create(dynamic ? {} : definitions, {
      authorizeProjection: () => ({ libraries: ["page", "components", "private", "denied"] }),
    });
    try {
      if (dynamic) await locus.admit(definitions);
      assert.equal(locus.rev, dynamic ? 1 : 0);
      assert.match(locus.doc.must("page").render(), /Hello/);
      assert.match(locus.doc.must("page").render(), /margin:0/);
      assert.match(locus.doc.must("page").render(), /color:red/);
      assert.deepEqual(locus.parts.must("components").snap(), components);
      await locus.admit({ private: { data: { count: 1 }, schema: Count }, denied: { data: 2, access: "private" } });
      assert.equal(locus.data.must("private", Count).snap(["count"]), 1);
      const session = await locus.session.create({ libraries: ["page", "components", "private", "denied"] });
      assert.deepEqual(session.now().libs.libraries.map(entry => entry.name), ["page"]);
      assert.equal(session.now().libs.writableDocuments.length, 0);
    } finally { locus.dispose(); }
  }
  const noGrant = hsonLiveMap.locus.create({ page: { document: "<main/>", access: "shared" } });
  assert.equal((await noGrant.session.create({ libraries: ["page"] })).now().libs.libraries.length, 0);
  noGrant.dispose();

  const names = ["__proto__", "constructor", "toString", "prototype", "then", "must", "private", "shared", "local", "schema", "actions"];
  const keyed = Object.create({ inherited: { data: 99 } });
  for (const [index, name] of names.entries()) Object.defineProperty(keyed, name, { value: { data: index }, enumerable: index % 2 === 0 });
  const collisions = hsonLiveMap.locus.create(keyed);
  try {
    names.forEach((name, index) => assert.equal(collisions.data.must(name).snap(), index));
    assert.equal(collisions.data("inherited"), undefined);
    assert.equal(Object.hasOwn(Object.prototype, "data"), false);
    await rejected(collisions, { earlier: { data: 1 }, constructor: { data: 2 } });
    await rejected(collisions, new Proxy({ repeat: { data: 1 } }, { ownKeys: () => ["repeat", "repeat"] }));
  } finally { collisions.dispose(); }

  const locus = hsonLiveMap.locus.create({ state: { data: { count: 0 }, schema: Count } });
  const quid = parse_hson_exact_runtime("<main @000000123/>", { allowTopLevelDocumentText: true });
  for (const invalid of [
    { data: 1, document: "<main/>" }, { parts: {}, document: "<main/>" }, { data: undefined, document: "<main/>" }, {},
    { parts: { bad: { kind: "data", document: "<p/>" } } }, { parts: {}, schema: Count },
    { data: { count: "bad" }, schema: Count }, { document: "<main/>", schema: Count }, { data: 1, schema: {} },
    { document: '<main <hson-part lib="missing" at="button"/>/>' }, { document: '<main <hson-part/>/>' },
    { document: quid }, { document: "<main/>", stylesheet: 42 }, { data: 1, stylesheet: "main{}" },
    { data: 1, access: "local" }, { data: 1, access: undefined }, { data: 1, ownership: "shared" },
  ]) {
    assert.throws(() => hsonLiveMap.locus.create({ earlier: { data: 1 }, invalid } as never));
    await rejected(locus, { earlier: { data: 1 }, invalid });
    assert.equal(locus.data("earlier"), undefined);
  }
  await rejected(locus, { [Symbol("hidden")]: { data: 1 } });
  await rejected(locus, {});
  let nested: Promise<void> | undefined;
  await locus.stage(() => { nested = assert.rejects(locus.admit({ nested: { data: 1 } }), /forbidden/i); });
  await nested;
  assert.equal(locus.data("nested"), undefined);
  const pending = locus.admit({ stale: { data: 1 } });
  locus.dispose();
  await assert.rejects(pending, /closed|disposed/i);
  await assert.rejects(locus.admit({ disposed: { data: 1 } }), /closed|disposed/i);

  assert.throws(() => hsonLiveMap.locus.create({}, { unsupported: true } as never), /unsupported/);
  assert.throws(() => hsonLiveMap.locus.create({}, [] as never), /configuration/);
  assert.throws(() => hsonLiveMap.locus.create({}, null as never), /configuration/);
  const map = hsonLiveMap.create();
  const gated = create_registry_locus_internal({ map, libraries: [] }, { prepareGate() { throw Error("publication preparation failed"); } }).locus;
  try { await rejected(gated, { unpublished: { document: "<main/>" } }); }
  finally { gated.dispose(); }

  class HeldAppend extends MemoryCheckpointAdapter {
    readonly entered = deferred(); readonly release = deferred();
    override async appendCommit(record: Parameters<MemoryCheckpointAdapter["appendCommit"]>[0]) {
      this.entered.resolve(); await this.release.promise; await super.appendCommit(record);
    }
  }
  const persistence = new HeldAppend();
  const config = { logicalMapId: "flat-keyed-durable", persistence, authorizeProjection: () => ({ libraries: ["page"] }) };
  const durable = await hsonLiveMap.locus.resume({}, config);
  let settled = false, published = 0;
  const stop = durable.commits.observe(() => published++);
  const admitting = durable.admit({ page: { document, access: "shared" }, components: { parts: components } }).then(() => { settled = true; });
  await persistence.entered.promise;
  assert.equal(settled, false); assert.equal(durable.rev, 0); assert.equal(published, 0);
  assert.equal(durable.doc("page"), undefined);
  persistence.release.resolve(); await admitting;
  assert.equal(settled, true); assert.equal(durable.rev, 1); assert.equal(published, 1);
  persistence.failAppend = Error("durable append failed");
  await rejected(durable, { failed: { data: 1 } });
  stop(); durable.dispose();
  const replayed = await hsonLiveMap.locus.resume({}, config);
  assert.equal(replayed.rev, 1); assert.match(replayed.doc.must("page").render(), /Hello/);
  assert.deepEqual((await replayed.session.create({ libraries: ["page", "components"] })).now().libs.libraries.map(entry => entry.name), ["page"]);
  await hsonLiveMap.locus.checkpoint(replayed); replayed.dispose();
  const restored = await hsonLiveMap.locus.resume({}, config);
  assert.equal(restored.rev, 1); assert.match(restored.doc.must("page").render(), /Hello/); restored.dispose();

  const clientLocal = hsonLiveMap.locus.create({}, {
    local: [{ name: "ui", initializer: { document: "<main/>", stylesheet: "main{color:blue}" } }],
    authorizeProjection: () => ({ libraries: ["ui"] }),
  });
  try {
    const now = (await clientLocal.session.create({ libraries: ["ui"] })).now();
    assert.equal(now.libs.libraries.length, 0);
    assert.match(JSON.stringify(now.local), /blue/);
    await rejected(clientLocal, { ui: { data: 1 } });
  } finally { clientLocal.dispose(); }

  const local = hsonLiveMap.fromLibraries({ page: { document: "<main/>", stylesheet: "main{color:red}" } });
  assert.match(local.doc.must("page").css.snapshot(), /color:red/);
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: "<main/>", access: "shared" } } as never), /metadata/);
}

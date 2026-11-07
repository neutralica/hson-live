import { install_libraries_snapshot } from "../../src/api/livemap/index.js";
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
  await explicit_data_channel_cases();
  for (const name of ["a/b", "/a", "a/", "a//b"]) {
    for (const definition of [{ json: 1 }, { document: "<main/>" }, { parts: components }]) {
      assert.throws(() => hsonLiveMap.fromLibraries({ [name]: definition }), /Library name .*must not contain/);
      assert.throws(() => hsonLiveMap.locus.create({ [name]: definition }), /Library name .*must not contain/);
    }
    const map = hsonLiveMap.fromLibraries({ valid: { json: 1 } });
    const before = map.capture();
    assert.throws(() => map.addLibraries({ earlier: { json: 1 }, [name]: { json: 2 } }), /Library name .*must not contain/);
    assert.deepEqual(map.capture(), before);
    assert.throws(() => map.data(name), /Library name .*must not contain/);
    const locus = hsonLiveMap.locus.create({ valid: { json: 1 } });
    await rejected(locus, { earlier: { json: 1 }, [name]: { json: 2 } });
    locus.dispose();
  }
  await document_stylesheet_cases();
  await local_correspondence_correction_cases();
  const literalNames = hsonLiveMap.fromLibraries({ "a\\b": { json: 1 }, "a%2Fb": { json: 2 } });
  assert.equal(literalNames.data.must("a\\b").snap(), 1);
  assert.equal(literalNames.data.must("a%2Fb").snap(), 2);
  const minimal = hsonLiveMap.locus.create({ first: { json: 1 } });
  assert.equal(await minimal.admit({ page: { document: "<main/>" } }), undefined);
  assert.equal(minimal.doc.must("page").render(), "<!doctype html><html><head></head><body><main></main></body></html>");
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
      await locus.admit({ private: { json: { count: 1 }, schema: Count }, denied: { json: 2, access: "private" } });
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
  const keyed = Object.create({ inherited: { json: 99 } });
  for (const [index, name] of names.entries()) Object.defineProperty(keyed, name, { value: { json: index }, enumerable: index % 2 === 0 });
  const collisions = hsonLiveMap.locus.create(keyed);
  try {
    names.forEach((name, index) => assert.equal(collisions.data.must(name).snap(), index));
    assert.equal(collisions.data("inherited"), undefined);
    assert.equal(Object.hasOwn(Object.prototype, "data"), false);
    await rejected(collisions, { earlier: { json: 1 }, constructor: { json: 2 } });
    await rejected(collisions, new Proxy({ repeat: { json: 1 } }, { ownKeys: () => ["repeat", "repeat"] }));
  } finally { collisions.dispose(); }

  const locus = hsonLiveMap.locus.create({ state: { json: { count: 0 }, schema: Count } });
  const quid = parse_hson_exact_runtime("<main @000000123/>", { allowTopLevelDocumentText: true });
  for (const invalid of [
    { json: 1, document: "<main/>" }, { parts: {}, document: "<main/>" }, { json: undefined, document: "<main/>" }, {},
    { parts: { bad: { kind: "data", document: "<p/>" } } }, { parts: {}, schema: Count },
    { json: { count: "bad" }, schema: Count }, { document: "<main/>", schema: Count }, { json: 1, schema: {} },
    { document: '<main <hson-part lib="missing" at="button"/>/>' }, { document: '<main <hson-part/>/>' },
    { document: quid }, { document: "<main/>", stylesheet: 42 }, { json: 1, stylesheet: "main{}" },
    { json: 1, access: "local" }, { json: 1, access: undefined }, { json: 1, ownership: "shared" },
  ]) {
    assert.throws(() => hsonLiveMap.locus.create({ earlier: { json: 1 }, invalid } as never));
    await rejected(locus, { earlier: { json: 1 }, invalid });
    assert.equal(locus.data("earlier"), undefined);
  }
  await rejected(locus, { [Symbol("hidden")]: { json: 1 } });
  await rejected(locus, {});
  let nested: Promise<void> | undefined;
  await locus.stage(() => { nested = assert.rejects(locus.admit({ nested: { json: 1 } }), /forbidden/i); });
  await nested;
  assert.equal(locus.data("nested"), undefined);
  const pending = locus.admit({ stale: { json: 1 } });
  locus.dispose();
  await assert.rejects(pending, /closed|disposed/i);
  await assert.rejects(locus.admit({ disposed: { json: 1 } }), /closed|disposed/i);

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
  await rejected(durable, { failed: { json: 1 } });
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
    await rejected(clientLocal, { ui: { json: 1 } });
  } finally { clientLocal.dispose(); }

  const local = hsonLiveMap.fromLibraries({ page: { document: "<main/>", stylesheet: "main{color:red}" } });
  assert.match(local.doc.must("page").css.snapshot(), /color:red/);
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: "<main/>", access: "shared" } } as never), /metadata/);
}

async function explicit_data_channel_cases() {
  const source = Hson.data`<count -0>`;
  for (const definition of [{ json: { count: -0 }, schema: Count }, { hson: source, schema: Count }]) {
    const map = hsonLiveMap.fromLibraries({ state: definition });
    map.addLibraries({ added: definition });
    assert.equal(map.data.must("state").hson(), source);
    assert.equal(map.data.must("added").hson(), source);
    const locus = hsonLiveMap.locus.create({ state: { ...definition, access: "shared" } }, {
      local: [{ name: "local", initializer: definition }],
      authorizeProjection: () => ({ libraries: ["state", "added", "local"] }),
    });
    try {
      await locus.admit({ added: { ...definition, access: "shared" } });
      assert.equal(locus.data.must("state").hson(), source);
      assert.equal(locus.data.must("added").hson(), source);
      const session = (await locus.session.create({ libraries: ["state", "added", "local"] })).now();
      assert.equal(session.local.length, 1);
      assert.equal(session.local[0]!.mode, "data-object");
      assert.ok(session.libs.libraries.every(entry => entry.name !== "local"));
    } finally { locus.dispose(); }
    const persistence = new MemoryCheckpointAdapter(), config = { logicalMapId: "explicit-data-channels", persistence };
    const durable = await hsonLiveMap.locus.resume({ state: definition }, config);
    try { await durable.admit({ added: definition }); await hsonLiveMap.locus.checkpoint(durable); }
    finally { durable.dispose(); }
    const restored = await hsonLiveMap.locus.resume({ state: definition }, config);
    try { assert.equal(restored.data.must("added").hson(), source); }
    finally { restored.dispose(); }
  }
  const invalid = [{ json: true, hson: undefined }, { json: undefined, hson: "true" }, {}, { data: true },
    { json: undefined }, { hson: undefined }, { hson: '{"count":1}' }, { hson: '<count "wrong">', schema: Count }];
  const locus = hsonLiveMap.locus.create({ state: { hson: source, schema: Count } });
  try {
    for (const definition of invalid) {
      await rejected(locus, { first: { json: 1 }, bad: definition });
      await assert.rejects(hsonLiveMap.locus.resume({ bad: definition } as never, {
        logicalMapId: "invalid-channel", persistence: new MemoryCheckpointAdapter(),
      }));
      assert.throws(() => hsonLiveMap.locus.create({}, { local: [{ name: "bad", initializer: definition }] } as never));
    }
  } finally { locus.dispose(); }
  // Capture the source before a durable load yields to application code.
  class HeldLoad extends MemoryCheckpointAdapter {
    readonly entered = deferred(); readonly release = deferred();
    override async load(id: string) { this.entered.resolve(); await this.release.promise; return super.load(id); }
  }
  const persistence = new HeldLoad();
  let selected = source, reads = 0;
  const pending = hsonLiveMap.locus.resume({ state: { get hson() { reads++; return selected; }, schema: Count } }, {
    logicalMapId: "source-capture", persistence,
  });
  await persistence.entered.promise;
  selected = Hson.data`<count 99>`;
  persistence.release.resolve();
  const captured = await pending;
  try { assert.equal(reads, 1); assert.equal(captured.data.must("state").hson(), source); }
  finally { captured.dispose(); }
}

/** Checkpoint B: the actual construction, topology, local seed and durable receivers. */
async function document_stylesheet_cases() {
  const document = '<html @:page <head/> <body <h1 @:title "Title"/>/>/>';
  const makeStyle = () => ({ color: "red", "--Tone": "purple", width: { value: 20, unit: "px" }, marginTop: undefined,
    "& > body": { padding: { value: 2, unit: "em" } },
    "@:title": { color: "blue", _hover: { color: "green" }, "&::before": { content: '"prefix"' } },
    $media: { "(min-width: 1px)": { "@:title": { fontSize: { value: 15, unit: "px" } } } },
  });
  const assertSheet = (map: ReturnType<typeof hsonLiveMap.create>, name: string) => {
    const page = map.doc.must(name), sheet = page.css.snapshot(), record = map.capture().libraries.find(entry => entry.name === name)!.css!;
    assert.match(sheet, /:root\{color:red;\}/); assert.match(sheet, /:root\{--Tone:purple;\}/);
    assert.match(sheet, /:root\{width:20px;\}/); assert.doesNotMatch(sheet, /margin-top/);
    assert.match(sheet, /:root>body\{padding:2em;\}/); assert.match(sheet, /:hover\{color:green;\}/);
    assert.match(sheet, /::before\{content:"prefix";\}/); assert.match(sheet, /@media\s*\(min-width:1px\)/);
    assert.match(sheet, /font-size:15px/); assert.doesNotMatch(sheet, /@scope/);
    assert.deepEqual(record.rules.slice(0, 4).map(rule => rule.declarations[0]), [["color", "red"], ["--Tone", "purple"], ["width", "20px"], ["padding", "2em"]]);
    assert.match(record.rules[4]!.selector, /hson\\:quad="title"/);
    assert.match(page.render(), /data-hson-managed-document-css/);
    assert.match(page.render(), /hson:quad="title"/); // SSR subjects and their stylesheet correspond before any browser code.
    const restored = install_libraries_snapshot(map.capture()).map;
    assert.deepEqual(restored.capture().libraries.find(entry => entry.name === name)!.css, record);
    assert.equal(restored.doc.must(name).render(), page.render());
  };
  for (const dynamic of [false, true]) {
    const style = makeStyle(), map = hsonLiveMap.fromLibraries(dynamic ? {} : { page: { document, stylesheet: style } });
    if (dynamic) map.addLibraries({ page: { document, stylesheet: style } });
    style.color = "pink"; style["@:title"].color = "orange"; style.width.value = 99;
    assertSheet(map, "page");
    const before = map.capture(), owner = internal_livemap_aggregate_authority(map), issued = owner.identityEpoch().issued();
    let observations = 0; map.commits.observe(() => observations++);
    const invalid = [{ unknownProperty: "red" }, { "@:missing": { color: "red" } }, { "& >": { color: "red" } },
      { color: "red", CoLoR: "blue" }, { padding: { value: 2, unit: "bogus" } }, { color: false },
      { $media: { "screen,": { color: "red" } } }, { color: "red; background:blue" }];
    for (const stylesheet of invalid) {
      assert.throws(() => Reflect.apply(map.addLibraries, map, [{ first: { json: 1 }, invalid: { document, stylesheet } }]));
      assert.deepEqual(map.capture(), before); assert.strictEqual(owner.identityEpoch().issued(), issued); assert.equal(observations, 0);
    }
  }
  const text = " /* opaque: & @:missing */\nBOGUS { future-property : untouched }\n";
  const opaque = hsonLiveMap.fromLibraries({ page: { document, stylesheet: text } });
  assert.equal(opaque.doc.must("page").css.snapshot(), text);
  opaque.addLibraries({ later: { document, stylesheet: text } }); assert.equal(opaque.doc.must("later").css.snapshot(), text);
  const empty = hsonLiveMap.fromLibraries({ page: { document, stylesheet: { color: undefined, "--missing": undefined } } });
  assert.equal(empty.doc.must("page").css.snapshot(), "");
  const short = hsonLiveMap.fromLibraries({ page: { document: '<main @:title/>', stylesheet: { color: "red", "@:title": { color: "blue" } } } });
  assert.match(short.doc.must("page").css.snapshot(), /:root\{color:red;\}/); assert.match(short.doc.must("page").render(), /color:blue/);

  const locus = hsonLiveMap.locus.create({ page: { document, stylesheet: makeStyle(), access: "shared" } }, {
    local: [{ name: "ui", initializer: Object.freeze({ document, stylesheet: { color: "orange" } }), stylesheet: { color: "red", "& > body": { margin: 0 }, $media: { screen: { _hover: { color: "blue" } } } } }],
    authorizeProjection: () => ({ libraries: ["page", "ui"] }),
  });
  try {
    assertSheet(locus_map_internal(locus), "page");
    await locus.admit({ later: { document, stylesheet: makeStyle(), access: "shared" } }); assertSheet(locus_map_internal(locus), "later");
    await rejected(locus, { first: { json: 1 }, invalid: { document, stylesheet: { "@:missing": { color: "red" } } } });
    const now = (await locus.session.create({ libraries: ["page", "ui"] })).now();
    assert.match(JSON.stringify(now.local), /red/); assert.doesNotMatch(JSON.stringify(now.local), /orange/);
    const localRecord = now.local.find(entry => entry.name === "ui")!.css!;
    assert.ok(localRecord.rules.some(rule => rule.selector === ":root"));
    assert.ok(localRecord.rules.some(rule => rule.selector === ":root>body"));
  } finally { locus.dispose(); }

  let sourceReads = 0;
  const accessorInitializer = Object.defineProperty({}, "document", { enumerable: true, get() { sourceReads++; return document; } });
  const baselineGetterLocus = Reflect.apply(hsonLiveMap.locus.create, undefined, [{}, { local: [{ name: "ui", initializer: accessorInitializer }] }]);
  baselineGetterLocus.dispose();
  const baselineSourceReads = sourceReads; sourceReads = 0;
  const getterLocus = Reflect.apply(hsonLiveMap.locus.create, undefined, [{}, { local: [{ name: "ui", initializer: accessorInitializer, stylesheet: { color: "red" } }] }]);
  getterLocus.dispose();
  assert.ok(baselineSourceReads > 0);
  assert.equal(sourceReads, baselineSourceReads, "A local stylesheet override preserves ordinary configuration getter capture");
  assert.throws(() => Reflect.apply(hsonLiveMap.locus.create, undefined, [{}, { local: [{ name: "ui", initializer: { document }, stylesheet: null }] }]));

  class HeldCssLoad extends MemoryCheckpointAdapter {
    readonly entered = deferred(); readonly release = deferred();
    override async load(logicalMapId: string) {
      this.entered.resolve(); await this.release.promise; return super.load(logicalMapId);
    }
  }
  for (const outer of [false, true]) {
    const adapter = new HeldCssLoad(), sheet = Proxy.revocable({ color: "red", "& > body": { margin: 0 } }, {});
    const pending = hsonLiveMap.locus.resume({}, { logicalMapId: `local-css-capture-${outer}`, persistence: adapter,
      local: [{ name: "ui", initializer: { document: "<main/>", ...(outer ? {} : { stylesheet: sheet.proxy }) }, ...(outer ? { stylesheet: sheet.proxy } : {}) }],
      authorizeProjection: () => ({ libraries: ["ui"] }),
    });
    await adapter.entered.promise; sheet.revoke(); adapter.release.resolve();
    const resumed = await pending;
    try {
      const now = (await resumed.session.create({ libraries: ["ui"] })).now();
      const localSheet = now.local.find(entry => entry.name === "ui")!.css!;
      assert.ok(localSheet.rules.some(rule => rule.selector === ":root" && rule.declarations.some(([name, value]) => name === "color" && value === "red")));
    } finally { resumed.dispose(); }
  }

  const namedLocal = hsonLiveMap.locus.create({}, { local: [{ name: "ui", initializer: { document, stylesheet: makeStyle() } }] });
  namedLocal.dispose();

  class HeldCssAppend extends MemoryCheckpointAdapter {
    readonly entered = deferred(); readonly release = deferred();
    override async appendCommit(record: Parameters<MemoryCheckpointAdapter["appendCommit"]>[0]) {
      this.entered.resolve(); await this.release.promise; await super.appendCommit(record);
    }
  }
  const persistence = new HeldCssAppend(), config = { logicalMapId: "d4c-css-map", persistence };
  const durable = await hsonLiveMap.locus.resume({ state: { json: 0 } }, config);
  try {
    const blocking = durable.stage(draft => { draft.data.must("state").at([]).set(1); }); await persistence.entered.promise;
    const style = makeStyle(), proxy = Proxy.revocable(style, {});
    const pending = durable.admit({ page: { document, stylesheet: proxy.proxy } });
    style.color = "orange"; style["@:title"].color = "orange"; proxy.revoke();
    persistence.release.resolve(); await blocking; await pending; assertSheet(locus_map_internal(durable), "page");
  } finally { persistence.release.resolve(); durable.dispose(); }
  const resumed = await hsonLiveMap.locus.resume({ state: { json: 0 } }, config);
  try { assertSheet(locus_map_internal(resumed), "page"); await hsonLiveMap.locus.checkpoint(resumed); }
  finally { resumed.dispose(); }
  const checkpointed = await hsonLiveMap.locus.resume({ state: { json: 0 } }, config);
  try { assertSheet(locus_map_internal(checkpointed), "page"); }
  finally { checkpointed.dispose(); }
}

async function local_correspondence_correction_cases() {
  const { admit_locus_local_initializers, install_client_local_initializers_internal } = await import("../../src/api/locus/locus.local-initializer.js");
  const { compose_client_projection_internal } = await import("../../src/api/echo/echo.projection.js");
  const { sha256_sync } = await import("../../src/core/sha256-sync.js");
  const { lookup_document_quad_internal } = await import("../../src/api/livemap/livemap.document.quad.js");
  const { authority_definitions_from_map_fixture, create_locus_fixture } = await import("../helpers/locus-definition-fixture.mts");
  const original = hsonLiveMap.fromLibraries({ text: { json: "42" } });
  const reconstructed = create_locus_fixture(authority_definitions_from_map_fixture(original, [{ name: "text", ownership: "shared" }]));
  assert.equal(reconstructed.data.must("text").snap(), "42"); reconstructed.dispose();
  const seed = async (document: string) => {
    const locus = hsonLiveMap.locus.create({}, { local: [{ name: "ui", initializer: { document, stylesheet: { color: "orange" } }, stylesheet: { color: "red", "@:title": { color: "blue" } } }], authorizeProjection: () => ({ libraries: ["ui"] }) });
    try { return (await locus.session.create({ libraries: ["ui"] })).now(); } finally { locus.dispose(); }
  };
  const a = await seed('<main <h1 @:title/> <p/>/>'), b = await seed('<main <h1/> <p @:title/>/>');
  assert.deepEqual(a.local[0]!.root, b.local[0]!.root);
  assert.notDeepEqual(a.local[0]!.quads, b.local[0]!.quads);
  assert.notEqual(a.local[0]!.fingerprint, b.local[0]!.fingerprint);
  const transported = JSON.parse(JSON.stringify(a.local));
  const admitted = admit_locus_local_initializers(transported);
  transported[0].quads[0].path[0] = 99;
  assert.deepEqual(admitted, a.local); assert.ok(Object.isFrozen(admitted[0]!.quads[0]!.path));
  const rehash = (record: Record<string, unknown>) => { const { name, mode, schemaDigest, validation, rootCodec, root, quads, scopes, css } = record; const contract = { name, mode, schemaDigest, ...(validation === undefined ? {} : { validation }), rootCodec, root, quads, ...(scopes === undefined ? {} : { scopes }), ...(css === undefined ? {} : { css }) }; return { ...record, fingerprint: sha256_sync(JSON.stringify({ format: "hson-local-initializer", ...contract })) }; };
  const first = compose_client_projection_internal(a.libs, admitted);
  const later = compose_client_projection_internal(a.libs, admitted);
  install_client_local_initializers_internal(later, admit_locus_local_initializers([rehash({ ...admitted[0], name: "later" })]));
  for (const map of [first, later]) {
    assert.ok(lookup_document_quad_internal(map.doc.must(map === first ? "ui" : "later"), "title"));
    const html = map.doc.must(map === first ? "ui" : "later").render(); assert.match(html, /blue/); assert.match(html, /red/); assert.doesNotMatch(html, /orange/);
  }
  assert.notEqual(lookup_document_quad_internal(first.doc.must("ui"), "title")!.quid, lookup_document_quad_internal(later.doc.must("later"), "title")!.quid);
  const before = later.capture(); const owner = internal_livemap_aggregate_authority(later), issued = owner.identityEpoch().issued();
  for (const quads of [[{ name: "title", path: [999] }], [{ name: "bad/name", path: admitted[0]!.quads[0]!.path }], [...admitted[0]!.quads, ...admitted[0]!.quads], [{ ...admitted[0]!.quads[0], name: "other" }], []]) {
    const forged = rehash({ ...admitted[0], quads });
    assert.throws(() => admit_locus_local_initializers([forged]));
    assert.throws(() => install_client_local_initializers_internal(later, [forged as never]));
    assert.deepEqual(later.capture(), before); assert.equal(owner.identityEpoch().issued(), issued);
  }
  const { quads: omitted, ...old } = admitted[0]!;
  assert.throws(() => admit_locus_local_initializers([old]));
  assert.throws(() => admit_locus_local_initializers([{ ...admitted[0], quads: b.local[0]!.quads }]));
  // Existing portable occurrence namespaces exercise repeated internal Part names.
  const { scoped_portable_fixture_capture } = await import("./livemap-scoped-portable-cases.mts");
  const { encode_hosted_root, decode_hosted_root, HOSTED_MAX_SNAPSHOT_BYTES } = await import("../../src/api/livemap/livemap.hosted.js");
  const { ANY_DOCUMENT, hson_schema_digest } = await import("../../src/api/schema/hson-schema.js");
  const capturedScoped = scoped_portable_fixture_capture();
  // The low-level fixture adds a second alias to one subject. Public authored
  // Documents have one name per subject; preserve its repeated Part occurrences.
  const scoped = { ...capturedScoped, scopes: { ...capturedScoped.scopes, document: capturedScoped.scopes.document.filter(binding => binding.name !== "mainAlias") } };
  const record = rehash({ name: "scoped", mode: "document", schema: ANY_DOCUMENT.toHson(), schemaDigest: hson_schema_digest(ANY_DOCUMENT), rootCodec: "hson-exact-value", root: encode_hosted_root(scoped.root), css: scoped.css, quads: [], scopes: scoped.scopes });
  const scopedSeeds = admit_locus_local_initializers([record]);
  const scopedMap = compose_client_projection_internal(a.libs, scopedSeeds, true);
  assert.ok(scopedMap.doc.must("scoped").render().length > 0);
  assert.deepEqual(scopedSeeds[0]!.scopes, scoped.scopes);
  assert.ok(scoped.scopes.occurrences.filter(scope => scope.bindings.some(binding => binding.name === "label")).length > 1);
  install_client_local_initializers_internal(later, scopedSeeds);
  assert.match(later.doc.must("scoped").render(), /display:grid/);
  const { document_scoped_libraries_semantically_equal } = await import("../../src/api/livemap/livemap.document.scoped-portable.js");
  const captureScoped = (map: typeof later) => {
    const captured = internal_livemap_aggregate_authority(map).captureSelectedHosted(["scoped"], false, true).libraries[0]!;
    return { root: decode_hosted_root(captured.root, HOSTED_MAX_SNAPSHOT_BYTES), scopes: captured.scopes, css: captured.css };
  };
  assert.ok(document_scoped_libraries_semantically_equal(captureScoped(later), captureScoped(scopedMap)));
  const restored = install_libraries_snapshot(first.capture()).map;
  assert.equal(restored.doc.must("ui").render(), first.doc.must("ui").render());
  assert.throws(() => admit_locus_local_initializers([rehash({ ...record, quads: admitted[0]!.quads })]));
  for (const mutation of ["duplicate", "outside", "name"]) {
    const scopes = structuredClone(scoped.scopes);
    const occurrence = scopes.occurrences[0]!;
    const binding = occurrence.bindings[0]!;
    const invalidScopes = { ...scopes, occurrences: [{ ...occurrence, bindings: mutation === "duplicate"
      ? [...occurrence.bindings, binding]
      : [{ ...binding, ...(mutation === "outside" ? { path: [] } : { name: "bad/name" }) }, ...occurrence.bindings.slice(1)] }, ...scopes.occurrences.slice(1)] };
    assert.throws(() => admit_locus_local_initializers([rehash({ ...record, scopes: invalidScopes })]));
  }
}

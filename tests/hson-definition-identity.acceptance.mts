import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { make_locus_application_catalog, admit_locus_local_initializers } from "../src/api/locus/locus.local-initializer.ts";
import { spawnSync } from "node:child_process";
import { Hson, hsonTransform, hsonLiveMap } from "../src/index.ts";
import { HsonSchema, hson_schema_digest, hson_schema_source_digest } from "../src/api/schema/hson-schema.ts";
import { make_hosted_registry, registry_from_entries } from "../src/api/livemap/livemap.hosted.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { portable_aggregate_inputs_internal } from "../src/api/livemap/livemap.libraries.ts";
import { compiled_hson_schema_of } from "../src/api/schema/hson-schema.ts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "hson.definition-identity", title: "Ordered Schema definition identity", category: "Schema", runtime: "node", tags: Object.freeze(["schema", "identity", "admission"]) });
const testEvents = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
testEvents.case_begin("ordered-definition-contracts", HSON_LIVE_TEST_METADATA.title);
try {
  const digest = hson_schema_source_digest;
  const registry = (source: string) => make_hosted_registry([{ name: "state", identity: {}, mode: "data-object", schema: HsonSchema.fromHson(source) }]);
  const a = '<type "data" defs <T <content <value "string">>> content <ref "T">>';
  const b = String.raw`// presentation
  < type "data" defs <T <content <value "string"> >> content <ref "\u0054"> >`;
  assert.equal(digest(a), digest(b));
  assert.equal(registry(a).digest, registry(b).digest);
  const ra = registry(a);
  assert.equal(registry_from_entries(ra.libraries.map(entry => ({ ...entry, schema: b as typeof entry.schema }))).digest, ra.digest);
  assert.throws(() => registry_from_entries(ra.libraries.map(entry => ({ ...entry, schema: '<type "data">' as typeof entry.schema }))));
  const different = [
    [a, '<type "data" defs <U <content <value "string">>> content <ref "U">>'],
    [a, '<type "data" defs <T <content <value "string">>> content <value "string">>'],
    ['<type "data">', '<type "data" defs <Unused "string">>'],
    ['<type "data" content <v <union «"string","number"»>>>', '<type "data" content <v <union «"number","string"»>>>'],
    [`<type "data" content <'10' "string" '2' "number">>`, `<type "data" content <'2' "number" '10' "string">>`],
    ['<type "data" content <v <exact 0>>>', '<type "data" content <v <exact -0>>>'],
    ['<type "data" content <v "string">>', '<type "data" content <v <optional "string">>>'],
    ['<type "document" content <sequence «<tag "a" content "empty">,<tag "b" content "empty">»>>', '<type "document" content <sequence «<tag "b" content "empty">,<tag "a" content "empty">»>>'],
    ['<type "data">', '<type "document">'],
    ['<type "data" defs <A "string" B "number">>', '<type "data" defs <B "number" A "string">>'],
    ["<type \"data\" defs <'10' \"string\" '2' \"number\">>", "<type \"data\" defs <'2' \"number\" '10' \"string\">>"],
  ];
  for (const [left, right] of different) assert.notEqual(digest(left!), digest(right!));
  const ordered = HsonSchema.fromHson(`<type "data" content <'10' "string" '2' "number">>`);
  const semantic = compiled_hson_schema_of(ordered).semantic;
  assert.equal(semantic.kind, "object");
  if (semantic.kind === "object") assert.deepEqual(semantic.members.map(m => m.name), ["10", "2"]);
  assert.throws(() => HsonSchema.fromHson('<type "data" defs <Unused <bogus "string">>>'));
  assert.throws(() => HsonSchema.fromHson('<type "data" defs <Unused <ref "Missing">>>'));
  for (let run = 0; run < 2; run++) {
    const child = spawnSync(process.execPath, ["--import=tsx", "--input-type=module", "-e", `import {hson_schema_source_digest} from './src/api/schema/hson-schema.ts'; process.stdout.write(hson_schema_source_digest(${JSON.stringify(a)}));`], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, digest(a));
  }
  for (const source of ["< a 1 b -0 >", "[1, 2,]", "«1,2,»"]) {
    const generic = hsonTransform.fromHson(source).toHson().serialize();
    assert.equal(Hson.data.fromHson(source as never), Hson.data.fromHson(generic));
    assert.equal(Hson.data.fromHson(hsonTransform.fromHson(source).toHson().noBreak().serialize()), Hson.data.fromHson(generic));
  }
  assert.deepEqual(Hson.data.entries(Hson.data.fromHson("<'10' 0 '2' -0>" as never))?.map(([name]) => name), ["10", "2"]);
  assert.notEqual(Hson.data.fromHson('<a "">' as never), Hson.data.fromHson('<>' as never));
  for (const source of ["<a 1 a 2>", "<a 1 'a' 2>", "<_hson_reserved 1>", "<x @000000001/>", "1e999", "<main hidden/>"]) assert.throws(() => Hson.data.fromHson(source as never));
  assert.equal(Hson.document.fromHson(' <main  "a" "" "b" /> ' as never), Hson.document`<main "a" "" "b"/>`);
  assert.equal(hson_schema_digest(HsonSchema.fromHson(a)), digest(b));
  console.log("ordered definition identity and relaxed admission passed");

  const unique = (cases: string) => `<type "data" content <items <array <content <content <key "string">> unique <by "key" cases ${cases}>>>>>`;
  assert.notEqual(digest(unique('[["a",["A"]],["b",["B"]]]')), digest(unique('[["b",["B"]],["a",["A"]]]')));
  assert.notEqual(digest(unique('[["a",["A","B"]]]')), digest(unique('[["a",["B","A"]]]')));
  const authority = hsonLiveMap.fromLibraries({ shared: { data: {} } });
  const catalog = (source: string, value = "x") => make_locus_application_catalog(authority, [
    { name: "shared", ownership: "shared" },
    { name: "local", ownership: "local", initializer: { data: { value }, schema: HsonSchema.fromHson(source) } },
  ]);
  const first = catalog(a).local.get("local")!;
  const second = catalog(b).local.get("local")!;
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, catalog(a, "y").local.get("local")!.fingerprint);
  assert.equal(admit_locus_local_initializers([{ ...first, schema: b }])[0]!.fingerprint, first.fingerprint);
  assert.throws(() => admit_locus_local_initializers([{ ...first, schema: '<type "data">' }]));

  assert.throws(() => HsonSchema.fromHson('<type "data" defs <Unused <ref "Unused">>>'), /consuming/);
  assert.throws(() => HsonSchema.fromHson('<type "data" defs <A <ref "B"> B <ref "A">>>'), /consuming/);

  const sourceMap = hsonLiveMap.fromLibraries({ state: { data: { value: "x" }, schema: HsonSchema.fromHson(a) } });
  const snapshot = sourceMap.capture();
  const presentedSnapshot = { ...snapshot, registry: { ...snapshot.registry,
    libraries: snapshot.registry.libraries.map(entry => ({ ...entry, schema: b as typeof entry.schema })) } };
  const installed = install_libraries_snapshot(presentedSnapshot).map;
  assert.equal(installed.capture().registryDigest, snapshot.registryDigest);
  const installedLibrary = installed.lib("state");
  assert.equal(installedLibrary.mode, "data-object");
  assert.deepEqual(installedLibrary.snap(), { value: "x" });
  assert.doesNotThrow(() => portable_aggregate_inputs_internal({ ...presentedSnapshot, format: "hson-portable-aggregate-snapshot",
    authority: { logicalMapId: "presentation-test", incarnationId: "presentation-test-incarnation" } }));
  assert.throws(() => install_libraries_snapshot({ ...presentedSnapshot,
    registry: { ...presentedSnapshot.registry, format: "wrong" } } as never));
  assert.throws(() => install_libraries_snapshot({ ...presentedSnapshot,
    registry: { ...presentedSnapshot.registry, libraries: presentedSnapshot.registry.libraries.map(entry => ({ ...entry, rootCodec: "wrong" })) } } as never));

  testEvents.case_end("ordered-definition-contracts", "pass");
  testEvents.terminal("pass");
} catch (error) {
  testEvents.diagnostic("ordered-definition-contracts", "assertion", error instanceof Error ? error.message : String(error));
  testEvents.case_end("ordered-definition-contracts", "fail");
  testEvents.terminal("fail");
  throw error;
}

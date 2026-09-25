import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, enable_interactions, hsonLiveMap } from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
import { generate_hson_schema_types } from "../src/internal/hson-schema/generate-types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-phase-1a",
  title: "LiveMap runtime admission foundation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "livemap", "capture", "primitive-root"]),
});

const events = create_test_event_emitter("livemap-phase-1a");
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : "Check failed.");
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
}

check("family tops use ordinary canonical Schema and generated evidence", () => {
  assert.equal(ANY_DATA.toHson(), '<type "data">');
  assert.equal(ANY_DOCUMENT.toHson(), '<type "document">');
  for (const source of ['<type "data">', '<type "data" content "any">', '<type "document">', '<type "document" tag "main">']) {
    const compiled = compile_hson_schema(source);
    assert.equal(compiled.ok, true, source);
    if (!compiled.ok) continue;
    const generated = generate_hson_schema_types("TopSchema", compiled.value.semantic, compiled.value.definitions);
    assert.match(generated.declarations, source.includes('"data"') ? /JsonValue/ : /HsonNode/);
    if (source.includes('"document"')) assert.ok(generated.proofNodeCount > 0);
  }
  assert.match(Hson.schema`<type "data" content "any">`.toHson(), /content "any"/);
});

check("data top certifies every supported data family and rejects invalid material", () => {
  for (const candidate of [Hson.data`<x 1>`, Hson.data`[1, true, null]`, Hson.data`"hello"`, Hson.data`-0`, Hson.data`true`, Hson.data`null`]) {
    assert.equal(ANY_DATA.certify(candidate), candidate);
  }
  assert.throws(() => ANY_DATA.certify('<main/>' as never));
  assert.throws(() => ANY_DATA.certify(undefined as never));
});

check("document top accepts broad content while explicit empty and tag narrow", () => {
  const broad = Hson.schema`<type "document">`;
  const tagged = Hson.schema`<type "document" tag "main">`;
  const empty = Hson.schema`<type "document" tag "main" content "empty">`;
  for (const candidate of [Hson.document``, Hson.document`"text"`, Hson.document`<main/>`, Hson.document`<main "text"/>`, Hson.document`<main <p "text"/>/>`, Hson.document`<article/>`, Hson.document`<a/><b/>`]) {
    assert.equal(broad.certify(candidate), candidate);
  }
  const taggedCandidate = Hson.document`<main <p "text"/>/>`;
  assert.equal(tagged.certify(taggedCandidate), taggedCandidate);
  assert.throws(() => tagged.certify(Hson.document`<article/>`));
  assert.throws(() => empty.certify(Hson.document`<main <p/>/>`));
  const broadCandidate = Hson.document`<main <p/>/>`;
  assert.equal(ANY_DOCUMENT.certify(broadCandidate), broadCandidate);
  assert.throws(() => ANY_DOCUMENT.certify('<value 1>' as never));
});

check("primitive data roots admit, expose scalar handles, commit, and round trip", () => {
  const cases = [
    { data: '"hello"', mode: "data-string", value: "hello", next: 'world' },
    { data: 3, mode: "data-number", value: 3, next: 4 },
    { data: true, mode: "data-boolean", value: true, next: false },
    { data: null, mode: "data-null", value: null, next: null },
  ] as const;
  for (const entry of cases) {
    const map = hsonLiveMap.fromLibraries({ value: { data: entry.data, schema: ANY_DATA } });
    const library = map.lib("value");
    assert.equal(library.mode, entry.mode);
    assert.deepEqual(library.snap(), entry.value);
    const root = library.at([]);
    assert.equal(root.kind(), "scalar");
    assert.ok(root.asScalar());
    assert.equal(root.asObject(), undefined);
    assert.equal(root.asArray(), undefined);
    assert.equal("setKey" in root, false);
    assert.equal("push" in root, false);
    const capture = map.capture();
    assert.equal(capture.registry.libraries[0]?.mode, entry.mode);
    const installed = install_libraries_snapshot(capture).map.lib("value");
    if (!("snap" in installed)) throw new Error("Expected a data Library after installation.");
    assert.deepEqual(installed.snap(), entry.value);
    map.restore(capture);
    assert.deepEqual(library.snap(), entry.value);
    if (entry.mode !== "data-null") {
      const commits: number[] = [];
      const stop = map.commits.observe((commit) => commits.push(commit.rev));
      root.replace(entry.next);
      stop();
      assert.equal(map.rev, 1);
      assert.deepEqual(commits, [1]);
      assert.deepEqual(library.snap(), entry.next);
      assert.equal(library.mode, entry.mode);
    }
    const before = map.rev;
    assert.throws(() => root.replace({ changed: true }), /root mode is fixed/);
    assert.equal(map.rev, before);
    assert.throws(() => map.render(), /no selectable public document Library/);
  }
});

check("empty maps are complete runtimes with capture, restore, and ordinary failures", () => {
  for (const map of [hsonLiveMap.create(), hsonLiveMap.fromLibraries({})]) {
    assert.equal(map.rev, 0);
    const capture = map.capture();
    assert.equal(capture.revision, 0);
    assert.deepEqual(capture.registry.libraries, []);
    assert.deepEqual(capture.libraries, []);
    assert.deepEqual(install_libraries_snapshot(capture).map.capture(), capture);
    const commits: number[] = [];
    const stop = map.commits.observe((commit) => commits.push(commit.rev));
    map.restore(capture);
    stop();
    assert.equal(map.rev, 0);
    assert.deepEqual(commits, []);
    assert.throws(() => Reflect.apply(map.lib, map, ["whatever"]), /Unknown LiveMap Library/);
    assert.throws(() => map.render(), /no selectable public document Library/);
  }
});

check("empty maps retain independent internal system state", () => {
  const map = hsonLiveMap.create();
  enable_interactions(map);
  const capture = map.capture();
  assert.equal(map.rev, 0);
  assert.equal(capture.registry.libraries.length, 1);
  assert.equal(capture.registry.libraries[0]?.scope, "hson-internal");
  map.restore(capture);
  assert.equal(map.rev, 0);
  assert.throws(() => Reflect.apply(map.lib, map, ["whatever"]), /Unknown LiveMap Library/);
});

events.terminal("pass");

import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, add_interaction, enable_interactions, hsonLiveMap } from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-phase-1b",
  title: "Local LiveMap library admission",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "topology", "capture", "replay"]),
});

const events = create_test_event_emitter("livemap-phase-1b");
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : "Check failed.");
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
}

const page = Hson.document`<main "Hello"/>`;

check("empty map admits a document and data atomically with top Schemas", () => {
  const map = hsonLiveMap.create();
  const before = map.capture();
  const observations: Array<{ rev: number; names: string[] }> = [];
  const stop = map.commits.observe((commit) => observations.push({
    rev: commit.rev, names: map.capture().registry.libraries.map((entry) => entry.name),
  }));
  const commit = map.lib.add({ page: { document: page }, state: { data: { count: 0 } } });
  stop();
  assert.deepEqual([commit.prevRev, commit.rev, commit.changed], [0, 1, true]);
  assert.equal(commit.operations.length, 1);
  const operation = commit.operations[0]?.operation;
  assert.equal(operation !== undefined && "kind" in operation && operation.kind, "library-add");
  assert.deepEqual(observations, [{ rev: 1, names: ["page", "state"] }]);
  assert.equal(map.lib("page").schema.get(), ANY_DOCUMENT);
  assert.equal(map.lib("state").schema.get(), ANY_DATA);
  const explicit = hsonLiveMap.create();
  explicit.lib.add({ page: { document: page, schema: ANY_DOCUMENT },
    state: { data: { count: 0 }, schema: ANY_DATA } });
  assert.equal(explicit.capture().registry.digest, map.capture().registry.digest);
  assert.equal(map.render("page"), "<main>Hello</main>");
  assert.equal(map.render(), "<main>Hello</main>");
  assert.notEqual(map.capture().registry.digest, before.registry.digest);
  assert.equal(map.capture().revision, 1);
  let emptyObservations = 0;
  const stopEmpty = map.commits.observe(() => { emptyObservations += 1; });
  assert.deepEqual(map.lib.add({}).operations, []);
  stopEmpty();
  assert.equal(map.rev, 1);
  assert.equal(emptyObservations, 0);
});

check("existing handles survive unrelated admission and explicit Schema governs", () => {
  const schema = Hson.schema`<type "data" content <count "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { count: 2 } } });
  const state = map.lib("state");
  const root = state.at([]);
  const epoch = livemap_identity_epoch_accounting(state).epoch;
  const commit = map.lib.add({ page: { document: page }, exact: { data: { count: 4 }, schema } });
  assert.equal(commit.rev, 1);
  assert.equal(map.lib("state"), state);
  assert.equal(livemap_identity_epoch_accounting(state).epoch, epoch);
  assert.deepEqual(root.snap(), { count: 2 });
  assert.deepEqual(state.snap(), { count: 2 });
  assert.equal(map.lib("exact").schema.get(), schema);
  assert.throws(() => map.lib.add({ invalid: { data: { count: "no" }, schema } }), /Schema|number/i);
  assert.equal(map.rev, 1);
});

check("primitive data families remain scalar under runtime admission", () => {
  const map = hsonLiveMap.create();
  const commit = map.lib.add({
    text: { data: '"hello"' }, number: { data: 3 }, flag: { data: true }, empty: { data: null },
  });
  assert.equal(commit.rev, 1);
  for (const [name, value, mode] of [
    ["text", "hello", "data-string"], ["number", 3, "data-number"],
    ["flag", true, "data-boolean"], ["empty", null, "data-null"],
  ] as const) {
    const selected = map.lib(name);
    if (!("snap" in selected)) throw new Error("Expected data Library.");
    assert.deepEqual(selected.snap(), value);
    assert.equal(selected.mode, mode);
    assert.equal(selected.at([]).kind(), "scalar");
  }
});

check("failed admission leaves revision, registry, observers and identity alone", () => {
  const map = hsonLiveMap.fromLibraries({ existing: { data: { count: 1 } } });
  const old = map.lib("existing");
  const baseline = map.capture();
  const epoch = livemap_identity_epoch_accounting(old);
  let observations = 0;
  const stop = map.commits.observe(() => { observations += 1; });
  const narrow = Hson.schema`<type "document" tag "main" content "empty">`;
  const claimed = parse_hson("<main/>", { allowTopLevelDocumentText: true });
  const child = claimed.$_content[0];
  if (!is_Node(child)) throw new Error("Expected document child.");
  child.$_meta = { quid: "000009111" };
  const bad: unknown[] = [
    { existing: { data: 2 } },
    { "@hson/canonical-interactions/v1": { data: {} } },
    { invalid: { data: undefined } },
    { wrong: { data: 1, schema: ANY_DOCUMENT } },
    { wrong: { document: "<main/>", schema: ANY_DATA } },
    { wrong: { document: "<article/>", schema: narrow } },
    { claimed: { document: claimed } },
    { valid: { data: 1 }, invalid: { document: "<article/>", schema: narrow } },
  ];
  for (const [index, input] of bad.entries()) {
    assert.throws(() => map.lib.add(input as never), /./, `Failure case ${index} was admitted.`);
    assert.deepEqual(map.capture(), baseline);
    assert.equal(map.lib("existing"), old);
    assert.deepEqual(livemap_identity_epoch_accounting(old), epoch);
    assert.equal(observations, 0);
  }
  stop();
});

check("portable replay, fresh install and two-way local topology restore", () => {
  const map = hsonLiveMap.create();
  const before = map.capture();
  const commit = map.lib.add({ page: { document: page }, state: { data: { count: 0 } } });
  const after = map.capture();
  const installed = install_libraries_snapshot(after).map;
  assert.equal(installed.rev, 1);
  assert.equal(installed.capture().registry.digest, after.registry.digest);
  assert.equal(installed.render(), "<main>Hello</main>");
  const replayed = hsonLiveMap.create();
  const replayCommit = replayed.replay(JSON.parse(JSON.stringify(commit)));
  assert.deepEqual(replayCommit.operations, commit.operations);
  assert.equal(replayed.capture().registry.digest, after.registry.digest);
  const invalidReplay = JSON.parse(JSON.stringify(commit));
  invalidReplay.operations[0].operation.libraries[0].mode = "data-object";
  const rejectedReplica = hsonLiveMap.create();
  const rejectedBefore = rejectedReplica.capture();
  assert.throws(() => rejectedReplica.replay(invalidReplay));
  assert.deepEqual(rejectedReplica.capture(), rejectedBefore);
  const oldPage = map.lib("page");
  map.restore(before);
  assert.equal(map.rev, 0);
  assert.deepEqual(map.capture(), before);
  assert.throws(() => oldPage.root(), /another map authority/);
  const invalidRestore = JSON.parse(JSON.stringify(after));
  invalidRestore.libraries[0].root.payload = "<not-valid";
  assert.throws(() => map.restore(invalidRestore));
  assert.deepEqual(map.capture(), before);
  map.restore(after);
  assert.equal(map.rev, 1);
  assert.equal(map.capture().registry.digest, after.registry.digest);
  assert.equal(map.render(), "<main>Hello</main>");
  assert.notEqual(map.lib("page"), oldPage);
});

check("forward replay and topology restore preserve shared library handles", () => {
  const source = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
  const initial = source.capture();
  const state = source.lib("state");
  const transition = source.lib.add({ page: { document: page } });
  const later = source.capture();
  const replica = install_libraries_snapshot(initial).map;
  replica.replay(transition);
  assert.equal(replica.capture().registry.digest, later.registry.digest);
  source.restore(initial);
  assert.equal(source.lib("state"), state);
  assert.deepEqual(state.snap(), { count: 1 });
  source.restore(later);
  assert.equal(source.lib("state"), state);
  assert.deepEqual(state.snap(), { count: 1 });
});

check("interaction state can target a document admitted after enabling it", () => {
  const map = hsonLiveMap.create();
  enable_interactions(map);
  map.lib.add({ page: { document: Hson.document`<main <button/>/>` } });
  const descriptor = Object.freeze({
    id: "new-page", subject: Object.freeze({ library: "page", path: Object.freeze([0, 0, 0]) }),
    listener: Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
      passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false,
      stopImmediatePropagation: false }),
    kind: "browser-local" as const, key: "run", args: null,
  });
  add_interaction(map, descriptor);
  assert.equal(map.rev, 2);
  assert.equal(internal_livemap_aggregate_authority(map).hostedRegistry().libraries.length, 2);
});

events.terminal("pass");

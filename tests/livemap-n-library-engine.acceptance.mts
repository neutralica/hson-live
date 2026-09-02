import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, hson } from "../src/index.ts";
import { get_livemap_staged_authority } from "../src/api/livemap/livemap.authority.ts";
import {
  internal_livemap_aggregate_authority,
  internal_livemap_library_ownership,
} from "../src/api/livemap/livemap.internal.ts";
import {
  make_livemap_library,
  make_livemap_library_registry,
} from "../src/api/livemap/livemap.library.ts";
import { prepare_livemap_root } from "../src/api/livemap/livemap.document.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

const DataSchema = Hson`<type "data" content <value "number">>`;
const ColorSchema = Hson`<type "data" content <value "string">>`;
const ViewSchema = Hson`<type "data" content <value "boolean">>`;
const DocumentSchema = Hson`<type "document" tag "main" content <sequence []>>`;
const Q1 = "000000001";
const Q2 = "000000002";
const Q3 = "000000003";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.n-library-engine",
  title: "LiveMap N-library engine",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "libraries", "aggregate", "engine"]),
});

const testEvents = create_test_event_emitter("livemap.n-library-engine");
let checks = 0;

function check(name: string, run: () => void): void {

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
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function triple() {
  const map = hson.liveMap.fromJson({ value: 1 }).schema.use(DataSchema);
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ value: "blue" }).toNode(), { hsonSchema: ColorSchema });
  const view = aggregate.addLibrary(hson.fromJson({ value: false }).toNode(), { hsonSchema: ViewSchema });
  return { map, aggregate, data, colors, view };
}

check("registry keeps a stable default plus deterministic opaque two and three library identities", () => {
  const { aggregate, data, colors, view } = triple();
  assert.deepEqual(aggregate.libraries(), [data, colors, view]);
  assert.equal(aggregate.defaultLibrary(), data);
  assert.notEqual(data, colors);
  assert.notEqual(colors, view);
  assert.notEqual(data, view);
  const inspected = aggregate.inspect();
  assert.equal(inspected.revision, 0);
  assert.deepEqual(inspected.libraries.map((library) => library.identity), [data, colors, view]);
  assert.deepEqual(inspected.libraries.map((library) => library.mode), ["data-object", "data-object", "data-object"]);
  assert.deepEqual(inspected.libraries.map((library) => library.hsonSchemaAttached), [true, true, true]);
});

check("the internal registry rejects duplicate opaque identities", () => {
  const library = make_livemap_library(prepare_livemap_root(hson.fromJson({ value: 1 }).toNode()));
  const registry = make_livemap_library_registry(library);
  assert.equal(registry.defaultLibrary(), library);
  assert.throws(() => registry.add(library), /identity twice/i);
  assert.equal(registry.size(), 1);
});

check("library equality is authority identity, not structural root equality", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const aggregate = internal_livemap_aggregate_authority(map);
  const first = aggregate.defaultLibrary();
  const second = aggregate.addLibrary(hson.fromJson({ value: 1 }).toNode());
  assert.notEqual(first, second);
  assert.deepEqual(aggregate.snap(first), aggregate.snap(second));
  assert.notEqual(aggregate.handle(first, ["value"]), aggregate.handle(second, ["value"]));
});

check("same structural paths have independent roots, resolution, handles, watches, and feeds", () => {
  const { aggregate, data, colors } = triple();
  const dataHandle = aggregate.handle(data, ["value"]);
  const colorHandle = aggregate.handle(colors, ["value"]);
  const dataWatch: unknown[] = [];
  const colorWatch: unknown[] = [];
  const dataFeed: unknown[] = [];
  const colorFeed: unknown[] = [];
  aggregate.watch(data, ["value"], (value) => dataWatch.push(value));
  aggregate.watch(colors, ["value"], (value) => colorWatch.push(value));
  aggregate.feed(data, ["value"], (event) => dataFeed.push(event.value));
  aggregate.feed(colors, ["value"], (event) => colorFeed.push(event.value));

  assert.notEqual(dataHandle, colorHandle);
  assert.equal(dataHandle.at([]), dataHandle);
  assert.equal(colorHandle.at([]), colorHandle);
  assert.equal(dataHandle.snap(), 1);
  assert.equal(colorHandle.snap(), "blue");
  aggregate.commit([{ target: aggregate.target(data, ["value"]), kind: "set", value: 2 }]);
  assert.deepEqual(dataWatch, [2]);
  assert.deepEqual(colorWatch, []);
  assert.deepEqual(dataFeed, [2]);
  assert.deepEqual(colorFeed, []);
  assert.equal(colorHandle.snap(), "blue");
});

check("one map-wide order accepts A, B, A+B, and C with exactly one revision and publication each", () => {
  const { map, aggregate, data, colors, view } = triple();
  const observed: number[] = [];
  aggregate.observe((commit) => observed.push(commit.rev));
  const commits = [
    aggregate.commit([{ target: aggregate.target(data, ["value"]), kind: "set", value: 2 }]),
    aggregate.commit([{ target: aggregate.target(colors, ["value"]), kind: "set", value: "green" }]),
    aggregate.commit([
      { target: aggregate.target(data, ["value"]), kind: "set", value: 3 },
      { target: aggregate.target(colors, ["value"]), kind: "set", value: "red" },
    ]),
    aggregate.commit([{ target: aggregate.target(view, ["value"]), kind: "set", value: true }]),
  ];
  assert.deepEqual(commits.map((commit) => [commit.prevRev, commit.rev]), [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.equal(map.rev, 4);
  assert.deepEqual(observed, [1, 2, 3, 4]);
  assert.equal(aggregate.snap(data, ["value"]), 3);
  assert.equal(aggregate.snap(colors, ["value"]), "red");
  assert.equal(aggregate.snap(view, ["value"]), true);
  assert.throws(() => aggregate.lowerForLegacy(commits[2]!), /legacy single-root/i);
});

check("each affected candidate uses its own HsonSchema and one invalid library rejects the whole aggregate", () => {
  const { map, aggregate, data, colors, view } = triple();
  const before = aggregate.telemetry();
  const publications: unknown[] = [];
  aggregate.observe((commit) => publications.push(commit));
  aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 2 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "green" },
    { target: aggregate.target(view, ["value"]), kind: "set", value: true },
  ]);
  const afterValid = aggregate.telemetry();
  assert.equal(afterValid.candidateRootsCloned - before.candidateRootsCloned, 3);
  assert.equal(afterValid.schemaValidations - before.schemaValidations, 3);
  assert.equal(afterValid.aggregatePublications - before.aggregatePublications, 1);
  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 3 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: 7 },
  ]));
  assert.equal(map.rev, 1);
  assert.equal(aggregate.snap(data, ["value"]), 2);
  assert.equal(aggregate.snap(colors, ["value"]), "green");
  assert.equal(aggregate.snap(view, ["value"]), true);
  assert.equal(publications.length, 1);
});

check("data and document libraries coexist under one map authority with separate roots, modes, and schemas", () => {
  const map = hson.liveMap.fromJson({ value: 1 }).schema.use(DataSchema);
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const document = aggregate.addLibrary(hson.fromHson("<main/>").toNode(), { hsonSchema: DocumentSchema });
  const documentRoot = aggregate.root(document);
  const before = aggregate.inspect();
  assert.deepEqual(before.libraries.map((library) => library.mode), ["data-object", "document"]);
  assert.deepEqual(before.libraries.map((library) => library.hsonSchemaAttached), [true, true]);
  aggregate.commit([{ target: aggregate.target(data, ["value"]), kind: "set", value: 2 }]);
  assert.equal(map.rev, 1);
  assert.equal(aggregate.snap(data, ["value"]), 2);
  assert.equal(aggregate.root(document), documentRoot);
  assert.throws(() => aggregate.handle(document, []), /data library/i);
  assert.equal(map.snap(["value"]), 2);
  assert.equal(aggregate.inspect().libraries.length, 2);
});

check("one global QUID ledger resolves library-qualified locations, rejects collision and ABA, and defers cross-library movement", () => {
  const map = hson.liveMap.fromJson({ active: {}, retired: {}, duplicate: {} });
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ active: {}, reuse: {}, duplicate: {}, incoming: {} }).toNode());
  aggregate.commit([
    { target: aggregate.target(data, ["active"]), kind: "ensure-quid", quid: Q1 },
    { target: aggregate.target(colors, ["active"]), kind: "ensure-quid", quid: Q2 },
  ]);
  assert.deepEqual(aggregate.resolveQuid(Q1), aggregate.target(data, ["active"]));
  assert.deepEqual(aggregate.resolveQuid(Q2), aggregate.target(colors, ["active"]));
  const issuedBeforeFailure = internal_livemap_library_ownership(map).issuedQuids;
  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["duplicate"]), kind: "ensure-quid", quid: Q3 },
    { target: aggregate.target(colors, ["duplicate"]), kind: "ensure-quid", quid: Q3 },
  ]), /collision/i);
  assert.equal(aggregate.resolveQuid(Q3), undefined);
  assert.equal(internal_livemap_library_ownership(map).issuedQuids, issuedBeforeFailure);
  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["active"]), kind: "delete" },
    { target: aggregate.target(colors, ["incoming"]), kind: "ensure-quid", quid: Q1 },
  ]), /explicit LiveMap transfer semantic/i);
  assert.deepEqual(aggregate.resolveQuid(Q1), aggregate.target(data, ["active"]));
  aggregate.commit([{ target: aggregate.target(data, ["active"]), kind: "delete" }]);
  assert.throws(() => aggregate.commit([
    { target: aggregate.target(colors, ["reuse"]), kind: "ensure-quid", quid: Q1 },
  ]), /retired/i);
  assert.equal(aggregate.resolveQuid(Q1), undefined);
  assert.equal(internal_livemap_library_ownership(map).issuedQuids, issuedBeforeFailure);
});

check("existing staging remains global while aggregate preparation is stale-safe and atomic", () => {
  const { map, aggregate, data, colors } = triple();
  const staged = get_livemap_staged_authority(map);
  const stagedA = staged.prepare((draft) => draft.set(["value"], 2));
  staged.accept(stagedA);
  assert.equal(map.rev, 1);
  assert.equal(aggregate.snap(data, ["value"]), 2);
  assert.equal(aggregate.snap(colors, ["value"]), "blue");

  const aggregateStaged = aggregate.prepare([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 3 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "green" },
  ]);
  aggregate.accept(aggregateStaged);
  assert.equal(map.rev, 2);
  assert.equal(aggregate.snap(data, ["value"]), 3);
  assert.equal(aggregate.snap(colors, ["value"]), "green");

  const stale = aggregate.prepare([{ target: aggregate.target(colors, ["value"]), kind: "set", value: "red" }]);
  map.set(["value"], 4);
  assert.throws(() => aggregate.accept(stale), /stale/i);
  assert.equal(map.rev, 3);
  assert.equal(aggregate.snap(colors, ["value"]), "green");
});

check("aggregate introspection is private and legacy capture/root continue to represent only the default graph", () => {
  const { map, aggregate, data, colors, view } = triple();
  aggregate.commit([{ target: aggregate.target(colors, ["value"]), kind: "set", value: "green" }]);
  const capture = map.capture();
  const inspected = aggregate.inspect();
  assert.equal(capture.rev, 1);
  assert.equal(map.snap(["value"]), 1);
  assert.deepEqual(inspected.libraries.map((library) => library.identity), [data, colors, view]);
  assert.equal(aggregate.snap(colors, ["value"]), "green");
  assert.equal(aggregate.snap(view, ["value"]), false);
  assert.equal("libraries" in map, false);
  assert.equal("lib" in map, false);
  assert.equal("library" in map, false);
  assert.equal("repository" in map, false);
  assert.equal("addLibrary" in map, false);
  assert.equal("atLibrary" in map, false);
});

check("performance telemetry clones and validates only touched libraries", () => {
  const single = hson.liveMap.fromJson({ value: 1 });
  const singleStart = performance.now();
  single.set(["value"], 2);
  const singleMs = performance.now() - singleStart;
  const { map, aggregate, data, colors, view } = triple();
  const before = aggregate.telemetry();
  const oneStart = performance.now();
  aggregate.commit([{ target: aggregate.target(data, ["value"]), kind: "set", value: 2 }]);
  const oneMs = performance.now() - oneStart;
  const afterOne = aggregate.telemetry();
  const twoStart = performance.now();
  aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 3 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "green" },
  ]);
  const twoMs = performance.now() - twoStart;
  const afterTwo = aggregate.telemetry();
  const threeStart = performance.now();
  aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 4 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "red" },
    { target: aggregate.target(view, ["value"]), kind: "set", value: true },
  ]);
  const threeMs = performance.now() - threeStart;
  const afterThree = aggregate.telemetry();
  assert.equal(afterOne.candidateRootsCloned - before.candidateRootsCloned, 1);
  assert.equal(afterOne.schemaValidations - before.schemaValidations, 1);
  assert.equal(afterTwo.candidateRootsCloned - afterOne.candidateRootsCloned, 2);
  assert.equal(afterTwo.schemaValidations - afterOne.schemaValidations, 2);
  assert.equal(afterThree.candidateRootsCloned - afterTwo.candidateRootsCloned, 3);
  assert.equal(afterThree.schemaValidations - afterTwo.schemaValidations, 3);
  assert.equal(afterThree.aggregatePublications - before.aggregatePublications, 3);
  assert.equal(map.rev, 3);
  process.stdout.write(`telemetry single=${singleMs.toFixed(3)}ms one=${oneMs.toFixed(3)}ms two=${twoMs.toFixed(3)}ms three=${threeMs.toFixed(3)}ms candidates=1/2/3 schemas=1/2/3 revisions=3 publications=3\n`);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.n-library-engine", checks, checks, 0);

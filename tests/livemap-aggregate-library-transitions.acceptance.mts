import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, hson } from "../src/index.ts";
import {
  internal_livemap_aggregate_authority,
  internal_livemap_library_ownership,
} from "../src/api/livemap/livemap.internal.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

const NumberSchema = Hson`<type "data" content <value "number">>`;
const StringSchema = Hson`<type "data" content <value "string">>`;
const Q1 = "000000001";
const Q2 = "000000002";
const Q3 = "000000003";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.aggregate-library-transitions",
  title: "LiveMap aggregate library transitions",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "libraries", "aggregate", "transitions"]),
});

const testEvents = create_test_event_emitter("livemap.aggregate-library-transitions");
let checks = 0;

const check = (name: string, run: () => void): void => {

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
};

check("default-library public behavior and legacy commit shape remain unchanged", () => {
  const map = hson.liveMap.fromJson({ value: 1 }).schema.use(NumberSchema);
  const firstHandle = map.at(["value"]);
  const commit = map.set(["value"], 2);

  assert.equal(map.at(["value"]), firstHandle);
  assert.equal(map.snap(["value"]), 2);
  assert.equal(map.rev, 1);
  assert.equal(commit.rev, 1);
  assert.equal(commit.ops.length, 1);
  assert.equal("target" in commit.ops[0]!, false);
  assert.equal("operations" in commit, false);
});

check("two internal libraries share one revision while same paths and handles stay distinct", () => {
  const map = hson.liveMap.fromJson({ value: 1 }).schema.use(NumberSchema);
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ value: "blue" }).toNode(), { hsonSchema: StringSchema });
  const dataHandle = aggregate.handle(data, ["value"]);
  const colorsHandle = aggregate.handle(colors, ["value"]);

  assert.notEqual(data, colors);
  assert.notEqual(dataHandle, colorsHandle);
  assert.equal(dataHandle.target.path[0], colorsHandle.target.path[0]);
  assert.equal(dataHandle.target.library, data);
  assert.equal(colorsHandle.target.library, colors);
  assert.equal(dataHandle.at([]), dataHandle);
  assert.equal(colorsHandle.at([]), colorsHandle);
  assert.equal(dataHandle.snap(), 1);
  assert.equal(colorsHandle.snap(), "blue");
  assert.equal(map.at(["value"]).snap(), 1);
  assert.equal(map.rev, 0);
});

check("one aggregate commit preserves total library-qualified order and advances the map once", () => {
  const map = hson.liveMap.fromJson({ value: 1 }).schema.use(NumberSchema);
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ value: "blue" }).toNode(), { hsonSchema: StringSchema });
  const observed: unknown[] = [];
  const dataWatched: unknown[] = [];
  const colorsWatched: unknown[] = [];
  const dataFeeds: unknown[] = [];
  const colorsFeeds: unknown[] = [];
  aggregate.observe((commit) => observed.push(commit));
  aggregate.watch(data, ["value"], (value) => dataWatched.push(value));
  aggregate.watch(colors, ["value"], (value) => colorsWatched.push(value));
  aggregate.feed(data, ["value"], (event) => dataFeeds.push(event));
  aggregate.feed(colors, ["value"], (event) => colorsFeeds.push(event));

  const transition = aggregate.prepare([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 2 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "green" },
    { target: aggregate.target(data, ["value"]), kind: "set", value: 3 },
  ]);
  assert.equal(transition.baseRevision, 0);
  assert.equal(transition.nextRevision, 1);
  assert.deepEqual(transition.libraryModes, ["data-object", "data-object"]);

  const accepted = aggregate.accept(transition);
  assert.equal(accepted.commit.kind, "aggregate");
  assert.equal(accepted.commit.prevRev, 0);
  assert.equal(accepted.commit.rev, 1);
  assert.deepEqual(accepted.commit.operations.map((entry) => entry.target.library), [data, colors, data]);
  assert.deepEqual(accepted.commit.operations.map((entry) => entry.target.path), [["value"], ["value"], ["value"]]);
  assert.equal(map.rev, 1);
  assert.equal(aggregate.snap(data, ["value"]), 3);
  assert.equal(aggregate.snap(colors, ["value"]), "green");
  assert.equal(observed.length, 1);
  assert.deepEqual(dataWatched, [3]);
  assert.deepEqual(colorsWatched, ["green"]);
  assert.equal(dataFeeds.length, 1);
  assert.equal(colorsFeeds.length, 1);
  assert.throws(() => aggregate.lowerForLegacy(accepted.commit), /legacy single-root/i);

  aggregate.commit([{ target: aggregate.target(data, ["value"]), kind: "set", value: 4 }]);
  assert.deepEqual(dataWatched, [3, 4]);
  assert.deepEqual(colorsWatched, ["green"]);
  assert.equal(dataFeeds.length, 2);
  assert.equal(colorsFeeds.length, 1);
});

check("a schema rejection in one affected library atomically rejects every candidate", () => {
  const map = hson.liveMap.fromJson({ value: 1 }).schema.use(NumberSchema);
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ value: "blue" }).toNode(), { hsonSchema: StringSchema });
  let publications = 0;
  aggregate.observe(() => { publications += 1; });
  const beforeOwnership = internal_livemap_library_ownership(map);

  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 2 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: 3 },
  ]));

  assert.equal(aggregate.snap(data, ["value"]), 1);
  assert.equal(aggregate.snap(colors, ["value"]), "blue");
  assert.equal(map.rev, 0);
  assert.equal(publications, 0);
  assert.equal(internal_livemap_library_ownership(map).issuedQuids, beforeOwnership.issuedQuids);
});

check("QUID claims are globally issued, resolve to library targets, and reject cross-library ABA reuse", () => {
  const map = hson.liveMap.fromJson({ active: {}, retired: {}, duplicate: {} });
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ active: {}, reuse: {}, duplicate: {} }).toNode());

  aggregate.commit([
    { target: aggregate.target(data, ["active"]), kind: "ensure-quid", quid: Q1 },
    { target: aggregate.target(colors, ["active"]), kind: "ensure-quid", quid: Q2 },
  ]);
  assert.deepEqual(aggregate.resolveQuid(Q1), aggregate.target(data, ["active"]));
  assert.deepEqual(aggregate.resolveQuid(Q2), aggregate.target(colors, ["active"]));
  assert.equal(internal_livemap_library_ownership(map).issuedQuids, 2);

  const beforeCollision = map.rev;
  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["duplicate"]), kind: "ensure-quid", quid: Q3 },
    { target: aggregate.target(colors, ["duplicate"]), kind: "ensure-quid", quid: Q3 },
  ]), /collision/i);
  assert.equal(map.rev, beforeCollision);
  assert.equal(aggregate.resolveQuid(Q3), undefined);

  aggregate.commit([{ target: aggregate.target(data, ["active"]), kind: "delete" }]);
  assert.equal(aggregate.resolveQuid(Q1), undefined);
  const beforeReuse = map.rev;
  assert.throws(() => aggregate.commit([
    { target: aggregate.target(colors, ["reuse"]), kind: "ensure-quid", quid: Q1 },
  ]), /retired/i);
  assert.equal(map.rev, beforeReuse);
  assert.equal(aggregate.resolveQuid(Q1), undefined);
  assert.equal(internal_livemap_library_ownership(map).issuedQuids, 2);
});

check("failure in another library cannot partially issue a QUID claim", () => {
  const map = hson.liveMap.fromJson({ item: {} });
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ value: "blue" }).toNode(), { hsonSchema: StringSchema });
  const before = internal_livemap_library_ownership(map);

  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["item"]), kind: "ensure-quid", quid: Q1 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: 3 },
  ]));

  assert.equal(map.rev, 0);
  assert.equal(aggregate.resolveQuid(Q1), undefined);
  assert.equal(internal_livemap_library_ownership(map).issuedQuids, before.issuedQuids);
});

check("a document-mode internal library can coexist under the same map authority", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const document = aggregate.addLibrary(hson.fromHson("<main/>").toNode());
  const commit = aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 2 },
  ]);

  assert.equal(commit.rev, 1);
  assert.notEqual(aggregate.root(data), aggregate.root(document));
  assert.equal(aggregate.snap(data, ["value"]), 2);
  assert.throws(() => aggregate.handle(document, []), /data library/i);
});

check("aggregate preparation clones only affected library candidates and publishes once", () => {
  const single = hson.liveMap.fromJson({ value: 1 });
  const singleStart = performance.now();
  single.set(["value"], 2);
  const singleMs = performance.now() - singleStart;

  const map = hson.liveMap.fromJson({ value: 1 });
  const aggregate = internal_livemap_aggregate_authority(map);
  const data = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ value: "blue" }).toNode());
  const before = aggregate.telemetry();
  const aggregateStart = performance.now();
  aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 2 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "green" },
  ]);
  const aggregateMs = performance.now() - aggregateStart;
  const after = aggregate.telemetry();

  assert.equal(after.candidateRootsCloned - before.candidateRootsCloned, 2);
  assert.equal(after.acceptedTransitions - before.acceptedTransitions, 1);
  assert.equal(after.aggregatePublications - before.aggregatePublications, 1);
  assert.equal(map.rev, 1);
  process.stdout.write(`telemetry single-library=${singleMs.toFixed(3)}ms aggregate-two-library=${aggregateMs.toFixed(3)}ms candidates=2 revisions=1 publications=1\n`);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.aggregate-library-transitions", checks, checks, 0);

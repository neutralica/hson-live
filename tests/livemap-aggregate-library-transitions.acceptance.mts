import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, hsonLiveMap } from "../src/index.ts";
import {
  internal_livemap_aggregate_authority,
} from "../src/api/livemap/livemap.internal.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import type { JsonValue } from "../src/core/types.ts";

const NumberSchema = Hson.schema`<type "data" content <value "number">>`;
const StringSchema = Hson.schema`<type "data" content <value "string">>`;
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

function pair(
  data: JsonValue,
  colors: JsonValue,
  dataSchema = NumberSchema,
  colorsSchema = StringSchema,
) {
  const map = hsonLiveMap.fromLibraries({
    data: { data, schema: dataSchema },
    colors: { data: colors, schema: colorsSchema },
  });
  const aggregate = internal_livemap_aggregate_authority(map);
  const [dataIdentity, colorsIdentity] = aggregate.libraries();
  if (dataIdentity === undefined || colorsIdentity === undefined) throw new Error("Expected fixed pair registry.");
  return { map, aggregate, data: dataIdentity, colors: colorsIdentity };
}

check("one-library registry keeps stable selection and map-wide commits", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: NumberSchema } });
  const state = map.lib("state");
  const commit = state.at(["value"]).set(2);

  assert.equal(map.lib("state"), state);
  assert.equal(state.snap(["value"]), 2);
  assert.equal(map.rev, 1);
  assert.equal(commit.rev, 1);
  assert.equal(commit.kind, "map");
  assert.equal(commit.operations.length, 1);
  assert.equal(commit.operations[0]?.library, "state");
});

check("two internal libraries share one revision while same paths and handles stay distinct", () => {
  const { map, aggregate, data, colors } = pair({ value: 1 }, { value: "blue" });
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
  assert.equal(aggregate.handle(data, ["value"]).snap(), 1);
  assert.equal(map.rev, 0);
});

check("one aggregate commit preserves total library-qualified order and advances the map once", () => {
  const { map, aggregate, data, colors } = pair({ value: 1 }, { value: "blue" });
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
  assert.equal(Reflect.has(aggregate, "lowerForLegacy"), false);

  aggregate.commit([{ target: aggregate.target(data, ["value"]), kind: "set", value: 4 }]);
  assert.deepEqual(dataWatched, [3, 4]);
  assert.deepEqual(colorsWatched, ["green"]);
  assert.equal(dataFeeds.length, 2);
  assert.equal(colorsFeeds.length, 1);
});

check("a schema rejection in one affected library atomically rejects every candidate", () => {
  const { map, aggregate, data, colors } = pair({ value: 1 }, { value: "blue" });
  let publications = 0;
  aggregate.observe(() => { publications += 1; });
  const issuedBefore = aggregate.identityEpoch().issued().size;

  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 2 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: 3 },
  ]));

  assert.equal(aggregate.snap(data, ["value"]), 1);
  assert.equal(aggregate.snap(colors, ["value"]), "blue");
  assert.equal(map.rev, 0);
  assert.equal(publications, 0);
  assert.equal(aggregate.identityEpoch().issued().size, issuedBefore);
});

check("QUID claims are globally issued, resolve to library targets, and reject cross-library ABA reuse", () => {
  const AnyData = Hson.schema`<type "data" content <active <optional "any"> retired <optional "any"> duplicate <optional "any"> reuse <optional "any">>>`;
  const { map, aggregate, data, colors } = pair(
    { active: {}, retired: {}, duplicate: {}, reuse: {} },
    { active: {}, retired: {}, reuse: {}, duplicate: {} },
    AnyData,
    AnyData,
  );

  aggregate.commit([
    { target: aggregate.target(data, ["active"]), kind: "ensure-quid", quid: Q1 },
    { target: aggregate.target(colors, ["active"]), kind: "ensure-quid", quid: Q2 },
  ]);
  assert.deepEqual(aggregate.resolveQuid(Q1), aggregate.target(data, ["active"]));
  assert.deepEqual(aggregate.resolveQuid(Q2), aggregate.target(colors, ["active"]));
  assert.equal(aggregate.identityEpoch().issued().size, 2);

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
  assert.equal(aggregate.identityEpoch().issued().size, 2);
});

check("failure in another library cannot partially issue a QUID claim", () => {
  const AnyData = Hson.schema`<type "data" content <item <optional "any">>>`;
  const { map, aggregate, data, colors } = pair({ item: {} }, { value: "blue" }, AnyData, StringSchema);
  const issuedBefore = aggregate.identityEpoch().issued().size;

  assert.throws(() => aggregate.commit([
    { target: aggregate.target(data, ["item"]), kind: "ensure-quid", quid: Q1 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: 3 },
  ]));

  assert.equal(map.rev, 0);
  assert.equal(aggregate.resolveQuid(Q1), undefined);
  assert.equal(aggregate.identityEpoch().issued().size, issuedBefore);
});

check("a document-mode internal library can coexist under the same map authority", () => {
  const map = hsonLiveMap.fromLibraries({
    data: { data: { value: 1 }, schema: NumberSchema },
    document: { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content <sequence []>>` },
  });
  const aggregate = internal_livemap_aggregate_authority(map);
  const [data, document] = aggregate.libraries();
  if (data === undefined || document === undefined) throw new Error("Expected fixed mixed registry.");
  const commit = aggregate.commit([
    { target: aggregate.target(data, ["value"]), kind: "set", value: 2 },
  ]);

  assert.equal(commit.rev, 1);
  assert.notEqual(aggregate.root(data), aggregate.root(document));
  assert.equal(aggregate.snap(data, ["value"]), 2);
  assert.throws(() => aggregate.handle(document, []), /data library/i);
});

check("aggregate preparation clones only affected library candidates and publishes once", () => {
  const single = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: NumberSchema } });
  const singleStart = performance.now();
  single.lib("state").at(["value"]).set(2);
  const singleMs = performance.now() - singleStart;

  const { map, aggregate, data, colors } = pair({ value: 1 }, { value: "blue" });
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

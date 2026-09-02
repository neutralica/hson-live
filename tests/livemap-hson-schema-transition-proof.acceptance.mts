import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, hson } from "../src/index.ts";
import { get_livemap_staged_authority } from "../src/api/livemap/livemap.authority.ts";
import {
  internal_livemap_aggregate_authority,
  internal_livemap_library_ownership,
} from "../src/api/livemap/livemap.internal.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const StateSchema = Hson`<type "data" content <account <content <id "string">> age <number <int true min 0 under 130>>>>`;
const ColorsSchema = Hson`<type "data" content <value <string <prefix "#">>>>`;
const Q1 = "000000001";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-hson-schema-transition-proof",
  title: "LiveMap Hson Schema transition proof",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "hson-schema", "transitions"]),
});

const testEvents = create_test_event_emitter("livemap-hson-schema-transition-proof");
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
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

function governed() {
  const map = hson.liveMap.fromJson({ account: { id: "ada" }, age: 37 }).schema.use(StateSchema);
  const aggregate = internal_livemap_aggregate_authority(map);
  const state = aggregate.defaultLibrary();
  const colors = aggregate.addLibrary(hson.fromJson({ value: "#blue" }).toNode(), { hsonSchema: ColorsSchema });
  return { map, aggregate, state, colors };
}

check("one invalid aggregate candidate rejects every library before QUID ledger installation", () => {
  const { map, aggregate, state, colors } = governed();
  const observed: unknown[] = [];
  aggregate.observe((commit) => observed.push(commit));
  const beforeOwnership = internal_livemap_library_ownership(map);
  const telemetry = aggregate.telemetry();

  assert.throws(() => aggregate.commit([
    { target: aggregate.target(state, ["account"]), kind: "ensure-quid", quid: Q1 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "blue" },
  ]));

  assert.equal(map.rev, 0);
  assert.equal(aggregate.snap(state, ["age"]), 37);
  assert.equal(aggregate.snap(colors, ["value"]), "#blue");
  assert.equal(aggregate.resolveQuid(Q1), undefined);
  assert.equal(internal_livemap_library_ownership(map).issuedQuids, beforeOwnership.issuedQuids);
  assert.equal(observed.length, 0);
  assert.equal(aggregate.telemetry().schemaValidations - telemetry.schemaValidations, 2);
  assert.equal(aggregate.telemetry().candidateRootsCloned - telemetry.candidateRootsCloned, 2);
});

check("refined leaf rejection is atomic across a valid peer library", () => {
  const { map, aggregate, state, colors } = governed();
  let publications = 0;
  aggregate.observe(() => { publications += 1; });

  assert.throws(() => aggregate.commit([
    { target: aggregate.target(state, ["age"]), kind: "set", value: 37.5 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "#green" },
  ]));
  assert.equal(map.rev, 0);
  assert.equal(aggregate.snap(state, ["age"]), 37);
  assert.equal(aggregate.snap(colors, ["value"]), "#blue");
  assert.equal(publications, 0);

  const started = performance.now();
  const commit = aggregate.commit([
    { target: aggregate.target(state, ["age"]), kind: "set", value: 38 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "#green" },
  ]);
  const elapsed = performance.now() - started;
  assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
  assert.equal(aggregate.snap(state, ["age"]), 38);
  assert.equal(aggregate.snap(colors, ["value"]), "#green");
  assert.equal(publications, 1);
  assert.equal(Number.isFinite(elapsed), true);
});

check("staged candidates gain no governed proof until accepted", () => {
  const { map, aggregate, state, colors } = governed();
  const staged = get_livemap_staged_authority(map);
  const valid = staged.prepare((draft) => draft.set(["age"], 38));
  staged.accept(valid);
  assert.equal(map.rev, 1);
  assert.equal(aggregate.snap(state, ["age"]), 38);

  assert.throws(() => staged.prepare((draft) => draft.set(["age"], 38.5)));
  assert.throws(() => aggregate.prepare([
    { target: aggregate.target(state, ["age"]), kind: "set", value: 39 },
    { target: aggregate.target(colors, ["value"]), kind: "set", value: "green" },
  ]));
  assert.equal(map.rev, 1);
  assert.equal(aggregate.snap(state, ["age"]), 38);
  assert.equal(aggregate.snap(colors, ["value"]), "#blue");
});

testEvents.terminal("pass");

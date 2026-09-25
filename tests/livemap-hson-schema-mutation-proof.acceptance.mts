import type { SchemaType } from "hson-live";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "hson-live";
import { encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { TreeSchema, UserSchema } from "./fixtures/hson-schema-mvp/producer.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-hson-schema-mutation-proof",
  title: "LiveMap Hson Schema mutation proof",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "hson-schema", "mutation", "public-api"]),
});

const testEvents = create_test_event_emitter("livemap-hson-schema-mutation-proof");
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

function user(age = 37) {
  return {
    name: "Ada",
    nickname: "ada",
    score: 37,
    age,
    percent: 80,
    code: "ID-7",
    key: "abc",
    status: "ready" as const,
    phase: "lobby" as const,
    turn: "player1" as const,
    zero: 0,
    negativeZero: -0,
    signedZeroChoice: -0,
    flags: [true, false],
    pair: ["pair", 2],
    account: { kind: "user" as const, handle: "ada" },
  };
}

check("schema association supplies certified reads and ordinary typed mutation candidates", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: user(), schema: UserSchema } });
  const state = map.lib("state");
  const age = state.at(["age"]);
  const flags = state.at(["flags"]);
  const pair = state.at(["pair"]);
  const account = state.at(["account"]);
  const phase = state.at(["phase"]);
  const turn = state.at(["turn"]);
  const signedZeroChoice = state.at(["signedZeroChoice"]);
  const key = state.at(["key"]);

  const governed: SchemaType<typeof UserSchema> = state.snap();
  const governedAge: SchemaType<typeof UserSchema>["age"] = age.snap();
  const governedFlags: SchemaType<typeof UserSchema>["flags"] = flags.snap();
  const governedPair: SchemaType<typeof UserSchema>["pair"] = pair.snap();
  const governedAccount: SchemaType<typeof UserSchema>["account"] = account.snap();
  age.set(38);
  flags.replace([true, false]);
  pair.replace(["next", 3]);
  account.replace({ kind: "admin", level: 4 });
  phase.set("ready");
  phase.set("playing");
  phase.set("finished");
  phase.set("lobby");
  turn.set("player2");
  turn.set(null);
  turn.set("player1");
  signedZeroChoice.set(0);
  assert.equal(Object.is(signedZeroChoice.snap(), 0), true);
  signedZeroChoice.set(-0);
  assert.equal(Object.is(signedZeroChoice.snap(), -0), true);
  key.set("cba");
  assert.throws(() => key.set("abd"));
  assert.equal(key.snap(), "cba");
  state.at(["nickname"]).set("grace");

  const libraries = hsonLiveMap.fromLibraries({
    state: { data: user(), schema: UserSchema },
    tree: { data: { value: "root", age: 1, children: [] }, schema: TreeSchema },
  });
  const libraryAge = libraries.lib("state").at(["age"]);
  libraryAge.set(38);
  const libraryGovernedAge: SchemaType<typeof UserSchema>["age"] = libraryAge.snap();
  assert.equal(libraries.rev, 1);

  if (false) {
    // @ts-expect-error Candidate domain follows the generated leaf domain.
    age.set("38");
    // @ts-expect-error Named Library handles retain the same candidate domain.
    libraryAge.set("38");
    // @ts-expect-error A plain candidate cannot impersonate the certified integer read.
    const fabricatedAge: SchemaType<typeof UserSchema>["age"] = 38;
    // @ts-expect-error One Schema's numeric proof is not another Schema's proof.
    const crossSchemaProof: SchemaType<typeof TreeSchema>["age"] = age.snap();
    // @ts-expect-error Exact literals remain statically precise in candidates.
    state.at(["status"]).set("other");
    // @ts-expect-error Finite exact literal domains reject outsiders.
    phase.set("paused");
    // @ts-expect-error Exact string-or-null domains reject outsiders.
    turn.set("player3");
    // @ts-expect-error Tuple candidates retain position and primitive types.
    pair.replace(["next", "3"]);
    // @ts-expect-error Array candidates retain item domain.
    flags.replace([true, "false"]);
    // @ts-expect-error Object candidates retain required members.
    account.replace({ kind: "user" });
    // @ts-expect-error Whole-root candidates retain required object structure.
    state.at([]).replace({ name: "Ada" });
    void fabricatedAge;
    void crossSchemaProof;
  }

  void governed;
  void governedAge;
  void governedFlags;
  void governedPair;
  void governedAccount;
  void libraryGovernedAge;
});

check("refinement and composite failures reject before revision or publication", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: user(), schema: UserSchema } });
  const state = map.lib("state");
  const publications: unknown[] = [];
  map.commits.observe((event) => publications.push(event));
  const before = map.rev;
  const root = state.snap();

  assert.throws(() => state.at(["age"]).set(37.5));
  assert.throws(() => state.at(["age"]).set(-1));
  assert.throws(() => state.at(["age"]).set(130));
  assert.throws(() => state.at(["code"]).set("bad"));
  assert.throws(() => state.at(["flags"]).replace([true, true]));
  assert.deepEqual(state.snap(), root);
  assert.equal(map.rev, before);
  assert.equal(publications.length, 0);

  state.at(["age"]).set(38);
  state.at(["code"]).set("ID-7");
  state.at(["flags"]).replace([true]);
  state.at(["pair"]).replace(["pair", 3]);
  state.at(["account"]).replace({ kind: "admin", level: 4 });
  assert.equal(map.rev, before + 4);
  assert.equal(state.at(["age"]).snap(), 38);
});

check("nested recursive handles preserve governed reads while accepting ordinary candidates", () => {
  const map = hsonLiveMap.fromLibraries({ tree: { data: {
    value: "root",
    age: 1,
    children: [{ value: "leaf", age: 0, children: [] }],
  }, schema: TreeSchema } });
  const state = map.lib("tree");
  const age = state.at(["children", 0, "age"]);
  const before = map.rev;
  age.set(4);
  const governedAge: SchemaType<typeof TreeSchema>["age"] | undefined = age.snap();
  assert.equal(age.snap(), 4);
  assert.throws(() => age.set(-1));
  assert.equal(map.rev, before + 1);
  void governedAge;
});

check("construction and restore cannot install invalid governed data", () => {
  assert.throws(() => hsonLiveMap.fromLibraries({ state: { data: user(-1), schema: UserSchema } }));

  const map = hsonLiveMap.fromLibraries({ state: { data: user(), schema: UserSchema } });
  const state = map.lib("state");
  const beforeRoot = state.snap();
  const beforeRev = map.rev;
  const capture = map.capture();
  const entry = capture.libraries[0];
  if (entry === undefined) throw new Error("Expected state library capture.");
  const invalidCapture = { ...capture, libraries: [{ ...entry, root: encode_hosted_root(hsonTransform.fromJson(user(-1)).toNode()) }] };
  assert.throws(() => map.restore(invalidCapture));
  assert.deepEqual(state.snap(), beforeRoot);
  assert.equal(map.rev, beforeRev);
});

testEvents.terminal("pass");

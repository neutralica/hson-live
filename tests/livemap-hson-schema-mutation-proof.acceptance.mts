import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "hson-live";
import { TreeSchema, UserSchema, type TreeSchemaType, type UserSchemaType } from "./fixtures/hson-schema-mvp/producer.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
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
  const map = hsonLiveMap.fromJson(user()).schema.use(UserSchema);
  const age = map.at(["age"]);
  const flags = map.at(["flags"]);
  const pair = map.at(["pair"]);
  const account = map.at(["account"]);
  const phase = map.at(["phase"]);
  const turn = map.at(["turn"]);
  const signedZeroChoice = map.at(["signedZeroChoice"]);

  const governed: UserSchemaType = map.snap();
  const governedAge: UserSchemaType["age"] = age.snap();
  const governedFlags: UserSchemaType["flags"] = flags.snap();
  const governedPair: UserSchemaType["pair"] = pair.snap();
  const governedAccount: UserSchemaType["account"] = account.snap();
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
  map.at(["nickname"]).set("grace");

  const libraries = hsonLiveMap.fromLibraries({
    state: { data: user(), schema: UserSchema },
    tree: { data: { value: "root", age: 1, children: [] }, schema: TreeSchema },
  });
  const libraryAge = libraries.lib("state").at(["age"]);
  libraryAge.set(38);
  const libraryGovernedAge: UserSchemaType["age"] = libraryAge.snap();
  assert.equal(libraries.rev, 1);

  if (false) {
    // @ts-expect-error Schema, not a caller-selected generic, controls the governed map type.
    hsonLiveMap.fromJson(user()).schema.use<UserSchemaType>(UserSchema);
    // @ts-expect-error Candidate domain follows the generated leaf domain.
    age.set("38");
    // @ts-expect-error Named Library handles retain the same candidate domain.
    libraryAge.set("38");
    // @ts-expect-error A plain candidate cannot impersonate the certified integer read.
    const fabricatedAge: UserSchemaType["age"] = 38;
    // @ts-expect-error One Schema's numeric proof is not another Schema's proof.
    const crossSchemaProof: TreeSchemaType["age"] = age.snap();
    // @ts-expect-error Exact literals remain statically precise in candidates.
    map.at(["status"]).set("other");
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
    map.replace({ name: "Ada" });
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
  const map = hsonLiveMap.fromJson(user()).schema.use(UserSchema);
  const publications: unknown[] = [];
  map.commits.observe((event) => publications.push(event));
  const before = map.rev;
  const root = map.snap();

  assert.throws(() => map.at(["age"]).set(37.5));
  assert.throws(() => map.at(["age"]).set(-1));
  assert.throws(() => map.at(["age"]).set(130));
  assert.throws(() => map.at(["code"]).set("bad"));
  assert.throws(() => map.at(["flags"]).replace([true, true]));
  assert.deepEqual(map.snap(), root);
  assert.equal(map.rev, before);
  assert.equal(publications.length, 0);

  map.at(["age"]).set(38);
  map.at(["code"]).set("ID-7");
  map.at(["flags"]).replace([true]);
  map.at(["pair"]).replace(["pair", 3]);
  map.at(["account"]).replace({ kind: "admin", level: 4 });
  assert.equal(map.rev, before + 4);
  assert.equal(map.at(["age"]).snap(), 38);
});

check("nested recursive handles preserve governed reads while accepting ordinary candidates", () => {
  const map = hsonLiveMap.fromJson({
    value: "root",
    age: 1,
    children: [{ value: "leaf", age: 0, children: [] }],
  }).schema.use(TreeSchema);
  const age = map.at(["children", 0, "age"]);
  const before = map.rev;
  age.set(4);
  const governedAge: TreeSchemaType["age"] | undefined = age.snap();
  assert.equal(age.snap(), 4);
  assert.throws(() => age.set(-1));
  assert.equal(map.rev, before + 1);
  void governedAge;
});

check("construction, restore, and replay cannot install invalid governed data", () => {
  assert.throws(() => hsonLiveMap.fromLibraries({ state: { data: user(-1), schema: UserSchema } }));

  const map = hsonLiveMap.fromJson(user()).schema.use(UserSchema);
  const beforeRoot = map.snap();
  const beforeRev = map.rev;
  const invalidCapture = hsonLiveMap.fromJson(user(-1)).capture();
  assert.throws(() => map.restore(invalidCapture));
  assert.throws(() => map.replay({
    prevRev: map.rev,
    ops: [{ kind: "set", path: ["age"], prev: 37, next: 37.5 }],
  } as never));
  assert.deepEqual(map.snap(), beforeRoot);
  assert.equal(map.rev, beforeRev);
});

testEvents.terminal("pass");
emit_hson_live_test_completion("livemap-hson-schema-mutation-proof", checks, checks, 0);

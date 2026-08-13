// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError } from "../src/index.ts";
import { get_livemap_staged_authority } from "../src/api/livemap/livemap.authority.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const State = hson.liveMap.schema.define((s) => s.object.exact({ count: s.number }));
const Equivalent = hson.liveMap.schema.define((s) => s.object.exact({ count: s.number }));
const Different = hson.liveMap.schema.define((s) => s.object.exact({ count: s.string }));
const Wrapped = hson.liveMap.schema.define(() => State);

await check("valid first attachment records the exact schema object", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  assert.equal(map.schema.use(State), map);
  assert.equal(map.schema.get(), State);
});

await check("invalid first attachment rejects synchronously", () => {
  const map = hson.liveMap.fromJson({ count: "wrong" });
  assert.throws(() => map.schema.use(State), LiveMapSchemaError);
});

await check("failed first attachment leaves the owner schema-less", () => {
  const map = hson.liveMap.fromJson({ count: "wrong" });
  assert.throws(() => map.schema.use(State));
  assert.equal(map.schema.get(), undefined);
});

await check("failed first attachment leaves state and revision unchanged", () => {
  const map = hson.liveMap.fromJson({ count: "wrong" });
  const before = map.capture();
  assert.throws(() => map.schema.use(State));
  assert.deepEqual(map.capture(), before);
});

await check("a valid schema can attach after a failed first attempt", () => {
  const map = hson.liveMap.fromJson({ count: "ready" });
  assert.throws(() => map.schema.use(State));
  assert.equal(map.schema.use(Different), map);
  assert.equal(map.schema.get(), Different);
});

await check("same-object reattachment is idempotent", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  map.schema.use(State);
  const before = map.capture();
  assert.equal(map.schema.use(State), map);
  assert.equal(map.schema.get(), State);
  assert.deepEqual(map.capture(), before);
});

await check("ordinary aliases to the same schema object reattach idempotently", () => {
  const Alias = State;
  const map = hson.liveMap.fromJson({ count: 0 });
  map.schema.use(State);
  assert.equal(map.schema.use(Alias), map);
});

await check("structurally equivalent distinct schemas cannot replace the contract", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  map.schema.use(State);
  assert.throws(() => map.schema.use(Equivalent), /already attached and cannot be replaced/);
});

await check("different state-space schemas cannot replace the contract", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  map.schema.use(State);
  assert.throws(() => map.schema.use(Different), /already attached and cannot be replaced/);
});

await check("wrapper definitions remain distinct schema identities", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  map.schema.use(State);
  assert.throws(() => map.schema.use(Wrapped), /already attached and cannot be replaced/);
});

await check("first attachment does not advance revision or emit commits", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  const observations: unknown[] = [];
  map.commits.observe((event) => observations.push(event));
  const beforeRev = map.rev;
  map.schema.use(State);
  assert.equal(map.rev, beforeRev);
  assert.deepEqual(observations, []);
});

await check("first attachment does not notify watch or feed listeners", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  const watched: unknown[] = [];
  const fed: unknown[] = [];
  map.at([]).watch((value) => watched.push(value));
  map.feed([], (event) => fed.push(event));
  map.schema.use(State);
  assert.deepEqual(watched, []);
  assert.deepEqual(fed, []);
});

await check("valid mutation remains admitted after attachment", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  const location = map.at(["count"]);
  const proxy = map.proxy(["count"]);
  const watched: unknown[] = [];
  location.watch((value) => watched.push(value));
  map.schema.use(State);
  assert.equal(location.snap(), 0);
  assert.equal(proxy.$_.set(1).rev, 1);
  assert.deepEqual(map.snap(), { count: 1 });
  assert.deepEqual(watched, [1]);
});

await check("invalid mutation rejects atomically after attachment", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  const location = map.at(["count"]);
  const watched: unknown[] = [];
  const fed: unknown[] = [];
  const committed: unknown[] = [];
  map.at(["count"]).watch((value) => watched.push(value));
  map.feed([], (event) => fed.push(event));
  map.commits.observe((event) => committed.push(event));
  map.schema.use(State);
  const before = map.capture();
  assert.throws(() => location.set("wrong" as never), LiveMapSchemaError);
  assert.deepEqual(map.capture(), before);
  assert.deepEqual({ watched, fed, committed }, { watched: [], fed: [], committed: [] });
});

await check("rejected replacement leaves A attached and state unchanged", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  map.schema.use(State);
  const before = map.capture();
  assert.throws(() => map.schema.use(Equivalent));
  assert.equal(map.schema.get(), State);
  assert.deepEqual(map.capture(), before);
  map.set(["count"], 1);
});

await check("one immutable schema object governs independent owners", () => {
  const first = hson.liveMap.fromJson({ count: 1 });
  const second = hson.liveMap.fromJson({ count: 2 });
  first.schema.use(State);
  second.schema.use(State);
  assert.equal(first.schema.get(), State);
  assert.equal(second.schema.get(), State);
});

await check("owners sharing one schema enforce and mutate independently", () => {
  const first = hson.liveMap.fromJson({ count: 1 }).schema.use(State);
  const second = hson.liveMap.fromJson({ count: 2 }).schema.use(State);
  first.set(["count"], 3);
  assert.deepEqual(first.snap(), { count: 3 });
  assert.deepEqual(second.snap(), { count: 2 });
  assert.throws(() => second.set(["count"], "wrong" as never));
});

await check("restore retains and enforces the permanent schema", () => {
  const map = hson.liveMap.fromJson({ count: 0 }).schema.use(State);
  const before = map.capture();
  assert.throws(() => map.restore({ rev: 7, value: { count: "wrong" } } as never), LiveMapSchemaError);
  assert.equal(map.schema.get(), State);
  assert.deepEqual(map.capture(), before);
});

await check("replay retains and enforces the permanent schema", () => {
  const map = hson.liveMap.fromJson({ count: 0 }).schema.use(State);
  const source = hson.liveMap.fromJson({ count: 0 });
  const invalid = source.set(["count"], "wrong");
  const before = map.capture();
  assert.throws(() => map.replay(invalid), LiveMapSchemaError);
  assert.equal(map.schema.get(), State);
  assert.deepEqual(map.capture(), before);
});

await check("staged authority evaluates candidates under the permanent schema", () => {
  const map = hson.liveMap.fromJson({ count: 0 }).schema.use(State);
  const authority = get_livemap_staged_authority(map);
  assert.throws(() => authority.prepare((draft) => draft.set(["count"], "wrong" as never)), LiveMapSchemaError);
  assert.deepEqual(map.snap(), { count: 0 });
});

await check("schema attachment invalidates a previously prepared schema-less candidate", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  const authority = get_livemap_staged_authority(map);
  const transition = authority.prepare((draft) => draft.set(["count"], 1));
  map.schema.use(State);
  assert.throws(() => authority.accept(transition), /stale/i);
  assert.deepEqual(map.snap(), { count: 0 });
});

await check("LiveHost mutations remain governed by the permanent schema", async () => {
  const map = hson.liveMap.fromJson({ count: 0 }).schema.use(State);
  const host = hson.liveHost.create({ map });
  await host.mutate((draft) => draft.set(["count"], 1));
  await assert.rejects(host.mutate((draft) => draft.set(["count"], "wrong" as never)));
  assert.deepEqual(map.snap(), { count: 1 });
  assert.equal(map.schema.get(), State);
  host.dispose();
});

await check("schema attachment has no detach reset or replacement operation", () => {
  const map = hson.liveMap.fromJson({ count: 0 });
  assert.deepEqual(Object.keys(map.schema).sort(), ["get", "has", "match", "must", "resolve", "use"]);
  for (const name of ["clear", "drop", "reset", "replace"]) assert.equal(name in map.schema, false);
});

process.stdout.write(`# ${checks} projected schema owner-contract checks passed\n`);
emit_hson_live_test_completion("livemap.schema-owner-contract", checks, checks, 0);

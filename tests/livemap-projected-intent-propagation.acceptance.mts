// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { create_locus } from "../src/api/locus/locus.core.ts";
import { link_livemap } from "../src/api/livemap/livemap.link.ts";
import { make_livemap_store_api } from "../src/api/livemap/livemap.store.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { ordered_projected_array, ordered_projected_object } from "../src/core/ordered-projected-value.ts";
import {
  decode_livemap_replay_payload,
  encode_projected_value_transport,
} from "../src/api/livemap/livemap.transport.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

async function check_async(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const map = (value: Parameters<typeof hson.liveMap.fromJson>[0]) => hson.liveMap.fromJson(value);

check("rename intent reaches canonical commit observers", () => {
  const source = map({ source: 1 });
  let kind: string | undefined;
  source.commits.observe((event) => {
    const op = event.kind === "commit" ? event.commit.ops[0] : undefined;
    if (op !== undefined && "kind" in op) kind = op.kind;
  });
  source.at([]).object.renameKey("source", "destination");
  assert.equal(kind, "rename");
});

check("move intent reaches canonical commit observers", () => {
  const source = map({ items: [1, 2] });
  let kind: string | undefined;
  source.commits.observe((event) => {
    const op = event.kind === "commit" ? event.commit.ops[0] : undefined;
    if (op !== undefined && "kind" in op) kind = op.kind;
  });
  source.at(["items"]).array.move(0, 1);
  assert.equal(kind, "move");
});

check("rename intent reaches public feeds", () => {
  const source = map({ source: 1 });
  let kind: string | undefined;
  source.feed([], (event) => { kind = event.op.kind; });
  source.at([]).object.renameKey("source", "destination");
  assert.equal(kind, "rename");
});

check("move intent reaches path feeds", () => {
  const source = map({ items: [1, 2] });
  let kind: string | undefined;
  source.feed(["items"], (event) => { kind = event.op.kind; });
  source.at(["items"]).array.move(0, 1);
  assert.equal(kind, "move");
});

check("feed mutation cannot alter rename replay", () => {
  const source = map({ source: { value: 1 } });
  source.feed([], (event) => {
    const op = event.op;
    if (op.kind === "rename") (op.next as { destination: { value: number } }).destination.value = 9;
  });
  const commit = source.at([]).object.renameKey("source", "destination");
  const target = map({ source: { value: 1 } });
  target.replay(commit);
  assert.deepEqual(target.snap(), { destination: { value: 1 } });
});

check("same-path link propagates rename intent", () => {
  const source = map({ source: 1, kept: 2 });
  const target = map({ source: 1, kept: 2 });
  let targetKind: string | undefined;
  target.feed([], (event) => { targetKind = event.op.kind; });
  link_livemap(source, target, { path: [] });
  source.at([]).object.renameKey("source", "destination");
  assert.equal(targetKind, "rename");
  assert.deepEqual(target.snap(), source.snap());
});

check("same-path link propagates move intent", () => {
  const source = map({ items: [1, 2, 3] });
  const target = map({ items: [1, 2, 3] });
  let targetKind: string | undefined;
  target.feed(["items"], (event) => { targetKind = event.op.kind; });
  link_livemap(source, target, { path: [] });
  source.at(["items"]).array.move(0, 2);
  assert.equal(targetKind, "move");
  assert.deepEqual(target.snap(), source.snap());
});

check("mapped links translate semantic operation paths", () => {
  const source = map({ left: { source: 1 } });
  const target = map({ right: { source: 1 } });
  link_livemap(source, target, { from: ["left"], to: ["right"] });
  source.at(["left"]).object.renameKey("source", "destination");
  assert.deepEqual(target.snap(), { right: { destination: 1 } });
});

check("handle links preserve semantic move intent", () => {
  const source = map({ items: [1, 2] });
  const target = map({ copy: [1, 2] });
  let targetKind: string | undefined;
  target.feed(["copy"], (event) => { targetKind = event.op.kind; });
  source.at(["items"]).linkTo(target.at(["copy"]));
  source.at(["items"]).array.move(0, 1);
  assert.equal(targetKind, "move");
});

check("divergent link targets fall back to scoped replacement", () => {
  const source = map({ source: 1 });
  const target = map({ other: 2 });
  link_livemap(source, target, { path: [] });
  source.at([]).object.renameKey("source", "destination");
  assert.deepEqual(target.snap(), { destination: 1 });
  assert.deepEqual(source.snap(), { destination: 1 });
});

check("store snapshots publish order-only rename changes", () => {
  const source = map('{"a":1,"source":2,"z":3}');
  let calls = 0;
  make_livemap_store_api(source).subscribeDiff(() => { calls += 1; });
  source.at([]).object.renameKey("source", "destination");
  assert.equal(calls, 1);
});

check("store snapshots publish order-only moves", () => {
  const source = map({ items: [1, 2, 3] });
  let calls = 0;
  make_livemap_store_api(source).subscribeDiff(() => { calls += 1; });
  source.at(["items"]).array.move(0, 2);
  assert.equal(calls, 1);
});

check("exact no-op move suppresses feeds and stores", () => {
  const source = map({ items: [1, 2] });
  let feeds = 0;
  let stores = 0;
  source.feed([], () => { feeds += 1; });
  make_livemap_store_api(source).subscribeDiff(() => { stores += 1; });
  source.at(["items"]).array.move(0, 0);
  assert.deepEqual([feeds, stores], [0, 0]);
});

await check_async("Locus history retains rename intent", async () => {
  const host = create_locus({ state: { source: 1 } });
  await host.mutate((draft) => draft.at([]).object.renameKey("source", "destination"));
  const op = host.stream.history.replay_after(0)?.[0]?.ops[0];
  assert.equal(op !== undefined && "kind" in op ? op.kind : undefined, "rename");
  host.dispose();
});

await check_async("Locus history retains move intent", async () => {
  const host = create_locus({ state: { items: [1, 2] } });
  await host.mutate((draft) => draft.at(["items"]).array.move(0, 1));
  const op = host.stream.history.replay_after(0)?.[0]?.ops[0];
  assert.equal(op !== undefined && "kind" in op ? op.kind : undefined, "move");
  host.dispose();
});

check("canonical rename replay remains bounded and deterministic", () => {
  const source = map({ source: 1 });
  const commit = source.at([]).object.renameKey("source", "destination");
  const target = map({ source: 1 });
  target.replay(commit);
  assert.deepEqual(target.snap(), source.snap());
});

check("canonical move replay remains bounded and deterministic", () => {
  const source = map({ items: [1, 2, 3] });
  const commit = source.at(["items"]).array.move(0, 2);
  const target = map({ items: [1, 2, 3] });
  target.replay(commit);
  assert.deepEqual(target.snap(), source.snap());
});

check("older set-shaped legacy replay is rejected", () => {
  const target = map({ value: 1 });
  assert.throws(() => target.replay({ prevRev: 0, ops: [{ kind: "set", path: ["value"], prev: 1, next: 2 }] } as never));
  assert.deepEqual(target.snap(), { value: 1 });
});

check("malformed exact move indexes reject", () => {
  const malformed = ordered_projected_array([ordered_projected_object([
    ["kind", "move"], ["path", ordered_projected_array(["items"])], ["from", -1], ["to", 0],
    ["prev", ordered_projected_array([1, 2])], ["next", ordered_projected_array([2, 1])],
  ])]);
  const payload = encode_projected_value_transport(malformed).payload;
  assert.throws(() => decode_livemap_replay_payload(payload), /non-negative safe integer/);
});

check("malformed exact rename witnesses reject", () => {
  const malformed = ordered_projected_array([ordered_projected_object([
    ["kind", "rename"], ["path", ordered_projected_array([])], ["from", "source"], ["to", "destination"],
    ["prev", ordered_projected_array([1])], ["next", ordered_projected_array([1])],
  ])]);
  const payload = encode_projected_value_transport(malformed).payload;
  assert.throws(() => decode_livemap_replay_payload(payload), /prev is not an object/);
});

check("stale revision rejection publishes nothing", () => {
  const source = map({ source: 1 });
  const commit = source.at([]).object.renameKey("source", "destination");
  const target = map({ source: 1 });
  target.set(["source"], 2);
  const before = target.capture();
  assert.throws(() => target.replay(commit), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "STALE_REV"
  ));
  assert.deepEqual(target.capture(), before);
});

check("replay witness mismatch is atomic", () => {
  const source = map({ items: [1, 2] });
  const commit = source.at(["items"]).array.move(0, 1);
  const target = map({ items: [9, 2] });
  const before = target.capture();
  assert.throws(() => target.replay(commit), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "REPLAY_CONFLICT"
  ));
  assert.deepEqual(target.capture(), before);
});

check("rename and move close through strict canonical graph equality", () => {
  const source = map({ source: { items: [1, 2, 3] } });
  const rename = source.at([]).object.renameKey("source", "destination");
  const move = source.at(["destination", "items"]).array.move(0, 2);
  const target = map({ source: { items: [1, 2, 3] } });
  target.replay(rename);
  target.replay(move);
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});

check("propagation never introduces QUID metadata", () => {
  const source = map({ source: { items: [1, 2] } });
  const target = map({ source: { items: [1, 2] } });
  link_livemap(source, target, { path: [] });
  source.at([]).object.renameKey("source", "destination");
  source.at(["destination", "items"]).array.move(0, 1);
  assert.equal(JSON.stringify(target.root()).includes("quid"), false);
});

process.stdout.write(`# ${checks} projected intent propagation checks passed\n`);
emit_hson_live_test_completion("livemap.projected-intent-propagation", checks, checks, 0);

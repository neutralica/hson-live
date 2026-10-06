import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import type { LiveMapCommit, LiveMapLibraryFeedEvent } from "../src/types/livemap.types.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { ordered_projected_array } from "../src/core/ordered-projected-value.ts";
import { decode_livemap_replay_payload, encode_livemap_replay_transport } from "../src/api/livemap/livemap.transport.ts";
import type { JsonValue } from "../src/core/types.ts";
import type { HsonSchema } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap-root-mutation",
  title: "LiveMap root set and update",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "mutation", "hson-schema", "public-api"]),
});

const events = create_test_event_emitter("livemap-root-mutation");
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : "Check failed.");
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok - ${name}\n`);
}

// Runtime Schemas keep these regressions independent of generated Schema fixtures.
const StateSchema = Hson.schema`<type "data" content <count <number <int true min 0>> keep "number" nested <content <a "number" b <optional "number">>>>>`;
const ArraySchema = Hson.schema`<type "data" defs <Value <array "number">> content <ref "Value">>`;
const TupleSchema = Hson.schema`<type "data" defs <Value <tuple ["string", "number"]>> content <ref "Value">>`;
const NumberSchema = Hson.schema`<type "data" defs <Value "number"> content <ref "Value">>`;

function governed() {
  const map = hsonLiveMap.fromLibraries({
    state: { data: { count: 1, keep: 2, nested: { a: 1, b: 2 } }, schema: StateSchema },
  });
  const state = map.lib("state");
  const root = state.at([]);
  const publications: LiveMapCommit[] = [];
  const feeds: LiveMapLibraryFeedEvent[] = [];
  map.commits.observe(commit => publications.push(commit));
  root.feed(event => feeds.push(event));
  return { map, state, root, publications, feeds };
}

function changed(commit: LiveMapCommit, prevRev: number): void {
  assert.equal(commit.changed, true);
  assert.deepEqual([commit.prevRev, commit.rev], [prevRev, prevRev + 1]);
  assert.ok(commit.operations.length > 0);
}

function unchanged(commit: LiveMapCommit, rev: number): void {
  assert.equal(commit.changed, false);
  assert.deepEqual([commit.prevRev, commit.rev], [rev, rev]);
  assert.deepEqual(commit.operations, []);
}

check("root object set is a shallow patch and publishes one final state", () => {
  const { map, state, root, publications, feeds } = governed();
  // Omitted root members survive; a supplied object member is assigned exactly.
  const commit = root.set({ count: 3, nested: { a: 4 } });
  const expected = { count: 3, keep: 2, nested: { a: 4 } };
  assert.deepEqual(state.snap(), expected);
  changed(commit, 0);
  assert.equal(map.rev, 1);
  assert.equal(publications.length, 1);
  assert.equal(feeds.length, 1);
  assert.deepEqual(feeds[0]?.value, expected);
  assert.deepEqual(publications[0], commit);
  assert.deepEqual(feeds[0]?.commit, commit);
});

check("root update receives a detached structural snapshot and uses set semantics", () => {
  const { map, state, root, publications, feeds } = governed();
  let calls = 0;
  const commit = root.update(current => {
    calls += 1;
    assert.deepEqual(current, { count: 1, keep: 2, nested: { a: 1, b: 2 } });
    assert.notEqual(current, state.snap());
    // Even mutation of the detached callback argument cannot change live state.
    Object.assign(current.nested, { a: 99 });
    assert.equal(state.at(["nested", "a"]).snap(), 1);
    return { count: current.count + 1 };
  });
  assert.equal(calls, 1);
  assert.deepEqual(state.snap(), { count: 2, keep: 2, nested: { a: 1, b: 2 } });
  changed(commit, 0);
  changed(root.update(current => {
    assert.deepEqual(current, { count: 2, keep: 2, nested: { a: 1, b: 2 } });
    return { ...current, count: current.count + 1 };
  }), 1);
  assert.deepEqual(state.snap(), { count: 3, keep: 2, nested: { a: 1, b: 2 } });
  assert.equal(map.rev, 2);
  assert.equal(publications.length, 2);
  assert.equal(feeds.length, 2);
});

check("root and nested no-ops follow the same revision and publication policy", () => {
  const { map, root, publications, feeds } = governed();
  // Constructive root writes preserve an identified ancestor container.
  const identity = acquire_projected_identity(map.lib("state"), []);
  unchanged(root.set({}), 0);
  unchanged(root.set({ count: 1 }), 0);
  unchanged(root.update(current => {
    assert.deepEqual(current, { count: 1, keep: 2, nested: { a: 1, b: 2 } });
    return current;
  }), 0);
  unchanged(root.at(["nested"]).set({ a: 1 }), 0);
  unchanged(root.at(["nested"]).update(current => {
    assert.deepEqual(current, { a: 1, b: 2 });
    return current;
  }), 0);
  assert.equal(identity.active, true);
  assert.equal(map.rev, 0);
  assert.equal(publications.length, 0);
  assert.equal(feeds.length, 0);
});

check("invalid root candidates reject before any revision, commit, or feed", () => {
  const { map, state, root, publications, feeds } = governed();
  const before = state.snap();
  // A valid member preceding the invalid member must not escape candidate planning.
  assert.throws(() => root.set({ keep: 7, count: -1 }), /Schema|schema/);
  assert.throws(() => root.update(current => {
    assert.deepEqual(current, before);
    return { count: 1.5 };
  }), /Schema|schema/);
  assert.deepEqual(state.snap(), before);
  assert.equal(map.rev, 0);
  assert.equal(publications.length, 0);
  assert.equal(feeds.length, 0);
  changed(root.set({ count: 2 }), 0);
  const accepted = state.snap();
  assert.throws(() => root.update(() => ({ count: -1 })), /Schema|schema/);
  assert.deepEqual(state.snap(), accepted);
  assert.equal(map.rev, 1);
  assert.equal(publications.length, 1);
  assert.equal(feeds.length, 1);
});

check("nested set and update preserve shallow patch versus exact replacement", () => {
  const { map, state, publications, feeds } = governed();
  const nested = state.at(["nested"]);
  changed(nested.set({ a: 3 }), 0);
  assert.deepEqual(nested.snap(), { a: 3, b: 2 });
  changed(nested.update(current => {
    assert.deepEqual(current, { a: 3, b: 2 });
    return { a: current.a + 1 };
  }), 1);
  assert.deepEqual(nested.snap(), { a: 4, b: 2 });
  changed(nested.replace({ a: 5 }), 2);
  assert.deepEqual(nested.snap(), { a: 5 });
  assert.equal(map.rev, 3);
  assert.equal(publications.length, 3);
  assert.equal(feeds.length, 3);
});

check("explicit root replacement removes omitted members and validates the complete candidate", () => {
  const { map, root, publications, feeds } = governed();
  assert.throws(() => root.replace({ count: 3 }), /Schema|schema/);
  assert.equal(map.rev, 0);
  assert.equal(publications.length, 0);
  assert.equal(feeds.length, 0);
  const broad = hsonLiveMap.fromLibraries({ state: { data: { a: 1, b: 2 } } });
  const broadRoot = broad.lib("state").at([]);
  changed(broadRoot.replace({ a: 3 }), 0);
  assert.deepEqual(broadRoot.snap(), { a: 3 });
});

check("root arrays and tuples assign the whole endpoint and retain ordinary no-ops", () => {
  for (const { schema, initial, next, proposal } of [
    { schema: ArraySchema, initial: [1, 2, 3], next: [4], proposal: [5, 6] },
    { schema: TupleSchema, initial: ["first", 1], next: ["next", 2], proposal: ["updated", 3] },
  ]) {
    const map = hsonLiveMap.fromLibraries({ state: { data: initial, schema } });
    const root = map.lib("state").at([]);
    let publications = 0;
    let feeds = 0;
    map.commits.observe(() => { publications += 1; });
    root.feed(() => { feeds += 1; });
    changed(root.set(next), 0);
    assert.deepEqual(root.snap(), next);
    const identity = acquire_projected_identity(map.lib("state"), []);
    unchanged(root.set(next), 1);
    unchanged(root.update(current => {
      assert.deepEqual(current, next);
      return current;
    }), 1);
    assert.equal(identity.active, true);
    changed(root.update(() => proposal), 1);
    assert.equal(identity.active, false);
    assert.deepEqual(root.snap(), proposal);
    assert.throws(() => root.set([true]), /Schema|schema/);
    assert.deepEqual(root.snap(), proposal);
    assert.equal(map.rev, 2);
    assert.equal(publications, 2);
    assert.equal(feeds, 2);

    const nestedMap = hsonLiveMap.fromLibraries({ state: { data: { items: next } } });
    const nested = nestedMap.lib("state").at(["items"]);
    const nestedIdentity = acquire_projected_identity(nestedMap.lib("state"), ["items"]);
    unchanged(nested.set(next), 0);
    unchanged(nested.update(current => {
      assert.deepEqual(current, next);
      return current;
    }), 0);
    assert.equal(nestedIdentity.active, true);
  }
});

check("root primitive set and update replace the value with atomic validation", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: 1, schema: NumberSchema } });
  const root = map.lib("state").at([]);
  let publications = 0;
  let feeds = 0;
  map.commits.observe(() => { publications += 1; });
  root.feed(() => { feeds += 1; });
  changed(root.set(2), 0);
  assert.equal(root.snap(), 2);
  unchanged(root.set(2), 1);
  unchanged(root.update(current => {
    assert.equal(current, 2);
    return current;
  }), 1);
  changed(root.update(current => {
    assert.equal(current, 2);
    return current + 1;
  }), 1);
  assert.throws(() => root.update(() => "wrong"), /Schema|schema/);
  assert.equal(root.snap(), 3);
  assert.equal(map.rev, 2);
  assert.equal(publications, 2);
  assert.equal(feeds, 2);
});

check("multi-library root assignments preserve other values, identity, and the issued epoch", () => {
  const cases: readonly { initial: JsonValue; next: JsonValue; proposal: JsonValue; schema?: HsonSchema }[] = [
    { initial: [1, 2], next: [3], proposal: [4, 5], schema: ArraySchema },
    { initial: ["first", 1], next: ["next", 2], proposal: ["updated", 3], schema: TupleSchema },
    { initial: 1, next: 2, proposal: 3, schema: NumberSchema },
    { initial: "first", next: "next", proposal: "updated" },
    { initial: false, next: true, proposal: false },
    { initial: 0, next: -0, proposal: 0 },
  ];
  for (const { initial, next, proposal, schema } of cases) {
    const map = hsonLiveMap.fromLibraries({
      state: { data: JSON.stringify(initial), ...(schema === undefined ? {} : { schema }) },
      other: { data: { keep: { value: 1 } } },
    });
    // Runtime Schema cases intentionally use the Schema-neutral selector.
    const state = map.lib(String("state"));
    assert.ok(state.mode !== "document");
    const root = state.at([]);
    const other = map.lib("other");
    const otherIdentity = acquire_projected_identity(other, ["keep"]);
    const endpointIdentity = Array.isArray(initial) ? acquire_projected_identity(state, []) : undefined;
    const beforeIdentity = livemap_identity_epoch_accounting(state);
    const publications: LiveMapCommit[] = [];
    const feeds: LiveMapLibraryFeedEvent[] = [];
    let otherFeeds = 0;
    map.commits.observe(commit => publications.push(commit));
    root.feed(event => feeds.push(event));
    other.at([]).feed(() => { otherFeeds += 1; });

    unchanged(root.set(initial), 0);
    unchanged(root.update(current => {
      assert.ok(current !== undefined);
      return current;
    }), 0);
    assert.equal(endpointIdentity?.active, Array.isArray(initial) ? true : undefined);
    assert.equal(publications.length, 0);
    assert.equal(feeds.length, 0);
    const commit = root.set(next);
    changed(commit, 0);
    assert.deepEqual(commit.operations.map(entry => [entry.library, entry.operation.kind, entry.operation.path]),
      [["state", "set", []]]);
    assert.deepEqual(root.snap(), next);
    assert.equal(endpointIdentity?.active, Array.isArray(initial) ? false : undefined);
    assert.deepEqual(livemap_identity_epoch_accounting(state), beforeIdentity);
    assert.deepEqual(livemap_identity_epoch_accounting(other), beforeIdentity);
    assert.deepEqual(otherIdentity.snap(), { value: 1 });
    assert.equal(otherIdentity.active, true);
    assert.deepEqual(other.snap(), { keep: { value: 1 } });
    assert.equal(publications.length, 1);
    assert.equal(feeds.length, 1);
    assert.deepEqual(feeds[0]?.value, next);
    assert.equal(otherFeeds, 0);

    const reacquired = Array.isArray(next) ? acquire_projected_identity(state, []) : undefined;
    const afterAcquire = livemap_identity_epoch_accounting(state);
    assert.equal(afterAcquire.epoch, beforeIdentity.epoch);
    assert.equal(afterAcquire.issued, beforeIdentity.issued + (reacquired === undefined ? 0 : 1));
    unchanged(root.set(next), 1);
    unchanged(root.update(current => {
      assert.ok(current !== undefined);
      return current;
    }), 1);
    assert.equal(reacquired?.active, Array.isArray(next) ? true : undefined);
    let calls = 0;
    const update = root.update(current => {
      calls += 1;
      assert.deepEqual(current, next);
      if (Array.isArray(current)) {
        current.push(99);
        assert.deepEqual(root.snap(), next);
      }
      return proposal;
    });
    changed(update, 1);
    assert.equal(calls, 1);
    assert.deepEqual(root.snap(), proposal);
    assert.equal(reacquired?.active, Array.isArray(next) ? false : undefined);
    assert.deepEqual(livemap_identity_epoch_accounting(state), afterAcquire);
    assert.equal(otherIdentity.active, true);
    assert.deepEqual(otherIdentity.snap(), { value: 1 });
    assert.equal(map.rev, 2);
    assert.equal(publications.length, 2);
    assert.equal(feeds.length, 2);
    assert.equal(otherFeeds, 0);
    assert.deepEqual(feeds[1]?.value, proposal);
  }
});

check("multi-library rejected assignments and explicit replacement retain existing policy atomically", () => {
  const map = hsonLiveMap.fromLibraries({
    state: { data: [1, 2], schema: ArraySchema },
    other: { data: { keep: 1 } },
  });
  const state = map.lib("state");
  const root = state.at([]);
  const identity = acquire_projected_identity(state, []);
  const otherIdentity = acquire_projected_identity(map.lib("other"), []);
  const beforeIdentity = livemap_identity_epoch_accounting(state);
  let publications = 0;
  let feeds = 0;
  map.commits.observe(() => { publications += 1; });
  root.feed(() => { feeds += 1; });
  assert.throws(() => root.set([true]), /Schema|schema/);
  assert.throws(() => root.update(() => [true]), /Schema|schema/);
  assert.throws(() => root.replace([3]), /multiple application Libraries/);
  assert.throws(() => root.replace([1, 2]), /multiple application Libraries/);
  assert.deepEqual(root.snap(), [1, 2]);
  assert.deepEqual(map.lib("other").snap(), { keep: 1 });
  assert.equal(identity.active, true);
  assert.equal(otherIdentity.active, true);
  assert.deepEqual(livemap_identity_epoch_accounting(state), beforeIdentity);
  assert.equal(map.rev, 0);
  assert.equal(publications, 0);
  assert.equal(feeds, 0);

  const single = hsonLiveMap.fromLibraries({ state: { data: [1] } });
  const singleState = single.lib("state");
  const singleRoot = singleState.at([]);
  const singleIdentity = acquire_projected_identity(singleState, []);
  const before = livemap_identity_epoch_accounting(singleState);
  changed(singleRoot.set([2]), 0);
  assert.equal(singleIdentity.active, false);
  assert.deepEqual(livemap_identity_epoch_accounting(singleState), before);
  const fresh = acquire_projected_identity(singleState, []);
  changed(singleRoot.replace([2]), 1);
  assert.equal(fresh.active, false);
  assert.deepEqual(livemap_identity_epoch_accounting(singleState), { epoch: before.epoch + 1, issued: 0 });
});

check("root assignment retires descendants while object patches and nested writes remain constructive", () => {
  const map = hsonLiveMap.fromLibraries({
    state: { data: [{ child: {} }] }, other: { data: { a: 1, b: 2, nested: { a: 1, b: 2 }, items: [1, 2] } },
  });
  const state = map.lib("state");
  const other = map.lib("other");
  const rootIdentity = acquire_projected_identity(state, []);
  const childIdentity = acquire_projected_identity(state, [0, "child"]);
  const otherIdentity = acquire_projected_identity(other, []);
  const before = livemap_identity_epoch_accounting(state);
  state.at([]).set([{ child: { next: 1 } }]);
  assert.equal(rootIdentity.active, false);
  assert.equal(childIdentity.active, false);
  assert.equal(otherIdentity.active, true);
  assert.deepEqual(livemap_identity_epoch_accounting(state), before);
  other.at([]).set({ a: 3, nested: { a: 4 } });
  assert.deepEqual(other.snap(), { a: 3, b: 2, nested: { a: 4 }, items: [1, 2] });
  other.at(["nested"]).set({ b: 5 });
  other.at(["nested"]).update(current => {
    assert.ok(current !== null && typeof current === "object" && !Array.isArray(current));
    assert.ok(typeof current.a === "number");
    return { a: current.a + 1 };
  });
  assert.deepEqual(other.at(["nested"]).snap(), { a: 5, b: 5 });
  other.at(["items"]).set([3]);
  other.at(["items", 0]).update(current => {
    assert.ok(typeof current === "number");
    return current + 1;
  });
  assert.deepEqual(other.at(["items"]).snap(), [4]);
  assert.equal(otherIdentity.active, true);
});

check("multi-library null roots retain fixed root-kind constraints", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: null }, other: { data: {} } });
  const root = map.lib("state").at([]);
  unchanged(root.set(null), 0);
  unchanged(root.update(current => current), 0);
  assert.throws(() => root.set(1), /root mode is fixed/);
  assert.equal(root.snap(), null);
  assert.equal(map.rev, 0);
});

check("replay preserves root assignment intent through the existing operation codec", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: [1] }, other: { data: { keep: 1 } } });
  const aggregate = internal_livemap_aggregate_authority(map);
  const state = map.lib("state");
  const other = acquire_projected_identity(map.lib("other"), []);
  const identity = acquire_projected_identity(state, []);
  const before = livemap_identity_epoch_accounting(state);
  const operation = decode_livemap_replay_payload(encode_livemap_replay_transport([
    { kind: "set", path: [], prev: ordered_projected_array([1]), next: ordered_projected_array([2]) },
  ]).payload)[0];
  assert.ok(operation);
  const target = aggregate.libraries()[0];
  assert.ok(target);
  const commit = aggregate.commit([{ kind: "replay-data", target: aggregate.target(target, []), operation }]);
  assert.equal(commit.changed, true);
  assert.equal(commit.rev, 1);
  assert.deepEqual(state.snap(), [2]);
  assert.equal(identity.active, false);
  assert.equal(other.active, true);
  assert.deepEqual(livemap_identity_epoch_accounting(state), before);
});

events.terminal("pass");

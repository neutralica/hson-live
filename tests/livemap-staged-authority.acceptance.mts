import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import {
  get_livemap_staged_authority,
  LiveMapTransitionError,
} from "../src/api/livemap/livemap.authority.ts";
import type {
  ElementLiveMap,
  LiveMap,
  LiveMapCommitObservation,
} from "../src/types/livemap.types.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function data(value = 0): LiveMap {
  return hson.liveMap.fromJson({ value, sibling: "kept" });
}

function element(source = `<main data-_quid="0000000000000001" <p data-_quid="0000000000000002" "old"/>/>`): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`expected element, observed ${map.mode}`);
  return map;
}

function transitionCode(fn: () => unknown, code: LiveMapTransitionError["code"]): void {
  assert.throws(fn, (cause) => cause instanceof LiveMapTransitionError && cause.code === code);
}

function mustCommitObservation(observations: readonly LiveMapCommitObservation[]): Extract<LiveMapCommitObservation, { kind: "commit" }> {
  const observation = observations[0];
  if (observation?.kind !== "commit") throw new Error("expected commit observation");
  return observation;
}

check("projected preparation is detached, silent and exposes an immutable commit view", () => {
  const map = data();
  const authority = get_livemap_staged_authority(map);
  const feeds: unknown[] = [];
  const subscriptions: unknown[] = [];
  const observations: LiveMapCommitObservation[] = [];
  map.feed([], (event) => feeds.push(event));
  map.sub((value) => subscriptions.push(value));
  map.commits.observe((event) => observations.push(event));
  const beforeRoot = map.root();

  const transition = authority.prepare((draft) => draft.set(["value"], 1));

  assert.deepEqual(map.root(), beforeRoot);
  assert.deepEqual(map.snap(), { value: 0, sibling: "kept" });
  assert.equal(map.rev, 0);
  assert.deepEqual(feeds, []);
  assert.deepEqual(subscriptions, []);
  assert.deepEqual(observations, []);
  assert.equal(transition.commit.changed, true);
  assert.deepEqual(transition.commit.ops.map((op) => "kind" in op ? op.kind : op.op), ["set"]);
  assert.equal(Object.isFrozen(transition.commit), true);
  assert.equal(Object.isFrozen(transition.commit.ops), true);
  assert.equal(Reflect.set(transition.commit, "rev", 99), false);
});

check("projected acceptance installs before feeds and observers and emits the prepared commit", () => {
  const map = data();
  const authority = get_livemap_staged_authority(map);
  const seen: Array<readonly [string, number, number]> = [];
  map.feed([], (event) => seen.push(["feed", map.rev, event.commit.rev]));
  map.commits.observe((event) => {
    if (event.kind === "commit") seen.push(["observer", map.rev, event.commit.rev]);
  });
  const rootIdentity = map.debug.node([]).must();
  const transition = authority.prepare((draft) => draft.set(["value"], 2));
  const accepted = authority.accept(transition);

  assert.deepEqual(map.snap(), { value: 2, sibling: "kept" });
  assert.equal(map.rev, 1);
  assert.equal(map.debug.node([]).must(), rootIdentity);
  assert.deepEqual(seen, [["feed", 1, 1], ["observer", 1, 1]]);
  assert.deepEqual(accepted.commit, transition.commit);
});

check("links run only after source acceptance", () => {
  const source = data();
  const target = data();
  source.at(["value"]).linkTo(target.at(["value"]));
  const authority = get_livemap_staged_authority(source);
  const transition = authority.prepare((draft) => draft.set(["value"], 4));
  assert.equal(target.snap(["value"]), 0);
  authority.accept(transition);
  assert.equal(target.snap(["value"]), 4);
  assert.equal(target.rev, 1);
});

check("document preparation preserves root, identity, typed attrs and observations until acceptance", () => {
  const map = element();
  const authority = get_livemap_staged_authority(map);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const before = map.capture();
  const target = { kind: "quid", quid: "0000000000000002" } as const;
  const transition = authority.prepare((draft) => draft.document.attrs.setMany(target, {
    hidden: false,
    style: { width: { value: 2, unit: "px" } },
  }));

  assert.deepEqual(map.capture(), before);
  assert.equal(map.document.attrs.get(target, "hidden"), undefined);
  assert.equal(map.document.byQuid("0000000000000002")?.$_tag, "p");
  assert.deepEqual(observations, []);
  assert.deepEqual(transition.commit.ops.map((op) => "op" in op ? op.op : op.kind), ["replace-attrs"]);

  const accepted = authority.accept(transition);
  assert.equal(map.rev, 1);
  assert.equal(map.document.attrs.get(target, "hidden"), false);
  assert.deepEqual(map.document.attrs.get(target, "style"), { width: { value: 2, unit: "px" } });
  assert.equal(map.document.byQuid("0000000000000002")?.$_tag, "p");
  assert.equal(observations.length, 1);
  assert.equal(mustCommitObservation(observations).commit, accepted.commit);
});

check("document install prepares and accepts one exact replace-root transition", () => {
  const map = element(`<main data-_quid="0000000000000001"/>`);
  const replacement = element(`<main data-_quid="0000000000000001" <section data-_quid="0000000000000003"/>/>`);
  const authority = get_livemap_staged_authority(map);
  const transition = authority.prepare((draft) => draft.install(replacement.capture()));
  assert.equal(map.document.byQuid("0000000000000003"), undefined);
  assert.equal(map.rev, 0);
  authority.accept(transition);
  assert.equal(map.document.byQuid("0000000000000003")?.$_tag, "section");
  assert.equal(map.rev, 1);
  assert.deepEqual(transition.commit.ops.map((op) => "op" in op ? op.op : op.kind), ["replace-root"]);
});

check("transition lifecycle rejects duplicate, discarded, foreign and stale acceptance", () => {
  const first = data();
  const second = data();
  const firstAuthority = get_livemap_staged_authority(first);
  const secondAuthority = get_livemap_staged_authority(second);

  const accepted = firstAuthority.prepare((draft) => draft.set(["value"], 1));
  firstAuthority.accept(accepted);
  transitionCode(() => firstAuthority.accept(accepted), "LIVEMAP_TRANSITION_ALREADY_ACCEPTED");

  const discarded = firstAuthority.prepare((draft) => draft.set(["value"], 2));
  firstAuthority.discard(discarded);
  transitionCode(() => firstAuthority.accept(discarded), "LIVEMAP_TRANSITION_DISCARDED");

  const foreign = firstAuthority.prepare((draft) => draft.set(["value"], 3));
  transitionCode(() => secondAuthority.accept(foreign), "LIVEMAP_TRANSITION_FOREIGN");

  const stale = firstAuthority.prepare((draft) => draft.set(["value"], 4));
  first.set(["value"], 5);
  transitionCode(() => firstAuthority.accept(stale), "LIVEMAP_TRANSITION_STALE");
});

check("restore, replay, schema changes and unsafe graph divergence invalidate candidates", () => {
  const restored = data();
  const restoredAuthority = get_livemap_staged_authority(restored);
  const beforeRestore = restoredAuthority.prepare((draft) => draft.set(["value"], 1));
  restored.restore({ rev: 7, value: { value: 7, sibling: "kept" } });
  transitionCode(() => restoredAuthority.accept(beforeRestore), "LIVEMAP_TRANSITION_STALE");

  const replayed = data();
  const replayAuthority = get_livemap_staged_authority(replayed);
  const beforeReplay = replayAuthority.prepare((draft) => draft.set(["value"], 1));
  const source = data();
  const replayCommit = source.set(["value"], 2);
  replayed.replay(replayCommit);
  transitionCode(() => replayAuthority.accept(beforeReplay), "LIVEMAP_TRANSITION_STALE");

  const schemaMap = data();
  const schemaAuthority = get_livemap_staged_authority(schemaMap);
  const beforeSchema = schemaAuthority.prepare((draft) => draft.set(["value"], 1));
  schemaMap.schema.use(hson.liveMap.schema.define((shape) => ({ value: shape.number, sibling: shape.string })));
  transitionCode(() => schemaAuthority.accept(beforeSchema), "LIVEMAP_TRANSITION_STALE");

  const debugMap = data();
  const debugAuthority = get_livemap_staged_authority(debugMap);
  const beforeDebug = debugAuthority.prepare((draft) => draft.set(["value"], 1));
  const live = debugMap.debug.node(["value"]).must();
  live.$_content[0] = 9;
  transitionCode(() => debugAuthority.accept(beforeDebug), "LIVEMAP_TRANSITION_STALE");

  const restoredDocument = element();
  const restoredDocumentAuthority = get_livemap_staged_authority(restoredDocument);
  const beforeDocumentRestore = restoredDocumentAuthority.prepare((draft) => draft.document.attrs.set(
    { kind: "quid", quid: "0000000000000002" },
    "title",
    "pending",
  ));
  const restoredSource = element(`<main data-_quid="0000000000000001" <p data-_quid="0000000000000002" title="restored"/>/>`);
  restoredDocument.restore({ ...restoredSource.capture(), rev: 8 });
  transitionCode(() => restoredDocumentAuthority.accept(beforeDocumentRestore), "LIVEMAP_TRANSITION_STALE");

  const replayedDocument = element();
  const replayedDocumentAuthority = get_livemap_staged_authority(replayedDocument);
  const beforeDocumentReplay = replayedDocumentAuthority.prepare((draft) => draft.document.attrs.set(
    { kind: "quid", quid: "0000000000000002" },
    "title",
    "pending",
  ));
  const documentReplaySource = element();
  const documentCommit = documentReplaySource.document.attrs.set(
    { kind: "quid", quid: "0000000000000002" },
    "title",
    "replayed",
  );
  replayedDocument.replay(documentCommit);
  transitionCode(() => replayedDocumentAuthority.accept(beforeDocumentReplay), "LIVEMAP_TRANSITION_STALE");
});

check("batch preparation remains one detached transition and one commit boundary", () => {
  const map = data();
  const authority = get_livemap_staged_authority(map);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const transition = authority.prepare((draft) => draft.batch((tx) => {
    tx.set(["value"], 2);
    tx.set(["sibling"], "changed");
  }));
  assert.deepEqual(map.snap(), { value: 0, sibling: "kept" });
  assert.equal(transition.commit.ops.length, 2);
  authority.accept(transition);
  assert.deepEqual(map.snap(), { value: 2, sibling: "changed" });
  assert.equal(map.rev, 1);
  assert.equal(observations.length, 1);
});

check("no-op transitions stay silent, revision-stable and one-shot", () => {
  const map = data();
  const authority = get_livemap_staged_authority(map);
  let notifications = 0;
  map.feed([], () => { notifications += 1; });
  map.commits.observe(() => { notifications += 1; });
  const transition = authority.prepare((draft) => draft.set(["value"], 0));
  assert.equal(transition.commit.changed, false);
  const accepted = authority.accept(transition);
  assert.equal(accepted.commit.changed, false);
  assert.equal(map.rev, 0);
  assert.equal(notifications, 0);
  transitionCode(() => authority.accept(transition), "LIVEMAP_TRANSITION_ALREADY_ACCEPTED");
});

check("preparation validation failure is inert", () => {
  const map = data();
  const authority = get_livemap_staged_authority(map);
  const before = map.capture();
  assert.throws(() => authority.prepare((draft) => draft.set(["missing", "value"], 1)));
  assert.deepEqual(map.capture(), before);
});

check("legacy and isolated notification policies preserve accepted state", () => {
  const legacy = data();
  legacy.feed([], () => { throw new Error("legacy-listener"); });
  assert.throws(() => legacy.set(["value"], 1), /legacy-listener/);
  assert.equal(legacy.snap(["value"]), 1);
  assert.equal(legacy.rev, 1);

  const isolated = data();
  isolated.feed([], () => { throw new Error("isolated-listener"); });
  const authority = get_livemap_staged_authority(isolated);
  const transition = authority.prepare((draft) => draft.set(["value"], 2));
  const accepted = authority.accept(transition, "isolate");
  assert.equal(accepted.notificationFailureCount, 1);
  assert.equal(isolated.snap(["value"]), 2);
  assert.equal(isolated.rev, 1);
  transitionCode(() => authority.accept(transition), "LIVEMAP_TRANSITION_ALREADY_ACCEPTED");
});

check("notification reentrancy accepts a second ordered transition once", () => {
  const map = data();
  const commits: number[] = [];
  let nested = false;
  map.feed([], () => {
    if (nested) return;
    nested = true;
    map.set(["value"], 2);
  });
  map.commits.observe((event) => {
    if (event.kind === "commit") commits.push(event.commit.rev);
  });
  const first = map.set(["value"], 1);
  assert.equal(first.rev, 1);
  assert.equal(map.rev, 2);
  assert.equal(map.snap(["value"]), 2);
  assert.deepEqual(commits, [2, 1]);
});

check("existing projected mutation facades retain synchronous commit behavior", () => {
  const setManyMap = hson.liveMap.fromJson({ left: 1, right: 2 });
  assert.equal(setManyMap.setMany([], { left: 3 }).rev, 1);
  assert.deepEqual(setManyMap.snap(), { left: 3, right: 2 });

  const handleMap = data();
  assert.equal(handleMap.at(["value"]).update((value) => Number(value) + 1).rev, 1);
  assert.equal(handleMap.proxy(["sibling"]).$_.replace("proxy").rev, 2);
  assert.deepEqual(handleMap.snap(), { value: 1, sibling: "proxy" });

  const arrayMap = hson.liveMap.fromJson({ items: [1, 2] });
  assert.equal(arrayMap.splice(["items"], 1, 1, 3).rev, 1);
  assert.equal(arrayMap.at(["items"]).array.push(4).rev, 2);
  assert.deepEqual(arrayMap.snap(), { items: [1, 3, 4] });

  const objectMap = hson.liveMap.fromJson({ kept: true, removed: true });
  assert.equal(objectMap.at([]).object.setKey("added", 1).rev, 1);
  assert.equal(objectMap.delete(["removed"]).rev, 2);
  assert.deepEqual(objectMap.snap(), { kept: true, added: 1 });

  const applied = data();
  assert.equal(applied.apply({ prevRev: 0, value: { value: 7, sibling: "applied" } }).rev, 1);
  assert.deepEqual(applied.snap(), { value: 7, sibling: "applied" });
});

process.stdout.write(`# ${checks} staged LiveMap authority checks passed\n`);

import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type {
  ElementLiveMap,
  FragmentLiveMap,
  LiveMapCommitObservation,
  LiveMapGraphCommit,
} from "../src/index.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
  return map;
}

const rootTarget = { kind: "path", path: [] } as const;

check("document mutations publish their exact canonical commit once", () => {
  const map = element(`<main data-_quid="0000000000000001"/>`);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const commit = map.element.attrs.set(rootTarget, "id", "main");
  assert.equal(observations.length, 1);
  const event = observations[0];
  assert.equal(event?.kind, "commit");
  if (event?.kind !== "commit") throw new Error("Expected commit observation");
  assert.equal(event.origin, "authoritative");
  assert.equal(event.commit, commit);
  assert.equal(event.commit.ops[0], commit.ops[0]);

  map.element.attrs.set(rootTarget, "id", "main");
  assert.equal(observations.length, 1);
  assert.throws(() => map.element.attrs.set(rootTarget, "bad name", "x"));
  assert.equal(observations.length, 1);
});

check("fragment content mutation publishes one graph-domain commit", () => {
  const map = fragment(`"before" <main/>`);
  const mirror = fragment(`"before" <main/>`);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const replacement = element(`<aside/>`).element.node();
  const commit = map.fragment.content.replace(rootTarget, 1, replacement);
  assert.equal(observations.length, 1);
  const event = observations[0];
  assert.equal(event?.kind, "commit");
  if (event?.kind !== "commit") throw new Error("Expected commit observation");
  assert.equal(event.commit, commit);
  assert.deepEqual(commit.ops.map((op) => "domain" in op ? op.domain : "data"), ["graph"]);
  mirror.replay(commit);
  assert.deepEqual(mirror.capture(), map.capture());
});

check("projected feeds remain unchanged beside shared commit observation", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const feeds: unknown[] = [];
  const observations: LiveMapCommitObservation[] = [];
  map.feed([], (event) => feeds.push(event));
  map.commits.observe((event) => observations.push(event));
  const commit = map.set(["value"], 2);
  assert.equal(feeds.length, 1);
  assert.equal(observations.length, 1);
  const event = observations[0];
  assert.equal(event?.kind, "commit");
  if (event?.kind !== "commit") throw new Error("Expected commit observation");
  assert.equal(event.commit, commit);
  assert.equal(event.origin, "authoritative");
});

check("projected restore swaps state and exact revision with only a snapshot event", () => {
  const source = hson.liveMap.fromJson({ value: 1 });
  source.set(["value"], 2);
  source.set(["value"], 3);
  const target = hson.liveMap.fromJson({ value: 0 });
  const feeds: unknown[] = [];
  const observations: LiveMapCommitObservation[] = [];
  target.feed([], (event) => feeds.push(event));
  target.commits.observe((event) => observations.push(event));
  target.restore(source.capture());
  assert.deepEqual(target.snap(), { value: 3 });
  assert.equal(target.rev, 2);
  assert.equal(feeds.length, 0);
  assert.deepEqual(observations, [{ kind: "snapshot", origin: "snapshot", revision: 2 }]);

  const before = target.capture();
  assert.throws(() => Reflect.apply(target.restore, target, [{ rev: 4, value: [] }]));
  assert.deepEqual(target.capture(), before);
});

check("ordered element graph commits replay atomically without echo", () => {
  const source = element(`<main data-_quid="0000000000000002" <p data-_quid="0000000000000003" "old"/>/>`);
  const target = element(`<main data-_quid="0000000000000002" <p data-_quid="0000000000000003" "old"/>/>`);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  const first = source.element.attrs.set(rootTarget, "class", "ready");
  const second = source.element.attrs.set({ kind: "quid", quid: "0000000000000003" }, "title", "new");
  const replayed = target.replay(first);
  assert.deepEqual(replayed, first);
  target.replay(second);
  assert.deepEqual(target.root(), source.root());
  assert.equal(target.rev, source.rev);
  assert.equal(target.element.byQuid("0000000000000003")?.$_tag, "p");
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.kind === "commit" && event.origin === "replay"));
});

check("fragment graph replay preserves canonical snapshot and identity", () => {
  const source = fragment(`<section data-_quid="0000000000000004" "old"/> "tail"`);
  const target = fragment(`<section data-_quid="0000000000000004" "old"/> "tail"`);
  const commit = source.fragment.attrs.set({ kind: "quid", quid: "0000000000000004" }, "title", "kept");
  target.replay(commit);
  assert.deepEqual(target.capture(), source.capture());
  assert.equal(target.fragment.byQuid("0000000000000004")?.$_attrs?.title, "kept");
});

check("replace-root graph commit replays with canonical mode and QUID identity", () => {
  const sourceState = element(`<article data-_quid="0000000000000009"/>`);
  const source = element(`<main data-_quid="000000000000000a"/>`);
  const target = element(`<main data-_quid="000000000000000a"/>`);
  const commit = source.install(sourceState.capture());
  target.replay(commit);
  assert.deepEqual(target.capture(), source.capture());
  assert.equal(target.element.byQuid("0000000000000009")?.$_tag, "article");
  assert.equal(target.element.byQuid("000000000000000a"), undefined);
});

check("malformed and out-of-order graph replay leave state unchanged", () => {
  const target = element(`<main data-_quid="0000000000000005"/>`);
  const before = target.capture();
  const malformed = {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target: rootTarget, name: "id", value: "x", extra: true }],
  };
  assert.throws(() => Reflect.apply(target.replay, target, [malformed]));
  assert.deepEqual(target.capture(), before);

  const source = element(`<main data-_quid="0000000000000005"/>`);
  const commit = source.element.attrs.set(rootTarget, "id", "x");
  target.replay(commit);
  assert.throws(() => target.replay(commit), /revision mismatch/);
  assert.equal(target.rev, 1);
});

check("snapshot restore swaps mode-compatible root, QUID index, and exact revision", () => {
  const source = element(`<article data-_quid="0000000000000006" <em data-_quid="0000000000000007"/>/>`);
  source.element.attrs.set(rootTarget, "id", "one");
  source.element.attrs.set(rootTarget, "title", "two");
  const target = element(`<aside data-_quid="0000000000000008"/>`);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  target.restore(source.capture());
  assert.equal(target.rev, 2);
  assert.deepEqual(target.root(), source.root());
  assert.equal(target.element.byQuid("0000000000000007")?.$_tag, "em");
  assert.equal(target.element.byQuid("0000000000000008"), undefined);
  assert.deepEqual(events, [{ kind: "snapshot", origin: "snapshot", revision: 2 }]);
});

process.stdout.write(`# ${checks} document observation/replay checks passed\n`);

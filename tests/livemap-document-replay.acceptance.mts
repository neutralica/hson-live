import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { prepare_document_graph_operation } from "../src/api/livemap/livemap.document.mutation.ts";
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

function replaceAttrsCommit(rev: number, target: unknown, attrs: unknown): unknown {
  return {
    changed: true,
    prevRev: rev,
    rev: rev + 1,
    ops: [{ domain: "graph", op: "replace-attrs", target, attrs }],
  };
}

check("document mutations publish their exact canonical commit once", () => {
  const map = element(`<main data-_quid="0000000000000001"/>`);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const commit = map.document.attrs.set(rootTarget, "id", "main");
  assert.equal(observations.length, 1);
  const event = observations[0];
  assert.equal(event?.kind, "commit");
  if (event?.kind !== "commit") throw new Error("Expected commit observation");
  assert.equal(event.origin, "authoritative");
  assert.equal(event.commit, commit);
  assert.equal(event.commit.ops[0], commit.ops[0]);

  map.document.attrs.set(rootTarget, "id", "main");
  assert.equal(observations.length, 1);
  assert.throws(() => map.document.attrs.set(rootTarget, "bad name", "x"));
  assert.equal(observations.length, 1);
});

check("fragment content mutation publishes one graph-domain commit", () => {
  const map = fragment(`"before" <main/>`);
  const mirror = fragment(`"before" <main/>`);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const replacement = element(`<aside/>`).element.node();
  const commit = map.document.content.replace(rootTarget, 1, replacement);
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
  const first = source.document.attrs.set(rootTarget, "class", "ready");
  const second = source.document.attrs.set({ kind: "quid", quid: "0000000000000003" }, "title", "new");
  const replayed = target.replay(first);
  assert.deepEqual(replayed, first);
  target.replay(second);
  assert.deepEqual(target.root(), source.root());
  assert.equal(target.rev, source.rev);
  assert.equal(target.document.byQuid("0000000000000003")?.$_tag, "p");
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.kind === "commit" && event.origin === "replay"));
});

check("fragment graph replay preserves canonical snapshot and identity", () => {
  const source = fragment(`<section data-_quid="0000000000000004" "old"/> "tail"`);
  const target = fragment(`<section data-_quid="0000000000000004" "old"/> "tail"`);
  const commit = source.document.attrs.set({ kind: "quid", quid: "0000000000000004" }, "title", "kept");
  target.replay(commit);
  assert.deepEqual(target.capture(), source.capture());
  assert.equal(target.document.byQuid("0000000000000004")?.$_attrs?.title, "kept");
});

check("replace-attrs planning is detached and leaves authority state untouched", () => {
  const map = element(`<main id="before" data-_quid="000000000000001f"/>`);
  const attrs = { id: "after", style: { color: "red" } };
  const before = map.capture();
  const prepared = prepare_document_graph_operation(map.root(), map.mode, {
    domain: "graph",
    op: "replace-attrs",
    target: rootTarget,
    attrs,
  });
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
  assert.equal(prepared.operation.op, "replace-attrs");
  if (prepared.operation.op !== "replace-attrs") throw new Error("Expected replace-attrs");
  assert.notEqual(prepared.operation.attrs, attrs);
  assert.deepEqual(prepared.operation.attrs, { id: "after", style: { color: "red" } });
  attrs.id = "caller-mutated";
  attrs.style.color = "blue";
  assert.deepEqual(prepared.operation.attrs, { id: "after", style: { color: "red" } });
  assert.equal(map.element.node().$_attrs?.id, "before");
});

check("replace-attrs replays one detached final-state bag on path and QUID targets", () => {
  const map = element(`<main id="before" title="old" data-_quid="0000000000000020"/>`);
  const attrs = {
    title: "after",
    empty: "",
    hidden: false,
    count: 0,
    nullable: null,
    style: { color: "red", width: { value: 2, unit: "px" } },
  };
  const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event));
  const replayed = Reflect.apply(map.replay, map, [replaceAttrsCommit(0, rootTarget, attrs)]);
  assert.equal(replayed.ops.length, 1);
  assert.equal(replayed.ops[0]?.op, "replace-attrs");
  assert.equal(map.rev, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "commit");
  assert.equal(events[0]?.kind === "commit" && events[0].origin, "replay");
  assert.deepEqual(map.element.node().$_attrs, {
    count: 0,
    empty: "",
    hidden: false,
    nullable: null,
    style: { width: { unit: "px", value: 2 }, color: "red" },
    title: "after",
  });
  assert.equal(map.document.byQuid("0000000000000020")?.$_tag, "main");
  assert.equal(map.element.node().$_meta?.["data-_quid"], "0000000000000020");
  assert.notEqual(replayed.ops[0]?.op === "replace-attrs" && replayed.ops[0].attrs, attrs);

  attrs.title = "caller-mutated";
  attrs.style.color = "green";
  assert.equal(map.element.node().$_attrs?.title, "after");
  assert.equal(map.element.node().$_attrs?.style?.color, "red");

  const fragmentMap = fragment(`<section id="old" data-_quid="0000000000000021"/> "tail"`);
  Reflect.apply(fragmentMap.replay, fragmentMap, [replaceAttrsCommit(
    0,
    { kind: "quid", quid: "0000000000000021" },
    { id: "new" },
  )]);
  assert.deepEqual(fragmentMap.document.byQuid("0000000000000021")?.$_attrs, { id: "new" });
});

check("replace-attrs clears compactly and canonical equality ignores key order", () => {
  const cleared = element(`<main id="old" title="old" data-_quid="0000000000000022"/>`);
  Reflect.apply(cleared.replay, cleared, [replaceAttrsCommit(0, rootTarget, {})]);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.element.node(), "$_attrs"), false);
  assert.equal(cleared.document.byQuid("0000000000000022")?.$_tag, "main");

  const equal = element(`<main a="one" b="two"/>`);
  const before = equal.capture();
  assert.throws(
    () => Reflect.apply(equal.replay, equal, [replaceAttrsCommit(0, rootTarget, { b: "two", a: "one" })]),
    /unchanged operation/,
  );
  assert.deepEqual(equal.capture(), before);

  const absent = element(`<main/>`);
  assert.throws(
    () => Reflect.apply(absent.replay, absent, [replaceAttrsCommit(0, rootTarget, {})]),
    /unchanged operation/,
  );
  assert.equal(absent.rev, 0);
});

check("replace-attrs rejects invalid bags, protected metadata, and invalid targets atomically", () => {
  const cyclicStyle: Record<string, unknown> = {};
  cyclicStyle.self = cyclicStyle;
  const invalidAttrs = [
    { "data-_quid": "0000000000000024" },
    { "data-_index": "0" },
    { "data-_custom": "x" },
    { "": "empty-name" },
    { "bad name": "malformed-name" },
    { bad: undefined },
    { bad: Number.POSITIVE_INFINITY },
    { bad: [] },
    { bad: { nested: true } },
    { style: { color: undefined } },
    { style: cyclicStyle },
  ];
  for (const attrs of invalidAttrs) {
    const map = element(`<main id="kept" data-_quid="0000000000000023"/>`);
    const before = map.capture();
    assert.throws(() => Reflect.apply(map.replay, map, [replaceAttrsCommit(0, rootTarget, attrs)]));
    assert.deepEqual(map.capture(), before);
    assert.equal(map.document.byQuid("0000000000000023")?.$_attrs?.id, "kept");
  }

  for (const target of [
    { kind: "path", path: [0] },
    { kind: "path", path: [9] },
    { kind: "quid", quid: "0000000000000099" },
  ]) {
    const map = element(`<main "text"/>`);
    const before = map.capture();
    assert.throws(() => Reflect.apply(map.replay, map, [replaceAttrsCommit(0, target, { id: "x" })]));
    assert.deepEqual(map.capture(), before);
  }
});

check("all four public bulk attrs methods replay through the one replace-attrs path", () => {
  const initial = `<main id="old" title="kept" data-_quid="0000000000000025"/>`;
  const source = element(initial);
  const target = element(initial);
  const commits = [
    source.document.attrs.setMany(rootTarget, { id: "new", hidden: false }),
    source.document.attrs.dropMany(rootTarget, ["title", "absent", "title"]),
    source.document.attrs.replace(rootTarget, { count: 0, nullable: null, style: { color: "red" } }),
    source.document.attrs.clear(rootTarget),
  ];
  assert.deepEqual(commits.map((commit) => commit.ops.length), [1, 1, 1, 1]);
  assert.ok(commits.every((commit) => commit.ops[0]?.op === "replace-attrs"));
  for (const commit of commits) target.replay(commit);
  assert.deepEqual(target.capture(), source.capture());
  assert.equal(target.rev, 4);
  assert.equal(target.document.byQuid("0000000000000025")?.$_tag, "main");
  assert.equal(target.document.byQuid("0000000000000025")?.$_meta?.["data-_quid"], "0000000000000025");
});

check("insert, remove and final-position move replay through the single graph planner", () => {
  const initial = `<a/> <b/> <c data-_quid="000000000000001c"/>`;
  const source = fragment(initial);
  const target = fragment(initial);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  const inserted = element(`<d data-_quid="000000000000001d"/>`).element.node();
  const commits = [
    source.document.content.insert(rootTarget, 1, inserted),
    source.document.content.move(rootTarget, 1, 3),
    source.document.content.remove(rootTarget, 1),
  ];
  assert.deepEqual(commits.map((commit) => commit.ops[0]?.op), [
    "insert-content", "move-content", "remove-content",
  ]);
  for (const commit of commits) target.replay(commit);
  assert.deepEqual(target.capture(), source.capture());
  assert.equal(target.document.byQuid("000000000000001d")?.$_tag, "d");
  assert.equal(target.document.byQuid("000000000000001c")?.$_tag, "c");
  assert.equal(events.length, 3);
  assert.ok(events.every((event) => event.kind === "commit" && event.origin === "replay"));
});

check("malformed structural graph operations reject atomically", () => {
  const target = fragment(`<a/> <b/>`);
  const before = target.capture();
  const malformed = {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [
      { domain: "graph", op: "move-content", target: rootTarget, from: 0, to: 1 },
      { domain: "graph", op: "remove-content", target: rootTarget, index: 0, extra: true },
    ],
  };
  assert.throws(() => Reflect.apply(target.replay, target, [malformed]));
  assert.deepEqual(target.capture(), before);

  const falseChanged = {
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "move-content", target: rootTarget, from: 0, to: 0 }],
  };
  assert.throws(() => Reflect.apply(target.replay, target, [falseChanged]));
  assert.deepEqual(target.capture(), before);
});

check("replace-root graph commit replays with canonical mode and QUID identity", () => {
  const sourceState = element(`<article data-_quid="0000000000000009"/>`);
  const source = element(`<main data-_quid="000000000000000a"/>`);
  const target = element(`<main data-_quid="000000000000000a"/>`);
  const commit = source.install(sourceState.capture());
  target.replay(commit);
  assert.deepEqual(target.capture(), source.capture());
  assert.equal(target.document.byQuid("0000000000000009")?.$_tag, "article");
  assert.equal(target.document.byQuid("000000000000000a"), undefined);
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
  const commit = source.document.attrs.set(rootTarget, "id", "x");
  target.replay(commit);
  assert.throws(() => target.replay(commit), /revision mismatch/);
  assert.equal(target.rev, 1);
});

check("snapshot restore swaps mode-compatible root, QUID index, and exact revision", () => {
  const source = element(`<article data-_quid="0000000000000006" <em data-_quid="0000000000000007"/>/>`);
  source.document.attrs.set(rootTarget, "id", "one");
  source.document.attrs.set(rootTarget, "title", "two");
  const target = element(`<aside data-_quid="0000000000000008"/>`);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  target.restore(source.capture());
  assert.equal(target.rev, 2);
  assert.deepEqual(target.root(), source.root());
  assert.equal(target.document.byQuid("0000000000000007")?.$_tag, "em");
  assert.equal(target.document.byQuid("0000000000000008"), undefined);
  assert.deepEqual(events, [{ kind: "snapshot", origin: "snapshot", revision: 2 }]);
});

process.stdout.write(`# ${checks} document observation/replay checks passed\n`);

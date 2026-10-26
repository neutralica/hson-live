import assert from "node:assert/strict";
import { hsonLiveMap, hsonMirror, hsonTransform } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveMap, LiveMapCommit, LiveMapDataLibrary, LiveMapDataOp } from "../src/types/livemap.types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { create_locus_hosted_aggregate_internal } from "../src/api/locus/locus.aggregate.ts";
import { make_portable_aggregate_commit, type HostedAggregateCommit } from "../src/api/livemap/livemap.hosted.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.commit-publication-ownership",
  title: "LiveMap commit publication ownership",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "ownership", "publication", "document", "mirror"]),
});

const events = create_test_event_emitter("livemap.commit-publication-ownership");
let checks = 0, failures = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); process.stdout.write(`ok ${++checks} - ${name}\n`); }
  catch (error) {
    failures += 1;
    events.diagnostic(name, "assertion", String(error).slice(0, 1_000));
    events.case_end(name, "fail"); process.stderr.write(`not ok - ${name}: ${String(error)}\n`);
  }
}

// Exercise ordinary access plus the array-method and descriptor routes that
// shallow wrappers and read proxies can accidentally leave writable.
function attempt(run: () => unknown): void {
  try { run(); } catch (error) { assert.ok(error instanceof TypeError); }
}
function attack(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const key of Reflect.ownKeys(value)) {
    const child: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
    attack(child);
    if (!(Array.isArray(value) && key === "length")) {
      attempt(() => Reflect.set(value, key, "corrupted"));
      attempt(() => Object.defineProperty(value, key, { value: "corrupted" }));
      attempt(() => Reflect.deleteProperty(value, key));
    }
  }
  if (Array.isArray(value)) {
    value.slice().forEach(attack);
    value.map(item => item).forEach(attack);
    attempt(() => value.push("corrupted"));
    attempt(() => value.splice(0, 1));
  }
}
function immutable(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value), "every publication record and array must be frozen");
  for (const key of Reflect.ownKeys(value)) immutable(Object.getOwnPropertyDescriptor(value, key)?.value);
}
function data_op(commit: LiveMapCommit): LiveMapDataOp {
  const op = commit.operations[0]?.operation;
  assert.ok(op !== undefined && "path" in op);
  return op;
}
type PublishedGraphOp = Extract<LiveMapCommit["operations"][number]["operation"], { domain: "graph" }>;
function graph_op(commit: LiveMapCommit): PublishedGraphOp {
  const op = commit.operations[0]?.operation;
  assert.ok(op !== undefined && "domain" in op && op.domain === "graph");
  return op;
}

await check("Data observer attempts cannot change later observers, returned commits or revisions", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { items: [], other: 0 } } });
  const state = map.data.must("state"), accepted = [{ deep: { values: [-0, 1] } }];
  const publications: LiveMapCommit[] = [];
  let first: LiveMapCommit | undefined, watches = 0;
  state.at(["items"]).watch(() => { watches += 1; });
  map.commits.observe(commit => { first = commit; attack(commit); });
  map.commits.observe(commit => { publications.push(commit); });
  const returned = state.at(["items"]).set(accepted);
  assert.equal(publications.length, 1);
  assert.equal(watches, 1);
  assert.equal(map.rev, 1);
  assert.equal(returned.prevRev, 0);
  assert.equal(returned.rev, 1);
  assert.deepEqual(data_op(publications[0]!), data_op(returned));
  const op = data_op(returned);
  assert.equal(op.kind, "set");
  if (op.kind !== "set") throw new Error("Expected set");
  assert.deepEqual(op.next, accepted);
  assert.deepEqual(state.snap(), { items: accepted, other: 0 });
  immutable(first); immutable(returned);
  const retained = structuredClone(returned);
  attack(returned.operations.slice()[0]);
  attack(Object.getOwnPropertyDescriptor(op, "next")?.value);
  assert.deepEqual(publications[0], retained);
  accepted[0]!.deep.values[0] = 8;
  state.at(["items", 0, "deep", "values", 1]).set(2);
  assert.deepEqual(state.snap(["items"]), [{ deep: { values: [-0, 2] } }]);
  assert.deepEqual(returned, retained);
  assert.equal(map.rev, 2);
  assert.equal(publications.length, 2);
});

const dataRoutes: ReadonlyArray<readonly [string, (state: LiveMapDataLibrary) => LiveMapCommit]> = [
  ["replace", state => state.at(["items"]).replace([{ deep: [-0] }])],
  ["delete", state => state.at(["object"]).delete()],
  ["splice", state => state.at(["items"]).asArray()!.array.splice(0, 1, { deep: [-0] })],
  ["move", state => state.at(["items"]).asArray()!.array.move(0, 1)],
  ["rename", state => state.at([]).asObject()!.object.renameKey("object", "renamed")],
];
for (const [name, write] of dataRoutes) await check(`Data ${name} protects all previous, next, removed and inserted values`, () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { items: [{ deep: [1] }, { deep: [2] }], object: { nested: [-0] } } } });
  const state = map.data.must("state");
  let expected: LiveMapCommit | undefined, second: LiveMapCommit | undefined;
  map.commits.observe(commit => { expected = structuredClone(commit); attack(commit); });
  map.commits.observe(commit => { second = commit; });
  const returned = write(state), canonical = state.snap();
  assert.deepEqual(second, expected);
  assert.deepEqual(returned, expected);
  assert.equal(data_op(returned).kind, name);
  immutable(returned);
  attack(returned);
  assert.deepEqual(state.snap(), canonical);
  assert.equal(map.rev, 1);
});

await check("early Data feeds cannot change later feeds, commit observers or returned operations", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { items: [] } } });
  const items = map.data.must("state").at(["items"]);
  let expected: LiveMapCommit | undefined, laterFeed: LiveMapCommit | undefined, observed: LiveMapCommit | undefined;
  let firstOp: LiveMapDataOp | undefined, laterOp: LiveMapDataOp | undefined;
  items.feed(event => { expected = structuredClone(event.commit); firstOp = event.op; attack(event.ops); attack(event.commit); });
  items.feed(event => { laterFeed = event.commit; laterOp = event.op; });
  map.commits.observe(commit => { observed = commit; });
  const returned = items.set([{ deep: [-0] }]);
  assert.deepEqual(laterFeed, expected);
  assert.deepEqual(observed, expected);
  assert.deepEqual(returned, expected);
  assert.equal(firstOp, laterOp, "feeds share one immutable accepted description");
  assert.equal(laterOp, data_op(returned));
  immutable(laterOp);
  assert.deepEqual(items.snap(), [{ deep: [-0] }]);
  assert.equal(map.rev, 1);
});

await check("batch return and observer descriptions own every accepted operation", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { items: [], other: [] } } });
  let expected: LiveMapCommit | undefined, observed: LiveMapCommit | undefined, publications = 0;
  map.commits.observe(commit => { expected = structuredClone(commit); attack(commit); });
  map.commits.observe(commit => { publications += 1; observed = commit; });
  const returned = map.batch(writer => {
    writer.data.must("state").at(["items"]).set([{ deep: [-0] }]);
    writer.data.must("state").at(["other"]).set([{ deep: [1] }]);
  });
  assert.equal(returned.operations.length, 2);
  assert.deepEqual(observed, expected);
  assert.deepEqual(returned, expected);
  immutable(returned);
  attack(returned.operations.map(entry => entry.operation));
  assert.deepEqual(observed, expected);
  assert.deepEqual(map.data.must("state").snap(), { items: [{ deep: [-0] }], other: [{ deep: [1] }] });
  assert.equal(map.rev, 1);
  assert.equal(publications, 1);
});

const content = (): HsonNode => {
  const node = hsonTransform.fromHson('<p title="admitted" style="opacity:0" <span title="child" "accepted"/>/>').toNode().$_content[0];
  assert.ok(is_Node(node));
  return node;
};
for (const route of ["insert", "replace", "attrs"] as const) await check(`Document ${route} remains intact across aggregate and Document observers and Mirror`, () => {
  const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: "<main <p/>/>" } });
  const page = map.doc.must("page");
  let expected: PublishedGraphOp | undefined, second: PublishedGraphOp | undefined, documentSecond: unknown;
  let publications = 0, documentPublications = 0, watches = 0;
  // Registered before both Document observers and Mirror: reproduces the audit order.
  map.commits.observe(commit => { publications += 1; expected = structuredClone(graph_op(commit)); attack(commit); });
  page.commits.observe(observation => {
    if (observation.kind === "commit") { documentPublications += 1; attack(observation.commit); }
  });
  page.commits.observe(observation => {
    if (observation.kind === "commit") documentSecond = observation.commit.ops[0];
  });
  const mirror = hsonMirror(page);
  map.commits.observe(commit => { second = graph_op(commit); });
  page.watch(() => { watches += 1; });
  try {
    const returned = route === "insert" ? page.at([]).asElement()!.insert(0, content())
      : route === "replace" ? page.at([0]).replace(content())
      : page.at([0]).asElement()!.attrs.replace({ title: "admitted", style: { opacity: "0" } });
    assert.deepEqual(second, expected);
    assert.deepEqual(documentSecond, expected);
    assert.deepEqual(graph_op(returned), expected);
    immutable(returned); immutable(documentSecond);
    assert.equal(mirror.status, "active");
    assert.equal(mirror.sourceRevision, 1);
    assert.match(JSON.stringify(mirror.tree.node), /admitted/);
    assert.doesNotMatch(JSON.stringify(mirror.tree.node), /corrupted/);
    assert.equal(map.rev, 1);
    assert.equal(publications, 1);
    assert.equal(documentPublications, 1);
    assert.equal(watches, 1);
    const canonical = page.root(), hson = page.hson(), retained = structuredClone(returned);
    assert.match(page.snap(), /admitted/);
    assert.doesNotMatch(page.snap(), /corrupted/);
    attack(returned);
    assert.deepEqual(page.root(), canonical);
    assert.equal(page.hson(), hson);
    if (route !== "attrs") {
      assert.match(page.snap(), /accepted/);
      const operation = graph_op(returned);
      const payload = operation.op === "insert-content" ? operation.content
        : operation.op === "replace-content" ? operation.replacement : undefined;
      assert.ok(is_Node(payload));
      assert.equal(hsonTransform.fromNode({ $_tag: "_hson_elem", $_content: [payload] }).toHson().serialize(), hsonTransform.fromNode({ $_tag: "_hson_elem", $_content: [content()] }).toHson().serialize());
    }
    // Later legitimate canonical mutation must still succeed and reconcile.
    page.at([0]).asElement()!.attrs.set("title", "later");
    assert.equal(mirror.status, "active");
    assert.equal(mirror.sourceRevision, 2);
    assert.equal(map.rev, 2);
    assert.deepEqual(returned, retained);
    assert.doesNotMatch(JSON.stringify(returned), /later|corrupted/);
  } finally { mirror.dispose(); }
});


await check("Document Library addition protects opaque stylesheet contributions across recipients", () => {
  const map = hsonLiveMap.create();
  let expected: LiveMapCommit | undefined, first: LiveMapCommit | undefined, later: LiveMapCommit | undefined;
  let publications = 0;
  map.commits.observe(commit => {
    if (commit.rev !== 1) return;
    first = commit;
    expected = structuredClone(commit);
    const operation = commit.operations[0]?.operation;
    assert.ok(operation !== undefined && "kind" in operation && operation.kind === "library-add");
    const css = operation.libraries[0]?.css;
    assert.ok(css !== undefined && css.order[0]?.kind === "text");
    assert.deepEqual(css, { rules: [], properties: [], keyframes: [], order: [{ kind: "text", text: "main { color: red; }" }] });
    attempt(() => Reflect.set(css.order[0], "text", "corrupted"));
    attempt(() => Array.prototype.splice.call(css.order, 0, css.order.length));
    attack(css);
  });
  map.commits.observe(commit => { publications += 1; later = commit; });
  const returned = map.addLibraries({ page: { document: "<main/>", stylesheet: "main { color: red; }" } }).commit;
  assert.deepEqual(later, expected);
  assert.deepEqual(returned, expected);
  assert.equal(first?.operations[0]?.operation, returned.operations[0]?.operation);
  immutable(returned);
  const page = map.doc.must("page"), root = page.root(), retained = structuredClone(returned);
  assert.equal(page.hson(), "<main/>");
  assert.equal(page.css.snapshot(), "main { color: red; }");
  assert.deepEqual([map.rev, returned.prevRev, returned.rev, publications], [1, 0, 1, 1]);
  attack(returned);
  assert.deepEqual(page.root(), root);
  assert.equal(page.css.snapshot(), "main { color: red; }");
  page.css.sel("main").set.color("blue");
  page.at([]).asElement()!.attrs.set("title", "later");
  assert.equal(page.css.snapshot(), "main { color: red; }\n\nmain{color:blue;}");
  assert.match(page.hson(), /later/);
  assert.deepEqual([map.rev, publications], [3, 3]);
  assert.deepEqual(returned, retained);
  const replay = hsonLiveMap.create();
  const replayed = replay.replay(returned);
  immutable(replayed);
  assert.deepEqual(replayed, returned);
  assert.equal(replay.doc.must("page").css.snapshot(), "main { color: red; }");
});

await check("multi-Library Data, Parts and scoped Document topology owns nested publication storage", async () => {
  const map = hsonLiveMap.create();
  let expected: LiveMapCommit | undefined, later: LiveMapCommit | undefined;
  let publications = 0;
  map.commits.observe(commit => { expected = structuredClone(commit); attack(commit); });
  map.commits.observe(commit => { publications += 1; later = commit; });
  const returned = map.addLibraries({
    state: { data: { values: [-0, 1] } },
    parts: { parts: { badge: { kind: "document", document: '<b hson:part @:label "accepted"/>', stylesheet: ':scope{color:red}' } } },
    page: { document: '<main <hson-part lib="parts" at="badge"/>/>', stylesheet: "main{margin:0}" },
  }).commit;
  assert.deepEqual(later, expected);
  assert.deepEqual(returned, expected);
  immutable(returned);
  const operation = returned.operations[0]?.operation;
  assert.ok(operation !== undefined && "kind" in operation && operation.kind === "library-add");
  assert.deepEqual(operation.libraries.map(entry => entry.name), ["state", "parts", "page"]);
  const pageEntry = operation.libraries.find(entry => entry.name === "page");
  assert.ok(pageEntry?.scopes !== undefined && pageEntry.css !== undefined);
  assert.deepEqual(map.data.must("state").snap(), { values: [-0, 1] });
  assert.match(JSON.stringify(map.parts.must("parts").snap()), /accepted/);
  const page = map.doc.must("page"), retained = structuredClone(returned);
  assert.match(page.hson(), /accepted/);
  assert.match(page.css.snapshot(), /color:red/);
  assert.doesNotMatch(page.hson(), /corrupted|hson-part/);
  assert.deepEqual([map.rev, publications], [1, 1]);
  assert.throws(() => map.addLibraries({ state: { data: {} } }), /already|duplicate|exists/i);
  assert.deepEqual([map.rev, publications], [1, 1]);
  map.data.must("state").at(["values", 1]).set(2);
  const authority = create_locus_hosted_aggregate_internal({ map, scopedDocuments: true });
  try {
    await authority.stage(writer => { writer.doc.must("page").at([]).asElement().attrs.set("title", "later"); });
  } finally { authority.dispose(); }
  assert.deepEqual(map.data.must("state").snap(), { values: [-0, 2] });
  assert.equal(map.rev, 3);
  assert.deepEqual(returned, retained);
});

await check("Locus gates cannot change the hosted description accepted and returned later", async () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { items: [] } } });
  let expected: HostedAggregateCommit | undefined, observed: HostedAggregateCommit | undefined;
  let gates = 0, publications = 0;
  const authority = create_locus_hosted_aggregate_internal({ map, gate(input) {
    gates += 1;
    expected = structuredClone(input.commit);
    attack(input.commit);
  } });
  authority.on_commit(commit => { publications += 1; observed = commit; });
  try {
    const returned = await authority.stage(writer => { writer.data.must("state").at(["items"]).set([{ deep: [-0] }]); });
    assert.deepEqual(observed, expected);
    assert.deepEqual(returned, expected);
    assert.equal(observed, returned);
    immutable(returned);
    assert.deepEqual(map.data.must("state").snap(), { items: [{ deep: [-0] }] });
    assert.deepEqual([map.rev, gates, publications], [1, 1, 1]);
  } finally { authority.dispose(); }
});

await check("hosted mixed Data, Document and CSS descriptions resist earlier authority listeners", async () => {
  const map: LiveMap = hsonLiveMap.fromLibraries({ state: { data: { items: [] } }, page: { document: "<main/>" } });
  const page = map.doc.must("page"), mirror = hsonMirror(page);
  const authority = create_locus_hosted_aggregate_internal({ map });
  let expected: HostedAggregateCommit | undefined, later: HostedAggregateCommit | undefined;
  let publications = 0;
  authority.on_commit(commit => { expected = structuredClone(commit); attack(commit); });
  authority.on_commit(commit => { publications += 1; later = commit; });
  try {
    const returned = await authority.stage(writer => {
      writer.data.must("state").at(["items"]).set([{ deep: [-0] }]);
      const draft = writer.doc.must("page");
      draft.at([]).asElement().insert(0, content());
      draft.css.sel("main").setProp("color", "red");
    });
    assert.ok(returned !== undefined && expected !== undefined);
    assert.deepEqual(later, expected);
    assert.deepEqual(returned, expected);
    assert.equal(later, returned);
    assert.deepEqual(returned.operations.map(entry => entry.library), ["state", "page", "page"]);
    immutable(returned);
    const retained = structuredClone(returned), portable = make_portable_aggregate_commit(returned);
    immutable(portable);
    attack(returned);
    assert.deepEqual(make_portable_aggregate_commit(returned), portable);
    assert.deepEqual(map.data.must("state").snap(), { items: [{ deep: [-0] }] });
    assert.match(page.hson(), /accepted/);
    assert.equal(page.css.snapshot(), "main{color:red;}");
    assert.deepEqual([map.rev, publications, mirror.sourceRevision, mirror.status], [1, 1, 1, "active"]);
    await authority.stage(writer => {
      writer.data.must("state").at(["items", 0, "deep", 0]).set(2);
      writer.doc.must("page").at([0]).asElement().attrs.set("title", "later");
    });
    assert.deepEqual([map.rev, publications, mirror.sourceRevision, mirror.status], [2, 2, 2, "active"]);
    assert.deepEqual(returned, retained);
  } finally { mirror.dispose(); authority.dispose(); }
});

process.stdout.write(`1..${checks + failures}\n`);
events.terminal(failures === 0 ? "pass" : "fail");
if (failures > 0) process.exitCode = 1;

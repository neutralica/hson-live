// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap, LiveMapCommitObservation, LiveMapGraphOp } from "../src/types/livemap.types.ts";
import {
  livemap_document_identity_accounting,
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import { LiveMapDocumentStagingError, LiveMapRevError } from "../src/api/livemap/livemap.error.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-atomic-reconciliation",
  title: "Atomic document identity reconciliation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "path", "atomicity", "rollback", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-atomic-reconciliation");
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
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const Q1 = "000000501";
const Q2 = "000000502";
const Q3 = "000000503";
const path = (...parts: number[]) => validate_document_path(parts);
const documentTarget = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: path(...parts) });
const target = (...parts: number[]) => documentTarget(0, ...parts);

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected element map");
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected multiNodeDocument map");
  return map;
}

function ordinary(tag: string, quid?: string, child?: HsonNode): HsonNode {
  return {
    $_tag: tag,
    $_content: child === undefined ? [] : [{ $_tag: "_hson_elem", $_content: [child] }],
    ...(quid === undefined ? {} : { $_meta: { quid } }),
  };
}

function branch(tag: string, quid?: string, child?: HsonNode): HsonNode {
  return { $_tag: "_hson_elem", $_content: [ordinary(tag, quid, child)] };
}

function replay(map: DocumentLiveMap, ops: readonly LiveMapGraphOp[]): void {
  Reflect.apply(map.replay, map, [{ changed: true, prevRev: map.rev, rev: map.rev + 1, ops }]);
}

function state(map: DocumentLiveMap) {
  return {
    root: map.root(),
    rev: map.rev,
    overlay: livemap_document_identity_overlay_for(map),
  };
}

function assertState(map: DocumentLiveMap, before: ReturnType<typeof state>): void {
  assert.deepEqual(map.root(), before.root);
  assert.equal(map.rev, before.rev);
  assert.equal(livemap_document_identity_overlay_for(map), before.overlay);
}

check("malformed incoming QUID rejects before publication", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  assert.throws(() => map.document.content.insert(target(), 0, branch("span", "short")));
  assertState(map, before);
});

check("duplicate QUIDs inside an incoming subtree reject atomically", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  const incoming = branch("section", Q2, ordinary("b", Q2));
  assert.throws(() => map.document.content.insert(target(), 0, incoming), /duplicate quid/i);
  assertState(map, before);
});

check("incoming collision with a surviving graph claim rejects atomically", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  assert.throws(() => map.document.content.insert(target(), 0, branch("span", Q1)), /duplicate quid/i);
  assertState(map, before);
});

check("replacement may reuse the displaced subtree QUID", () => {
  const map = element(`<main <i @${Q2}/>/` + `>`);
  map.document.content.replace(target(0), 0, ordinary("b", Q2));
  assert.equal(map.document.byQuid(Q2)?.$_tag, "b");
  assert.equal(map.rev, 1);
});

check("active different witness rejects without rerouting", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  assert.throws(() => replay(map, [{
    domain: "graph", op: "set-attr",
    target: { kind: "path", path: path(0), witness: { quid: Q2 } },
    name: "id", value: "bad",
  }]), /witness/i);
  assertState(map, before);
});

check("invalid path never reroutes to a matching QUID", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  assert.throws(() => replay(map, [{
    domain: "graph", op: "set-attr",
    target: { kind: "path", path: path(9), witness: { quid: Q1 } },
    name: "id", value: "bad",
  }]), /path/i);
  assertState(map, before);
});

check("failed operation retains the exact overlay object", () => {
  const map = element(`<main @${Q1}/>`);
  const overlay = livemap_document_identity_overlay_for(map);
  assert.throws(() => map.document.content.insert(target(), 0, branch("span", Q1)));
  assert.equal(livemap_document_identity_overlay_for(map), overlay);
});

check("failed operation retains revision zero", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(() => map.document.content.insert(target(), 0, branch("span", Q1)));
  assert.equal(map.rev, 0);
});

check("failed operation publishes no commit", () => {
  const map = element(`<main @${Q1}/>`);
  const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event));
  assert.throws(() => map.document.content.insert(target(), 0, branch("span", Q1)));
  assert.deepEqual(events, []);
});

check("later staged path failure rolls back every earlier graph and overlay change", () => {
  const map = element(`<main @${Q1} <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const before = state(map);
  assert.throws(() => replay(map, [
    { domain: "graph", op: "remove-content", target: target(0), index: 0 },
    { domain: "graph", op: "set-attr", target: target(0, 9), name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError && error.opIndex === 1);
  assertState(map, before);
});

check("failed staged commit publishes no partial observation", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event));
  assert.throws(() => replay(map, [
    { domain: "graph", op: "move-content", target: target(0), from: 0, to: 1 },
    { domain: "graph", op: "remove-content", target: target(0), index: 9 },
  ]));
  assert.deepEqual(events, []);
});

check("observer failure occurs after root revision and overlay installation", () => {
  const map = element(`<main @${Q1}/>`);
  map.commits.observe(() => { throw new Error("observer-failure"); });
  assert.throws(() => map.document.content.insert(target(), 0, branch("span", Q2)), /observer-failure/);
  assert.equal(map.rev, 1);
  assert.equal(map.document.byQuid(Q2)?.$_tag, "span");
});

check("replay revision conflict is atomic", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  assert.throws(() => Reflect.apply(map.replay, map, [{
    changed: true, prevRev: 4, rev: 5,
    ops: [{ domain: "graph", op: "set-attr", target: target(), name: "id", value: "bad" }],
  }]), (error: unknown) => error instanceof LiveMapRevError);
  assertState(map, before);
});

check("failed incoming admission retains no partial introduced claim", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(() => map.document.content.insert(target(), 0, branch("section", Q2, ordinary("b", Q1))));
  assert.equal(map.document.byQuid(Q2), undefined);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
});

check("multi-node document root removal is an ordinary rooted-content mutation", () => {
  const map = multiNodeDocument(`<a @${Q1}/> <b @${Q2}/>`);
  map.document.content.remove(documentTarget(), 1);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "a");
  assert.equal(map.document.byQuid(Q2), undefined);
  assert.equal(map.rev, 1);
});

check("protected metadata mutation is inert", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  assert.throws(() => map.document.attrs.set(target(), "hson:quid", Q2));
  assertState(map, before);
});

check("malformed replacement graph is inert", () => {
  const map = element(`<main <i @${Q2}/>/` + `>`);
  const before = state(map);
  assert.throws(() => map.document.content.replace(target(0), 0, ordinary("b", "short")));
  assertState(map, before);
});

check("exact attr no-op advances neither revision nor publication", () => {
  const map = element(`<main @${Q1} id="same"/>`);
  const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event));
  const overlay = livemap_document_identity_overlay_for(map);
  const commit = map.document.attrs.set(target(), "id", "same");
  assert.equal(commit.changed, false);
  assert.equal(map.rev, 0);
  assert.equal(livemap_document_identity_overlay_for(map), overlay);
  assert.deepEqual(events, []);
});

check("same-position move is a complete atomic no-op", () => {
  const map = element(`<main <a @${Q2}/> <b/>/>`);
  const before = state(map);
  const commit = map.document.content.move(target(0), 0, 0);
  assert.equal(commit.changed, false);
  assertState(map, before);
});

check("exact content replacement is a complete no-op", () => {
  const map = element(`<main <a @${Q2}/>/` + `>`);
  const content = map.root().$_content[0];
  if (typeof content !== "object") throw new Error("Expected canonical branch");
  const before = state(map);
  const commit = map.document.content.replace(documentTarget(), 0, content);
  assert.equal(commit.changed, false);
  assertState(map, before);
});

check("failed QUID request performs no reconciliation", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  assert.throws(() => map.document.attrs.set({ kind: "quid", quid: Q2 }, "id", "bad"));
  const after = livemap_document_identity_accounting();
  assert.equal(after.reconciliations, before.reconciliations);
});

check("duplicate whole-root install remains atomic", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  const duplicate: HsonNode = {
    $_tag: "_hson_root",
    $_content: [ordinary("main", Q2, ordinary("b", Q2))],
  };
  assert.throws(() => Reflect.apply(map.install, map, [{ kind: "hson-document", mode: "document", rev: 0, root: duplicate }]));
  assertState(map, before);
});

check("malformed whole-root restore remains atomic", () => {
  const map = element(`<main @${Q1}/>`);
  const before = state(map);
  const malformed: HsonNode = { $_tag: "_hson_root", $_content: [ordinary("main", "short")] };
  assert.throws(() => Reflect.apply(map.restore, map, [{ kind: "hson-document", mode: "document", rev: 7, root: malformed }]));
  assertState(map, before);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.document-atomic-reconciliation", checks, checks, 0);

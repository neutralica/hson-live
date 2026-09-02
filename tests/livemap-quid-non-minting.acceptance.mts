import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../src/api/livemap/livemap.document.view-state-codec.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import type { HsonNode } from "../src/core/types.ts";
import { is_Node } from "../src/core/node-guards.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.quid-non-minting",
  title: "LiveMap sparse QUID non-minting contract",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "sparse-identity", "non-minting", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.quid-non-minting");
let checks = 0;
function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
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

const Q1 = "000000qb1";
const Q2 = "000000qb2";
const ROOT = { kind: "path", path: [0] } as const;
const CHILD_CLUSTER = { kind: "path", path: [0, 0] } as const;

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function manyUnquidded(): DocumentLiveMap {
  return element(`<main <header/> <section <p/> <p/> <aside/>/> <footer/> <nav/>/>`);
}

function sparse(): DocumentLiveMap {
  return element(`<main @${Q1} <header/> <section @${Q2} <p/> <p/>/> <footer/>/>`);
}

function ordinary(source: string): HsonNode {
  const value = element(source).at([]).snap();
  if (!is_Node(value)) throw new Error("Expected ordinary document element");
  return value;
}

function nodes(root: HsonNode): HsonNode[] {
  const found: HsonNode[] = [];
  const visit = (node: HsonNode): void => {
    found.push(node);
    for (const item of node.$_content) {
      if (typeof item === "object" && item !== null) visit(item);
    }
  };
  visit(root);
  return found;
}

function quids(root: HsonNode): string[] {
  return nodes(root)
    .map((node) => node.$_meta?.quid)
    .filter((quid): quid is string => quid !== undefined);
}

function quidForTag(root: HsonNode, tag: string): string | undefined {
  return nodes(root).find((node) => node.$_tag === tag)?.$_meta?.quid;
}

function assertNoQuids(map: DocumentLiveMap): void {
  assert.deepEqual(quids(map.root()), []);
}

function assertSparse(map: DocumentLiveMap): void {
  assert.deepEqual(quids(map.root()), [Q1, Q2]);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.document.byQuid(Q2)?.$_tag, "section");
}

check("construction admits many eligible elements with zero QUIDs", () => {
  const map = manyUnquidded();
  assert.ok(nodes(map.root()).filter((node) => !node.$_tag.startsWith("_hson_")).length >= 8);
  assertNoQuids(map);
});

check("construction from a detached QUID-free node does not mint", () => {
  const root = hson.fromHson(`<main <header/> <section/> <footer/>/>`).toNode();
  const map = hson.liveMap.fromNode(root);
  if (map.mode !== "document") throw new Error(`Expected element, observed ${map.mode}`);
  assertNoQuids(map);
});

check("document root and element traversal do not mint", () => {
  const map = manyUnquidded();
  assert.equal(map.root().$_tag, "_hson_root");
  assertNoQuids(map);
});

check("document content traversal does not mint", () => {
  const map = manyUnquidded();
  assert.equal(map.document.content().length, 1);
  assert.ok(nodes(map.root()).length >= 8);
  assertNoQuids(map);
});

check("path-based attribute lookup does not mint", () => {
  const map = manyUnquidded();
  assert.deepEqual(map.document.attrs.keys(ROOT), []);
  assert.equal(map.document.attrs.get(ROOT, "id"), undefined);
  assertNoQuids(map);
});

check("missing and malformed QUID lookup does not mint", () => {
  const map = manyUnquidded();
  assert.equal(map.document.byQuid(Q1), undefined);
  assert.equal(map.document.byQuid("bad"), undefined);
  assertNoQuids(map);
});

check("ordinary attribute mutation does not mint", () => {
  const map = manyUnquidded();
  map.document.attrs.set(ROOT, "id", "root");
  assert.equal(map.document.attrs.get(ROOT, "id"), "root");
  assertNoQuids(map);
});

check("ordinary attribute removal does not mint", () => {
  const map = element(`<main id="root" <section/>/>`);
  map.document.attrs.drop(ROOT, "id");
  assertNoQuids(map);
});

check("ordinary content insertion does not mint existing or incoming nodes", () => {
  const map = manyUnquidded();
  map.document.content.insert(CHILD_CLUSTER, 1, ordinary(`<article <span/>/>`));
  assert.equal(nodes(map.root()).some((node) => node.$_tag === "article"), true);
  assertNoQuids(map);
});

check("ordinary content replacement does not mint", () => {
  const map = manyUnquidded();
  map.document.content.replace(CHILD_CLUSTER, 0, ordinary(`<article <span/>/>`));
  assert.equal(nodes(map.root()).some((node) => node.$_tag === "article"), true);
  assertNoQuids(map);
});

check("ordinary content move does not mint", () => {
  const map = manyUnquidded();
  map.document.content.move(CHILD_CLUSTER, 0, 2);
  assertNoQuids(map);
});

check("ordinary content deletion does not mint", () => {
  const map = manyUnquidded();
  map.document.content.remove(CHILD_CLUSTER, 1);
  assertNoQuids(map);
});

check("exact capture of a QUID-free map does not mint", () => {
  const map = manyUnquidded();
  const capture = map.capture();
  assert.deepEqual(quids(capture.root), []);
  assertNoQuids(map);
});

check("canonical install of a QUID-free capture does not mint", () => {
  const source = manyUnquidded();
  const target = element(`<aside @${Q1}/>`);
  target.install(source.capture());
  assertNoQuids(target);
});

check("exact restore of a QUID-free capture does not mint", () => {
  const source = manyUnquidded();
  const target = element(`<aside @${Q1}/>`);
  target.restore({ ...source.capture(), rev: 9 });
  assert.equal(target.rev, 9);
  assertNoQuids(target);
});

check("ordinary commit replay on a QUID-free graph does not mint", () => {
  const source = manyUnquidded();
  const target = manyUnquidded();
  const commit = source.document.attrs.set(ROOT, "data-state", "ready");
  target.replay(commit);
  assert.equal(target.document.attrs.get(ROOT, "data-state"), "ready");
  assertNoQuids(target);
});

check("Locus-compatible view-state installation does not mint", () => {
  const source = manyUnquidded();
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(source.capture()));
  const target = element(`<aside @${Q1}/>`);
  target.restore(decoded);
  assertNoQuids(target);
});

check("sparse supplied QUIDs are admitted without filling eligible gaps", () => {
  const map = sparse();
  assertSparse(map);
  assert.equal(quidForTag(map.root(), "header"), undefined);
  assert.equal(quidForTag(map.root(), "p"), undefined);
  assert.equal(quidForTag(map.root(), "footer"), undefined);
});

check("sparse traversal and QUID lookup preserve untouched gaps", () => {
  const map = sparse();
  assert.equal(map.document.content().length, 1);
  assert.ok(nodes(map.root()).length >= 6);
  const section = map.document.byQuid(Q2);
  if (section === undefined) throw new Error("Expected supplied section QUID");
  assert.equal(nodes(section).filter((node) => node.$_tag === "p").length, 2);
  assertSparse(map);
  assert.equal(quidForTag(map.root(), "header"), undefined);
});

check("sparse targeted attribute mutation preserves only supplied QUIDs", () => {
  const map = sparse();
  map.document.attrs.set({ kind: "quid", quid: Q2 }, "title", "section");
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.title, "section");
  assertSparse(map);
});

check("sparse insertion preserves supplied QUIDs and leaves new nodes unquidded", () => {
  const map = sparse();
  map.document.content.insert(CHILD_CLUSTER, 1, ordinary(`<article <span/>/>`));
  assertSparse(map);
  assert.equal(quidForTag(map.root(), "article"), undefined);
  assert.equal(quidForTag(map.root(), "span"), undefined);
});

check("sparse movement preserves supplied QUIDs without minting siblings", () => {
  const map = sparse();
  map.document.content.move(CHILD_CLUSTER, 1, 0);
  assertSparse(map);
  assert.equal(quidForTag(map.root(), "header"), undefined);
  assert.equal(quidForTag(map.root(), "footer"), undefined);
});

check("sparse deletion retires removed supplied QUID and does not mint survivors", () => {
  const map = sparse();
  map.document.content.remove(CHILD_CLUSTER, 1);
  assert.deepEqual(quids(map.root()), [Q1]);
  assert.equal(map.document.byQuid(Q2), undefined);
  assert.equal(quidForTag(map.root(), "header"), undefined);
  assert.equal(quidForTag(map.root(), "footer"), undefined);
});

check("sparse exact capture, codec, install, and replay preserve only supplied QUIDs", () => {
  const source = sparse();
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(source.capture()));
  const target = manyUnquidded();
  target.install(decoded);
  assertSparse(target);
  const mirror = sparse();
  const commit = source.document.attrs.set(ROOT, "data-state", "ready");
  mirror.replay(commit);
  assertSparse(mirror);
  assert.equal(quidForTag(mirror.root(), "header"), undefined);
});

process.stdout.write(`# ${checks} LiveMap QUID non-minting checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.quid-non-minting", checks, checks, 0);

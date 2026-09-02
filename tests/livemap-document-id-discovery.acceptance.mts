// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import * as publicApi from "../src/index.ts";
import { find_internal_document_id } from "../src/api/livemap/livemap.document.id-discovery.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type {
  DocumentLiveMap,
  LiveMapDocumentRequestTarget,
} from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-id-discovery",
  title: "Internal canonical document ID discovery",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "traversal", "discovery", "canonical-graph", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-id-discovery");
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

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected element map; observed ${map.mode}`);
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected multiNodeDocument map; observed ${map.mode}`);
  return map;
}

const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const find = (map: DocumentLiveMap, id: string, scope: readonly number[] = []) =>
  find_internal_document_id(map, map.at(scope), id);
const tag = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "$_tag" in value ? String(value.$_tag) : undefined;
const authoredElement = (source: string) => {
  const candidate = element(source).root().$_content[0];
  if (!is_Node(candidate)) throw new Error("Expected one authored document element");
  return candidate;
};

check("element search includes the ordinary root element", () => {
  assert.deepEqual(find(element(`<main id="root"/>`), "root")?.path(), []);
});

check("direct child discovery returns its logical coordinate", () => {
  assert.deepEqual(find(element(`<main <button id="submit"/>/>`), "submit")?.path(), [0]);
});

check("nested descendant discovery uses logical edges", () => {
  assert.deepEqual(find(element(`<main <section <button id="x"/>/>/>`), "x")?.path(), [0, 0]);
});

check("multiNodeDocument search can match its first actual element", () => {
  assert.deepEqual(find(multiNodeDocument(`<a id="first"/> <b/>`), "first")?.path(), [0]);
});

check("multiNodeDocument search reaches a later element in canonical order", () => {
  assert.deepEqual(find(multiNodeDocument(`"before" <a/> <b id="later"/>`), "later")?.path(), [2]);
});

check("missing IDs return undefined", () => {
  const map = element(`<main <a/>/>`);
  assert.equal(find(map, "missing"), undefined);
  assert.equal(find(map, "missing", [9]), undefined);
});

check("duplicate IDs choose the first canonical preorder match", () => {
  const map = element(`<main <section id="x"/> <aside <button id="x"/>/>/>`);
  assert.deepEqual(find(map, "x")?.path(), [0]);
});

check("scoped discovery cannot escape upward", () => {
  const map = element(`<main id="root" <section/>/>`);
  assert.equal(find(map, "root", [0]), undefined);
});

check("a scoped ordinary endpoint may itself match", () => {
  const map = element(`<main <section id="scope"/>/>`);
  assert.deepEqual(find(map, "scope", [0])?.path(), [0]);
});

check("scoped discovery reaches descendants", () => {
  const map = element(`<main <section <button id="child"/>/>/>`);
  assert.deepEqual(find(map, "child", [0])?.path(), [0, 0]);
});

check("scoped discovery ignores siblings outside the subtree", () => {
  const map = element(`<main <section/> <aside id="outside"/>/>`);
  assert.equal(find(map, "outside", [0]), undefined);
});

check("text before a match retains its logical document index", () => {
  const map = element(`<main "before" <button id="x"/>/>`);
  assert.deepEqual(find(map, "x")?.path(), [1]);
});

check("nested element carriers never enter the returned coordinate", () => {
  const map = element(`<main <section <button id="x"/>/>/>`);
  assert.deepEqual(find(map, "x")?.path(), [0, 0]);
});

check("string carriers are never ID candidates", () => {
  assert.equal(find(element(`<main "id=x"/>`), "x"), undefined);
});

check("QUID metadata is not treated as an ordinary ID", () => {
  assert.equal(find(element(`<main @00000000f/>`), "00000000f"), undefined);
});

check("ID values match exactly and case-sensitively", () => {
  const map = element(`<main <a id="Target"/>/>`);
  assert.equal(find(map, "target"), undefined);
  assert.deepEqual(find(map, "Target")?.path(), [0]);
});

check("non-string canonical ID values are not coerced", () => {
  const map = hson.liveMap.fromNode({
    $_tag: "_hson_elem",
    $_content: [{ $_tag: "main", $_attrs: { id: 7 }, $_content: [] }],
  });
  if (map.mode !== "document") throw new Error("Expected element map");
  assert.equal(find(map, "7"), undefined);
});

check("empty-string IDs follow existing canonical attribute semantics", () => {
  assert.deepEqual(find(element(`<main id=""/>`), "")?.path(), []);
});

check("discovery returns the same coordinate and interned location as map.at", () => {
  const map = element(`<main <button id="x"/>/>`);
  const found = find(map, "x");
  assert.deepEqual(found?.path(), map.at([0]).path());
  assert.equal(found, map.at([0]));
});

check("insertion and movement do not move an old location but fresh searches find the subject", () => {
  const map = element(`<main <a id="x"/> <b/>/>`);
  const found = find(map, "x");
  map.document.content.insert(target(0, 0), 0, authoredElement(`<z/>`));
  assert.equal(tag(found?.snap()), "z");
  assert.deepEqual(find(map, "x")?.path(), [1]);
  map.document.content.move(target(0, 0), 1, 2);
  assert.equal(tag(found?.snap()), "z");
  assert.deepEqual(find(map, "x")?.path(), [2]);
});

check("removing a discovered tail makes its fixed coordinate missing", () => {
  const map = element(`<main <a/> <b id="x"/>/>`);
  const found = find(map, "x");
  map.document.content.remove(target(0, 0), 1);
  assert.equal(found?.snap(), undefined);
  assert.equal(find(map, "x"), undefined);
});

check("replacement changes the occupant and fresh discovery sees current attrs", () => {
  const map = element(`<main <a id="x"/>/>`);
  const found = find(map, "x");
  map.document.content.replace(target(0, 0), 0, authoredElement(`<b id="y"/>`));
  assert.equal(tag(found?.snap()), "b");
  assert.equal(find(map, "x"), undefined);
  assert.equal(find(map, "y"), found);
});

check("replay preserves old coordinates while fresh discovery sees replayed state", () => {
  const source = element(`<main <a id="x"/> <b/>/>`);
  const receiver = element(`<main <a id="x"/> <b/>/>`);
  const found = find(receiver, "x");
  receiver.replay(source.document.content.move(target(0, 0), 0, 1));
  assert.equal(tag(found?.snap()), "b");
  assert.deepEqual(find(receiver, "x")?.path(), [1]);
});

check("restore searches restored state without changing fixed-coordinate semantics", () => {
  const map = element(`<main <a id="x"/> <b/>/>`);
  const initial = map.capture();
  map.document.content.move(target(0, 0), 0, 1);
  const moved = find(map, "x");
  map.restore(initial);
  assert.equal(tag(moved?.snap()), "b");
  assert.deepEqual(find(map, "x")?.path(), [0]);
});

check("internal discovery remains non-minting and unexported beneath the public location method", () => {
  const map = element(`<main <button id="x"/>/>`);
  const before = map.root();
  const rev = map.rev;
  void find(map, "x");
  assert.deepEqual(map.root(), before);
  assert.equal(map.rev, rev);
  assert.equal(JSON.stringify(map.root()).includes("quid"), false);
  assert.equal("find_internal_document_id" in publicApi, false);
  assert.equal("find_internal_document_id_path" in publicApi, false);
  assert.equal("id" in map.document, false);
  assert.equal(typeof map.proxy().$_.id, "function");
});

process.stdout.write(`# ${checks} internal canonical ID-discovery checks passed\n`);
testEvents.terminal("pass");

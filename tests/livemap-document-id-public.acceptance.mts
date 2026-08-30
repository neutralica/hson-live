// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type {
  DocumentLiveMap,
  LiveMapDocumentRequestTarget,
} from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
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
const tag = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "$_tag" in value ? String(value.$_tag) : undefined;

check("root document locations discover their own canonical ID", () => {
  const map = element(`<main id="root"/>`);
  assert.equal(map.at([]).id("root"), map.at([]));
});

check("root locations discover direct children", () => {
  const map = element(`<main <button id="submit"/>/>`);
  assert.deepEqual(map.at([]).id("submit")?.path(), [0]);
});

check("root locations discover nested descendants", () => {
  const map = element(`<main <section <button id="submit"/>/>/>`);
  assert.deepEqual(map.at([]).id("submit")?.path(), [0, 0]);
});

check("multiNodeDocument root locations search actual multiNodeDocument contents", () => {
  const map = multiNodeDocument(`"before" <section <button id="submit"/>/>`);
  assert.deepEqual(map.at([]).id("submit")?.path(), [1, 0]);
});

check("ordinary missing IDs return undefined", () => {
  const map = element(`<main <button/>/>`);
  assert.equal(map.at([]).id("missing"), undefined);
  assert.throws(() => Reflect.apply(map.at([]).id, map.at([]), [7]), /not a string/);
});

check("duplicate IDs choose the first canonical preorder match", () => {
  const map = element(`<main <section id="x"/> <aside <button id="x"/>/>/>`);
  assert.deepEqual(map.at([]).id("x")?.path(), [0]);
});

check("scoped ordinary endpoints include themselves", () => {
  const map = element(`<main <section id="scope"/>/>`);
  assert.equal(map.at([0]).id("scope"), map.at([0]));
});

check("scoped locations search their descendants", () => {
  const map = element(`<main <section <button id="child"/>/>/>`);
  assert.deepEqual(map.at([0]).id("child")?.path(), [0, 0]);
});

check("scoped locations cannot escape upward", () => {
  const map = element(`<main id="root" <section/>/>`);
  assert.equal(map.at([0]).id("root"), undefined);
});

check("scoped locations cannot inspect outside siblings", () => {
  const map = element(`<main <section/> <aside id="outside"/>/>`);
  assert.equal(map.at([0]).id("outside"), undefined);
});

check("text and structural carriers remain invisible to public discovery", () => {
  const map = element(`<main "id=x" <section <button id="x"/>/>/>`);
  assert.deepEqual(map.at([]).id("x")?.path(), [1, 0]);
});

check("public ID values match exactly and case-sensitively", () => {
  const map = element(`<main <button id="Submit"/>/>`);
  assert.equal(map.at([]).id("submit"), undefined);
  assert.deepEqual(map.at([]).id("Submit")?.path(), [0]);
});

check("public discovery returns logical authoring coordinates", () => {
  const map = element(`<main <section <button id="x"/>/>/>`);
  assert.deepEqual(map.at([]).id("x")?.path(), [0, 0]);
});

check("successful public discovery returns the existing interned location", () => {
  const map = element(`<main <button id="x"/>/>`);
  const found = map.at([]).id("x");
  assert.equal(found, map.at(found?.path() ?? []));
});

check("location and proxy escape discovery return the same object", () => {
  const map = element(`<main <section <button id="x"/>/>/>`);
  assert.equal(map.at([0]).id("x"), map.proxy()[0].$_.id("x"));
  assert.equal(map.proxy().$_.id("x"), map.at([0, 0]));
});

check("insertion shifts fresh discovery without moving an old location", () => {
  const map = element(`<main <a id="x"/> <b/>/>`);
  const found = map.at([]).id("x");
  map.document.content.insert(target(0), 0, element(`<z/>`).root());
  assert.equal(tag(found?.snap()), "z");
  assert.deepEqual(map.at([]).id("x")?.path(), [1]);
});

check("movement does not make a returned location follow the subject", () => {
  const map = element(`<main <a id="x"/> <b/>/>`);
  const found = map.at([]).id("x");
  map.document.content.move(target(0), 0, 1);
  assert.equal(tag(found?.snap()), "b");
});

check("fresh discovery after movement finds the current coordinate", () => {
  const map = element(`<main <a id="x"/> <b/>/>`);
  const found = map.at([]).id("x");
  map.document.content.move(target(0), 0, 1);
  assert.notEqual(map.at([]).id("x"), found);
  assert.deepEqual(map.at([]).id("x")?.path(), [1]);
});

check("removal leaves the old coordinate passive and fresh discovery missing", () => {
  const map = element(`<main <a/> <b id="x"/>/>`);
  const found = map.at([]).id("x");
  map.document.content.remove(target(0), 1);
  assert.equal(found?.snap(), undefined);
  assert.equal(map.at([]).id("x"), undefined);
});

check("replacement is visible to fresh public discovery", () => {
  const map = element(`<main <a id="x"/>/>`);
  const found = map.at([]).id("x");
  map.document.content.replace(target(0), 0, element(`<b id="y"/>`).root());
  assert.equal(map.at([]).id("x"), undefined);
  assert.equal(map.at([]).id("y"), found);
});

check("fresh public discovery observes replayed canonical state", () => {
  const source = element(`<main <a id="x"/> <b/>/>`);
  const receiver = element(`<main <a id="x"/> <b/>/>`);
  const found = receiver.at([]).id("x");
  receiver.replay(source.document.content.move(target(0), 0, 1));
  assert.equal(tag(found?.snap()), "b");
  assert.deepEqual(receiver.at([]).id("x")?.path(), [1]);
});

check("fresh public discovery observes restored canonical state", () => {
  const map = element(`<main <a id="x"/> <b/>/>`);
  const initial = map.capture();
  map.document.content.move(target(0), 0, 1);
  const moved = map.at([]).id("x");
  map.restore(initial);
  assert.equal(tag(moved?.snap()), "b");
  assert.deepEqual(map.at([]).id("x")?.path(), [0]);
});

check("public discovery does not mint QUIDs or acquire identity", () => {
  const map = element(`<main <button id="x"/>/>`);
  const before = map.root();
  void map.at([]).id("x");
  void map.proxy().$_.id("x");
  assert.deepEqual(map.root(), before);
  assert.equal(JSON.stringify(map.root()).includes("quid"), false);
});

check("public discovery does not advance document revision", () => {
  const map = element(`<main <button id="x"/>/>`);
  const before = map.rev;
  void map.at([]).id("x");
  assert.equal(map.rev, before);
});

check("data handles and façades do not gain document ID discovery", () => {
  const projected = hson.liveMap.fromJson({ id: "x" });
  const document = element(`<main id="x"/>`);
  assert.equal("id" in projected.at([]), false);
  assert.equal("id" in projected.proxy().$_, false);
  assert.equal("id" in document.document, false);
  assert.equal(Reflect.get(document.proxy(), "id"), undefined);
  assert.equal(Reflect.get(document.proxy(), "$_id"), undefined);
  assert.equal(Reflect.get(document.proxy(), "ƒ_id"), undefined);
});

process.stdout.write(`# ${checks} public canonical ID-discovery checks passed\n`);
emit_hson_live_test_completion("livemap.document-id-public", checks, checks, 0);

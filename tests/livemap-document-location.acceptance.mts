// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import * as publicApi from "../src/index.ts";
import type { ElementLiveMap, FragmentLiveMap, LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element map; observed ${map.mode}`);
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment map; observed ${map.mode}`);
  return map;
}

const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const tag = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "$_tag" in value ? String(value.$_tag) : undefined;

check("element empty path denotes the ordinary root element", () => {
  assert.equal(tag(element(`<main/>`).at([]).snap()), "main");
});

check("element numeric descent reads its first logical content item", () => {
  assert.equal(tag(element(`<main <a/>/>`).at([0]).snap()), "a");
});

check("nested numeric descent repeats logical element-content traversal", () => {
  assert.equal(tag(element(`<main <section <b/>/>/>`).at([0, 0]).snap()), "b");
});

check("fragment empty path denotes a detached logical root container", () => {
  assert.equal(tag(fragment(`<a/> <b/>`).at([]).snap()), "_hson_root");
});

check("fragment numeric descent reads top-level logical content", () => {
  assert.equal(tag(fragment(`<a/> <b/>`).at([0]).snap()), "a");
});

check("empty element content resolves missing", () => {
  assert.equal(element(`<main/>`).at([0]).snap(), undefined);
});

check("empty fragment content resolves missing", () => {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  if (map.mode !== "fragment") throw new Error("Expected empty fragment");
  assert.equal(map.at([0]).snap(), undefined);
});

check("out-of-range logical content resolves missing", () => {
  assert.equal(element(`<main <a/>/>`).at([9]).snap(), undefined);
});

check("primitive logical leaves read directly", () => {
  assert.equal(element(`<main "hello"/>`).at([0]).snap(), "hello");
});

check("descent beyond a primitive resolves missing", () => {
  assert.equal(element(`<main "hello"/>`).at([0, 0]).snap(), undefined);
});

check("node reads are detached", () => {
  const map = element(`<main <a/>/>`);
  const read = map.at([0]).snap();
  if (typeof read !== "object" || read === null) throw new Error("Expected node");
  read.$_tag = "changed";
  assert.equal(tag(map.at([0]).snap()), "a");
});

check("ordinary traversal never counts the element content carrier", () => {
  const map = element(`<main <a/>/>`);
  assert.equal(tag(map.at([0]).snap()), "a");
  assert.notEqual(tag(map.at([0]).snap()), "_hson_elem");
});

check("construction and reads do not mint QUIDs", () => {
  const map = element(`<main <a/>/>`);
  const before = map.root();
  void map.at([0]).snap();
  assert.deepEqual(map.root(), before);
  assert.equal(JSON.stringify(map.root()).includes("_quid"), false);
});

check("construction and reads do not change revision", () => {
  const map = element(`<main <a/>/>`);
  const before = map.rev;
  void map.at([0]).snap();
  assert.equal(map.rev, before);
});

check("insertion before a fixed coordinate changes its current occupant", () => {
  const map = element(`<main <a/> <b/>/>`);
  const location = map.at([1]);
  map.document.content.insert(target(0), 0, element(`<x/>`).element.node());
  assert.equal(tag(location.snap()), "a");
});

check("a fixed coordinate does not follow a moved subject", () => {
  const map = element(`<main <a/> <b/> <c/>/>`);
  const location = map.at([0]);
  map.document.content.move(target(0), 0, 2);
  assert.equal(tag(location.snap()), "b");
});

check("removal changes the current occupant or missing state", () => {
  const map = element(`<main <a/> <b/>/>`);
  const location = map.at([0]);
  const tail = map.at([1]);
  map.document.content.remove(target(0), 0);
  assert.equal(tag(location.snap()), "b");
  assert.equal(tail.snap(), undefined);
});

check("replacement changes the current occupant", () => {
  const map = element(`<main <a/>/>`);
  const location = map.at([0]);
  map.document.content.replace(target(0), 0, element(`<x/>`).element.node());
  assert.equal(tag(location.snap()), "x");
});

check("replay re-resolves an existing logical location", () => {
  const source = element(`<main <a/> <b/>/>`);
  const receiver = element(`<main <a/> <b/>/>`);
  const location = receiver.at([0]);
  receiver.replay(source.document.content.move(target(0), 0, 1));
  assert.equal(tag(location.snap()), "b");
});

check("restore re-resolves an existing logical location", () => {
  const map = element(`<main <a/>/>`);
  const initial = map.capture();
  const location = map.at([0]);
  map.document.content.replace(target(0), 0, element(`<x/>`).element.node());
  map.restore(initial);
  assert.equal(tag(location.snap()), "a");
});

check("relative at composes logical coordinates", () => {
  const map = element(`<main <section <b/>/>/>`);
  assert.equal(map.at([0]).at([0]), map.at([0, 0]));
  assert.equal(tag(map.at([0]).at([0]).snap()), "b");
});

check("coordinate inspection returns a detached logical path", () => {
  const location = element(`<main <a/>/>`).at([0]);
  const path = location.path() as number[];
  assert.deepEqual(path, [0]);
  assert.throws(() => path.push(1), TypeError);
});

check("projected at behavior remains unchanged", () => {
  const map = hson.liveMap.fromJson({ items: ["first"] });
  assert.equal(map.at(["items", 0]).snap(), "first");
  assert.equal(typeof map.at(["items"]).array.push, "function");
});

check("document namespace does not acquire an at surface", () => {
  assert.equal("at" in element(`<main/>`).document, false);
});

check("malformed logical paths reject at construction", () => {
  const map = element(`<main/>`);
  assert.throws(() => map.at([-1]), /not valid/);
  assert.throws(() => map.at([1.5]), /not valid/);
  assert.throws(() => Reflect.apply(map.at, map, [["content"]]), /not valid/);
});

check("internal logical traversal names are not package exports", () => {
  assert.equal("resolve_internal_document_location" in publicApi, false);
  assert.equal("InternalDocumentTraversalError" in publicApi, false);
});

process.stdout.write(`# ${checks} public document location checks passed\n`);
emit_hson_live_test_completion("livemap.document-location", checks, checks, 0);

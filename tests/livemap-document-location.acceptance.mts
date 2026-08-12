// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import * as publicApi from "../src/index.ts";
import type { ElementLiveMap, FragmentLiveMap, LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";

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
  const dispose = map.at([0]).watch(() => undefined);
  assert.deepEqual(map.root(), before);
  assert.equal(JSON.stringify(map.root()).includes("_quid"), false);
  dispose();
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

check("document watch is future-only and observes attrs and content snapshots", () => {
  const map = element(`<main <a/>/>`);
  const rootTags: string[] = [];
  const childTags: string[] = [];
  const primitiveValues: unknown[] = [];
  map.at([]).watch((next) => rootTags.push(tag(next) ?? "missing"));
  map.at([0]).watch((next) => childTags.push(tag(next) ?? "missing"));
  map.at([0, 0]).watch((next) => primitiveValues.push(next));

  map.at([0]).attrs.set("title", "watched");
  map.at([0]).insert(0, "text");
  assert.deepEqual(rootTags, ["main", "main"]);
  assert.deepEqual(childTags, ["a", "a"]);
  assert.deepEqual(primitiveValues, ["text"]);
});

check("document watch keeps fixed coordinates through reindex and missing", () => {
  const map = element(`<main <a/> <b/>/>`);
  const seen: string[] = [];
  const dispose = map.at([1]).watch((next) => seen.push(tag(next) ?? "missing"));

  map.at([]).insert(0, element(`<x/>`).element.node());
  map.at([0]).delete();
  map.at([1]).replace(element(`<c/>`).element.node());
  map.at([1]).delete();
  map.at([]).insert(1, element(`<d/>`).element.node());
  assert.deepEqual(seen, ["a", "b", "c", "missing", "d"]);
  dispose();
  dispose();
  map.at([1]).replace(element(`<e/>`).element.node());
  assert.equal(seen.at(-1), "d");
});

check("document watch always delivers restore including missing-to-missing", () => {
  const map = element(`<main <a/>/>`);
  const seen: string[] = [];
  const missing: unknown[] = [];
  map.at([0]).watch((next) => seen.push(tag(next) ?? "missing"));
  map.at([9]).watch((next) => missing.push(next));

  map.restore(map.capture());
  assert.deepEqual(seen, ["a"]);
  assert.deepEqual(missing, [undefined]);

  map.restore(element(`<main <b/>/>`).capture());
  assert.deepEqual(seen, ["a", "b"]);
  assert.deepEqual(missing, [undefined, undefined]);

  assert.throws(() => map.restore(fragment(`<b/>`).capture()));
  assert.deepEqual(seen, ["a", "b"]);
  assert.deepEqual(missing, [undefined, undefined]);
});

check("document watch observes replay and strict canonical metadata changes", () => {
  const source = element(`<main <a/> <b/>/>`);
  const receiver = element(`<main <a/> <b/>/>`);
  const replayTags: string[] = [];
  receiver.at([0]).watch((next) => replayTags.push(tag(next) ?? "missing"));
  receiver.replay(source.at([]).move(0, 1));
  assert.deepEqual(replayTags, ["b"]);

  const identified = element(`<main <a/>/>`);
  const metadata: unknown[] = [];
  identified.at([0]).watch((next) => metadata.push(next));
  acquire_document_identity(identified.document, Object.freeze({
    kind: "path" as const,
    path: Object.freeze([0, 0]),
  }));
  assert.equal(metadata.length, 1);
  assert.equal(
    typeof metadata[0] === "object"
      && metadata[0] !== null
      && "$_meta" in metadata[0]
      && typeof metadata[0].$_meta === "object"
      && metadata[0].$_meta !== null
      && "quid" in metadata[0].$_meta,
    true,
  );

  const installed = element(`<main <a/> <aside state="old"/>/>`);
  const installedTags: string[] = [];
  installed.at([0]).watch((next) => installedTags.push(tag(next) ?? "missing"));
  installed.at([1]).attrs.set("state", "local");
  assert.deepEqual(installedTags, []);
  installed.install(element(`<main <a/> <aside state="remote"/>/>`).capture());
  assert.deepEqual(installedTags, []);
  installed.install(element(`<main <b/> <aside state="remote"/>/>`).capture());
  assert.deepEqual(installedTags, ["b"]);
});

check("an id-discovered watcher remains attached to its original coordinate", () => {
  const map = element(`<main <a id="x"/> <b/>/>`);
  const found = map.at([]).id("x");
  if (found === undefined) throw new Error("Expected discovered location");
  const seen: string[] = [];
  found.watch((next) => seen.push(tag(next) ?? "missing"));

  map.at([]).move(0, 1);
  assert.deepEqual(seen, ["b"]);
  assert.deepEqual(map.at([]).id("x")?.path(), [1]);
});

check("document watcher payloads are detached and listener failures are isolated", () => {
  const map = element(`<main <a/>/>`);
  const order: string[] = [];
  map.at([0]).watch((next) => {
    order.push("watch-a");
    if (typeof next === "object" && next !== null) next.$_tag = "mutated";
    throw new Error("document watch failure");
  });
  map.at([0]).watch((next) => { order.push(`watch-b:${tag(next)}`); });
  map.commits.observe(() => { order.push("observer"); });

  assert.throws(() => map.at([0]).attrs.set("title", "changed"), /document watch failure/);
  assert.deepEqual(order, ["watch-a", "watch-b:a", "observer"]);
  assert.equal(tag(map.at([0]).snap()), "a");
});

check("document public observer failure takes precedence after watch delivery", () => {
  const map = element(`<main <a/>/>`);
  const order: string[] = [];
  map.commits.observe(() => {
    order.push("observer");
    throw new Error("document observer failure");
  });
  map.at([0]).watch(() => {
    order.push("watch");
    throw new Error("document watch failure");
  });

  assert.throws(() => map.at([0]).attrs.set("title", "changed"), /document observer failure/);
  assert.deepEqual(order, ["watch", "observer"]);
});

process.stdout.write(`# ${checks} public document location checks passed\n`);
emit_hson_live_test_completion("livemap.document-location", checks, checks, 0);

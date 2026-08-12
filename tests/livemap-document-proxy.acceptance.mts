// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
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

check("document maps acquire proxies through the existing public surface", () => {
  assert.equal(typeof element(`<main/>`).proxy, "function");
  assert.equal("proxy" in element(`<main/>`).document, false);
});

check("element numeric proxy access traverses root content", () => {
  assert.equal(tag(element(`<main <a/>/>`).proxy()[0].$_.snap()), "a");
});

check("fragment numeric proxy access traverses top-level content", () => {
  assert.equal(tag(fragment(`<a/> <b/>`).proxy()[1].$_.snap()), "b");
});

check("nested numeric proxy access traverses nested logical content", () => {
  assert.equal(tag(element(`<main <section <b/>/>/>`).proxy()[0][0].$_.snap()), "b");
});

check("numeric proxy traversal never exposes the element carrier", () => {
  assert.notEqual(tag(element(`<main <a/>/>`).proxy()[0].$_.snap()), "_hson_elem");
});

check("text proxy reads return the authored primitive", () => {
  assert.equal(element(`<main "hello"/>`).proxy()[0].$_.snap(), "hello");
});

check("empty and out-of-range proxy coordinates read missing", () => {
  const map = element(`<main/>`);
  assert.equal(map.proxy()[0].$_.snap(), undefined);
  assert.equal(map.proxy()[100].$_.snap(), undefined);
});

check("missing proxy coordinates remain representable and identity-stable", () => {
  const proxy = element(`<main/>`).proxy();
  assert.equal(proxy[100], proxy[100]);
  assert.deepEqual(proxy[100].$_.path(), [100]);
});

check("traversal beyond a primitive remains a passive missing coordinate", () => {
  const location = element(`<main "hello"/>`).proxy()[0][1].$_;
  assert.deepEqual(location.path(), [0, 1]);
  assert.equal(location.snap(), undefined);
});

check("proxy escape resolves to the owning map's interned location", () => {
  const map = element(`<main <a/>/>`);
  assert.equal(map.proxy()[0].$_, map.at([0]));
});

check("nested and rooted proxy traversal match relative location traversal", () => {
  const map = element(`<main <section <a/> <b/>/>/>`);
  assert.equal(map.proxy()[0][1].$_, map.at([0]).at([1]));
  assert.equal(map.proxy([0])[1].$_, map.at([0, 1]));
});

check("fixed proxy coordinates re-resolve after insertion", () => {
  const map = element(`<main <a/> <b/>/>`);
  const proxy = map.proxy();
  map.document.content.insert(target(0), 0, element(`<x/>`).element.node());
  assert.equal(tag(proxy[1].$_.snap()), "a");
});

check("fixed proxy coordinates do not follow moved subjects", () => {
  const map = element(`<main <a/> <b/> <c/>/>`);
  const first = map.proxy()[0];
  map.document.content.move(target(0), 0, 2);
  assert.equal(tag(first.$_.snap()), "b");
});

check("fixed proxy coordinates re-resolve after removal", () => {
  const map = element(`<main <a/> <b/>/>`);
  const proxy = map.proxy();
  map.document.content.remove(target(0), 0);
  assert.equal(tag(proxy[0].$_.snap()), "b");
  assert.equal(proxy[1].$_.snap(), undefined);
});

check("fixed proxy coordinates re-resolve after replacement", () => {
  const map = element(`<main <a/>/>`);
  const first = map.proxy()[0];
  map.document.content.replace(target(0), 0, element(`<x/>`).element.node());
  assert.equal(tag(first.$_.snap()), "x");
});

check("proxy locations re-resolve after replay", () => {
  const source = element(`<main <a/> <b/>/>`);
  const receiver = element(`<main <a/> <b/>/>`);
  const first = receiver.proxy()[0];
  receiver.replay(source.document.content.move(target(0), 0, 1));
  assert.equal(tag(first.$_.snap()), "b");
});

check("proxy locations re-resolve after restore", () => {
  const map = element(`<main <a/>/>`);
  const initial = map.capture();
  const first = map.proxy()[0];
  map.document.content.replace(target(0), 0, element(`<x/>`).element.node());
  map.restore(initial);
  assert.equal(tag(first.$_.snap()), "a");
});

check("proxy acquisition and reads do not mint QUIDs or advance revision", () => {
  const map = element(`<main <a/>/>`);
  const before = map.capture();
  void map.proxy()[0].$_.snap();
  assert.equal(map.rev, before.rev);
  assert.deepEqual(map.capture().root, before.root);
  assert.equal(JSON.stringify(map.root()).includes("_quid"), false);
});

check("document $_ exposes only established passive location capabilities", () => {
  const location = element(`<main/>`).proxy().$_;
  assert.deepEqual(Reflect.ownKeys(location).sort(), ["at", "path", "rev", "snap"]);
  for (const projected of ["set", "replace", "delete", "update", "array", "object", "feed", "linkTo"]) {
    assert.equal(projected in location, false);
  }
});

check("projected object proxy behavior remains unchanged", () => {
  const map = hson.liveMap.fromJson({ user: { name: "Ada" } });
  const user = Reflect.get(map.proxy(), "user");
  assert.equal(Reflect.get(user, "name").$_.snap(), "Ada");
  assert.equal(typeof user.$_.object.getKey, "function");
});

check("projected array proxy behavior remains unchanged", () => {
  const map = hson.liveMap.fromJson({ items: ["first"] });
  const items = Reflect.get(map.proxy(), "items");
  assert.equal(items[0].$_.snap(), "first");
  assert.equal(typeof items.$_.array.push, "function");
});

check("implicit JavaScript probes stay inert", () => {
  const proxy = element(`<main/>`).proxy();
  for (const property of ["then", "constructor", "toJSON", "__proto__", Symbol.iterator]) {
    assert.equal(Reflect.get(proxy, property), undefined);
  }
  assert.equal(Promise.resolve(proxy) instanceof Promise, true);
});

check("ordinary document string properties do not become facets", () => {
  const proxy = element(`<main/>`).proxy();
  for (const property of ["tag", "attrs", "metadata", "style", "content", "find", "findAll"]) {
    assert.equal(Reflect.get(proxy, property), undefined);
  }
});

check("document proxy child caches are logical-coordinate based", () => {
  const map = element(`<main <a/>/>`);
  const proxy = map.proxy();
  const child = proxy[0];
  assert.equal(child, proxy[0]);
  assert.equal(child.$_, map.at([0]));
});

check("direct assignment deletion and definition remain rejected", () => {
  const proxy = element(`<main/>`).proxy() as unknown as Record<PropertyKey, unknown>;
  assert.throws(() => { proxy[0] = "bad"; }, /must be changed through \$_/);
  assert.throws(() => { delete proxy[0]; }, /must be deleted through \$_/);
  assert.throws(() => Object.defineProperty(proxy, "0", { value: "bad" }), /must not be defined directly/);
});

process.stdout.write(`# ${checks} public document proxy checks passed\n`);
emit_hson_live_test_completion("livemap.document-proxy", checks, checks, 0);

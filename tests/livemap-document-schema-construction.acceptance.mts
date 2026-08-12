// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError } from "../src/index.ts";
import type { DocumentLiveMap, ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const d = hson.liveMap.schema.document;

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

function emptyFragment(): FragmentLiveMap {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
  return map;
}

function rejectsSchema(map: DocumentLiveMap, schema: object, pattern: RegExp): void {
  assert.throws(
    () => Reflect.apply(map.schema.use, map.schema, [schema]),
    (error: unknown) => error instanceof LiveMapSchemaError && pattern.test(error.message),
  );
}

check("document schema namespace exposes exactly the approved vocabulary", () => {
  assert.deepEqual(Object.keys(d), ["text", "element", "fragment", "sequence", "repeat", "pick"]);
});

check("text is one deeply immutable opaque schema value", () => {
  assert.equal(Object.isFrozen(d.text), true);
  assert.deepEqual(Object.keys(d.text), []);
  assert.equal(d.text, d.text);
});

check("constructed schema values are immutable and reusable", () => {
  const schema = d.element({ content: d.sequence(d.text) });
  assert.equal(Object.isFrozen(schema), true);
  assert.equal(element(`<a "x"/>`).schema.use(schema).schema.get(), schema);
  assert.equal(element(`<b "y"/>`).schema.use(schema).schema.get(), schema);
});

check("element construction copies and normalizes caller options", () => {
  const options: { tag: string } = { tag: "button" };
  const schema = d.element(options);
  options.tag = "aside";
  element(`<button/>`).schema.use(schema);
  rejectsSchema(element(`<aside/>`), schema, /Expected tag "button"/);
});

check("empty pick rejects at runtime", () => {
  assert.throws(() => Reflect.apply(d.pick, d, []), /requires at least one choice/);
});

check("pick rejects item and content category mixing", () => {
  assert.throws(
    () => Reflect.apply(d.pick, d, [d.text, d.sequence(d.text)]),
    /cannot mix item and content/,
  );
});

check("composition rejects foreign values", () => {
  assert.throws(() => Reflect.apply(d.sequence, d, [{}]), /unrecognized schema value/);
});

check("sequence rejects content schemas as items", () => {
  assert.throws(() => Reflect.apply(d.sequence, d, [d.repeat(d.text)]), /expected a item schema/);
});

check("repeat rejects content schemas as its item", () => {
  assert.throws(() => Reflect.apply(d.repeat, d, [d.sequence(d.text)]), /expected a item schema/);
});

check("fragment requires a content schema", () => {
  assert.throws(() => Reflect.apply(d.fragment, d, [d.text]), /expected a content schema/);
});

check("text schema accepts canonical logical string content", () => {
  const map = element(`<button "Save"/>`);
  map.schema.use(d.element({ tag: "button", content: d.sequence(d.text) }));
  assert.equal(map.at([0]).snap(), "Save");
});

check("text schema rejects a structured element at its logical path", () => {
  rejectsSchema(
    element(`<button <em/>/>`),
    d.element({ content: d.sequence(d.text) }),
    /Expected text at \[0\]; received element <em>/,
  );
});

check("element schema accepts any ordinary tag when tag is omitted", () => {
  element(`<button/>`).schema.use(d.element());
  element(`<section/>`).schema.use(d.element());
});

check("element schema enforces an exact canonical tag", () => {
  const schema = d.element({ tag: "button" });
  element(`<button/>`).schema.use(schema);
  rejectsSchema(element(`<div/>`), schema, /Expected tag "button"/);
});

check("omitted element content leaves only that descendant subtree broad", () => {
  element(`<main <section "x" <strong "y"/>/>/>`).schema.use(
    d.element({ tag: "main", content: d.sequence(d.element()) }),
  );
});

check("supplied nested element content is closed recursively", () => {
  const schema = d.element({
    content: d.sequence(d.element({ content: d.sequence(d.text) })),
  });
  element(`<main <section "x"/>/>`).schema.use(schema);
  rejectsSchema(element(`<main <section "x" "y"/>/>`), schema, /closed sequence length 1/);
});

check("empty sequence admits permanently empty direct element content", () => {
  element(`<main/>`).schema.use(d.element({ content: d.sequence() }));
  rejectsSchema(
    element(`<main "x"/>`),
    d.element({ content: d.sequence() }),
    /closed sequence length 0/,
  );
});

check("empty sequence admits a permanently empty fragment", () => {
  emptyFragment().schema.use(d.fragment(d.sequence()));
  rejectsSchema(fragment(`"x"`), d.fragment(d.sequence()), /closed sequence length 0/);
});

check("repeat admits zero or more text items", () => {
  emptyFragment().schema.use(d.fragment(d.repeat(d.text)));
  fragment(`"a" "b"`).schema.use(d.fragment(d.repeat(d.text)));
});

check("repeat rejects a nonmatching item at its logical coordinate", () => {
  rejectsSchema(
    fragment(`"a" <b/>`),
    d.fragment(d.repeat(d.text)),
    /Expected text at \[1\]/,
  );
});

check("item pick admits repeated text or element content", () => {
  fragment(`"a" <b/> "c"`).schema.use(
    d.fragment(d.repeat(d.pick(d.text, d.element()))),
  );
});

check("layout pick admits either complete fixed sequence", () => {
  const schema = d.fragment(d.pick(
    d.sequence(d.text, d.text),
    d.sequence(d.text, d.element(), d.text),
  ));
  fragment(`"a" "b"`).schema.use(schema);
  fragment(`"a" <b/> "c"`).schema.use(schema);
});

check("layout pick rejects when no complete layout matches", () => {
  rejectsSchema(
    fragment(`"a" <b/>`),
    d.fragment(d.pick(
      d.sequence(d.text, d.text),
      d.sequence(d.text, d.element(), d.text),
    )),
    /no pick branch matched/,
  );
});

check("element map rejects fragment root schema through schema validation", () => {
  rejectsSchema(element(`<main/>`), d.fragment(d.sequence()), /fragment document root/);
});

check("fragment map rejects element root schema through schema validation", () => {
  rejectsSchema(fragment(`"x"`), d.element(), /element document root/);
});

process.stdout.write(`# ${checks} LiveMap document schema construction checks passed\n`);
emit_hson_live_test_completion("livemap.document-schema-construction", checks, checks, 0);

// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson } from "../src/hson-authoring.ts";
import { TransformError } from "../src/core/errors.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-structural-interpolation",
  title: "Hson grammar-context interpolation",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "admission", "tagged-template", "structural-interpolation"]),
});

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}
function error(run: () => unknown, code: string): TransformError {
  let result: TransformError | undefined;
  assert.throws(run, cause => {
    if (!(cause instanceof TransformError)) return false;
    result = cause;
    return cause.code === code;
  });
  if (result === undefined) throw new Error("Expected TransformError.");
  return result;
}

check("document inserts one, many, and zero content items", () => {
  const one = Hson.document`<main/>`;
  const many = Hson.document`<main/><footer/>`;
  const empty = undefined;
  assert.equal(Hson.document`<body ${one}/>`, Hson.document`<body <main/>/>`);
  assert.equal(Hson.document`<body ${many}/>`, Hson.document`<body <main/><footer/>/>`);
  assert.equal(Hson.document`<body ${empty}/>`, Hson.document`<body/>`);
  error(() => Hson.document`${empty}`, "HSON_DOCUMENT_EMPTY");
  error(() => Hson.document`${empty}${empty}`, "HSON_DOCUMENT_EMPTY");
  assert.equal(Hson.document`${many}`, many);
  assert.equal(Hson.document`${empty}<main/>`, one);
  assert.equal(Hson.document`<header/>${many}<aside/>`, Hson.document`<header/><main/><footer/><aside/>`);
  assert.equal(Hson.document`<div disabled ${one}/>`, Hson.document`<div disabled <main/>/>`);
  assert.equal(Hson.document`<div title="${"x"}" ${one}/>`, Hson.document`<div title="x" <main/>/>`);
});

check("unquoted document insertion and quoted string content differ", () => {
  const value = Hson.document`<main/>`;
  assert.equal(Hson.document`<body "${value}"/>`, Hson.document`<body "<main/>"/>`);
  const hostile = '<script src="/evil.js"/>';
  const textRoot = Hson.document.toNode(Hson.document`<p "${hostile}"/>`);
  assert.match(JSON.stringify(textRoot), /"_hson_str"/);
  assert.doesNotMatch(JSON.stringify(textRoot), /"\$_tag":"script"/);
  assert.equal(Hson.document`<body ${hostile}/>`, Hson.document`<body <script src="/evil.js"/>/>`);
  error(() => Hson.document`<body ${"hello"}/>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
});

check("document absence is zero nodes while quoted empty text is one STR", () => {
  const absent: import("../src/hson-authoring.ts").HsonDocument | undefined = undefined;
  assert.deepEqual(Hson.document.toNode(Hson.document`<main ${absent}/>`), Hson.document.toNode(Hson.document`<main/>`));
  assert.equal(Hson.document`<main <p "before"/> ${undefined} <p "after"/>/>`,
    Hson.document`<main <p "before"/> <p "after"/>/>`);
  error(() => Hson.document`<main ${""}/>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  error(() => Hson.document`${""}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  error(() => Hson.document`${""}${""}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  assert.deepEqual(Hson.document.toNode(Hson.document`<main "${""}"/>`),
    Hson.document.toNode(Hson.document`<main ""/>`));
  error(() => Hson.document`<main "${undefined}"/>`, "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED");
  for (const run of [
    () => (Hson.data as any)`${undefined}`,
    () => (Hson.data as any)`«${undefined}»`,
    () => (Hson.data as any)`<value ${undefined}>`,
  ]) error(run, "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID");
  error(() => (Hson.canonical as any)`${undefined}`, "HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED");
});

check("data slots preserve one value in each legal position", () => {
  const array = Hson.data`«1,2,3»`;
  const object = Hson.data`<a 1 b 2>`;
  const scalar = Hson.data`-0`;
  const string = Hson.data`"hello"`;
  assert.equal(Hson.data`${scalar}`, scalar);
  assert.equal(Hson.data`${string}`, string);
  assert.equal(Hson.data`${object}`, object);
  assert.equal(Hson.data`${array}`, array);
  assert.equal(Hson.data`<outer ${array}>`, Hson.data`<outer «1,2,3»>`);
  assert.equal(Hson.data`<outer ${object}>`, Hson.data`<outer <a 1 b 2>>`);
  assert.equal(Hson.data`«${array}»`, Hson.data`««1,2,3»»`);
  assert.equal(Hson.data`«${scalar},${array}»`, Hson.data`«-0,«1,2,3»»`);
  assert.deepEqual(Hson.data.materialize(Hson.data`<outer ${object}>`), { outer: { a: 1, b: 2 } });
});

check("unquoted data primitives and candidate modes are checked independently", () => {
  for (const value of [1, -0, true, false, null] as const) {
    assert.deepEqual(Hson.data.materialize(Hson.data`<value ${value}>`), { value });
    assert.equal(Hson.data.materialize(Hson.data`${value}`), value);
    assert.deepEqual(Hson.data.materialize(Hson.data`«${value}»`), [value]);
    error(() => Hson.document`<body ${value}/>`, "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID");
    const text = Object.is(value, -0) ? "-0" : String(value);
    assert.deepEqual(Hson.data.materialize(Hson.data`<value "${value}">`), { value: text });
  }
  assert.equal(Hson.data`${-0}`, "-0");
  error(() => Hson.data`${Infinity}`, "HSON_NUMBER_NONFINITE");
  for (const value of [{}, new String("<main/>")]) {
    error(() => (Hson.document as any)`<body ${value}/>`, "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID");
    error(() => (Hson.data as any)`${value}`, "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID");
  }
  error(() => Hson.document`<body ${Hson.data`<a 1>`}/>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  error(() => Hson.data`${Hson.document`<main/>`}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  error(() => Hson.data`${""}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  error(() => Hson.data`<label ${"hello"}>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  assert.equal(Hson.data`<label "${"hello"}">`, Hson.data`<label "hello">`);
  assert.equal(Hson.document`<body ${"<main/>"}/>`, Hson.document`<body <main/>/>`);
});

check("whole quoted slots accept primitives; unsupported values and partial strings reject", () => {
  for (const value of [undefined, {}, new String("x")]) {
    error(() => (Hson.document as any)`<p "${value}"/>`, "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED");
  }
  const value = "x";
  for (const run of [
    () => Hson.document`<p "hello ${value}"/>`,
    () => Hson.document`<p "${value} world"/>`,
    () => Hson.data`<a "a ${value} b">`,
    () => Hson.document`<p "a ${value} b ${value}"/>`,
    () => Hson.document`<p title="${value} world"/>`,
  ]) error(run, "HSON_QUOTED_INTERPOLATION_PARTIAL");
});

check("attribute values require complete quoted strings", () => {
  const value = "slide";
  assert.equal(Hson.document`<div class="${value}" id="${"hero"}" title="${"hello"}"/>`,
    Hson.document`<div class="slide" id="hero" title="hello"/>`);
  error(() => Hson.document`<div class=${value}/>`, "HSON_INTERPOLATION_POSITION_INVALID");
  assert.equal(Hson.document`<div disabled/>`, Hson.document`<div disabled/>`);
});

check("names, comments, and fused slots cannot be interpolated", () => {
  const value = Hson.document`<main/>`;
  for (const run of [
    () => Hson.document`<${value}/>` ,
    () => Hson.document`<body${value}/>` ,
    () => Hson.document`<p class${value}/>` ,
    () => Hson.data`<${"a"} 1>` ,
    () => Hson.data`<'a${"b"}' 1>` ,
    () => Hson.document`// ${value}
<main/>`,
  ]) error(run, "HSON_INTERPOLATION_POSITION_INVALID");
  assert.equal(Hson.document`<p "#foo"/>`, Hson.document`<p "#foo"/>`);
  assert.equal(Hson.data`<'#' 1>`, Hson.data`<'#' 1>`);
  assert.equal(Hson.document`// # is inert comment text
<main/>`, value);
  error(() => Hson.data`<a 1 ${Hson.data`2`}>`, "HSON_INTERPOLATION_POSITION_INVALID");
});

check("canonical shares source interpolation while Schema remains substitution-free", () => {
  assert.equal(Hson.canonical`${Hson.data`1`}`, "1");
  assert.equal(Hson.canonical`${"<main/>"}`, "<main/>");
  assert.equal(Hson.canonical`${-0}`, "-0");
  assert.equal(Hson.canonical`${true}`, "true");
  assert.equal(Hson.canonical`${false}`, "false");
  assert.equal(Hson.canonical`${null}`, "null");
  assert.throws(() => (Hson.schema as any)`${Hson.data`1`}`, /substitution-free/);
});

check("whole-document admission catches special-tag violations", () => {
  error(() => Hson.document`<body ${'<script "go()"/>'}/>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  const one = Hson.document`"a"`;
  assert.throws(() => Hson.document`<style ${one} ${one}/>`, /composed Hson.document|Document <style>/);
  const inlineScript = Hson.document`"go()"`;
  error(() => Hson.document`<script src="/app.js" ${inlineScript}/>`, "HSON_INTERPOLATION_COMPOSED_INVALID");
  const child = Hson.document`<b/>`;
  error(() => Hson.document`<style ${child}/>`, "HSON_INTERPOLATION_COMPOSED_INVALID");
  assert.equal(Hson.document`<style ${undefined} "body{margin:0}"/>`, Hson.document`<style "body{margin:0}"/>`);
});

check("style and script quoted slots use normal document admission", () => {
  const css = "body{margin:0}\nmain{color:red}";
  assert.equal(Hson.document`<style "${css}"/>`, Hson.document`<style "body{margin:0}\nmain{color:red}"/>`);
  error(() => Hson.document`<style "${""}"/>`, "HSON_INTERPOLATION_COMPOSED_INVALID");
  assert.equal(Hson.document`<script src="${"/app.js"}"/>`, Hson.document`<script src="/app.js"/>`);
  error(() => Hson.document`<script "${"go()"}"/>`, "HSON_INTERPOLATION_COMPOSED_INVALID");
});

check("portable document templates reject runtime QUID claims", () => {
  error(() => Hson.document`<main @000000001/>`, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
  const child = Hson.document`<main/>`;
  error(() => Hson.document`<body @000000001 ${child}/>`, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
});

process.stdout.write(`# ${checks} grammar-context interpolation checks passed\n`);

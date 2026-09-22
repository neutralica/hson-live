// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson } from "../src/hson-authoring.ts";
import { TransformError } from "../src/core/errors.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-structural-interpolation",
  title: "Hson structural interpolation",
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
  const empty = Hson.document``;
  assert.equal(Hson.document`<body #${one}/>`, Hson.document`<body <main/>/>`);
  assert.equal(Hson.document`<body #${many}/>`, Hson.document`<body <main/><footer/>/>`);
  assert.equal(Hson.document`<body #${empty}/>`, Hson.document`<body/>`);
  assert.equal(Hson.document`#${empty}`, empty);
  assert.equal(Hson.document`#${many}`, many);
  assert.equal(Hson.document`#${empty}<main/>`, one);
  assert.equal(Hson.document`<header/>#${many}<aside/>`, Hson.document`<header/><main/><footer/><aside/>`);
  assert.equal(Hson.document`<div disabled #${one}/>`, Hson.document`<div disabled <main/>/>`);
  assert.equal(Hson.document`<div title=${"x"} #${one}/>`, Hson.document`<div title="x" <main/>/>`);
});

check("ordinary interpolation remains one text leaf", () => {
  const value = Hson.document`<main/>`;
  assert.equal(Hson.document`<body ${value}/>`, Hson.document`<body "<main/>"/>`);
  const hostile = '<script src="/evil.js"/>';
  const textRoot = Hson.document.toNode(Hson.document`<p ${hostile}/>`);
  assert.match(JSON.stringify(textRoot), /"_hson_str"/);
  assert.doesNotMatch(JSON.stringify(textRoot), /"\$_tag":"script"/);
  assert.equal(Hson.document`<body #${hostile}/>`, Hson.document`<body <script src="/evil.js"/>/>`);
});

check("data slots preserve one value in each legal position", () => {
  const array = Hson.data`«1,2,3»`;
  const object = Hson.data`<a 1 b 2>`;
  const scalar = Hson.data`-0`;
  const string = Hson.data`"hello"`;
  assert.equal(Hson.data`#${scalar}`, scalar);
  assert.equal(Hson.data`#${string}`, string);
  assert.equal(Hson.data`#${object}`, object);
  assert.equal(Hson.data`#${array}`, array);
  assert.equal(Hson.data`<outer #${array}>`, Hson.data`<outer «1,2,3»>`);
  assert.equal(Hson.data`<outer #${object}>`, Hson.data`<outer <a 1 b 2>>`);
  assert.equal(Hson.data`«#${array}»`, Hson.data`««1,2,3»»`);
  assert.equal(Hson.data`«#${scalar},#${array}»`, Hson.data`«-0,«1,2,3»»`);
  assert.deepEqual(Hson.data.materialize(Hson.data`<outer #${object}>`), { outer: { a: 1, b: 2 } });
});

check("candidate type and receiving mode are checked independently", () => {
  for (const value of [123, true, null, {}, new String("<main/>")]) {
    error(() => (Hson.document as any)`<body #${value}/>`, "HSON_STRUCTURAL_CANDIDATE_STRING_REQUIRED");
    error(() => (Hson.data as any)`#${value}`, "HSON_STRUCTURAL_CANDIDATE_STRING_REQUIRED");
  }
  error(() => Hson.document`<body #${Hson.data`<a 1>`}/>`, "HSON_STRUCTURAL_CANDIDATE_INVALID");
  error(() => Hson.data`#${Hson.document`<main/>`}`, "HSON_STRUCTURAL_CANDIDATE_INVALID");
  error(() => Hson.data`#${""}`, "HSON_STRUCTURAL_CANDIDATE_INVALID");
  assert.equal(Hson.document`<body #${"<main/>"}/>`, Hson.document`<body <main/>/>`);
});

check("hash syntax and illegal positions reject", () => {
  const value = Hson.document`<main/>`;
  for (const run of [
    () => Hson.document`<body #foo/>`,
    () => Hson.document`<body # ${value}/>`,
    () => Hson.document`<body ##${value}/>`,
    () => Hson.document`<body #foo ${value}/>`,
    () => Hson.document`<body href=#${value}/>`,
    () => Hson.document`<body \\#${value}/>`,
    () => Hson.document`<body \#${value}/>`,
    () => Hson.document`<body \u0023${value}/>`,
  ]) assert.throws(run);
  assert.equal(Hson.document`<p "#foo"/>`, Hson.document`<p "#foo"/>`);
  assert.equal(Hson.data`<'#' 1>`, Hson.data`<'#' 1>`);
  assert.equal(Hson.document`// # is inert comment text
<main/>`, value);
  assert.equal(Hson.document`// #${123}
<main/>`, value);
  assert.equal(Hson.document`<body ${'"'} #${value}/>`, Hson.document`<body ${'"'} <main/>/>`);
  try {
    Hson.document`<p "#${123}"/>`;
  } catch (cause) {
    assert.notEqual(cause instanceof TransformError ? cause.code : "", "HSON_STRUCTURAL_CANDIDATE_STRING_REQUIRED");
  }
  error(() => Hson.data`<a 1 #${Hson.data`2`}>`, "HSON_STRUCTURAL_SLOT_POSITION_INVALID");
  error(() => Hson.document`<#${value}/>`, "HSON_STRUCTURAL_SLOT_POSITION_INVALID");
});

check("canonical and schema keep their existing boundaries", () => {
  error(() => Hson.canonical`#${Hson.data`1`}`, "HSON_STRUCTURAL_SLOT_MODE_FORBIDDEN");
  assert.throws(() => (Hson.schema as any)`#${Hson.data`1`}`, /substitution-free/);
});

check("whole-document admission catches special-tag violations", () => {
  error(() => Hson.document`<body #${'<script "go()"/>'}/>`, "HSON_STRUCTURAL_CANDIDATE_INVALID");
  const one = Hson.document`"a"`;
  assert.throws(() => Hson.document`<style #${one} #${one}/>`, /composed Hson.document|Document <style>/);
  const inlineScript = Hson.document`"go()"`;
  error(() => Hson.document`<script src="/app.js" #${inlineScript}/>`, "HSON_STRUCTURAL_COMPOSED_INVALID");
  const child = Hson.document`<b/>`;
  error(() => Hson.document`<style #${child}/>`, "HSON_STRUCTURAL_COMPOSED_INVALID");
  assert.equal(Hson.document`<style #${Hson.document``} "body{margin:0}"/>`, Hson.document`<style "body{margin:0}"/>`);
});

check("document QUID claims retain cold duplicate policy", () => {
  const child = Hson.document`<main @000000001/>`;
  const composed = Hson.document`<body @000000001 #${child}/>`;
  assert.match(composed, /body @000000001/);
  assert.match(composed, /main @000000001/);
});

process.stdout.write(`# ${checks} structural interpolation checks passed\n`);

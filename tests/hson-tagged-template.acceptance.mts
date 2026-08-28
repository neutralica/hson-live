// @hson-live-external-test
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";

import { TransformError } from "../src/core/errors.ts";
import { hson } from "../src/hson.ts";
import { HSON } from "../src/hson-authoring.ts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";

let checks = 0;

function check(name: string, body: () => void): void {
  body();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function captureTransformError(body: () => unknown): TransformError {
  let observed: TransformError | undefined;
  assert.throws(body, (cause) => {
    if (!(cause instanceof TransformError)) return false;
    observed = cause;
    return true;
  });
  if (observed === undefined) throw new Error("expected TransformError");
  return observed;
}

function canonicalize(source: string): string {
  return hson.fromHson(source).toHson().serialize();
}

check("ordinary JavaScript delimiters admit identical HSON source", () => {
  assert.equal(canonicalize("37"), "37");
  assert.equal(canonicalize('37'), canonicalize("37"));
  assert.equal(canonicalize(`37`), canonicalize("37"));
});

check("ordinary source admission preserves primitive and structural roots", () => {
  assert.equal(canonicalize("true"), "true");
  assert.equal(canonicalize("false"), "false");
  assert.equal(canonicalize("null"), "null");
  assert.equal(canonicalize('"hello"'), '"hello"');
  assert.equal(canonicalize("<foo/>"), "<foo/>");
});

check("ordinary bare strings and single-quoted values remain invalid HSON source", () => {
  assert.throws(() => canonicalize("hello"), /unexpected bare token/);
  assert.throws(() => canonicalize("'single quotes wrong'"), /use double quotes only/);
});

check("ordinary calls reject strings and primitive values defensively", () => {
  for (const value of ["37", "<foo/>", 37, true, null, {}]) {
    const error = captureTransformError(() => (HSON as any)(value));
    assert.equal(error.operation, "HSON");
    assert.equal(error.code, "HSON_TAGGED_TEMPLATE_REQUIRED");
    assert.equal(error.stage, "template-admission");
  }
});

check("aggregate facade retains subsystem properties without Transform source aliases", () => {
  assert.equal(hson.transform, hsonTransform);
  assert.equal("string" in hson.transform, false);
  assert.equal(typeof hson.liveMap, "object");
  assert.equal(typeof hson.liveTree, "object");
  assert.equal(typeof hson.locus, "object");
});

check("number interpolation matches number source", () => {
  assert.equal(HSON`${37}`, canonicalize("37"));
});

check("negative-zero interpolation preserves its canonical spelling", () => {
  assert.equal(HSON`${-0}`, canonicalize("-0"));
  assert.equal(HSON`${-0}`, "-0");
});

check("non-finite interpolated numbers use authoritative numeric admission", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const error = captureTransformError(() => HSON`${value}`);
    assert.equal(error.code, "HSON_NUMBER_NONFINITE");
  }
});

check("boolean interpolation matches boolean source", () => {
  assert.equal(HSON`${true}`, canonicalize("true"));
  assert.equal(HSON`${false}`, canonicalize("false"));
});

check("null interpolation matches null source", () => {
  assert.equal(HSON`${null}`, canonicalize("null"));
});

check("string interpolation matches double-quoted HSON string source", () => {
  assert.equal(HSON`${"37"}`, canonicalize('"37"'));
  assert.equal(HSON`${"true"}`, canonicalize('"true"'));
  assert.equal(HSON`${"hello"}`, canonicalize('"hello"'));
});

check("empty string interpolation produces an empty HSON string", () => {
  assert.equal(HSON`${""}`, '""');
});

check("string interpolation uses canonical quote, slash, and control escaping", () => {
  const value = 'quote " slash \\ newline\n tab\t';
  assert.equal(HSON`${value}`, JSON.stringify(value));
});

check("string interpolation preserves Unicode and astral characters", () => {
  const value = "café 😀 𝄞";
  assert.equal(HSON`${value}`, JSON.stringify(value));
});

check("dollar-brace and backticks remain ordinary string data", () => {
  const value = "${notSource} `tick`";
  assert.equal(HSON`${value}`, JSON.stringify(value));
});

check("multiple primitive substitutions reconstruct one complete HSON source", () => {
  assert.equal(
    HSON`«${37}, ${"37"}, ${true}, ${false}, ${null}»`,
    canonicalize(`«37,"37",true,false,null»`),
  );
});

check("HSON-looking interpolated strings remain string data", () => {
  const value = `<foo "evil"/>`;
  const brandedFragment = canonicalize(value);
  assert.equal(HSON`${value}`, JSON.stringify(value));
  assert.equal(HSON`${brandedFragment}`, JSON.stringify(value));
  assert.equal(canonicalize(value), `<foo "evil"/>`);
  assert.notEqual(HSON`${value}`, canonicalize(value));
});

check("HSON-looking strings cannot acquire structure inside a tag", () => {
  const value = `<foo "evil"/>`;
  assert.equal(HSON`<main ${value}/>`, `<main "<foo \\"evil\\"/>"/>`);
});

check("ordinary template coercion and tagged interpolation differ deliberately", () => {
  assert.equal(canonicalize(`${"37"}`), canonicalize("37"));
  assert.equal(canonicalize(`${"37"}`), "37");
  assert.equal(HSON`${"37"}`, '"37"');
  assert.notEqual(canonicalize(`${"37"}`), HSON`${"37"}`);
});

check("raw tagged HSON escapes remain parser-owned", () => {
  const source = String.raw`<text "\"\\\/\b\f\n\r\t\u0041"/>`;
  assert.equal(HSON`<text "\"\\\/\b\f\n\r\t\u0041"/>`, canonicalize(source));
});

check("final whole-source parsing rejects an invalid interpolation placement", () => {
  assert.throws(() => HSON`${true}x`, /unexpected|invalid|token/i);
});

check("unsupported substitutions fail with one structured template error", () => {
  const values: readonly unknown[] = [
    undefined,
    1n,
    Symbol("x"),
    {},
    [],
    () => undefined,
    new Date(0),
    { $_tag: "main", $_content: [] },
  ];
  for (const value of values) {
    const error = captureTransformError(() => (HSON as any)`<main ${value}/>`);
    assert.equal(error.operation, "HSON");
    assert.equal(error.code, "HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED");
    assert.equal(error.stage, "template-admission");
  }
});

check("unsupported objects are not stringified", () => {
  let stringified = false;
  const hostile = { toString(): string { stringified = true; return "<foo/>"; } };
  captureTransformError(() => (HSON as any)`${hostile}`);
  assert.equal(stringified, false);
});

check("empty tagged source retains the ordinary parser diagnostic", () => {
  const ordinary = captureTransformError(() => canonicalize(""));
  const tagged = captureTransformError(() => HSON``);
  assert.equal(tagged.code, ordinary.code);
  assert.equal(tagged.stage, ordinary.stage);
  assert.deepEqual(tagged.source, ordinary.source);
});

check("multiline source canonicalizes after complete reconstruction", () => {
  assert.equal(HSON`
    <main
      <h1 ${"Hello"}/>
    />
  `, `<main
  <h1 "Hello"/>
/>`);
});

process.stdout.write(`# ${checks} tagged-template checks passed\n`);
emit_hson_live_test_completion("transform.hson-tagged-template", checks, checks, 0);

// @hson-live-external-test
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";

import { TransformError } from "../src/core/errors.ts";
import { hson } from "../src/hson.ts";
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

check("ordinary JavaScript delimiters admit identical HSON source", () => {
  assert.equal(hson("37"), "37");
  assert.equal(hson('37'), hson("37"));
  assert.equal(hson(`37`), hson("37"));
});

check("ordinary source admission preserves primitive and structural roots", () => {
  assert.equal(hson("true"), "true");
  assert.equal(hson("false"), "false");
  assert.equal(hson("null"), "null");
  assert.equal(hson('"hello"'), '"hello"');
  assert.equal(hson("<foo/>"), "<foo/>");
});

check("ordinary bare strings and single-quoted values remain invalid HSON source", () => {
  assert.throws(() => hson("hello"), /unexpected bare token/);
  assert.throws(() => hson("'single quotes wrong'"), /use double quotes only/);
});

check("ordinary callable admission rejects direct primitive values", () => {
  for (const value of [37, true, null, {}]) {
    const error = captureTransformError(() => (hson as any)(value));
    assert.equal(error.operation, "hson");
    assert.equal(error.code, "HSON_SOURCE_TYPE_REQUIRED");
    assert.equal(error.stage, "source-admission");
  }
});

check("callable facade retains transform identity and subsystem properties", () => {
  assert.equal(hson.transform, hsonTransform);
  assert.equal(hson.transform.string, hson);
  assert.equal(hsonTransform.string, hson);
  assert.equal(typeof hson.liveMap, "object");
  assert.equal(typeof hson.liveTree, "object");
  assert.equal(typeof hson.locus, "object");
});

check("number interpolation matches number source", () => {
  assert.equal(hson`${37}`, hson("37"));
});

check("negative-zero interpolation preserves its canonical spelling", () => {
  assert.equal(hson`${-0}`, hson("-0"));
  assert.equal(hson`${-0}`, "-0");
});

check("non-finite interpolated numbers use authoritative numeric admission", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const error = captureTransformError(() => hson`${value}`);
    assert.equal(error.code, "HSON_NUMBER_NONFINITE");
  }
});

check("boolean interpolation matches boolean source", () => {
  assert.equal(hson`${true}`, hson("true"));
  assert.equal(hson`${false}`, hson("false"));
});

check("null interpolation matches null source", () => {
  assert.equal(hson`${null}`, hson("null"));
});

check("string interpolation matches double-quoted HSON string source", () => {
  assert.equal(hson`${"37"}`, hson('"37"'));
  assert.equal(hson`${"true"}`, hson('"true"'));
  assert.equal(hson`${"hello"}`, hson('"hello"'));
});

check("empty string interpolation produces an empty HSON string", () => {
  assert.equal(hson`${""}`, '""');
});

check("string interpolation uses canonical quote, slash, and control escaping", () => {
  const value = 'quote " slash \\ newline\n tab\t';
  assert.equal(hson`${value}`, JSON.stringify(value));
});

check("string interpolation preserves Unicode and astral characters", () => {
  const value = "café 😀 𝄞";
  assert.equal(hson`${value}`, JSON.stringify(value));
});

check("dollar-brace and backticks remain ordinary string data", () => {
  const value = "${notSource} `tick`";
  assert.equal(hson`${value}`, JSON.stringify(value));
});

check("multiple primitive substitutions reconstruct one complete HSON source", () => {
  assert.equal(
    hson`«${37}, ${"37"}, ${true}, ${false}, ${null}»`,
    hson(`«37,"37",true,false,null»`),
  );
});

check("HSON-looking interpolated strings remain string data", () => {
  const value = `<foo "evil"/>`;
  const brandedFragment = hson(value);
  assert.equal(hson`${value}`, JSON.stringify(value));
  assert.equal(hson`${brandedFragment}`, JSON.stringify(value));
  assert.equal(hson(value), `<foo "evil"/>`);
  assert.notEqual(hson`${value}`, hson(value));
});

check("HSON-looking strings cannot acquire structure inside a tag", () => {
  const value = `<foo "evil"/>`;
  assert.equal(hson`<main ${value}/>`, `<main "<foo \\"evil\\"/>"/>`);
});

check("ordinary template coercion and tagged interpolation differ deliberately", () => {
  assert.equal(hson(`${"37"}`), hson("37"));
  assert.equal(hson(`${"37"}`), "37");
  assert.equal(hson`${"37"}`, '"37"');
  assert.notEqual(hson(`${"37"}`), hson`${"37"}`);
});

check("raw tagged HSON escapes remain parser-owned", () => {
  const source = String.raw`<text "\"\\\/\b\f\n\r\t\u0041"/>`;
  assert.equal(hson`<text "\"\\\/\b\f\n\r\t\u0041"/>`, hson(source));
});

check("final whole-source parsing rejects an invalid interpolation placement", () => {
  assert.throws(() => hson`${true}x`, /unexpected|invalid|token/i);
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
    const error = captureTransformError(() => (hson as any)`<main ${value}/>`);
    assert.equal(error.operation, "hson");
    assert.equal(error.code, "HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED");
    assert.equal(error.stage, "template-admission");
  }
});

check("unsupported objects are not stringified", () => {
  let stringified = false;
  const hostile = { toString(): string { stringified = true; return "<foo/>"; } };
  captureTransformError(() => (hson as any)`${hostile}`);
  assert.equal(stringified, false);
});

check("empty tagged source retains the ordinary parser diagnostic", () => {
  const ordinary = captureTransformError(() => hson(""));
  const tagged = captureTransformError(() => hson``);
  assert.equal(tagged.code, ordinary.code);
  assert.equal(tagged.stage, ordinary.stage);
  assert.deepEqual(tagged.source, ordinary.source);
});

check("multiline source canonicalizes after complete reconstruction", () => {
  assert.equal(hson`
    <main
      <h1 ${"Hello"}/>
    />
  `, `<main
  <h1 "Hello"/>
/>`);
});

process.stdout.write(`# ${checks} tagged-template checks passed\n`);
emit_hson_live_test_completion("transform.hson-tagged-template", checks, checks, 0);

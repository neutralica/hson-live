// @hson-live-external-test
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";

import { TransformError } from "../src/core/errors.ts";
import { hson, hsonString } from "../src/hson.ts";
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

check("ordinary and tagged minimal HSON produce the same branded primitive", () => {
  const ordinary = hsonString("<main/>");
  const tagged = hsonString`<main/>`;
  assert.equal(tagged, ordinary);
  assert.equal(typeof tagged, "string");
});

check("Transform facades preserve exact function identity", () => {
  assert.equal(hson.transform.string, hsonString);
  assert.equal(hsonTransform.string, hsonString);
});

check("multiline nested templates use ordinary readable serialization", () => {
  const tagged = hsonString`
    <main
      <h1 "Hello"/>
    />
  `;
  assert.equal(tagged, `<main\n  <h1 "Hello"/>\n/>`);
});

check("double-quoted HSON escapes reach the parser in raw form", () => {
  const source = String.raw`<text "\"\\\/\b\f\n\r\t\u0041"/>`;
  const tagged = hsonString`<text "\"\\\/\b\f\n\r\t\u0041"/>`;
  assert.equal(tagged, hsonString(source));
});

check("single-quoted HSON name escapes reach the parser in raw form", () => {
  const source = String.raw`<'don\'t\\path\b\f\n\r\t\u0020name' 1>`;
  const tagged = hsonString`<'don\'t\\path\b\f\n\r\t\u0020name' 1>`;
  assert.equal(tagged, hsonString(source));
});

check("Unicode HSON escapes remain HSON-owned", () => {
  assert.equal(hsonString`<'tick\u0060name' 1>`, "<'tick`name' 1>");
  assert.equal(hsonString`<text "\u0024{value}"/>`, `<text "${"$"}{value}"/>`);
});

check("comments disappear through the ordinary canonical serializer", () => {
  const tagged = hsonString`<a// member comment
    1 b// another comment
    2>`;
  assert.equal(tagged, `<\n  a 1\n  b 2\n>`);
});

check("tagged templates retain default QUID behavior", () => {
  assert.equal(
    hsonString`<panel class="x" @4k7m2v9d1r6x8qwc hidden "Content"/>`,
    `<panel @4k7m2v9d1r6x8qwc class="x" hidden "Content"/>`,
  );
});

check("one substitution rejects before HSON parsing with structured admission identity", () => {
  const value = "not parsed";
  const error = captureTransformError(() => hsonString`<main ${value}/>`);
  assert.equal(error.operation, "hsonString");
  assert.equal(error.code, "HSON_TEMPLATE_SUBSTITUTION_UNSUPPORTED");
  assert.equal(error.stage, "template-admission");
  assert.equal(error.source, undefined);
  assert.match(error.message, /received 1/);
});

check("multiple substitutions report the exact count", () => {
  const error = captureTransformError(() => hsonString`<main ${1} ${2} ${3}/>`);
  assert.equal(error.code, "HSON_TEMPLATE_SUBSTITUTION_UNSUPPORTED");
  assert.match(error.message, /received 3/);
});

check("representative substitution values are never admitted or stringified", () => {
  let stringified = false;
  const hostile = { toString(): string { stringified = true; throw new Error("inspected"); } };
  const values: readonly unknown[] = [
    undefined,
    null,
    "text",
    hsonString("<main/>"),
    { $_tag: "main", $_content: [] },
    hostile,
  ];
  for (const value of values) {
    const error = captureTransformError(() => hsonString`<main ${value}/>`);
    assert.equal(error.code, "HSON_TEMPLATE_SUBSTITUTION_UNSUPPORTED");
  }
  assert.equal(stringified, false);
});

check("host expressions run before the tag rejects their substitutions", () => {
  let evaluated = false;
  captureTransformError(() => hsonString`<main ${(() => { evaluated = true; return 1; })()}/>`);
  assert.equal(evaluated, true);
});

check("empty tagged source retains the ordinary empty-source diagnostic", () => {
  const ordinary = captureTransformError(() => hsonString(""));
  const tagged = captureTransformError(() => hsonString``);
  assert.equal(tagged.code, "HSON_SOURCE_EMPTY");
  assert.equal(tagged.operation, ordinary.operation);
  assert.equal(tagged.stage, ordinary.stage);
  assert.deepEqual(tagged.source, ordinary.source);
});

check("malformed tagged HSON retains parser diagnostics and related evidence", () => {
  const malformedOrdinary = captureTransformError(() => hsonString(`"unterminated`));
  const malformedTagged = captureTransformError(() => hsonString`"unterminated`);
  assert.equal(malformedTagged.code, malformedOrdinary.code);
  assert.equal(malformedTagged.stage, malformedOrdinary.stage);
  assert.deepEqual(malformedTagged.source, malformedOrdinary.source);

  const duplicateOrdinary = captureTransformError(() => hsonString(`<a 1 a 2>`));
  const duplicateTagged = captureTransformError(() => hsonString`<a 1 a 2>`);
  assert.equal(duplicateTagged.code, duplicateOrdinary.code);
  assert.deepEqual(duplicateTagged.source, duplicateOrdinary.source);
  assert.deepEqual(duplicateTagged.related, duplicateOrdinary.related);
});

check("escaped host backticks are not repaired into HSON escapes", () => {
  const error = captureTransformError(() => hsonString`<'tick\`name' 1>`);
  assert.equal(error.code, "invalid-name-escape");
  assert.equal(error.stage, "tokenization");
  assert.equal(hsonString`<'tick\u0060name' 1>`, "<'tick`name' 1>");
});

check("runtime raw template line terminators normalize physical CRLF to LF", () => {
  const evaluate = Function("tag", "return tag`line one\r\nline two`;") as (
    tag: (source: TemplateStringsArray) => string,
  ) => string;
  const raw = evaluate((source) => source.raw[0]);
  assert.equal(raw, "line one\nline two");
});

process.stdout.write(`# ${checks} tagged-template checks passed\n`);
emit_hson_live_test_completion("transform.hson-tagged-template", checks, checks, 0);

// @hson-live-external-test
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

import { TransformError } from "../src/core/errors.ts";
import { hson } from "../src/hson.ts";
import { Hson } from "../src/hson-authoring.ts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { parse_authored_event } from "../src/internal/authored-events.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-tagged-template",
  title: "Hson tagged-template admission",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "admission", "tagged-template", "public-api", "diagnostics", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.hson-tagged-template");
let checks = 0;

function check(name: string, body: () => void): void {

  testEvents.case_begin(name, name);
  try {
    body();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
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

function tag_unknown(value: unknown): unknown {
  const strings = ((parts: TemplateStringsArray, _value: number) => parts)`<main ${0}/>`;
  return Reflect.apply(Hson.canonical, Hson, [strings, value]);
}

check("ordinary JavaScript delimiters admit identical Hson source", () => {
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

check("ordinary bare strings and single-quoted values remain invalid Hson source", () => {
  assert.throws(() => canonicalize("hello"), /unexpected bare token/);
  assert.throws(() => canonicalize("'single quotes wrong'"), /use double quotes only/);
});

check("Hson is a noncallable namespace", () => {
  assert.equal(typeof Hson, "object");
  for (const value of ["37", "<foo/>", 37, true, null, {}]) {
    assert.throws(() => Reflect.apply(Hson as unknown as Function, undefined, [value]), TypeError);
  }
});

check("aggregate facade retains subsystem properties without Transform source aliases", () => {
  assert.equal(hson.transform, hsonTransform);
  assert.equal("string" in hson.transform, false);
  assert.equal(typeof hson.liveMap, "object");
  assert.equal(typeof hson.liveTree, "object");
  assert.equal(typeof hson.liveMap.locus, "object");
});

check("number interpolation matches number source", () => {
  assert.equal(Hson.canonical`${37}`, canonicalize("37"));
});

check("negative-zero interpolation preserves its canonical spelling", () => {
  assert.equal(Hson.canonical`${-0}`, canonicalize("-0"));
  assert.equal(Hson.canonical`${-0}`, "-0");
});

check("non-finite interpolated numbers use authoritative numeric admission", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const error = captureTransformError(() => Hson.canonical`${value}`);
    assert.equal(error.code, "HSON_NUMBER_NONFINITE");
  }
});

check("boolean interpolation matches boolean source", () => {
  assert.equal(Hson.canonical`${true}`, canonicalize("true"));
  assert.equal(Hson.canonical`${false}`, canonicalize("false"));
});

check("null interpolation matches null source", () => {
  assert.equal(Hson.canonical`${null}`, canonicalize("null"));
});

check("unquoted strings are independently parsed Hson source", () => {
  assert.equal(Hson.canonical`${"37"}`, canonicalize("37"));
  assert.equal(Hson.canonical`${"true"}`, canonicalize("true"));
  assert.equal(Hson.canonical`${'"hello"'}`, canonicalize('"hello"'));
  assert.throws(() => Hson.canonical`${"hello"}`, /valid Hson source/);
});

check("empty source rejects while quoted empty content constructs a STR", () => {
  assert.throws(() => Hson.canonical`${""}`, /valid Hson source/);
  assert.equal(Hson.canonical`"${""}"`, '""');
});

check("string interpolation uses canonical quote, slash, and control escaping", () => {
  const value = 'quote " slash \\ newline\n tab\t';
  assert.equal(hsonTransform.fromHson(Hson.canonical`"${value}"`).toHson().noBreak().serialize(), JSON.stringify(value));
});

check("string interpolation preserves Unicode and astral characters", () => {
  const value = "café 😀 𝄞";
  assert.equal(Hson.canonical`"${value}"`, JSON.stringify(value));
});

check("dollar-brace and backticks remain ordinary string data", () => {
  const value = "${notSource} `tick`";
  assert.equal(Hson.canonical`"${value}"`, JSON.stringify(value));
});

check("multiple primitive substitutions remain separate semantic values", () => {
  assert.equal(
    Hson.canonical`«${37}, "${"37"}", ${true}, ${false}, ${null}»`,
    canonicalize(`«37,"37",true,false,null»`),
  );
});

check("Hson-looking strings parse structurally regardless of static branding", () => {
  const value = `<foo "evil"/>`;
  const brandedSource = Hson.canonical`<foo "evil"/>`;
  assert.equal(Hson.canonical`${value}`, canonicalize(value));
  assert.equal(Hson.canonical`${brandedSource}`, canonicalize(value));
  assert.equal(Hson.canonical`"${value}"`, JSON.stringify(value));
});

check("unquoted structural source inserts an element child", () => {
  const value = `<foo "evil"/>`;
  assert.equal(Hson.canonical`<main ${value}/>`, canonicalize(`<main <foo "evil"/>/>`));
});

check("explicit JavaScript source construction admits one complete candidate", () => {
  const source = `${1}e${2}`;
  assert.equal(Hson.canonical`${source}`, "100");
  assert.throws(() => Hson.canonical`${1}e${2}`);
});

check("raw tagged Hson escapes remain parser-owned", () => {
  const source = String.raw`<text "\"\\\/\b\f\n\r\t\u0041"/>`;
  assert.equal(Hson.canonical`<text "\"\\\/\b\f\n\r\t\u0041"/>`, canonicalize(source));
});

const frozenTemplate = (cooked: unknown[], raw: unknown[]) =>
  Object.freeze(Object.assign(cooked, { raw: Object.freeze(raw) }));
const templateError = { code: "HSON_TAGGED_TEMPLATE_REQUIRED", stage: "template-admission" };

check("all authoring tags require frozen arrays with own string segments at every index", () => {
  const source = "<hson:event on:click local:GO <> >";
  const inherited = () => Object.setPrototypeOf(Array(1), [source]);
  const accessor = () => Object.defineProperty(Array(1), 0, { get() { assert.fail("read segment getter"); } });
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  for (const [label, template] of [
    ["missing cooked", frozenTemplate(Array(1), [source])],
    ["missing raw", frozenTemplate([source], Array(1))],
    ["missing both", frozenTemplate(Array(1), Array(1))],
    ["inherited cooked", frozenTemplate(inherited(), [source])],
    ["inherited raw", frozenTemplate([source], inherited())],
    ["non-string cooked", frozenTemplate([42], [source])],
    ["non-string raw", frozenTemplate([source], [null])],
    ["short raw", frozenTemplate([source], [])],
    ["long raw", frozenTemplate([source], [source, ""])],
    ["unfrozen cooked", Object.assign([source], { raw: Object.freeze([source]) })],
    ["unfrozen raw", Object.freeze(Object.assign([source], { raw: [source] }))],
    ["cooked getter", frozenTemplate(accessor(), [source])],
    ["raw getter", frozenTemplate([source], accessor())],
    ["revoked array", revoked.proxy],
  ] as const) {
    for (const tag of [Hson.event, Hson.canonical, Hson.data, Hson.document, Hson.schema]) {
      assert.throws(() => Reflect.apply(tag, Hson, [template]), templateError, label);
    }
  }
});

check("template admission ignores caller-supplied array methods", () => {
  const source = "<hson:event on:click local:GO <> >";
  for (const every of [null, () => assert.fail("called shadowed every"), () => true]) {
    const override = (segments: unknown[]) => Object.assign(segments, { every });
    const complete = frozenTemplate(override([source]), override([source]));
    assert.equal(Reflect.apply(Hson.event, Hson, [complete]), source);
    for (const template of [
      frozenTemplate(override([false]), [source]),
      frozenTemplate([source], override(Array(1))),
    ]) assert.throws(() => Reflect.apply(Hson.event, Hson, [template]), templateError);
  }
});

check("interpolated templates require complete segments on both sides of each substitution", () => {
  const capture = (parts: TemplateStringsArray, ..._slots: unknown[]) => parts;
  const genuine = capture`"${"x"}"`;
  const missingTail = () => Object.assign(Array(2), { 0: '"' });
  for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
    assert.equal(Reflect.apply(tag, Hson, [genuine, "x"]), '"x"');
    for (const args of [
      [genuine], [genuine, "x", "y"],
      [frozenTemplate(missingTail(), ['"', '"']), "x"],
      [frozenTemplate(['"', '"'], missingTail()), "x"],
    ]) assert.throws(() => Reflect.apply(tag, Hson, args), templateError);
  }
  for (const tag of [Hson.event, Hson.schema]) {
    assert.throws(() => Reflect.apply(tag, Hson, [genuine, "x"]), templateError);
  }
});

check("Event templates use JavaScript's normalized raw source and reject undefined cooked escapes", () => {
  const event = "<hson:event on:click local:GO <> >";
  const source = "// \\u0041\r\n" + event;
  assert.equal(runInNewContext("tag`" + source + "`", { tag: Hson.event }), "// \\u0041\n" + event);
  assert.throws(() => Hson.event`// \xZZ
<hson:event on:click local:GO <> >`, templateError);
});

check("Hson.event returns primitive authored source and preserves comments and raw escapes", () => {
  const source = Hson.event`// Event example
<hson:event on:click local:RUN once title:str="C:\\new\u0020file" // inline comment
  settings:data={<ready true>} <> >`;
  assert.equal(typeof source, "string");
  assert.equal(source, String.raw`// Event example
<hson:event on:click local:RUN once title:str="C:\\new\u0020file" // inline comment
  settings:data={<ready true>} <> >`);
  assert.deepEqual(parse_authored_event(source).args[0]?.operand, { kind: "literal", value: "C:\\new file" });
});

check("Hson.event admits native lookups, FormData operations and unresolved Part references", () => {
  const input = Hson.event`<hson:event on:input host:SAVE checked:data=^{input.target.checked}
  row:data=^{row} title:str=%{title} <> >`;
  assert.deepEqual(parse_authored_event(input).args.map(argument => argument.operand.kind), ["native", "reference", "reference"]);
  const form = Hson.event`<hson:event on:formdata local:SAVE email:str=^{formdata:get("email")}
  tags:arr=^{formdata:getAll("tag")} upload:bool=^{formdata:has("upload")} <> >`;
  assert.deepEqual(parse_authored_event(form).args.map(({ operand }) => operand.kind === "native" && operand.lookup), [
    ["formdata", "formData", "get", "email", "entry-or-null"],
    ["formdata", "formData", "getAll", "tag", "entries"],
    ["formdata", "formData", "has", "upload", "boolean"],
  ]);
});

check("Hson.event rejects incorrect roots and preserves the Event parser's body diagnostics", () => {
  assert.throws(() => Hson.event`<person/>`, { operation: "HsonDeclarative", code: "HSON_DECLARATIVE_ROOT_REQUIRED" });
  assert.throws(() => Hson.event`<hson:schema>`, { operation: "HsonDeclarative", code: "HSON_DECLARATIVE_DOMAIN_MISMATCH" });
  assert.throws(() => Hson.event`<hson:query>`, { operation: "HsonDeclarative", code: "HSON_DECLARATIVE_DOMAIN_UNSUPPORTED" });
  for (const [run, message] of [
    [() => Hson.event`<hson:event on:click <> >`, /requires one of/],
    [() => Hson.event`<hson:event local:RUN <> >`, /requires one of/],
    [() => Hson.event`<hson:event on:click on:input local:RUN <> >`, /exactly one on: selector/],
    [() => Hson.event`<hson:event on:click local:RUN host:RUN <> >`, /exactly one host: or local:/],
    [() => Hson.event`<hson:event on:unknown local:RUN <> >`, /Unsupported Event selector/],
    [() => Hson.event`<hson:event on:click local: <> >`, /Expected an action name/],
    [() => Hson.event`<hson:event on:click local:RUN once once <> >`, /Duplicate authored event header/],
    [() => Hson.event`<hson:event on:click local:RUN document window <> >`, /mutually exclusive/],
    [() => Hson.event`<hson:event on:click local:RUN>`, /requires an outcome object/],
    [() => Hson.event`<hson:event on:click local:RUN <ok true> >`, /Nonempty authored event outcomes/],
    [() => Hson.event`<hson:event on:click local:RUN <> > <hson:event on:click local:RUN <> >`, /exactly one authored event declaration/],
    [() => Hson.event`<hson:event on:click local:RUN title:doc="bad" <> >`, /Invalid Event argument/],
    [() => Hson.event`<hson:event on:click local:RUN x:str="a" x:num="1" <> >`, /Duplicate Event argument/],
    [() => Hson.event`<hson:event on:click local:RUN items:arr={true} <> >`, /Expected an? arr value/],
    [() => Hson.event`<hson:event on:input local:RUN value:data=^{input.target.unknown} <> >`, /Unsupported input Event lookup/],
    [() => Hson.event`<hson:event on:formdata local:RUN value:str=^{formdata:has("x")} <> >`, /whole :bool or :data/],
  ] as const) {
    const error = captureTransformError(run);
    assert.match(error.message, message);
    assert.match(error.code, /^HSON_EVENT_/);
  }
});

check("Hson.event rejects template slots and invalid direct calls", () => {
  const raw = (strings: TemplateStringsArray, ..._values: unknown[]) => strings;
  const valid = raw`<hson:event on:click local:RUN <> >`;
  const withSlot = raw`<hson:event on:click local:RUN title:str="${"example"}" <> >`;
  for (const args of [[], [valid.raw[0]], [[valid.raw[0]]], [withSlot], [withSlot, "example"], [valid, undefined]]) {
    assert.throws(() => Reflect.apply(Hson.event, Hson, args), { code: "HSON_TAGGED_TEMPLATE_REQUIRED" });
  }
});

check("adjacent invalid trivia retains the Event scanner's code and source position", () => {
  const prefix = "// 😀\r\n  <hson:event";
  for (const [suffix, code] of [["/*", "HSON_BLOCK_COMMENT_UNSUPPORTED"], ["\u00a0", "HSON_UNSUPPORTED_WHITESPACE"]]) {
    const source = prefix + suffix;
    const tagged = captureTransformError(() => Reflect.apply(Hson.event, Hson, [frozenTemplate([source], [source])]));
    const scanned = captureTransformError(() => parse_authored_event(source));
    assert.equal(tagged.code, code);
    assert.equal(tagged.code, scanned.code);
    assert.deepEqual(tagged.source, scanned.source);
    assert.deepEqual(tagged.source, { index: prefix.length, line: 2, column: 14 });
  }
});

check("Hson.event preserves CRLF in raw segments and reports original UTF-16 positions", () => {
  const source = '// 😀 leading comment\r\n  <hson:event on:click local:RUN\r\n\tvalue:num="1"\r\n  <> >';
  const rawTemplate = (text: string): TemplateStringsArray => Object.freeze(Object.assign([text], { raw: Object.freeze([text]) }));
  assert.equal(Hson.event(rawTemplate(source)), source);
  const invalid = source.replace('"1"', '"Q"');
  const error = captureTransformError(() => Hson.event(rawTemplate(invalid)));
  const ordinaryError = captureTransformError(() => parse_authored_event(invalid));
  assert.equal(error.code, ordinaryError.code);
  assert.deepEqual(error.source, ordinaryError.source);
  assert.deepEqual(error.source, { index: invalid.indexOf('"Q"'), line: 3, column: 12 });
});

check("declaration recognition leaves existing Data and Document authoring behavior intact", () => {
  assert.equal(Hson.data`<person "Ada">`, Hson.data.from({ person: "Ada" }).toHson());
  assert.equal(Hson.document`<person app:label="Ada"/>`, '<person app:label="Ada"/>');
  assert.throws(() => Hson.document`<hson:event/>`, { code: "HSON_EVENT_DECLARATION_INVALID" });
});

check("final whole-source parsing rejects an invalid interpolation placement", () => {
  assert.throws(() => Hson.canonical`${true}x`, /unexpected|invalid|token/i);
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
    const error = captureTransformError(() => tag_unknown(value));
    assert.equal(error.operation, "Hson");
    assert.equal(error.code, "HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED");
    assert.equal(error.stage, "template-admission");
  }
});

check("unsupported objects are not stringified", () => {
  let stringified = false;
  const hostile = { toString(): string { stringified = true; return "<foo/>"; } };
  const strings = ((parts: TemplateStringsArray, _value: number) => parts)`${0}`;
  captureTransformError(() => Reflect.apply(Hson.canonical, Hson, [strings, hostile]));
  assert.equal(stringified, false);
});

check("empty tagged source retains the ordinary parser diagnostic", () => {
  const ordinary = captureTransformError(() => canonicalize(""));
  const tagged = captureTransformError(() => Hson.canonical``);
  assert.equal(tagged.code, ordinary.code);
  assert.equal(tagged.stage, ordinary.stage);
  assert.deepEqual(tagged.source, ordinary.source);
});

check("multiline source canonicalizes after semantic slot insertion", () => {
  assert.equal(Hson.canonical`
    <main
      <h1 "${"Hello"}"/>
    />
  `, `<main
  <h1 "Hello"/>
/>`);
});

process.stdout.write(`# ${checks} tagged-template checks passed\n`);
testEvents.terminal("pass");

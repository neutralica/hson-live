// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, type HsonCanonical, type HsonData, type HsonDocument } from "../src/hson-authoring.ts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { tokenize_hson } from "../src/api/transform/parsers/tokenize-hson.ts";
import { TransformError } from "../src/core/errors.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-interpolation-boundaries",
  title: "Shared interpolation semantics and semantic boundaries",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "interpolation", "semantic-boundaries", "root-closure"]),
});

const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : "Failed check");
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

function rejects(run: () => unknown, code?: string): void {
  assert.throws(run, error => error instanceof TransformError && (code === undefined || error.code === code));
}

// Correct interpolation and serialization closure are distinct assertions.
// Authored source supplies the expected graph independently of slot insertion.
function closes(actual: string, expectedSource: string): void {
  const graph = hsonTransform.fromHson(actual).toNode();
  assert.equal(canonical_hson_graph_equal(graph, hsonTransform.fromHson(expectedSource).toNode()), true, actual);
  const serialized = hsonTransform.fromHson(actual).toHson().serialize();
  assert.equal(serialized, actual);
  assert.equal(canonical_hson_graph_equal(graph, hsonTransform.fromHson(serialized).toNode()), true);
}

check("semantic boundaries prevent numeric token synthesis, rather than banning adjacency", () => {
  // These independent values cannot become 12, 1e2, or 1.2. Generic root
  // grammar rejects multiple VALs; array grammar requires authored commas.
  rejects(() => Hson.canonical`${1}${2}`);
  rejects(() => Hson.canonical`${1}e${2}`);
  rejects(() => Hson.canonical`${1}.${2}`);
  rejects(() => Hson.canonical`«${1}${2}»`);
  closes(Hson.canonical`«${1}, ${2}»`, "«1,2»");
  for (const tag of [Hson.canonical, Hson.data]) {
    rejects(() => tag`1${2}`);
    rejects(() => tag`${1}2`);
    rejects(() => tag`«${1}${2}»`);
    closes(tag`«${1}, ${2}»`, "«1,2»");
  }
});

check("explicit JavaScript construction supplies one independently parsed source", () => {
  const integer = `${1}${2}`;
  const exponent = `${1}e${2}`;
  const decimal = `${1}.${2}`;
  closes(Hson.canonical`${integer}`, "12");
  closes(Hson.canonical`${exponent}`, "100");
  closes(Hson.canonical`${decimal}`, "1.2");
  assert.equal(Hson.canonical`${exponent}`, "100");
});

check("source candidates and typed primitives preserve generic canonical roots", () => {
  for (const source of ['"hello"', "1", "-0", "true", "false", "null", "<x 1>", "«1,2»", "<p/>", '<a/>"middle"<b/>']) {
    closes(Hson.canonical`${source}`, source);
  }
  for (const value of [1, -0, true, false, null]) {
    const spelling = Object.is(value, -0) ? "-0" : String(value);
    const canonical = Hson.canonical`${value}`;
    const data = Hson.data`${value}`;
    closes(canonical, spelling);
    closes(data, spelling);
    const canonicalNode = hsonTransform.fromHson(canonical).toNode();
    const dataNode = hsonTransform.fromHson(data).toNode();
    assert.equal(canonicalNode.$_tag, "_hson_val");
    assert.equal(Object.is(canonicalNode.$_content[0], value), true);
    assert.equal(Object.is(dataNode.$_content[0], value), true);
    assert.equal(canonical_hson_graph_equal(canonicalNode, dataNode), true);
    rejects(() => Hson.document`${value}`, "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID");
  }
});

check("grammar-valid adjacent elements and STRs retain ordered content", () => {
  const a = "<a/>", b = "<b/>", text = '"hello"', many = '<a/>"middle"<b/>';
  for (const tag of [Hson.canonical, Hson.document]) {
    closes(tag`${a}${b}`, "<a/><b/>");
    closes(tag`${text}${text}`, '"hello""hello"');
    closes(tag`${text}${a}${text}`, '"hello"<a/>"hello"');
    closes(tag`<main ${a}${b}/>`, "<main <a/><b/>/>");
    closes(tag`<main ${many}/>`, '<main <a/>"middle"<b/>/>');
  }
});

check("canonical nested roles admit data values and element content independently", () => {
  closes(Hson.canonical`<outer ${'<x "y">'}>`, '<outer <x "y">>');
  closes(Hson.canonical`«${'"hello"'}, ${"<x 1>"}, ${"«2,3»"}»`, '«"hello",<x 1>,«2,3»»');
  closes(Hson.canonical`<outer ${-0}>`, "<outer -0>");
  closes(Hson.canonical`<main ${'"hello"'}${"<p/>"}/>`, '<main "hello"<p/>/>');
  for (const source of ["<p/>", "<a/><b/>", '"a""b"']) {
    rejects(() => Hson.canonical`<outer ${source}>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
    rejects(() => Hson.canonical`«${source}»`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  }
  for (const source of ["<x 1>", "«1»", "1", "true", "null"]) {
    rejects(() => Hson.canonical`<main ${source}/>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  }
  rejects(() => Hson.canonical`<main ${1}/>`, "HSON_INTERPOLATION_CANDIDATE_TYPE_INVALID");
});

check("unquoted invalid source and contextual domains still reject", () => {
  for (const source of ["", "hello", " \t\n", "// no value"]) {
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
      rejects(() => tag`${source}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
    }
  }
  closes(Hson.canonical`${"<p/>"}`, "<p/>");
  closes(Hson.document`${"<p/>"}`, "<p/>");
  rejects(() => Hson.data`${"<p/>"}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  for (const source of ["1", "-0", "true", "false", "null", "<x 1>", "«1»"]) {
    closes(Hson.canonical`${source}`, source);
    closes(Hson.data`${source}`, source);
    rejects(() => Hson.document`${source}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  }
  for (const tag of [Hson.canonical, Hson.data, Hson.document]) closes(tag`${'"hello"'}`, '"hello"');
});

check("whole quoted primitive slots build STRs consistently, including signed zero", () => {
  for (const value of [1, -0, true, false, null, "", "hello", "<p/>"]) {
    const text = Object.is(value, -0) ? "-0" : String(value);
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
      const result = tag`"${value}"`;
      closes(result, JSON.stringify(text));
      const node = hsonTransform.fromHson(result).toNode();
      assert.equal(node.$_tag, "_hson_str");
      assert.deepEqual(node.$_content, [text]);
    }
  }
  for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
    for (const value of [NaN, Infinity, -Infinity]) rejects(() => tag`"${value}"`, "HSON_NUMBER_NONFINITE");
    rejects(() => tag`"page-${1}"`, "HSON_QUOTED_INTERPOLATION_PARTIAL");
    rejects(() => tag`"${1}-page"`, "HSON_QUOTED_INTERPOLATION_PARTIAL");
    rejects(() => tag`"${1}${2}"`, "HSON_QUOTED_INTERPOLATION_PARTIAL");
  }
});

check("quoted strings preserve exact contents and cannot leak structural nodes", () => {
  const strings = ["<p/>", '<script src="/x.js"/>', "", 'quote " slash \\', "line\nnext\r\nlast\r", "café 😀 𝄞", "${literal} `tick`", "<«[]»>"];
  for (const value of strings) {
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
      closes(tag`"${value}"`, JSON.stringify(value));
      assert.deepEqual(hsonTransform.fromHson(tag`"${value}"`).toNode().$_content, [value]);
    }
    closes(Hson.canonical`<main "${value}"/>`, `<main ${JSON.stringify(value)}/>`);
    closes(Hson.document`<p "${value}"/>`, `<p ${JSON.stringify(value)}/>`);
    closes(Hson.data`<x "${value}">`, `<x ${JSON.stringify(value)}>`);
  }
  const main = hsonTransform.fromHson(Hson.canonical`<main "${"<p/>"}"/>`).toNode();
  assert.doesNotMatch(JSON.stringify(main), /"\$_tag":"p"/);
  assert.match(JSON.stringify(main), /"\$_tag":"_hson_str"/);
});

check("runtime brands cannot alter meaning and universal STRs cross families", () => {
  const ordinary: string = "<p/>";
  const canonical: HsonCanonical = Hson.canonical`<p/>`;
  const document: HsonDocument = Hson.document`<p/>`;
  for (const source of [ordinary, canonical, document]) {
    assert.equal(typeof source, "string");
    closes(Hson.canonical`${source}`, "<p/>");
    closes(Hson.canonical`"${source}"`, '"<p/>"');
  }
  const dataString: HsonData = Hson.data`"hello"`;
  const documentString: HsonDocument = Hson.document`"hello"`;
  const canonicalString: HsonCanonical = Hson.canonical`"hello"`;
  const ordinaryString: string = '"hello"';
  for (const source of [dataString, documentString, canonicalString, ordinaryString]) {
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) closes(tag`${source}`, '"hello"');
  }
  assert.equal(Hson.document`${dataString}`, '"hello"');
  assert.equal(Hson.data`${documentString}`, '"hello"');
});

check("undefined omission remains document-only and unquoted", () => {
  closes(Hson.document`<main ${undefined}/>`, "<main/>");
  closes(Hson.document`<main ${undefined}${"<p/>"}/>`, "<main <p/>/>");
  // Even a zero-node candidate remains a boundary, never a lexical deletion.
  rejects(() => Hson.document`<ma${undefined}in/>`, "HSON_INTERPOLATION_POSITION_INVALID");
  rejects(() => Hson.document`<main /${undefined}>`, "HSON_INTERPOLATION_POSITION_INVALID");
  rejects(() => Hson.document`// ${undefined}`, "HSON_INTERPOLATION_POSITION_INVALID");
  rejects(() => Hson.document`${undefined}`, "HSON_DOCUMENT_EMPTY");
  rejects(() => Hson.document`"${undefined}"`, "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED");
  const unquoted = ((parts: TemplateStringsArray, _value: number) => parts)`${0}`;
  const quoted = ((parts: TemplateStringsArray, _value: number) => parts)`"${0}"`;
  for (const tag of [Hson.canonical, Hson.data]) {
    rejects(() => Reflect.apply(tag, undefined, [unquoted, undefined]));
    rejects(() => Reflect.apply(tag, undefined, [quoted, undefined]), "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED");
  }
  assert.throws(() => Reflect.apply(Hson.schema, undefined, [unquoted, "1"]), /substitution-free/);
});

check("unsupported objects never gain node insertion or generic string coercion", () => {
  const unquoted = ((parts: TemplateStringsArray, _value: number) => parts)`${0}`;
  const quoted = ((parts: TemplateStringsArray, _value: number) => parts)`"${0}"`;
  const node = hsonTransform.fromHson("<p/>").toNode();
  let coerced = false;
  const hostile = { toString() { coerced = true; return "<p/>"; } };
  for (const candidate of [{}, [], new String("<p/>"), () => "<p/>", Symbol("p"), 1n, node, [node], hostile]) {
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
      rejects(() => Reflect.apply(tag, undefined, [unquoted, candidate]));
      rejects(() => Reflect.apply(tag, undefined, [quoted, candidate]), "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED");
    }
  }
  assert.equal(coerced, false);
});

check("slots cannot manufacture keywords, names, delimiters, comments, or escapes", () => {
  for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
    rejects(() => tag`tr${'"x"'}ue`);
    rejects(() => tag`<ma${'"x"'}in/>`);
    rejects(() => tag`<${"main"}/>`);
    rejects(() => tag`<'ma${'"x"'}in' 1>`);
    rejects(() => tag`<main cl${'"x"'}ass/>`);
    rejects(() => tag`<main /${'"x"'}>`);
    rejects(() => tag`/${'"x"'}/ comment\n<main/>`);
    rejects(() => tag`// ${'"x"'}`);
    rejects(() => tag`"\u00${"41"}"`);
  }
  // Raw scanner probes keep cooked-JavaScript rejection from masking a lexical
  // escape defect: no literal escape may consume an intervening slot.
  for (const mode of ["canonical", "data", "document"] as const) {
    rejects(() => tokenize_hson('"\\n"', 0, undefined, [{ offset: 2, substitution: 0 }], mode, ["x"]));
    rejects(() => tokenize_hson('"\\u0041"', 0, undefined, [{ offset: 5, substitution: 0 }], mode, ["x"]));
    const acrossNewline = tokenize_hson('// \r\n', 0, undefined, [{ offset: 4, substitution: 0 }], mode, ['\"hello\"']);
    assert.equal(acrossNewline.filter(token => token.kind === "INTERPOLATION_SLOT").length, 1);
  }
});

process.stdout.write(`# ${checks} shared interpolation boundary checks passed\n`);
events.terminal("pass");

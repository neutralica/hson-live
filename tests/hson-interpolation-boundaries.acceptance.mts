// @hson-live-external-test
import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, type HsonCanonical, type HsonData, type HsonAuthored } from "../src/hson-authoring.ts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { tokenize_hson, scan_hson_template_segments } from "../src/api/transform/parsers/tokenize-hson.ts";
import { parse_hson, parse_hson_interpolated_template } from "../src/api/transform/parsers/parse-hson.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode, NodeContent } from "../src/core/types.ts";
import { TransformError } from "../src/core/errors.ts";
import { discover_hson_tagged_templates } from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { interpolation_site, map_interpolation_range } from "../src/internal/trusted-schema-diagnostics/interpolation-source.ts";
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

// The private parser accepts already-admitted slot nodes. Supply them explicitly
// so these assertions inspect insertion/root shaping without any serialization.
function composed_graph(raw: readonly string[], substitutions: readonly string[], values: readonly (readonly HsonNode[])[] = []): HsonNode {
  const { source, slots } = scan_hson_template_segments(raw, substitutions);
  const tokens = tokenize_hson(source, 0, undefined, slots, "canonical", substitutions);
  return parse_hson_interpolated_template(source, "canonical", values, tokens);
}

function expected_node($_tag: string, $_content: NodeContent = []): HsonNode {
  return { $_tag, $_content };
}

function element_candidate(source: string): readonly HsonNode[] {
  const candidate = detach_hson_root_value(parse_hson(source));
  assert.equal(candidate.$_tag, "_hson_elem");
  return candidate.$_content.map(item => { assert.ok(is_Node(item)); return item; });
}

check("quoted nested interpolation graph is correct before serialization", () => {
  assert.deepEqual(composed_graph(['<main "', '"/>'], ["<p/>"]),
    expected_node("_hson_root", [expected_node("_hson_elem", [
      expected_node("main", [expected_node("_hson_elem", [expected_node("_hson_str", ["<p/>"])])]),
    ])]));
});

check("adjacent generic interpolation nodes retain exact order and wrappers before serialization", () => {
  assert.deepEqual(composed_graph(["", "", ""], ["<a/>", "<b/>"], [element_candidate("<a/>"), element_candidate("<b/>")]),
    expected_node("_hson_root", [expected_node("_hson_elem", [expected_node("a"), expected_node("b")])]));
  assert.deepEqual(composed_graph(["", "", "", ""], ['"a"', "<b/>", '"c"'], [
    [detach_hson_root_value(parse_hson('"a"'))], element_candidate("<b/>"), [detach_hson_root_value(parse_hson('"c"'))],
  ]), expected_node("_hson_root", [expected_node("_hson_elem", [
    expected_node("_hson_str", ["a"]), expected_node("b"), expected_node("_hson_str", ["c"]),
  ])]));
});

check("nested object and array candidates preserve one-value cardinality before serialization", () => {
  const object = "<x 1 y 2>";
  const objectGraph = expected_node("_hson_obj", [
    expected_node("x", [expected_node("_hson_obj", [expected_node("_hson_val", [1])])]),
    expected_node("y", [expected_node("_hson_obj", [expected_node("_hson_val", [2])])]),
  ]);
  assert.deepEqual(composed_graph(["<outer ", ">"], [object], [[detach_hson_root_value(parse_hson(object))]]),
    expected_node("_hson_root", [expected_node("_hson_obj", [expected_node("outer", [objectGraph])])]));
  const array = "«1,2»";
  const arrayGraph = expected_node("_hson_arr", [
    { ...expected_node("_hson_ii", [expected_node("_hson_val", [1])]), $_meta: { index: "0" } },
    { ...expected_node("_hson_ii", [expected_node("_hson_val", [2])]), $_meta: { index: "1" } },
  ]);
  assert.deepEqual(composed_graph(["«", "»"], [array], [[detach_hson_root_value(parse_hson(array))]]),
    expected_node("_hson_root", [expected_node("_hson_arr", [
      { ...expected_node("_hson_ii", [arrayGraph]), $_meta: { index: "0" } },
    ])]));
});

check("candidate source cannot borrow neighboring syntax", () => {
  // Concatenating these candidate bytes would form <p/>, but each slot must
  // admit complete source independently even when the outer grammar is valid.
  rejects(() => Hson.canonical`${"<p"}${"/>"}`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
  rejects(() => Hson.canonical`${"<p/>junk"}<b/>`, "HSON_INTERPOLATION_CANDIDATE_INVALID");
});

check("candidate-local line comments cannot swallow following authored structure", () => {
  const candidate = "<a/>// candidate-local comment";
  closes(Hson.canonical`${candidate}<b/>`, "<a/><b/>");
  closes(Hson.document`${candidate}<b/>`, "<a/><b/>");
});

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
    closes(tag`"page-${1}"`, '"page-1"');
    closes(tag`"${1}-page"`, '"1-page"');
    closes(tag`"${1}${2}"`, '"12"');
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
  const document: HsonAuthored = Hson.document`<p/>`;
  for (const source of [ordinary, canonical, document]) {
    assert.equal(typeof source, "string");
    closes(Hson.canonical`${source}`, "<p/>");
    closes(Hson.canonical`"${source}"`, '"<p/>"');
  }
  const dataString: HsonData = Hson.data`"hello"`;
  const documentString: HsonAuthored = Hson.document`"hello"`;
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

check("partial quoted values share scalar spelling across authoring modes", () => {
  for (const value of ["", "null", "true", "NaN", "Infinity", "-0", 0, -0, 1.25, 1e30, true, false, null]) {
    const text = Object.is(value, -0) ? "-0" : String(value);
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
      closes(tag`"pre${value}post"`, JSON.stringify(`pre${text}post`));
      closes(tag`"${value}${""}${value}"`, JSON.stringify(text + text));
    }
    assert.deepEqual(Hson.data.materialize(Hson.data`<label "pre${value}post">`), { label: `pre${text}post` });
    closes(Hson.document`<a href="/slides/${value}" title="Slide ${value} of ${2}"/>`,
      `<a href=${JSON.stringify(`/slides/${text}`)} title=${JSON.stringify(`Slide ${text} of 2`)}/>`);
    closes(Hson.document`<a title="${value}${""}${value}"/>`, `<a title=${JSON.stringify(text + text)}/>`);
  }
  // Data quoted values share scalar substitution, but do not gain attributes.
  rejects(() => Hson.data`<a title="prefix${1}"/>`);
  rejects(() => Hson.data`<a title="prefix${1}">`);
});

check("partial strings escape runtime text exactly and cannot inject attributes or nodes", () => {
  const values = ['" injected="yes', '\\"/><script src="/evil.js"/>', "\n\r\n\r\t\0\b\f\u001f",
    '\\u0022\\n\\', '<«[]»> // @000000001', '${javascript} %{part}', "😀\ud800"];
  for (const value of values) {
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
      closes(tag`"pre${value}post"`, JSON.stringify(`pre${value}post`));
    }
    const actual = Hson.document`<a title="pre${value}post" "pre${value}post"/>`;
    const expected = `<a title=${JSON.stringify(`pre${value}post`)} ${JSON.stringify(`pre${value}post`)}/>`;
    closes(actual, expected);
    const tokens = tokenize_hson(actual);
    const open = tokens.filter(token => token.kind === "OPEN");
    assert.equal(open.length, 1);
    assert.deepEqual(open[0].rawAttrs?.map(attr => attr.name), ["title"]);
  }
  const nested = Hson.document`<b title="n${2}"/>`;
  closes(Hson.document`<p title="pre${nested}post" "pre${nested}post"/>`,
    `<p title=${JSON.stringify(`pre${nested}post`)} ${JSON.stringify(`pre${nested}post`)}/>`);
  assert.equal(Hson.document`<main ${Hson.document`<p "pre${1}post"/>`}/>`, Hson.document`<main <p "pre1post"/>/>`);
});

check("authored escapes and multiline layout remain distinct from runtime text", () => {
  const value = '  lead\r\nnext\n  ';
  for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
    closes(tag`"\u0024{literal} %{part}\n\"\\${value}\u0021"`, JSON.stringify('${literal} %{part}\n"\\' + value + '!'));
    closes(tag`"
      before ${value}
      after
    "`, JSON.stringify(`before ${value}\nafter`));
    closes(tag`"
      ${value}
    "`, JSON.stringify(value));
  }
  closes(Hson.document`<a title="\u0024{literal} %{part}\n\"\\${value}\u0021"/>`,
    `<a title=${JSON.stringify('${literal} %{part}\n"\\' + value + '!')}/>`);
  const raw = ['"\r\n  before ', '\r\n  after\r\n"'];
  const template = scan_hson_template_segments(raw, [value]);
  const tokens = tokenize_hson(template.source, 0, undefined, template.slots, "data", [value]);
  assert.equal(tokens[0].kind, "TEXT");
  if (tokens[0].kind === "TEXT") assert.equal(tokens[0].directValue, `before ${value}\nafter`);
});

check("empty scalar slots retain their position through multiline framing and margins", () => {
  const cases = [
    { raw: ['"', '\n  tail\n"'], values: [""], expected: '\n  tail\n' },
    { raw: ['"\n  head\n  ', '\n    tail\n"'], values: [""], expected: 'head\n\n  tail' },
    { raw: ['"\n  head\n  ', '"'], values: [""], expected: 'head\n' },
    { raw: ['"', '', '\n  tail\n"'], values: ["", ""], expected: '\n  tail\n' },
    { raw: ['"', '\n  ', '\n"'], values: ["", "x"], expected: '\n  x\n' },
    { raw: ['"', ' \t\n', '\n \t', '"'], values: ["", "", ""], expected: ' \t\n\n \t' },
    { raw: ['"\n  ', '\n    ', '\n"'], values: ["", ""], expected: '\n  ' },
    { raw: ['"\n', '\n"'], values: [""], expected: '' },
    { raw: ['"\n  head\n', '  "'], values: [""], expected: '  head\n  ' },
    { raw: ['"', '\n  ', '\n"'], values: ["\0", ""], expected: '\0\n  \n' },
  ];
  const decoded = (source: string): unknown => hsonTransform.fromHson(source).toNode().$_content[0];
  for (const eol of ["\n", "\r\n"]) for (const { raw, values, expected } of cases) {
    const literals = raw.map(text => text.replaceAll("\n", eol));
    const template: TemplateStringsArray = Object.freeze(Object.assign([...literals], { raw: Object.freeze(literals) }));
    for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
      assert.equal(decoded(Reflect.apply(tag, undefined, [template, ...values])), expected);
      // Empty boundaries have the same layout significance as nonempty text,
      // without introducing that text into the decoded value.
      const reference = Reflect.apply(tag, undefined, [template, ...values.map(value => value === "" ? "§" : value)]);
      assert.equal(String(decoded(reference)).replaceAll("§", ""), expected);
    }
  }
  assert.equal(Hson.data.materialize(Hson.data`"${""}
  tail
"`), '\n  tail\n');
});

check("invalid partial candidates reject without coercion at the original slot offset", () => {
  let coerced = false;
  const hostile = { toString() { coerced = true; return "unsafe"; } };
  const templates = [((parts: TemplateStringsArray, _value: number) => parts)`"pre${0}post"`,
    ((parts: TemplateStringsArray, _value: number) => parts)`<p title="pre${0}post"/>`];
  for (const tag of [Hson.canonical, Hson.data, Hson.document]) {
    for (const value of [undefined, {}, [], hostile, new String("x"), Symbol(), 1n, () => "x", NaN, Infinity, -Infinity]) {
      const code = typeof value === "number" ? "HSON_NUMBER_NONFINITE" : "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED";
      for (const template of templates.slice(0, tag === Hson.data ? 1 : 2)) {
        assert.throws(() => Reflect.apply(tag, undefined, [template, value]), error =>
          error instanceof TransformError && error.code === code && error.source?.index === template.raw[0].length);
      }
    }
  }
  assert.equal(coerced, false);
  const template = scan_hson_template_segments(['\r\n<p title="\\u0041prefix', 'suffix"/>'], [undefined]);
  assert.throws(() => tokenize_hson(template.source, 0, undefined, template.slots, "document", [undefined]), error =>
    error instanceof TransformError && error.code === "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED"
      && error.source?.index === template.slots[0].offset && error.source.line === 2);
  for (const raw of [['"prefix\\', 'n"'], ['<p title="prefix\\u00', '41"/>']]) {
    const template = scan_hson_template_segments(raw, ["x"]);
    rejects(() => tokenize_hson(template.source, 0, undefined, template.slots, "document", ["x"]), "HSON_INTERPOLATION_POSITION_INVALID");
  }
});

check("scanner evidence retains raw literal offsets and host CRLF correspondence", () => {
  const host = 'import { Hson } from "hson-live/hson";\r\nHson.document`\r\n<a title="\\u0041${value}suffix"/>`;';
  const found = discover_hson_tagged_templates("/workspace/source.ts", host).interpolated[0];
  assert.ok(found);
  const site = interpolation_site(found, "file:///workspace/source.ts");
  const template = scan_hson_template_segments(site.literals.map(literal => literal.raw), ["\"\n\\"]);
  const attributes: { range: { start: number; end: number }; text: string | undefined }[] = [];
  tokenize_hson(template.source, 0, {
    recordToken() {},
    recordAttribute(attr, ranges) { assert.ok(ranges.value); attributes.push({ range: ranges.value, text: attr.value?.text }); },
  }, template.slots, "document", ['"\n\\']);
  assert.equal(attributes[0].text, 'A"\n\\suffix');
  const range = attributes[0].range;
  assert.equal(template.source.slice(range.start, range.end), '"\\u0041suffix"');
  const offset = site.literals[0].raw.length;
  const segments = [
    { kind: "literal", index: 0, start: 0, end: offset },
    { kind: "literal", index: 1, start: offset, end: template.source.length },
  ] satisfies Parameters<typeof map_interpolation_range>[1];
  const prefix = map_interpolation_range(site, segments, { precision: "exact", start: range.start + 1, end: offset });
  assert.equal(prefix.kind, "literal-exact");
  assert.equal(host.slice(prefix.range.start, prefix.range.end), '\\u0041');
  const composite = map_interpolation_range(site, segments, { precision: "exact", ...range });
  assert.equal(composite.kind, "composite");
  assert.equal(host.slice(composite.range.start, composite.range.end), '"\\u0041${value}suffix"');
});

check("governing Schemas validate the resulting strings and retain authored qualification", () => {
  const schema = Hson.schema`<type "document" tag "a" attrs <props <href <exact "/slides/2"> title <exact "Slide 2 of 3">> closed true> content "empty">`;
  const source = Hson.document`<a href="/slides/${2}" title="Slide ${2} of ${3}"/>`;
  const certified = schema.certify(source);
  assert.deepEqual(Hson.document.toNode(ANY_DOCUMENT.certify(certified)).$_content[0], Hson.document.toNode(ANY_DOCUMENT.certify(schema.certify(Hson.document`<a href="/slides/2" title="Slide 2 of 3"/>`))).$_content[0]);
  assert.throws(() => schema.certify(Hson.document`<a href="/slides/${4}" title="Slide ${2} of ${3}"/>`));
  assert.throws(() => schema.certify(Hson.document`<a href="/slides/${'2" injected="yes'}" title="Slide ${2} of ${3}"/>`));
  const data = Hson.schema`<type "data" content <label <exact "pre2post">>>`;
  assert.deepEqual(Hson.data.materialize(ANY_DATA.certify(data.certify(Hson.data`<label "pre${2}post">`))), { label: "pre2post" });
  assert.throws(() => data.certify(Hson.data`<label "pre${3}post">`));
  const authored = Hson.document`<a @:slide title="Slide ${2}"/>`;
  assert.match(authored, /@:slide/);
  assert.notEqual(authored, Hson.document`<a title="Slide 2"/>`);
});

process.stdout.write(`# ${checks} shared interpolation boundary checks passed\n`);
events.terminal("pass");

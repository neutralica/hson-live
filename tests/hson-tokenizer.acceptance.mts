import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { parse_tokens } from "../src/api/transform/parsers/parse-tokens.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { split_attrs_meta } from "../src/api/transform/utils/hson-utils/split-attrs-meta.ts";
import { completed_hson_element_ranges, scan_hson_template_segments, tokenize_hson } from "../src/api/transform/parsers/tokenize-hson.ts";
import { Hson } from "../src/hson-authoring.ts";
import { encode_persisted_quid, is_persisted_quid } from "../src/core/persisted-quid.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { JsonValue } from "../src/core/types.ts";
import type { Tokens } from "../src/api/transform/token.types.ts";
import { TransformError } from "../src/core/errors.ts";
import { dispatch_hson_declaration, recognize_hson_declaration, type HsonDeclarativeRecognition } from "../src/internal/hson-declarative.ts";
import { run_attribute_quoting_cases } from "./fixtures/hson-attribute-quoting-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-tokenizer",
  title: "Hson tokenizer",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "tokenization", "parsing"]),
});

const testEvents = create_test_event_emitter("transform.hson-tokenizer");
let checks = 0;

function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
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

check("declaration dispatch selects separate adapters with original names and ranges", () => {
  const adapters = {
    "hson:event": (source: string) => source,
    "hson:schema": (source: string, { nameRange }: HsonDeclarativeRecognition) => ({ schema: source, nameRange }),
  };
  for (const newline of ["\n", "\r\n", "\r"]) {
    const prefix = `\t// 😀 <hson:query>${newline}  `;
    const head = `< // ignored <hson:custom>${newline}\t`;
    const read = (domain: "hson:event" | "hson:schema") => {
      const source = prefix + head + domain + " \"unfinished body";
      const start = prefix.length + head.length;
      const recognition = recognize_hson_declaration(source);
      assert.deepEqual(recognition, { kind: "recognized", source, domain, name: domain, openingOffset: prefix.length,
        nameRange: { start, end: start + domain.length }, position: { index: start, line: 3, column: 2 } });
      return recognition;
    };
    const event = read("hson:event"), schema = read("hson:schema");
    assert.equal(dispatch_hson_declaration(event, adapters), event.source);
    assert.equal(dispatch_hson_declaration(event, { "hson:event": adapters["hson:event"] }, "hson:event"), event.source);
    const schemaResult: { schema: string } = dispatch_hson_declaration(schema, { "hson:schema": adapters["hson:schema"] }, "hson:schema");
    assert.deepEqual(schemaResult, { schema: schema.source, nameRange: schema.nameRange });
    assert.deepEqual(dispatch_hson_declaration(schema, adapters), schemaResult);
    assert.throws(() => dispatch_hson_declaration(schema, adapters, "hson:event"), {
      code: "HSON_DECLARATIVE_DOMAIN_MISMATCH", source: schema.position, message: /Expected a <hson:event declaration, found <hson:schema/,
    });
    assert.throws(() => Reflect.apply(dispatch_hson_declaration, undefined, [schema, { "hson:event": adapters["hson:event"] }]), {
      operation: "HsonDeclarative", code: "HSON_DECLARATIVE_ADAPTER_UNAVAILABLE", stage: "source-admission", source: schema.position,
    });
  }
});

check("declaration recognition reserves unsupported hson: names and classifies ordinary HSON separately", () => {
  const unexpected = () => assert.fail("A non-domain source reached a semantic adapter.");
  const adapters = { "hson:event": unexpected, "hson:schema": unexpected };
  for (const name of ["hson:query", "hson:declarative", "hson:custom", "hson:Event", "hson:eventual", "hson:schema-extra", "hson:e"]) {
    const source = `<${name} "unfinished`;
    const recognition = recognize_hson_declaration(source);
    assert.equal(recognition.kind, "unsupported");
    assert.deepEqual(recognition.nameRange, { start: 1, end: 1 + name.length });
    assert.throws(() => dispatch_hson_declaration(recognition, adapters, "hson:event"), (error: TransformError) =>
      error.operation === "HsonDeclarative"
      && error.code === "HSON_DECLARATIVE_DOMAIN_UNSUPPORTED"
      && error.message.includes(`Declarative domain "${name}" is unsupported.`)
      && error.source?.index === 1);
  }
  for (const source of ['<person "Ada">', "<person/>", "<person <hson:query/>>", "<'hson:event' 1>",
    '<HSON:event/>', '<hson-part/>', '<>', '"<hson:event>"', ' // <hson:event>']) {
    const recognition = recognize_hson_declaration(source);
    assert.equal(recognition.kind, "ordinary", source);
    assert.throws(() => dispatch_hson_declaration(recognition, adapters), { code: "HSON_DECLARATIVE_ROOT_REQUIRED" });
  }
});

check("declaration heads distinguish incomplete prefixes from malformed syntax", () => {
  const unexpected = () => assert.fail("A malformed head reached a semantic adapter.");
  const adapters = { "hson:event": unexpected, "hson:schema": unexpected };
  for (const source of ["<", "<\t", "<hson", "<hson:", "<hson:even", "<hson:schem"]) {
    const recognition = recognize_hson_declaration(source);
    assert.equal(recognition.kind, "incomplete", source);
    assert.equal(recognition.nameRange?.end, source.length);
    assert.throws(() => dispatch_hson_declaration(recognition, adapters), { code: "HSON_DECLARATIVE_NAME_INCOMPLETE" });
  }
  for (const [source, code, index] of [
    ["  <hson:>", "HSON_DECLARATIVE_HEAD_MALFORMED", 3],
    ["  <hson:event!>", "HSON_DECLARATIVE_HEAD_MALFORMED", 13],
    ["<hson:event/*", "HSON_BLOCK_COMMENT_UNSUPPORTED", 11],
    ["<hson:event\u00A0", "HSON_UNSUPPORTED_WHITESPACE", 11],
    ["< /bad>", "HSON_NAME_INVALID_START", 2],
    ["< /* block */ hson:event>", "HSON_BLOCK_COMMENT_UNSUPPORTED", 2],
    ["\u00A0<hson:event>", "HSON_UNSUPPORTED_WHITESPACE", 0],
  ] as const) {
    const recognition = recognize_hson_declaration(source);
    assert.equal(recognition.kind, "malformed", source);
    assert.throws(() => dispatch_hson_declaration(recognition, adapters), (error: TransformError) =>
      error.code === code && error.source?.index === index);
  }
  for (const source of ["<hson:event", "<hson:event<>>", "<hson:event// body", "<hson:event /* body"]) {
    assert.equal(recognize_hson_declaration(source).kind, "recognized", source);
  }
});

check("editor framing retains closed roots through malformed quotes without admitting them", () => {
  const first = '<main hson:part data:x=%{x} <p title=^{x}/>/>', last = '<main hson:part "😀"/>';
  const broken = '<aside title="a\r\nb <fake/> 😀"/>';
  const secondBroken = '<aside title="c\nd"/>';
  const trivia = '\r\n// 😀 <ignored/>\r\n';
  const unfinished = '<aside title="unterminated <fake/>';
  const source = [first, broken, secondBroken, last, unfinished, first].join(trivia);
  assert.deepEqual(completed_hson_element_ranges(source, []), [first, broken, secondBroken, last].map(root => {
    const start = source.indexOf(root);
    return { start, end: start + root.length };
  }));
  const newline = source.indexOf('\r\n', source.indexOf(broken));
  assert.throws(() => tokenize_hson(source), (error: TransformError) =>
    error.code === "HSON_STRING_CONTROL_UNESCAPED" && error.source?.index === newline);
  assert.deepEqual(completed_hson_element_ranges(unfinished + trivia + first, []), []);
});

check("escaped controls retain quote state until a literal quote and closer", () => {
  const first = '<header "😀"/>', part = '<main hson:part data:x=%{x} <p title=^{x}/>/>';
  const trivia = '\r\n// <ignored/>\r\n';
  for (const quote of ['"', "'"]) {
    const open = quote === '"' ? '<aside title="' : "<'aside";
    for (let code = 0; code < 0x20; code++) {
      const escape = '\\' + String.fromCharCode(code);
      const unfinished = open + 'a' + escape + 'b\\' + quote + '/> <decoy/>';
      const bad = unfinished + quote + '/>';
      const start = first.length + trivia.length, next = start + bad.length + trivia.length;
      assert.deepEqual(completed_hson_element_ranges([first, bad, part].join(trivia), []), [
        { start: 0, end: first.length }, { start, end: start + bad.length }, { start: next, end: next + part.length },
      ]);
      assert.throws(() => tokenize_hson(bad), (error: TransformError) =>
        error.code === (quote === '"' ? "invalid-json-escape" : "invalid-name-escape")
        && error.source?.index === open.length + 1);
      for (const trailing of [unfinished, unfinished + quote]) {
        assert.deepEqual(completed_hson_element_ranges([first, trailing, part].join(trivia), []),
          [{ start: 0, end: first.length }]);
      }
    }
  }
  const broken = '<aside title="a\nb' + '\\' + '\nc"/>';
  assert.deepEqual(completed_hson_element_ranges(broken + part, []), [
    { start: 0, end: broken.length }, { start: broken.length, end: broken.length + part.length },
  ]);
  assert.throws(() => tokenize_hson(broken + part), (error: TransformError) =>
    error.code === "HSON_STRING_CONTROL_UNESCAPED" && error.source?.index === broken.indexOf('\n'));
});

check("top-level bare tokens stop at lexical boundaries and never promote nested elements", () => {
  const first = '<header "😀"/>', part = '<main hson:part/>', trivia = '\r\n// <ignored/>\r\n';
  for (const [bare, code] of [
    ['note', 'HSON_TRAILING_SOURCE'], ['*', 'HSON_TRAILING_SOURCE'],
    ['01', 'HSON_NUMBER_LEADING_ZERO'], ['1e999', 'HSON_NUMBER_NONFINITE'],
    [',', 'HSON_TOKENIZATION_ERROR'], ['=', 'HSON_TOKENIZATION_ERROR'], ['\u00a0', 'HSON_UNSUPPORTED_WHITESPACE'],
  ] as const) {
    const prefix = first + trivia + bare;
    assert.deepEqual(completed_hson_element_ranges(prefix + part, []), [
      { start: 0, end: first.length }, { start: prefix.length, end: prefix.length + part.length },
    ]);
    assert.throws(() => tokenize_hson(prefix + part), { code });
    for (const suffix of ['"' + part, '<aside ' + part, '[' + part, '>' + part]) {
      assert.deepEqual(completed_hson_element_ranges(prefix + suffix, []), [{ start: 0, end: first.length }]);
    }
  }
});

check("editor framing recognizes delimiters only within a literal template segment", () => {
  const part = '<main hson:part data:x=%{x} <p title=^{x}/>/>', child = Hson.document`<b/>`;
  const ranges = (raw: readonly string[], expected: readonly string[]) => {
    const { source, slots } = scan_hson_template_segments(raw, Array(raw.length - 1).fill(child));
    let search = 0;
    assert.deepEqual(completed_hson_element_ranges(source, slots), expected.map(root => {
      const start = source.indexOf(root, search);
      search = start + root.length;
      return { start, end: search };
    }));
  };
  ranges([part + '<aside /', '>\r\n' + part], [part, part]);
  assert.throws(() => Hson.document`<aside /${child}>`, { code: "HSON_INTERPOLATION_POSITION_INVALID" });
  ranges(['<aside /', '/ <small/>/>' + part], ['<aside // <small/>/>', part]);
  ranges(['<aside title=', '/','/ <small/>/>' + part], ['<aside title=// <small/>/>', part]);
  ranges(['/', '/' + part], [part]);
  ranges([part + '/', '/ note ' + part], [part, part]);
  ranges([part + '/', '*' + part], [part, part]);
  ranges(['// note <ignored/>\r\n' + part], [part]);
  ranges([part + '/* note ' + part], [part]);
  ranges(['no', 'te' + part], [part]);
  ranges(['', part, ''], [part]);
  assert.throws(() => Hson.document`/${child}/ note <main hson:part/>`, { code: "HSON_INTERPOLATION_POSITION_INVALID" });
  assert.throws(() => Hson.document`/${child}*<main hson:part/>`, { code: "HSON_BLOCK_COMMENT_UNSUPPORTED" });
  ranges(['<aside /', '* <small/>/>' + part], ['<aside /* <small/>/>', part]);

  ranges(['<aside ', '/>// <ignored/>\r\n', part], ['<aside />', part]);
  assert.equal(Hson.document`<aside ${child}/>// <ignored/>
${child}<p/>`, '<aside\n  <b/>\n/>\n<b/>\n<p/>');

  // A split escape must not mask the following literal quote and closer.
  ranges(['<aside title="a\\', '"/>' + part], ['<aside title="a\\"/>', part]);
  // A quoted key spanning a slot still shields apparent tag syntax inside it.
  ranges(['<aside title=^{x["a', ' <fake/>"]}/>' + part], ['<aside title=^{x["a <fake/>"]}/>', part]);
});

check("invalid operand diagnostics never set the editor's structural cursor", () => {
  const part = '<main hson:part data:x=%{x} <p title=^{x}/>/>', earlier = '<header "😀"/>';
  const original = "<aside a=^{bad'/> " + part + " '/>" + part;
  assert.deepEqual(completed_hson_element_ranges(original, []), [{ start: 0, end: 67 }, { start: 67, end: 112 }]);
  expect_transform_error(original, 'HSON_PART_REFERENCE_INVALID', { index: 9, line: 1, column: 10 });
  for (const [open, close] of [
    ["^{bad'/> \\' ", "'"], ['%{bad"/> \\" ', '"'], ['#{bad[/> ', ']'],
    ['^{bad«/> ', '»'], ['^{good}^{bad[«[/> ', ']»]'],
    ['^{bad["escaped \\" /> ', '"]'], ["^{bad['outer [ /> ", "']"],
  ]) {
    const prefix = earlier + '\r\n<aside a=' + open + part;
    const end = prefix.length + close.length + 2;
    assert.deepEqual(completed_hson_element_ranges(prefix + close + '/>' + part, []), [
      { start: 0, end: earlier.length }, { start: earlier.length + 2, end }, { start: end, end: end + part.length },
    ], open);
    assert.deepEqual(completed_hson_element_ranges(prefix + '/>' + part, []), [{ start: 0, end: earlier.length }], open);
  }
  // A failed reference can start *inside* a square enclosure. Its closing
  // bracket must return ownership of the next /> to the surrounding angle.
  const bad = '<aside [x=^{bad]/>';
  assert.deepEqual(completed_hson_element_ranges(bad + part, []), [
    { start: 0, end: bad.length }, { start: bad.length, end: bad.length + part.length },
  ]);
  const commented = '<aside a=bare// /> ' + part + '\r\n/>';
  assert.deepEqual(completed_hson_element_ranges(commented + part, []), [
    { start: 0, end: commented.length }, { start: commented.length, end: commented.length + part.length },
  ]);
  const unsupported = '<aside a=/* /> ' + part;
  assert.deepEqual(completed_hson_element_ranges(earlier + unsupported, []), [{ start: 0, end: earlier.length }]);
  assert.throws(() => tokenize_hson(unsupported), { code: 'HSON_BLOCK_COMMENT_UNSUPPORTED' });
  const selector = '<hson-part at=lib/*literal/>';
  assert.doesNotThrow(() => tokenize_hson(selector));
  assert.deepEqual(completed_hson_element_ranges(selector + part, []), [
    { start: 0, end: selector.length }, { start: selector.length, end: selector.length + part.length },
  ]);
  const spacing = '<aside\u00a0a=\u00a0"quoted /> ' + part + '"/>';
  assert.throws(() => tokenize_hson(spacing), { code: 'HSON_UNSUPPORTED_WHITESPACE' });
  assert.deepEqual(completed_hson_element_ranges(spacing + part, []), [
    { start: 0, end: spacing.length }, { start: spacing.length, end: spacing.length + part.length },
  ]);
});

check("closed malformed content strings share quote framing with attributes", () => {
  const part = '<main hson:part data:x=%{x} <p title=^{x}/>/>', earlier = '<header/>';
  const malformed = '"a' + '\\' + '\n' + 'b"';
  assert.deepEqual(completed_hson_element_ranges(malformed + part, []), [{ start: 6, end: 51 }]);
  expect_transform_error(malformed + part, 'invalid-json-escape', { index: 2, line: 1, column: 3 });
  for (const bad of ['\\\r\n', '\\q', '\\u12', '\u0000', '\u001f']) {
    const open = earlier + '"😀' + bad + '\\" ' + part;
    assert.deepEqual(completed_hson_element_ranges(open, []), [{ start: 0, end: earlier.length }]);
    assert.deepEqual(completed_hson_element_ranges(open + '"' + part, []), [
      { start: 0, end: earlier.length }, { start: open.length + 1, end: open.length + 1 + part.length },
    ]);
    const array = '[' + open.slice(earlier.length) + '"]';
    assert.deepEqual(completed_hson_element_ranges(array + part, []), [{ start: array.length, end: array.length + part.length }]);
  }
});

check("interpolation never completes an escape, reference key or closer across literal segments", () => {
  const part = '<main hson:part data:x=%{x} <p title=^{x}/>/>';
  for (const [raw, closedElement] of [
    [['"a\\', '"' + part], false],
    [['"a\\q', '\\" ' + part + '"', part], false],
    [['<aside a=^', '{bad[/> ' + part + ']/>', part], true],
    [['<aside a=^{bad[', "'/> " + part + "'", ']/>', part], true],
    [['<aside a=^{bad["a\\', '"/> ' + part + ']/>', part], true],
    // With a slot between / and > the outer angle closes as an object.
    [['<aside a=^{bad[/> ', part + '] /', '>' + part], false],
  ] as const) {
    const {source, slots} = scan_hson_template_segments(raw, Array(raw.length - 1).fill(null));
    const start = source.length - part.length;
    assert.deepEqual(completed_hson_element_ranges(source, slots), [
      ...(closedElement ? [{ start: 0, end: start }] : []), { start, end: source.length },
    ], JSON.stringify(raw));
  }
});

function token_summary(tokens: readonly Tokens[]) {
  return tokens.map((token) => {
    switch (token.kind) {
      case "OPEN":
        return {
          kind: token.kind,
          tag: token.tag,
          ...(token.quid ? { quid: token.quid.value } : {}),
          attrs: token.rawAttrs.map((attr) => ({
            name: attr.name,
            ...(attr.value ? { value: attr.value } : {}),
          })),
        };
      case "CLOSE":
        return { kind: token.kind, close: token.close };
      case "ARR_OPEN":
      case "ARR_CLOSE":
        return { kind: token.kind, symbol: token.symbol };
      case "TEXT":
        return { kind: token.kind, raw: token.raw, ...(token.quoted ? { quoted: true } : {}) };
      case "EMPTY_OBJ":
        return { kind: token.kind, raw: token.raw };
    }
  });
}

function authored_node(source: string): ReturnType<typeof parse_hson> {
  const root = parse_hson(source);
  const cluster = root.$_content[0];
  assert.ok(is_Node(cluster));
  const node = cluster.$_content[0];
  assert.ok(is_Node(node));
  return node;
}

function authored_attr(source: string, name = "value"): unknown {
  return authored_node(source).$_attrs?.[name];
}

function authored_content(source: string): unknown {
  const node = authored_node(source);
  const cluster = node.$_content[0];
  assert.ok(is_Node(cluster));
  const leaf = cluster.$_content[0];
  assert.ok(is_Node(leaf));
  return leaf.$_content[0];
}

function assert_authored_rejection(
  source: string,
  classification: string,
  authoredName?: string,
): void {
  assert.throws(
    () => parse_hson(source),
    (cause) => cause instanceof Error
      && cause.message.includes(classification)
      && (authoredName === undefined || cause.message.includes(`"${authoredName}"`))
      && /at \d+:\d+ \(index \d+\)/.test(cause.message),
  );
}

function expect_transform_error(
  source: string,
  code: string,
  expectedSource?: Readonly<{ index: number; line: number; column: number }>,
): TransformError {
  let observed: TransformError | undefined;
  assert.throws(
    () => parse_hson(source),
    (cause) => {
      if (!(cause instanceof TransformError)) return false;
      observed = cause;
      return cause.code === code
        && (expectedSource === undefined || JSON.stringify(cause.source) === JSON.stringify(expectedSource));
    },
  );
  if (observed === undefined) throw new Error(`expected ${code}`);
  return observed;
}

check("object-value grammar covers empty, one, multiple, nested, array, and array-item objects", () => {
  const fixtures: ReadonlyArray<readonly [string, JsonValue]> = [
    [`<>`, {}],
    [`<a "1">`, { a: "1" }],
    [`<a "1" b "2">`, { a: "1", b: "2" }],
    [`<a <b "2" c "3"> d false>`, { a: { b: "2", c: "3" }, d: false }],
    [`<a «1,2» b null>`, { a: [1, 2], b: null }],
    [`«<a "1" b "2">»`, [{ a: "1", b: "2" }]],
  ];
  for (const [source, json] of fixtures) {
    assert.deepEqual(parse_hson(source), parse_json(json));
  }
});

check("object member names and physical-line comments use required trivia", () => {
  const source = `<true "literal-looking"\n  'unusual name'// name/value separator\n  "value"\n  a// name/value separator\n  true\n  b false>`;
  assert.deepEqual(parse_hson(source), parse_json({
    true: "literal-looking",
    "unusual name": "value",
    a: true,
    b: false,
  }));
  assert.throws(() => parse_hson(`<a"1">`), /trivia.*name.*value|separator/i);
  assert.throws(() => parse_hson(`<a "1"b "2">`), /trivia.*member|separator/i);
  assert.throws(() => parse_hson(`<a\/\* comment \*\/"1">`), /block|unexpected|trivia/i);
});

check("object members require one complete value and reject object headers", () => {
  for (const source of [
    `<a>`,
    `<a "1" b>`,
    `<a bare>`,
    `<a flag "value">`,
    `<a title="value" "content">`,
    `<a @000000001 1>`,
  ]) {
    assert.throws(
      () => parse_hson(source),
      (cause) => cause instanceof Error && /at \d+:\d+ \(index \d+\)/.test(cause.message),
      source,
    );
  }
});

check("legacy property-angle and anonymous-object aliases reject", () => {
  for (const source of [
    `<a 1><b 2>`,
    `<<a 1>>`,
    `«<<a 1><b 2>>»`,
    `<record <a 1><b 2>>`,
  ]) {
    assert.throws(
      () => parse_hson(source),
      (cause) => cause instanceof Error && /at \d+:\d+ \(index \d+\)/.test(cause.message),
      source,
    );
  }
});

check("object pairs stay stable across member cardinality and layout", () => {
  const compactSources = [`<>`, `<b "2">`, `<a "1" b "2">`];
  const readableSources = [
    `<\n>`,
    `<\n  b "2"\n>`,
    `<\n  a "1"\n  b "2"\n>`,
  ];
  for (let index = 0; index < compactSources.length; index += 1) {
    assert.deepEqual(parse_hson(readableSources[index]), parse_hson(compactSources[index]));
  }
});

check("object duplicate tracking is case-sensitive and reports both positions", () => {
  assert.throws(
    () => parse_hson(`<a 1 a 2>`),
    /\[duplicate-object-member\].*first declared at 1:2 \(index 1\).*at 1:6 \(index 5\)/,
  );
  assert.deepEqual(parse_hson(`<a 1 A 2>`), parse_json({ a: 1, A: 2 }));
});

check("element grammar and canonical graph remain unchanged", () => {
  const fixtures: ReadonlyArray<readonly [string, string]> = [
    [`<a/>`, `<a/>`],
    [`<a "text"/>`, `<a "text"/>`],
    [`<a flag/>`, `<a flag/>`],
    [`<a title="value"/>`, `<a title="value"/>`],
    [`<a href="foo//bar"/>`, `<a href="foo//bar"/>`],
    [`<a href=// layout\n"foo//bar"/>`, `<a href="foo//bar"/>`],
    [`<a <b/>/>`, `<a\n  <b/>\n/>`],
    [
      `<a style="color: red" "before" <b/> "after"/>`,
      `<a style="color: red"\n  "before"\n  <b/>\n  "after"\n/>`,
    ],
    [`<a/><b/>`, `<a/>\n<b/>`],
  ];
  for (const [source, expected] of fixtures) {
    const before = parse_hson(source);
    assert.deepEqual(parse_tokens(tokenize_hson(source)), before);
    const wire = serialize_hson(detach_hson_root_value(before));
    assert.equal(wire, expected);
    assert.deepEqual(parse_hson(wire), before);
  }
});

check("header @quid is represented separately from ordinary attributes", () => {
  const open = tokenize_hson(`<panel class="settings" @d1r6x8qwc hidden/>`)[0];
  assert.equal(open.kind, "OPEN");
  if (open.kind !== "OPEN") return;
  assert.equal(open.quid?.value, "d1r6x8qwc");
  assert.deepEqual(open.rawAttrs.map((attr) => attr.name), ["class", "hidden"]);
});

check("@quid rejects missing, duplicate, and post-content declarations", () => {
  assert.throws(() => tokenize_hson(`<panel @/>`), /missing persisted QUID/);
  assert.throws(() => tokenize_hson(`<panel @d1r6x8qwc @000000000/>`), /duplicate persisted QUID/);
  assert.throws(() => tokenize_hson(`<panel "text" @d1r6x8qwc/>`), /forbidden after content/);
});

check("persisted QUIDs use the canonical 45-bit Base32 contract", () => {
  assert.equal(encode_persisted_quid(new Uint8Array(6)), "000000000");
  assert.equal(encode_persisted_quid(new Uint8Array(6).fill(255)), "zzzzzzzzz");
  assert.equal(is_persisted_quid("d1r6x8qwc"), true);
  for (const value of ["", "d1r6x8qw", "0d1r6x8qwc", "4k7m2v9d1r6x8qwc", "D1R6X8QWC", "d1r6x8qwi", "d1r6x8qw-", " d1r6x8qwc", "d1r6x8qwc "]) {
    assert.equal(is_persisted_quid(value), false);
  }
});

const token_cases = [
  {
    name: "canonical multiline object members",
    source: `<
  name "Ada"
  age 42
>`,
    expected: [
      { kind: "OPEN", tag: "_hson_obj", attrs: [] },
      { kind: "OPEN", tag: "name", attrs: [] },
      { kind: "TEXT", raw: `"Ada"`, quoted: true },
      { kind: "CLOSE", close: "obj" },
      { kind: "OPEN", tag: "age", attrs: [] },
      { kind: "TEXT", raw: "42" },
      { kind: "CLOSE", close: "obj" },
      { kind: "CLOSE", close: "obj" },
    ],
  },
  {
    name: "ordered element children",
    source: `<p
  "first"
  <em "middle"/>
  "last"
/>`,
    expected: [
      { kind: "OPEN", tag: "p", attrs: [] },
      { kind: "TEXT", raw: `"first"`, quoted: true },
      { kind: "OPEN", tag: "em", attrs: [] },
      { kind: "TEXT", raw: `"middle"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
      { kind: "TEXT", raw: `"last"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "nested arrays and object item",
    source: `<items
  «
    1,
    [true, null],
    <
      name "Ada"
    >
  »
>`,
    expected: [
      { kind: "OPEN", tag: "_hson_obj", attrs: [] },
      { kind: "OPEN", tag: "items", attrs: [] },
      { kind: "ARR_OPEN", symbol: "guillemet" },
      { kind: "TEXT", raw: "1" },
      { kind: "ARR_OPEN", symbol: "bracket" },
      { kind: "TEXT", raw: "true" },
      { kind: "TEXT", raw: "null" },
      { kind: "ARR_CLOSE", symbol: "bracket" },
      { kind: "OPEN", tag: "_hson_obj", attrs: [] },
      { kind: "OPEN", tag: "name", attrs: [] },
      { kind: "TEXT", raw: `"Ada"`, quoted: true },
      { kind: "CLOSE", close: "obj" },
      { kind: "CLOSE", close: "obj" },
      { kind: "ARR_CLOSE", symbol: "guillemet" },
      { kind: "CLOSE", close: "obj" },
      { kind: "CLOSE", close: "obj" },
    ],
  },
  {
    name: "quoted key attributes flags and metadata",
    source: `<'display name' @000000001 count="2" enabled="true" missing="null" disabled "Ada"/>`,
    expected: [
      {
        kind: "OPEN",
        tag: "display name",
        quid: "000000001",
        attrs: [
          { name: "count", value: { text: "2", quoted: true } },
          { name: "enabled", value: { text: "true", quoted: true } },
          { name: "missing", value: { text: "null", quoted: true } },
          { name: "disabled" },
        ],
      },
      { kind: "TEXT", raw: `"Ada"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "escaped newline quoted content",
    source: `<text
  "first\\nsecond"
/>`,
    expected: [
      { kind: "OPEN", tag: "text", attrs: [] },
      { kind: "TEXT", raw: `"first\\nsecond"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "full-line and closer comments",
    source: `// before
<p
  "first"
  // between
  <em "middle"/>
/> // close`,
    expected: [
      { kind: "OPEN", tag: "p", attrs: [] },
      { kind: "TEXT", raw: `"first"`, quoted: true },
      { kind: "OPEN", tag: "em", attrs: [] },
      { kind: "TEXT", raw: `"middle"`, quoted: true },
      { kind: "CLOSE", close: "elem" },
      { kind: "CLOSE", close: "elem" },
    ],
  },
  {
    name: "empty object",
    source: `<>`,
    expected: [{ kind: "EMPTY_OBJ", raw: "<>" }],
  },
];

for (const fixture of token_cases) {
  check(`canonical tokens: ${fixture.name}`, () => {
    const tokens = tokenize_hson(fixture.source);
    assert.deepEqual(token_summary(tokens), fixture.expected);
    assert.deepEqual(parse_tokens(tokens), fixture.source.includes("@000000001")
      ? parse_hson_exact_runtime(fixture.source)
      : parse_hson(fixture.source));
  });
}

const required_valid = [
  `<tag attr="value" flag "content"/>`,
  `<tag attr="value" flag"content"/>`,
  `<tag attr="value" flag "content" />`,
  `<tag count="2"/>`,
  `<a 1 b 2>`,
  `<parent <child "value"/>/>`,
  `<'this is always a tag'
  attribute="long value"
  disabled
  "content"
/>`,
  `<p "first" <em "middle"/> "last"/>`,
  `<
  tag "content"
>`,
  `[1, «true, [null, "deep"]», <name "Ada" age 31>]`,
  `<p // comment after tag name
    "first" // comment after content
    <em // comment in child header
      "middle"
    />
    "last"
  />`,
  `<text "first\\nsecond and \\"quoted\\" text"/>`,
];

for (const source of required_valid) {
  check(`newline-agnostic valid form: ${JSON.stringify(source)}`, () => {
    const tokens = tokenize_hson(source);
    assert.ok(tokens.length > 0);
    assert.deepEqual(parse_tokens(tokens), parse_hson(source));
  });
}

check("required interleaved content token order", () => {
  const tokens = tokenize_hson(`<p "first" <em "middle"/> "last"/>`);
  assert.deepEqual(token_summary(tokens), [
    { kind: "OPEN", tag: "p", attrs: [] },
    { kind: "TEXT", raw: `"first"`, quoted: true },
    { kind: "OPEN", tag: "em", attrs: [] },
    { kind: "TEXT", raw: `"middle"`, quoted: true },
    { kind: "CLOSE", close: "elem" },
    { kind: "TEXT", raw: `"last"`, quoted: true },
    { kind: "CLOSE", close: "elem" },
  ]);
});

check("compact and layout-separated empty objects retain canonical tokens", () => {
  assert.deepEqual(token_summary(tokenize_hson(`<>`)), [
    { kind: "EMPTY_OBJ", raw: "<>" },
  ]);
  assert.deepEqual(token_summary(tokenize_hson(`<\n>`)), [
    { kind: "OPEN", tag: "_hson_obj", attrs: [] },
    { kind: "CLOSE", close: "obj" },
  ]);
  assert.throws(() => tokenize_hson(`<<a 1>>`), /legacy doubled object syntax/);
});

check("legacy doubled syntax is reserved for the adjacent retired spelling", () => {
  const legacy = expect_transform_error(`<<a 1>>`, "legacy-doubled-object-syntax", {
    index: 1, line: 1, column: 2,
  });
  assert.match(legacy.message, /legacy doubled object syntax/);

  const malformed = expect_transform_error(`<data 1\n  <data2 2>\n>`, "HSON_NAME_INVALID_START", {
    index: 10, line: 2, column: 3,
  });
  assert.match(malformed.message, /malformed object member name: expected a bare name or single-quoted name/);
  assert.doesNotMatch(malformed.message, /legacy/i);

  const separated = expect_transform_error(`<\n  <a 1>\n>`, "HSON_NAME_INVALID_START", {
    index: 4, line: 2, column: 3,
  });
  assert.doesNotMatch(separated.message, /legacy/i);
  expect_transform_error(`<a 1 2>`, "HSON_OBJECT_EXTRA_VALUE");
});

const equivalent_layouts = [
  [
    `<
  a <
    b 1
    c 2
  >
  d 3
>`,
    `<a <b 1 c 2> d 3>`,
  ],
  [
    `<p
  "first"
  <em "middle"/>
  "last"
/>`,
    `<p "first"<em "middle"/>"last"/>`,
  ],
  [
    `<items
  «
    1,
    [true, null],
    <
      name "Ada"
      age 31
    >
  »
>`,
    `<items «1,[true,null],<name "Ada" age 31>»>`,
  ],
  [
    `<
  tag "content"
>`,
    `<tag "content">`,
  ],
];

for (const [multiline, compact] of equivalent_layouts) {
  check(`multiline and compact graph equivalence: ${JSON.stringify(compact)}`, () => {
    assert.deepEqual(parse_hson(multiline), parse_hson(compact));
  });
}

check("quoted Hson attribute literals retain their string parse contract", () => {
  const root = parse_hson(`<tag count="2" enabled="true" missing="null" href="http://example.test/path" disabled "content"/>`);
  const cluster = root.$_content[0];
  assert.ok(is_Node(cluster));
  const tag = cluster.$_content[0];
  assert.ok(is_Node(tag));
  assert.deepEqual(tag.$_attrs, {
    count: "2",
    enabled: "true",
    missing: "null",
    href: "http://example.test/path",
    disabled: "disabled",
  });
});

check("CRLF trivia and escaped content retain absolute token starts", () => {
  const source = `<p\r\n  "a\\nb"\r\n/>\r\n<a 1>`;
  const tokens = tokenize_hson(source);
  assert.deepEqual(tokens.map((token) => ({ kind: token.kind, pos: token.pos })), [
    { kind: "OPEN", pos: { line: 1, col: 1, index: 0 } },
    { kind: "TEXT", pos: { line: 2, col: 3, index: 6 } },
    { kind: "CLOSE", pos: { line: 3, col: 1, index: 14 } },
    { kind: "OPEN", pos: { line: 4, col: 1, index: 18 } },
    { kind: "OPEN", pos: { line: 4, col: 2, index: 19 } },
    { kind: "TEXT", pos: { line: 4, col: 4, index: 21 } },
    { kind: "CLOSE", pos: { line: 4, col: 4, index: 21 } },
    { kind: "CLOSE", pos: { line: 4, col: 5, index: 22 } },
  ]);
  const text = tokens[1];
  assert.equal(text?.kind, "TEXT");
  if (text?.kind !== "TEXT") throw new Error("expected quoted TEXT token");
  assert.equal(text.raw, `"a\\nb"`);
});

check("multiline attribute ranges use original CRLF indices", () => {
  const source = `<tag\r\n  attr="x"\r\n  "y"\r\n/>`;
  const open = tokenize_hson(source)[0];
  assert.equal(open.kind, "OPEN");
  assert.deepEqual(open.rawAttrs[0].start, { line: 2, col: 3, index: 8 });
  assert.deepEqual(open.rawAttrs[0].end, { line: 2, col: 10, index: 15 });
});

check("comments quoted tags and nested arrays share absolute positions", () => {
  const source = `// c\r\n[<'a b' 1>,[2]]`;
  const tokens = tokenize_hson(source);
  assert.deepEqual(tokens.map((token) => ({ kind: token.kind, pos: token.pos })), [
    { kind: "ARR_OPEN", pos: { line: 2, col: 1, index: 6 } },
    { kind: "OPEN", pos: { line: 2, col: 2, index: 7 } },
    { kind: "OPEN", pos: { line: 2, col: 3, index: 8 } },
    { kind: "TEXT", pos: { line: 2, col: 9, index: 14 } },
    { kind: "CLOSE", pos: { line: 2, col: 9, index: 14 } },
    { kind: "CLOSE", pos: { line: 2, col: 10, index: 15 } },
    { kind: "ARR_OPEN", pos: { line: 2, col: 12, index: 17 } },
    { kind: "TEXT", pos: { line: 2, col: 13, index: 18 } },
    { kind: "ARR_CLOSE", pos: { line: 2, col: 14, index: 19 } },
    { kind: "ARR_CLOSE", pos: { line: 2, col: 15, index: 20 } },
  ]);
});

const round_trip_payloads: readonly JsonValue[] = [
  {},
  [],
  { a: 1, b: true, c: null, d: "text" },
  { nested: { left: [1, 2, 3], right: { ok: true } }, tail: "done" },
  [1, "two", false, null, [3, 4], { name: "Ada", age: 31 }],
  { "spaced key": "value", "punctuation!?": { "dot.key": "kept" } },
  { multiline: "first\nsecond", escaped: `a "quote" and \\ slash` },
];

for (const payload of round_trip_payloads) {
  check(`canonical serialize/parse graph round trip: ${JSON.stringify(payload)}`, () => {
    const original = parse_json(payload);
    const wire = serialize_hson(detach_hson_root_value(original));
    assert.deepEqual(parse_hson(wire), original);
  });
}

check("representative large canonical payload round trips", () => {
  const payload = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [
    `key-${index}`,
    { index, enabled: index % 2 === 0, values: [index, `value-${index}`, null] },
  ]));
  const original = parse_json(payload);
  const wire = serialize_hson(detach_hson_root_value(original));
  assert.deepEqual(parse_hson(wire), original);
});

for (const reserved of [
  "_hson_root",
  "_hson_elem",
  "_hson_obj",
  "_hson_arr",
  "_hson_ii",
  "_hson_str",
  "_hson_val",
]) {
  check(`authored reserved name rejects in bare and quoted spellings: ${reserved}`, () => {
    assert_authored_rejection(`<${reserved}>`, "[authored-reserved-name]", reserved);
    assert_authored_rejection(`<'${reserved}'>`, "[authored-reserved-name]", reserved);
    if (reserved === "_hson_obj") {
      assert.throws(
        () => hsonTransform.fromHson(`<${reserved}>`).toNode(),
        /\[authored-reserved-name\]/,
      );
    }
  });
}

check("authored reserved empty object-mode form rejects at name admission", () => {
  assert_authored_rejection(`<_hson_obj>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved empty element-mode form rejects at name admission", () => {
  assert_authored_rejection(`<_hson_elem/>`, "[authored-reserved-name]", "_hson_elem");
});

check("authored reserved populated form rejects before parser construction", () => {
  assert_authored_rejection(`<_hson_obj 1>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved nested form rejects at its nested source position", () => {
  assert_authored_rejection(`<outer <_hson_obj>>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved property position rejects", () => {
  assert_authored_rejection(`<_hson_obj 1>`, "[authored-reserved-name]", "_hson_obj");
});

check("authored reserved tag position rejects", () => {
  assert_authored_rejection(`<outer <_hson_elem/>/>`, "[authored-reserved-name]", "_hson_elem");
});

check("future reserved bare names reject at authored admission", () => {
  assert_authored_rejection(`<_hson_future>`, "[authored-reserved-name]", "_hson_future");
});

check("future reserved quoted names reject after decoding", () => {
  assert_authored_rejection(`<'_hson_future'/>`, "[authored-reserved-name]", "_hson_future");
});

for (const [name, source] of [
  ["value/value", `<tag a="1" a="2"/>`],
  ["flag/flag", `<tag disabled disabled/>`],
  ["flag/value", `<tag disabled disabled="1"/>`],
  ["value/flag", `<tag disabled="1" disabled/>`],
  ["__proto__ value/flag", `<tag __proto__="literal" __proto__/>`],
  ["style/style", `<tag style="color:red" style="color:blue"/>`],
  ["colonized", `<tag data:item="1" data:item="2"/>`],
  ["whitespace-separated", `<tag a="1"    a="2"/>`],
  ["comment-separated", `<tag a="1" // declaration boundary\n a="2"/>`],
] as const) {
  check(`duplicate Hson attributes reject before storage: ${name}`, () => {
    assert_authored_rejection(source, "[duplicate-attribute]");
    if (name === "value/value") {
      assert.throws(() => hsonTransform.fromHson(source).toNode(), /\[duplicate-attribute\]/);
    }
  });
}

check("Hson attribute duplicate identity is case-sensitive", () => {
  assert.deepEqual(authored_node(`<tag a="1" A="2"/>`).$_attrs, { a: "1", A: "2" });
});

check("Hson stores special attribute names as own data before node assembly", () => {
  for (const [header, value, canonicalHeader] of [
    ['__proto__="literal"', "literal", '__proto__="literal"'],
    ["__proto__", "__proto__", "__proto__"],
    ['__proto__="__proto__"', "__proto__", "__proto__"],
    ['__proto__=""', "", '__proto__=""'],
  ]) {
    const source = `<item ${header}/>`;
    const open = tokenize_hson(source).find(token => token.kind === "OPEN" && token.tag === "item");
    assert.ok(open?.kind === "OPEN");
    const { attrs } = split_attrs_meta(open.rawAttrs);
    assert.equal(Object.getOwnPropertyDescriptor(attrs, "__proto__")?.enumerable, true);
    assert.equal(attrs.__proto__, value);

    const expected = { ["__proto__"]: value };
    assert.deepEqual(authored_node(source).$_attrs, expected);
    const wire = hsonTransform.fromHson(source).toHson().noBreak().serialize();
    assert.equal(wire, `<item ${canonicalHeader}/>`);
    assert.deepEqual(authored_node(wire).$_attrs, expected);
  }
  assert.deepEqual(authored_node(`<item constructor="ctor" __proto__="literal" toString="method"/>`).$_attrs, {
    constructor: "ctor",
    ["__proto__"]: "literal",
    toString: "method",
  });
});

check("distinct colonized Hson attribute names remain distinct", () => {
  assert.deepEqual(authored_node(`<tag data:a="1" data:A="2"/>`).$_attrs, {
    "data:a": "1",
    "data:A": "2",
  });
});

check("quoted Hson attributes decode every JSON simple escape", () => {
  const cases = [
    [String.raw`\"`, `"`],
    [String.raw`\\`, `\\`],
    [String.raw`\/`, `/`],
    [String.raw`\b`, `\b`],
    [String.raw`\f`, `\f`],
    [String.raw`\n`, `\n`],
    [String.raw`\r`, `\r`],
    [String.raw`\t`, `\t`],
  ] as const;
  for (const [spelling, expected] of cases) {
    assert.equal(authored_attr(`<tag value="${spelling}"/>`), expected, spelling);
  }
});

check("quoted Hson attributes decode JSON unicode escapes", () => {
  assert.equal(authored_attr(String.raw`<tag value="\u0041\u03A9"/>`), "AΩ");
});

for (const [name, spelling] of [
  ["unknown q", String.raw`\q`],
  ["unknown v", String.raw`\v`],
  ["zero", String.raw`\0`],
  ["hex", String.raw`\x41`],
  ["incomplete unicode", String.raw`\u12`],
  ["malformed unicode", String.raw`\uZZZZ`],
] as const) {
  check(`quoted Hson attributes reject invalid JSON escape: ${name}`, () => {
    assert_authored_rejection(`<tag value="${spelling}"/>`, "[invalid-json-escape]");
    if (name === "unknown q") {
      assert.throws(
        () => hsonTransform.fromHson(`<tag value="${spelling}"/>`).toNode(),
        /\[invalid-json-escape\]/,
      );
    }
  });
}

check("ordinary strings reject raw C0 controls except physical line endings and tabs", () => {
  for (let codePoint = 0; codePoint <= 0x1f; codePoint += 1) {
    if ([9, 10, 13].includes(codePoint)) continue;
    const control = String.fromCharCode(codePoint);
    expect_transform_error(`"${control}"`, "HSON_STRING_CONTROL_UNESCAPED", {
      index: 1,
      line: 1,
      column: 2,
    });
  }
});

check("strict quoted control rejection is identical in object array element-content and attribute contexts", () => {
  for (const source of [
    `<value "a\fb">`,
    `["a\bb"]`,
    `<e "a\u0001b"/>`,
    `<e value="a\fb"/>`,
  ]) {
    expect_transform_error(source, "HSON_STRING_CONTROL_UNESCAPED");
  }
});

check("single-quoted names reject raw controls trailing escapes and unterminated spellings", () => {
  for (let codePoint = 0; codePoint <= 0x1f; codePoint += 1) {
    expect_transform_error(`<'a${String.fromCharCode(codePoint)}b' 1>`, "HSON_NAME_CONTROL_UNESCAPED");
  }
  expect_transform_error(`<'name${"\\"}`, "invalid-name-escape");
  expect_transform_error(`<'name 1>`, "HSON_NAME_UNTERMINATED");
});

check("empty decoded names are accepted only for object-member keys", () => {
  const graph = parse_hson(`<'' 1>`);
  assert.equal(authored_node(`<'' 1>`).$_tag, "");
  assert.equal(serialize_hson(detach_hson_root_value(graph), { noBreak: true }), `<'' 1>`);
  expect_transform_error(`<''/>`, "HSON_ELEMENT_NAME_REQUIRED");
  expect_transform_error(`<e ''/>`, "HSON_NAME_INVALID_START");
  expect_transform_error(`<e ''="value"/>`, "HSON_NAME_INVALID_START");
});

check("authored trivia is exactly SPACE HT LF CR and their ordinary combinations", () => {
  for (const trivia of [" ", "\t", "\n", "\r", "\r\n", " \t\r\n "]) {
    assert.deepEqual(parse_hson(`${trivia}42${trivia}`), parse_hson(`42`));
  }
  for (const source of [`42//eof`, `42//lf\n`, `42//cr\r`, `42//crlf\r\n`]) {
    assert.deepEqual(parse_hson(source), parse_hson(`42`));
  }
  expect_transform_error(`//comment`, "HSON_SOURCE_EMPTY");
});

check("unsupported whitespace and block comments reject with lexical identities", () => {
  for (const whitespace of ["\v", "\f", "\u0085", "\u00a0", "\u2028", "\u2029"]) {
    expect_transform_error(`${whitespace}42`, "HSON_UNSUPPORTED_WHITESPACE", {
      index: 0,
      line: 1,
      column: 1,
    });
  }
  expect_transform_error(`/* comment */42`, "HSON_BLOCK_COMMENT_UNSUPPORTED", {
    index: 0,
    line: 1,
    column: 1,
  });
});

check("primitive-looking element names are flags before content and header errors after content", () => {
  for (const name of ["true", "false", "null"]) {
    assert.deepEqual(authored_node(`<input ${name}/>`).$_attrs, { [name]: name });
  }
  assert.deepEqual(authored_node(`<input true false null/>`).$_attrs, {
    true: "true",
    false: "false",
    null: "null",
  });
  assert.deepEqual(authored_node(`<input true="true" false="false" null="null"/>`).$_attrs, {
    true: "true",
    false: "false",
    null: "null",
  });
  expect_transform_error(`<input "content" true/>`, "HSON_ELEMENT_HEADER_AFTER_CONTENT");
  expect_transform_error(`<a 1/>`, "HSON_ELEMENT_TYPED_CONTENT_FORBIDDEN", {
    index: 3,
    line: 1,
    column: 4,
  });
});

check("authoritative error precedence keeps lexical and grammar ownership", () => {
  expect_transform_error(`<a>`, "missing-object-member-value", { index: 1, line: 1, column: 2 });
  expect_transform_error(`<a 1b 2>`, "HSON_NUMBER_TRAILING_JUNK", { index: 3, line: 1, column: 4 });
  expect_transform_error(`</>`, "HSON_ELEMENT_NAME_REQUIRED", { index: 0, line: 1, column: 1 });
  expect_transform_error(`<e / >`, "HSON_ELEMENT_CLOSER_MALFORMED", { index: 3, line: 1, column: 4 });
});

check("numeric lexical branches have stable structured identities", () => {
  for (const [source, code] of [
    [`1.`, "HSON_NUMBER_INCOMPLETE_FRACTION"],
    [`.5`, "HSON_NUMBER_INCOMPLETE_FRACTION"],
    [`1e`, "HSON_NUMBER_INCOMPLETE_EXPONENT"],
    [`1e+`, "HSON_NUMBER_INCOMPLETE_EXPONENT"],
    [`--1`, "HSON_NUMBER_INVALID_SIGN"],
    [`+-1`, "HSON_NUMBER_INVALID_SIGN"],
    [`1a`, "HSON_NUMBER_TRAILING_JUNK"],
    [`0x10`, "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    [`1_0`, "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    [`NaN`, "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    [`Infinity`, "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    [`1e309`, "HSON_NUMBER_NONFINITE"],
  ] as const) {
    expect_transform_error(source, code);
  }
});

check("JSON-number tokens retain every settled accepted lexical branch", () => {
  for (const source of [
    "0",
    "-0",
    "1",
    "-1",
    "42",
    "0.5",
    "-0.5",
    "1e3",
    "1E3",
    "1e+3",
    "1e-3",
    "1.7976931348623157e308",
    "5e-324",
  ] as const) {
    assert.deepEqual(token_summary(tokenize_hson(source)), [{ kind: "TEXT", raw: source }]);
  }
});

check("leading-zero defects belong to the second integer digit", () => {
  for (const [source, expectedSource] of [
    ["01", { index: 1, line: 1, column: 2 }],
    ["00", { index: 1, line: 1, column: 2 }],
    ["-01", { index: 2, line: 1, column: 3 }],
  ] as const) {
    expect_transform_error(source, "HSON_NUMBER_LEADING_ZERO", expectedSource);
  }
});

check("leading-plus defects belong to the initial sign while exponent plus remains valid", () => {
  for (const source of ["+1", "+0", "+1.5", "+1e3"] as const) {
    expect_transform_error(source, "HSON_NUMBER_LEADING_PLUS", {
      index: 0,
      line: 1,
      column: 1,
    });
  }
  assert.deepEqual(parse_hson("1e+3"), parse_hson("1000"));
});

check("numeric spelling owns root object and array precedence without changing contextual names", () => {
  expect_transform_error("01 2", "HSON_NUMBER_LEADING_ZERO", { index: 1, line: 1, column: 2 });
  expect_transform_error("<n 01>", "HSON_NUMBER_LEADING_ZERO", { index: 4, line: 1, column: 5 });
  expect_transform_error("[+1]", "HSON_NUMBER_LEADING_PLUS", { index: 1, line: 1, column: 2 });
  assert.deepEqual(parse_hson("<n 1e+3>"), parse_json({ n: 1000 }));
  assert.deepEqual(parse_hson("[1e-3]"), parse_json([0.001]));
  assert.deepEqual(parse_hson("<'01' 1 '+1' 2>"), parse_json({ "01": 1, "+1": 2 }));
});

check("array comma closer and container failures have stable identities", () => {
  assert.deepEqual(parse_hson(`[1,2,]`), parse_hson(`«1,2,»`));
  assert.equal(
    serialize_hson(detach_hson_root_value(parse_hson(`[1,2,]`)), { noBreak: true }),
    `«1,2»`,
  );
  for (const [source, code] of [
    [`[,]`, "HSON_ARRAY_COMMA_EXTRA"],
    [`[1,,]`, "HSON_ARRAY_ITEM_MISSING"],
    [`[1,,2]`, "HSON_ARRAY_ITEM_MISSING"],
    [`«1,,»`, "HSON_ARRAY_ITEM_MISSING"],
    [`[1 2]`, "HSON_ARRAY_COMMA_MISSING"],
    [`[1»`, "HSON_ARRAY_CLOSER_MISMATCH"],
    [`«1]`, "HSON_ARRAY_CLOSER_MISMATCH"],
    [`[1`, "HSON_CONTAINER_UNTERMINATED"],
  ] as const) {
    expect_transform_error(source, code);
  }
});

check("duplicate declarations expose primary and related source positions structurally", () => {
  const objectError = expect_transform_error(`<a 1 a 2>`, "HSON_OBJECT_DUPLICATE_MEMBER", {
    index: 5,
    line: 1,
    column: 6,
  });
  assert.deepEqual(objectError.related, [{
    role: "first-declaration",
    source: { index: 1, line: 1, column: 2 },
  }]);

  const attrError = expect_transform_error(`<e x="1" x="2"/>`, "HSON_ELEMENT_DUPLICATE_ATTRIBUTE", {
    index: 9,
    line: 1,
    column: 10,
  });
  assert.deepEqual(attrError.related, [{
    role: "first-declaration",
    source: { index: 3, line: 1, column: 4 },
  }]);
});

check("quote defects retain distinct structured identities", () => {
  expect_transform_error(`'x'`, "HSON_QUOTE_KIND_UNSUPPORTED");
  expect_transform_error(`"x'`, "HSON_QUOTE_BOUNDARY_MISMATCH");
  expect_transform_error(`"x`, "HSON_STRING_UNTERMINATED");
  expect_transform_error(`<e x='v'/>`, "HSON_QUOTE_KIND_UNSUPPORTED");
  expect_transform_error(`<e x="bad\\q"/>`, "invalid-json-escape");
});

check("object and root grammar defects expose their stable identities", () => {
  for (const [source, code] of [
    [`<a"x">`, "HSON_REQUIRED_TRIVIA_MISSING"],
    [`<a 1 2 3>`, "HSON_OBJECT_EXTRA_VALUE"],
    [`<a 1, b 2>`, "HSON_OBJECT_COMMA_FORBIDDEN"],
    [`<a title="x" "v">`, "HSON_OBJECT_ATTRIBUTE_FORBIDDEN"],
    [`<a flag>`, "HSON_OBJECT_FLAG_FORBIDDEN"],
    [`<a @000000001 1>`, "HSON_OBJECT_QUID_FORBIDDEN"],
    [`<a hson:index="0">`, "HSON_AUTHORED_METADATA_FORBIDDEN"],
    [`<<a 1>>`, "legacy-doubled-object-syntax"],
    [`<a 1><b 2>`, "HSON_LEGACY_ADJACENT_OBJECT"],
    [`42 true`, "HSON_ROOT_MULTIPLE_VALUES"],
    [`<a/><b 2>`, "HSON_ROOT_MIXED_MODES"],
    [`42>`, "HSON_TRAILING_SOURCE"],
  ] as const) {
    expect_transform_error(source, code);
  }
});

check("element grammar and mode defects expose their stable identities", () => {
  for (const [source, code] of [
    [`<e x=/>`, "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID"],
    [`<e "x" late/>`, "HSON_ELEMENT_HEADER_AFTER_CONTENT"],
    [`<e @/>`, "HSON_ELEMENT_QUID_INVALID"],
    [`<e @000000001 @000000002/>`, "HSON_ELEMENT_QUID_INVALID"],
    [`<e <b 1>/>`, "HSON_STRUCTURAL_MODE_CROSSING"],
    [`<e [1]/>`, "HSON_STRUCTURAL_MODE_CROSSING"],
    [`[<e/>]`, "HSON_STRUCTURAL_MODE_CROSSING"],
  ] as const) {
    expect_transform_error(source, code);
  }
});

check("accepted colon and dot bare names canonicalize through serializer-owned quoted spellings", () => {
  for (const [source, canonical, decoded] of [
    [`<:x 1>`, `<':x' 1>`, ":x"],
    [`<a:b 1>`, `<'a:b' 1>`, "a:b"],
    [`<a.b 1>`, `<'a.b' 1>`, "a.b"],
  ] as const) {
    const graph = parse_hson(source);
    assert.equal(authored_node(source).$_tag, decoded);
    assert.equal(serialize_hson(detach_hson_root_value(graph), { noBreak: true }), canonical);
    assert.deepEqual(parse_hson(canonical), graph);
  }
});

check("object member content order survives parse serialize reparse and canonical equality", () => {
  const source = `<first 1 second 2 third 3>`;
  const parsed = parse_hson(source);
  const object = parsed.$_content[0];
  assert.ok(is_Node(object));
  assert.deepEqual(object.$_content.map((item) => is_Node(item) ? item.$_tag : item), [
    "first",
    "second",
    "third",
  ]);
  const serialized = serialize_hson(detach_hson_root_value(parsed), { noBreak: true });
  assert.equal(serialized, source);
  assert.deepEqual(parse_hson(serialized), parsed);
  assert.notDeepEqual(parse_hson(`<second 2 first 1 third 3>`), parsed);
});

check("quoted Hson attributes reject a trailing escape without discarding its slash", () => {
  assert_authored_rejection(`<tag value="bad${"\\"}`, "[invalid-json-escape]");
});

check("content strings decode every JSON escape and unicode spelling", () => {
  const cases = [
    [String.raw`\"`, `"`],
    [String.raw`\\`, `\\`],
    [String.raw`\/`, `/`],
    [String.raw`\b`, `\b`],
    [String.raw`\f`, `\f`],
    [String.raw`\n`, `\n`],
    [String.raw`\r`, `\r`],
    [String.raw`\t`, `\t`],
    [String.raw`\u0041`, `A`],
  ] as const;
  for (const [spelling, expected] of cases) {
    assert.equal(authored_content(`<tag "${spelling}"/>`), expected, spelling);
  }
});

for (const [name, spelling] of [
  ["unknown", String.raw`\q`],
  ["incomplete unicode", String.raw`\u12`],
  ["malformed unicode", String.raw`\uZZZZ`],
] as const) {
  check(`content strings reject invalid JSON escape: ${name}`, () => {
    assert_authored_rejection(`<tag "${spelling}"/>`, "[invalid-json-escape]");
  });
}

check("content strings reject a trailing escape", () => {
  assert_authored_rejection(`<tag "bad${"\\"}`, "[invalid-json-escape]");
});

for (const [name, source, expected] of [
  ["escaped apostrophe", "<'don\\'t' 1>", "don't"],
  ["literal backtick", "<'tick`name' 1>", "tick`name"],
  ["escaped backslash", "<'back\\\\slash' 1>", "back\\slash"],
  ["backspace escape", "<'back\\bspace' 1>", "back\bspace"],
  ["form-feed escape", "<'form\\ffeed' 1>", "form\ffeed"],
  ["newline escape", "<'line\\nname' 1>", "line\nname"],
  ["carriage-return escape", "<'line\\rname' 1>", "line\rname"],
  ["tab escape", "<'line\\tname' 1>", "line\tname"],
  ["four-digit Unicode control escape", "<'control\\u0001name' 1>", "control\u0001name"],
  ["ordinary Unicode", "<'λ漢😀' 1>", "λ漢😀"],
  ["literal forward slash", "<'path/name' 1>", "path/name"],
] as const) {
  check(`single-quoted Hson names accept ${name}`, () => {
    assert.equal(authored_node(source).$_tag, expected);
    const graph = parse_hson(source);
    assert.deepEqual(parse_hson(serialize_hson(detach_hson_root_value(graph))), graph);
  });
}

for (const [name, spelling] of [
  ["unknown", String.raw`\q`],
  ["incomplete unicode", String.raw`\u12`],
  ["malformed unicode", String.raw`\uZZZZ`],
  ["escaped forward slash", String.raw`\/`],
  ["zero", String.raw`\0`],
  ["hex", String.raw`\x41`],
] as const) {
  check(`single-quoted Hson names reject restricted escape: ${name}`, () => {
    assert_authored_rejection(`<'name${spelling}' 1>`, "[invalid-name-escape]");
  });
}

const malformed = [
  [`unterminated string`, `<tag "value/>`],
  [`unterminated quoted key`, `<'tag "value">`],
  [`unterminated tag`, `<tag`],
  [`unterminated array`, `<items [1, 2>`],
  [`single-quoted content`, `<tag 'value'/>`],
  [`single-quoted attribute`, `<tag attr='value'/>`],
  [`attribute after content`, `<tag "content" attr="late"/>`],
  [`flag after content`, `<tag "content" late/>`],
  [`mismatched bracket array`, `[1, 2»`],
  [`mismatched guillemet array`, `«1, 2]`],
  [`missing array comma`, `[1 2]`],
  [`missing array item`, `[1,,2]`],
  [`invalid implicit-object closer`, `<<tag "value">/>`],
  [`unexpected closer`, `>`],
];

for (const [name, source] of malformed) {
  check(`rejects malformed input: ${name}`, () => {
    assert.throws(() => tokenize_hson(source));
  });
}

check("malformed content escape still fails at the parse boundary", () => {
  assert.throws(() => parse_hson(`<tag "bad\\qescape"/>`));
});

check("adjacent authored element text items remain distinct and ordered", () => {
  const values = (source: string): unknown[] => {
    const node = authored_node(source);
    const cluster = node.$_content[0];
    assert.ok(is_Node(cluster));
    return cluster.$_content.map((leaf) => {
      assert.ok(is_Node(leaf));
      assert.equal(leaf.$_tag, "_hson_str");
      return leaf.$_content[0];
    });
  };
  assert.deepEqual(values(`<div "a" "b"/>`), ["a", "b"]);
  assert.deepEqual(values(`<div """"""/>`), ["", "", ""]);
});

check("bare object members may touch only structural value openers", () => {
  for (const [compact, readable] of [
    ['<content<id "intro">>', '<content <id "intro">>'],
    ['<content<>>', '<content <>>'],
    ['<blocks«<id "intro">, 2»>', '<blocks «<id "intro">, 2»>'],
    ['<blocks[<id "intro">, 2]>', '<blocks [<id "intro">, 2]>'],
    ['<type "data" defs<Item<content<id "string">>> content<array<ref "Item">>>',
     '<type "data" defs <Item <content <id "string">>> content <array <ref "Item">>>'],
  ]) {
    assert.deepEqual(parse_hson(compact), parse_hson(readable));
    assert.deepEqual(parse_tokens(tokenize_hson(compact)), parse_hson(readable));
    const wire = serialize_hson(detach_hson_root_value(parse_hson(compact)));
    assert.ok(!/content<|blocks[«\[]|array<|defs<|Item</.test(wire));
    assert.deepEqual(parse_hson(wire), parse_hson(readable));
  }
});
check("structural adjacency does not relax quoted names, scalars, attributes or sibling boundaries", () => {
  for (const source of ['<name"value">', "<'name'<>>", "<'name'«1»>", '<name=1>', '<name+1>',
    '<content<id 1>next 2>', '<blocks«1 2»>', '<content<id 1/> >', '<p title<id 1>/>']) {
    assert.throws(() => tokenize_hson(source), source);
    assert.throws(() => parse_hson(source), source);
  }
});

check("caret structural references use the authored header path and reject old hash spelling", () => {
  const structural = authored_node('<hson-part part:optional ^{control}/>');
  assert.deepEqual(structural.$_attrs, { 'part:optional': 'part:optional', '^{control}': '^{control}' });
  const old = '<hson-part #{control}/>';
  const error = expect_transform_error(old, 'HSON_PART_REFERENCE_INVALID', { index: 11, line: 1, column: 12 });
  assert.match(error.message, /Local Part references use \^\{/);
  for (const source of ['<p ^{control}/>', '<hson-part^{control}/>', '<hson-part ^{control.path}/>']) assert.throws(() => parse_hson(source));
  // Reference-looking payloads remain strings in ordinary Documents and Data.
  assert.equal(authored_content('<p "#{old} ^{local} %{incoming}"/>'), '#{old} ^{local} %{incoming}');
  assert.deepEqual(parse_hson('<value "#{old} ^{local} %{incoming}">'), parse_json({ value: '#{old} ^{local} %{incoming}' }));
});

let quotingChecks = 0;
check("authored attribute quoting contract in Node", () => { quotingChecks = run_attribute_quoting_cases(); });
const workerQuotingChecks = await new Promise<number>((resolve, reject) => {
  const worker = repository_typescript_worker(new URL("./fixtures/hson-attribute-quoting.worker.mts", import.meta.url));
  worker.once("message", resolve);
  worker.once("error", reject);
  worker.once("exit", code => { if (code !== 0) reject(new Error(`Attribute quoting Worker exited with ${code}`)); });
});
check("authored attribute quoting contract in Worker", () => { assert.equal(workerQuotingChecks, quotingChecks); });
process.stdout.write(`# ${checks} Hson tokenizer checks passed (${quotingChecks} quoting checks per runtime)\n`);
testEvents.terminal("pass");

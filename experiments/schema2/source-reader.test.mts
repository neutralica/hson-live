import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HsonDataValue } from "../../src/api/data/hson-data.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { HsonSchema, compiled_hson_schema_of, hson_schema_digest } from "../../src/api/schema/hson-schema.js";
import { read_transform_error_details } from "../../src/core/errors.js";
import { parse_canonical_hson_data, serialize_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { ordered_projected_value_equal } from "../../src/core/ordered-projected-value.js";
import { schema_definition_identity } from "../../src/internal/hson-schema/definition-identity.js";
import { compile_schema_source } from "./compile-source.js";
import { corpus } from "./corpus-goldens.js";
import { SchemaLoweringError } from "./lower-definition.js";
import { read_schema_source, SchemaSourceError, type ReadSchemaSource } from "./source-reader.js";
import { data, declarations, members, object, optional, str } from "./structural-fixtures.js";
import { application_name, header, is_schema_occurrence, type SchemaOrigin } from "./structure.js";

function authored(id: string) {
  return readFileSync(new URL(`./authored/${id}.hson`, import.meta.url), "utf8");
}

const field = (expr: string) => `<data [<members <'v' ${expr}>>]>`;

function assertOwned(read: ReadSchemaSource, source: string) {
  const seen = new Set<SchemaOrigin>();
  function walk(record: SchemaOrigin, start: number, end: number) {
    assert.ok(!seen.has(record), "each physical occurrence has one identity");
    seen.add(record);
    const range = read.rangeOf(record);
    assert.ok(range && start <= range.start && range.start < range.end && range.end <= end);
    assert.ok(Object.isFrozen(record));
    assert.equal(Object.getPrototypeOf(record), null);
    let next = range.start;
    function child(item: SchemaOrigin) {
      walk(item, next, range!.end);
      next = read.rangeOf(item)!.end;
    }
    if (is_schema_occurrence(record)) {
      assert.equal(source[range.start], "<");
      assert.equal(source[range.end - 1], ">");
      assert.ok(Object.isFrozen(record.headers));
      record.headers.forEach(child);
      if (record.body !== undefined) child(record.body);
    } else if (record.kind === "group" || record.kind === "members") {
      const list = record.kind === "group" ? record.items : record.entries;
      assert.ok(Object.isFrozen(list));
      list.forEach(child);
    } else if (record.kind === undefined && typeof record.operand === "object") {
      child(record.operand);
    }
  }
  walk(read.root, 0, source.length);
}

function compare(source: string, schema1: string) {
  const result = compile_schema_source(source);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result.issues));
  assertOwned(result, source);
  const expected = HsonSchema.fromHson(schema1);
  const before = compiled_hson_schema_of(expected);
  assert.ok(ordered_projected_value_equal(result.orderedDefinition, before.orderedDefinition));
  assert.ok(ordered_projected_value_equal(result.compiled.orderedDefinition, before.orderedDefinition));
  assert.equal(result.schema1Source, serialize_canonical_hson_data(before.orderedDefinition));
  assert.deepEqual(schema_definition_identity(result.compiled), schema_definition_identity(before));
  assert.deepEqual(result.compiled.graph, before.graph);
  const actual = HsonSchema.fromHson(result.schema1Source);
  assert.equal(actual.toHson(), expected.toHson());
  return { ...result, actual, expected };
}

function certify(schema: HsonSchema, source: string) {
  const candidate = HsonDataValue.fromSource(source);
  try {
    return { ok: true, text: schema.certify(candidate).toHson() } as const;
  } catch (error) {
    if (!(error instanceof HsonSchemaError)) throw error;
    return { ok: false, issues: error.issues } as const;
  }
}

test("authored D02 excerpt retains its ordered definition, identity and optional line2", () => {
  const result = compare(authored("D02-excerpt"), `<type "data" content <
    displayName <string <minlen 1 maxlen 80>>
    address <content <line1 "string" line2 <optional "string"> city "string">>
  >>`);
  assert.deepEqual(result.root, data(members(
    application_name("displayName", str(header("minlen", "1"), header("maxlen", "80"))),
    application_name("address", object(application_name("line1", str()),
      optional("line2", str()), application_name("city", str()))),
  )));
  assert.equal(hson_schema_digest(result.actual), "8f3020ac06b47fed396638a5e1a41e55c123502cab5e0a49188d62251b59d3ff");
  for (const [line2, ok] of [["", true], ['line2 ""', true], ["line2 null", false], ["line2 []", false]] as const) {
    const candidate = `<displayName "Mina" address <line1 "18 Cedar Lane" ${line2} city "Bristol">>`;
    const outcome = certify(result.actual, candidate);
    assert.deepEqual(outcome, certify(result.expected, candidate));
    assert.equal(outcome.ok, ok);
  }
});

for (const golden of corpus) {
  test(`authored ${golden.id} matches independent structures, Schema 1.0 identity and archived candidates`, () => {
    const result = compare(authored(golden.id), golden.schema);
    assert.equal(hson_schema_digest(result.actual), golden.digest);
    assert.deepEqual(result.root, declarations[golden.id]);
    if (golden.id === "D09") assert.equal(result.compiled.recursiveSccCount, 1);

    function check(candidate: string, accept: boolean, expectedIssue?: Readonly<Record<string, unknown>>) {
      const outcome = certify(result.actual, candidate);
      assert.deepEqual(outcome, certify(result.expected, candidate));
      assert.equal(outcome.ok, accept);
      if (outcome.ok) assert.equal(outcome.text, HsonDataValue.fromSource(candidate).toHson());
      else if (expectedIssue) {
        const first: Readonly<Record<string, unknown>> = outcome.issues[0];
        for (const [key, value] of Object.entries(expectedIssue)) assert.deepEqual(first[key], value);
      }
    }
    check(golden.valid, true);
    check(golden.invalid, false, golden.expected);
    for (const mutation of golden.mutations) {
      assert.ok(golden.valid.includes(mutation.from), mutation.label);
      check(golden.valid.replace(mutation.from, mutation.to), mutation.accept, mutation.expected);
    }
  });
}

test("repeated contentless numbers have independent positions in both HSON array spellings", () => {
  for (const [open, close] of [["[", "]"], ["«", "»"]]) {
    const source = `// 🧭\r\n<data [<members <'position' <tuple ${open}<number>, // > ]\r\n <number>,${close}>>>]>`;
    const result = compare(source, '<type "data" content <position <tuple ["number","number"]>>>');
    const group = result.originAt(["content", "position", "tuple"]);
    assert.ok(group.kind === "group");
    assert.equal(group.items.length, 2);
    assert.notEqual(group.items[0], group.items[1]);
    for (const [i, item] of group.items.entries()) {
      assert.ok(is_schema_occurrence(item));
      assert.equal(item.kind, "operation");
      assert.equal(item.name, "number");
      assert.ok(!Object.hasOwn(item, "body"));
      assert.equal(result.originAt(["content", "position", "tuple", i]), item);
      const start = i === 0 ? source.indexOf("<number>") : source.lastIndexOf("<number>");
      assert.deepEqual(result.rangeOf(item), { start, end: start + "<number>".length });
    }
    for (const [items, ok] of [["[1,2]", true], ["[1]", false], ['[1,"2"]', false], ["[1,2,3]", false]] as const) {
      assert.equal(certify(result.actual, `<position ${items}>`).ok, ok);
    }
  }
});

function rejection(source: string, code: string, fragment: string, message?: RegExp) {
  assert.throws(() => compile_schema_source(source), error => {
    assert.ok(error instanceof SchemaSourceError, String(error));
    assert.equal(error.code, code, source);
    assert.equal(source.slice(error.range.start, error.range.end), fragment, source);
    if (code === "SCHEMA_LOWERING") {
      assert.ok(error.cause instanceof SchemaLoweringError);
      assert.equal(error.origin, error.cause.origin);
    }
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("explicit member, object and ref root roles retain opposite certification witnesses", () => {
  const member = "<'content' <exact \"string\">>";
  rejection(`<data [<members ${member}>]>`, "SCHEMA_LOWERING", member, /Ambiguous direct root/);
  const optionalMember = "<'content' optional <string>>";
  rejection(`<data [<members ${optionalMember}>]>`, "SCHEMA_LOWERING", optionalMember, /Ambiguous direct root/);
  compare("<data [<members <'content' <string>>>]>", '<type "data" content <content "string">>');
  compare("<data [<members <'ref' <number>> <'content' <string>>>]>", '<type "data" content <ref "number" content "string">>');
  const first = compare("<data [<object <'exact' <string>>>]>", '<type "data" content <content <exact "string">>>');
  const second = compare(`<data [<object ${member}>]>`, '<type "data" content <content <content <exact "string">>>>');
  const defs = "<defs <'string' <number>>>";
  const refMember = "<'ref' <string>>";
  rejection(`<data [${defs}, <members ${refMember}>]>`, "SCHEMA_LOWERING", refMember, /Ambiguous direct root/);
  const third = compare(`<data [${defs}, <ref "string">]>`, '<type "data" defs <string "number"> content <ref "string">>');
  const fourth = compare(`<data [${defs}, <object ${refMember}>]>`, '<type "data" defs <string "number"> content <content <ref "string">>>');
  for (const [left, right, yes, no] of [
    [first, second, '<exact "abc">', '<content "string">'],
    [third, fourth, "2", '<ref "P">'],
  ] as const) {
    assert.notEqual(hson_schema_digest(left.actual), hson_schema_digest(right.actual));
    for (const [candidate, ok] of [[yes, true], [no, false]] as const) {
      assert.equal(certify(left.actual, candidate).ok, ok);
      assert.equal(certify(right.actual, candidate).ok, !ok);
    }
  }
});

test("absent root, empty maps and explicit any retain five identities", () => {
  const digests = [
    ["<data>", '<type "data">'],
    ["<data [<any>]>", '<type "data" content "any">'],
    ["<data [<defs <>>]>", '<type "data" defs <>>'],
    ["<data [<members < // empty map\n >>]>", '<type "data" content <>>'],
    ["<data [<object <>>]>", '<type "data" content <content <>>>'],
  ].map(([source, expected]) => hson_schema_digest(compare(source, expected).actual));
  assert.equal(new Set(digests).size, 5);
});

test("explicit literal bodies keep null, empty Data object, empty Data array and empty string", () => {
  assert.ok(!Object.hasOwn(read_schema_source("<x>").root, "body"));
  for (const literal of ["null", "<>", "[]", '""']) {
    const read = read_schema_source(`<x ${literal}>`);
    assert.deepEqual(read.root.headers, []);
    const body = read.root.body;
    assert.ok(body?.kind === "value");
    assert.ok(ordered_projected_value_equal(body.value, parse_canonical_hson_data(literal)));
    assert.deepEqual(read.rangeOf(body), { start: 3, end: 3 + literal.length });
    rejection(field(`<number ${literal}>`), "SCHEMA_LOWERING", literal, /absent content/);
    const result = compile_schema_source(field(`<exact ${literal}>`));
    assert.equal(result.ok, literal === "null" || literal === '""');
    assert.ok(ordered_projected_value_equal(result.orderedDefinition,
      parse_canonical_hson_data(`<type "data" content <v <exact ${literal}>>>`)));
  }
  compare(field("<tuple []>"), '<type "data" content <v <tuple []>>>');
  rejection(field("<tuple>"), "SCHEMA_LOWERING", "<tuple>");
  rejection(field("<object>"), "SCHEMA_LOWERING", "<object>");
});

test("quoted application names and header operands use HSON escaping and exact source order", () => {
  const source = String.raw`<data [<members
    <'obj\u0065ct' <object <'O\'Brien' optional <string contains="// >" suffix="\uD83C\uDF4E\t">>>>
    <'2' <number over="-1e2" int min="-0">>
    <'__proto__' <exact -0>>
  >]>`;
  const result = compare(source, String.raw`<type "data" content <
    object <content <'O\'Brien' <optional <string <contains "// >" suffix "🍎\t">>>>>
    '2' <number <over -100 int true min -0>>
    __proto__ <exact -0>
  >>`);
  const number = result.originAt(["content", "2"]);
  assert.ok(is_schema_occurrence(number));
  assert.deepEqual(number.headers.map(h => [h.name, h.operand]), [["over", "-1e2"], ["int", undefined], ["min", "-0"]]);
  const a = compare(field("<exact -0>"), '<type "data" content <v <exact -0>>>');
  const b = compare(field("<exact 0>"), '<type "data" content <v <exact 0>>>');
  assert.notEqual(hson_schema_digest(a.actual), hson_schema_digest(b.actual));
  assert.equal(certify(a.actual, "<v -0>").ok, true);
  assert.equal(certify(a.actual, "<v 0>").ok, false);
  for (const name of ["defs", "members", "object", "tuple", "exact", "ref", "data"]) {
    const read = read_schema_source(`<'${name}' <string>>`);
    assert.equal(read.root.kind, "name");
    assert.ok(read.root.body?.kind === "operation" && read.root.body.name === "string");
  }
});

test("bounded Data retains escaped delimiters, multiline strings, signed zero and ordered uniqueness rows", () => {
  const literal = '"\r\n    a >\r\n    b // ]\r\n  "';
  compare(field(`<exact ${literal}>`), '<type "data" content <v <exact "a >\\nb // ]">>>');
  const config = '<cases «[0,[0]], [-0,[-0]], ["} // >",[]],» by "slot">';
  const expr = `<array unique = { // }\r\n ${config} // ignore }\r\n} <object <'slot' <any>>>>`;
  const result = compare(field(expr), `<type "data" content <v <array <content <content <slot "any">> unique ${config}>>>>`);
  const flag = result.originAt(["content", "v", "array", "unique"]);
  assert.ok(flag.kind === undefined && typeof flag.operand === "object");
  const range = result.rangeOf(flag.operand)!;
  assert.equal(field(expr).slice(range.start, range.end), config);
  assert.equal(certify(result.actual, "<v [<slot 0>,<slot -0>]>").ok, true);
  assert.equal(certify(result.actual, "<v [<slot -0>,<slot -0>]>").ok, false);
});

test("collection headers retain the authored field order after generated content", () => {
  const number = '<number over="-1" under="2">';
  const a = compare(field('<array unique len="2" ' + number + '>'),
    '<type "data" content <v <array <content <number <over -1 under 2>> unique true len 2>>>>');
  const b = compare(field('<array len="2" unique ' + number + '>'),
    '<type "data" content <v <array <content <number <over -1 under 2>> len 2 unique true>>>>');
  assert.notEqual(hson_schema_digest(a.actual), hson_schema_digest(b.actual));
  compare(field('<tuple minlen="2" [<exact true>, <exact false>]>'),
    '<type "data" content <v <tuple <content [<exact true>, <exact false>] minlen 2>>>>');
});

test("duplicate names and headers are distinct physical records through semantic rejection", () => {
  for (const [source, fragment] of [
    ["<data [<members <'v' <number>> <'v' <number>>>]>", "<'v' <number>>"],
    ["<data [<defs <'T' <string>> <'T' <string>>>]>", "<'T' <string>>"],
    [field('<number int int>'), "int"],
    [field('<number min="1" min="1">'), 'min="1"'],
  ]) {
    const read = read_schema_source(source);
    assertOwned(read, source);
    assert.throws(() => compile_schema_source(source), error => {
      assert.ok(error instanceof SchemaSourceError && error.cause instanceof SchemaLoweringError);
      assert.match(error.message, /Duplicate/);
      const start = source.lastIndexOf(fragment);
      assert.deepEqual(error.range, { start, end: start + fragment.length });
      return true;
    });
  }
});

test("governed roles and bad operands reject at the authored occurrence", () => {
  for (const [source, fragment] of [
    [field("<future>"), "<future>"], [field('<number future="2">'), 'future="2"'],
    [field("<number int={true}>"), "int={true}"], [field('<number min="01">'), 'min="01"'],
    [field("<string len>"), "len"], [field('<null optional>'), "optional"],
    [field("<array unique={false} <any>>"), "false"], [field("<union <number>>"), "<number>"],
    [field("<tuple [<'number'>]>"), "<'number'>"], [field("<array []>"), "[]"],
    [field("<object []>"), "[]"], [field("<ref>"), "<ref>"],
    ["<data []>", "[]"], ["<data <members <>>>", "<members <>>"],
    ["<data [<ref \"R\">, <defs <>>]>", "<defs <>>"],
    ["<data [<any>, <any>]>", "<any>"], ["<data [<'object'>]>", "<'object'>"],
    ["<data [<number>]>", "<number>"], ["<document>", "<document>"],
    ["<data [<members <number>>]>", "<number>"],
    ["<data [<defs <'T' optional <number>>>]>", "optional"],
    ["<data [<members <'n' optional optional <number>>>]>", "optional"],
    ["<data [<members <'$_reserved' <number>>>]>", "<'$_reserved' <number>>"],
  ]) rejection(source, "SCHEMA_LOWERING", fragment);
});

test("syntax rejects incomplete, malformed, unaccounted or trailing input", () => {
  const sources = [
    "", "// only trivia", "<data", "<data [<any>]", "<number min=", "<'unterminated>",
    String.raw`<'bad\q' <number>>`, String.raw`<'bad\u123X'>`, "<'bad\nname'>",
    String.raw`<string prefix="\x22">`, '<string prefix="raw\nline">', '<exact "bad>',
    '<"age" <number>>', "<`age` <number>>", "<number/>", "<number /*no*/>",
    "<number\u00a0int>", "<number int!>", "<number int=\"x\"min=\"0\">", "<number min=1>",
    "<number min='1'>", "<number min=^{x}>", "<number min={}>", "<number min={1 2}>",
    '<array unique={<by "a" by "b">} <any>>', '<array unique={{"by":"a"}} <any>>',
    '<array unique={<a 1>} {<b 1>} <any>>', "<exact <missing>>",
    "<exact -01>", "<exact 1e999>", "<exact true false>", '<exact null="true">',
    "<'v' <number> <string>>", "<'v' <number> optional>", "<'v' , <number>>",
    "<tuple [<number><string>]>", "<tuple «<number>]>", "<tuple [<number>»>",
    "<tuple [,<number>]>", "<tuple [<number>,,<number>]>", "<tuple [<number>,",
    "<tuple [2]>", "<tuple [@abc <number>]>", "<data [<members <> <'x' <any>>>]>",
    "<data> <data>", "<data> stray", "<data> >", "prefix <data>",
  ];
  for (const source of sources) {
    assert.throws(() => read_schema_source(source), error => {
      assert.ok(error instanceof SchemaSourceError, `${source}: ${error}`);
      assert.ok(error.range.start >= 0 && error.range.start <= error.range.end && error.range.end <= source.length);
      return true;
    }, source);
  }
  assert.throws(() => read_schema_source("<array ".repeat(300) + "<any>" + ">".repeat(300)), SchemaSourceError);
});

test("Data operand admission and expression groups account for authored identity metadata", () => {
  rejection("<tuple [@000000000 <number>]>", "HSON_ARRAY_QUID_FORBIDDEN", "@");
  rejection("<exact <@000000000>>", "PORTABLE_RUNTIME_QUID_FORBIDDEN", "@");
  rejection("<array unique={ [@000000000 2] } <any>>", "PORTABLE_RUNTIME_QUID_FORBIDDEN", "@");
  rejection("<exact [<button/>]>", "HSON_STRUCTURAL_MODE_CROSSING", "<");
});

test("UTF-16 CRLF diagnostics identify malformed name escapes and missing closers", () => {
  const source = "// 🧭\r\n<data [\r\n <members <'x\\q' <string>>>]>";
  rejection(source, "invalid-name-escape", "\\", /3:14/);
  const missing = "// 🧭\r\n  <'x' <number>";
  rejection(missing, "SCHEMA_SOURCE_SYNTAX", "<", /2:3 Missing >/);
});

test("embedded Data failures display authored coordinates and preserve the operand-relative cause", () => {
  const prefix = "// check\r\n";
  for (const [source, start, position, operandColumn] of [
    [prefix + "<exact [<p/>]>", 18, "2:9", 2],
    [prefix + field("<exact <v [<p/>]>>"), 42, "2:33", 5],
    [prefix + field('<array unique={\r\n <by "🧭" cases [[<p/>]]>\r\n} <any>>'), 66, "3:19", 18],
  ] as const) {
    assert.throws(() => compile_schema_source(source), error => {
      assert.ok(error instanceof SchemaSourceError);
      assert.equal(error.code, "HSON_STRUCTURAL_MODE_CROSSING");
      assert.deepEqual(error.range, { start, end: start + 1 });
      assert.equal(source.indexOf("<p/>"), start);
      assert.deepEqual(error.message.match(/\d+:\d+/g), [position]);
      assert.ok(error.cause instanceof Error);
      const details = read_transform_error_details(error.cause);
      assert.equal(details?.code, error.code);
      assert.deepEqual(details?.source, { index: operandColumn - 1, line: 1, column: operandColumn });
      assert.ok(error.cause.message.includes(`element-mode value at 1:${operandColumn}`));
      return true;
    });
  }
});

// The field expression starts at depth 4. Each enclosing tuple adds a declaration and an array.
function insideTuples(count: number, expression: string): string {
  return field("<tuple [".repeat(count) + expression + "]>".repeat(count));
}

for (const [expression, body] of [["<tuple []>", "[]"], ["<object <>>", "<>"]]) {
  test(`the structural body of ${expression} admits depth 255 and rejects depth 256`, () => {
    assert.ok(compile_schema_source(insideTuples(125, expression)).ok);
    const source = insideTuples(125, `<array ${expression}>`);
    assert.throws(() => compile_schema_source(source), error => {
      assert.ok(error instanceof SchemaSourceError);
      assert.equal(error.code, "HSON_NESTING_LIMIT");
      const start = source.indexOf(body);
      assert.deepEqual(error.range, { start, end: start + 1 });
      return true;
    });
  });
}

test("populated groups and maps enforce the depth of their nested declarations", () => {
  for (const expression of ["<tuple «<any>,»>", "<object <'k' <any>>>"]) {
    assert.ok(compile_schema_source(insideTuples(124, `<array ${expression}>`)).ok);
    const source = insideTuples(124, `<array <array ${expression}>>`);
    assert.throws(() => compile_schema_source(source), error => {
      assert.ok(error instanceof SchemaSourceError);
      assert.equal(error.code, "SCHEMA_SOURCE_SYNTAX");
      const start = source.indexOf("<any>");
      assert.deepEqual(error.range, { start, end: start + 1 });
      return true;
    });
  }
});

test("braced Data operands use their own HSON nesting budget", () => {
  const arrays = "[".repeat(254) + "0" + "]".repeat(254);
  const operand = `<cases ${arrays}>`;
  const source = (data: string) => `<array unique={${data}} <any>>`;
  const config = read_schema_source(source(operand)).root.headers[0].operand;
  assert.ok(typeof config === "object");
  assert.deepEqual(config.value, parse_canonical_hson_data(operand));
  rejection(source(`<cases [${arrays}]>`), "HSON_NESTING_LIMIT", "0");
});

test("compiler path and generated coverage identify the authored refinement and the nested invalid union", () => {
  const invalid = '<union [<number>, <number>]>';
  const source = `<data [<members <'items' <tuple [<union [<null>, <number>]>, ${invalid}]>>>]>`;
  const result = compile_schema_source(source);
  assert.ok(!result.ok);
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(issue.code, "INVALID_UNION");
  assert.deepEqual(issue.path, []);
  assert.equal(issue.origin, result.originAt(["content", "items", "tuple", 1]));
  assert.equal(source.slice(issue.authoredRange.start, issue.authoredRange.end), invalid);
  assert.ok(issue.range);
  assert.ok(result.schema1Source.slice(issue.range.start, issue.range.end).includes("union"));
  for (const [expr, path, code, text] of [
    ['<array <string minlen="-1">>', ["content", "v", "array", "string", "minlen"], "INVALID_SCHEMA_EXPRESSION", 'minlen="-1"'],
    ['<ref "Missing">', ["content", "v", "ref"], "INVALID_REFERENCE", '"Missing"'],
    ['<ref false>', ["content", "v", "ref"], "INVALID_REFERENCE", "false"],
    ['<array unique={<by "slot" cases [1]>} <any>>', ["content", "v", "array", "unique", "cases", 0],
      "INVALID_SCHEMA_EXPRESSION", 'unique={<by "slot" cases [1]>}'],
  ] as const) {
    const source = field(expr);
    const result = compile_schema_source(source);
    assert.ok(!result.ok);
    const [issue] = result.issues;
    assert.equal(issue.code, code);
    assert.deepEqual(issue.path, path);
    assert.equal(issue.origin, result.originAt(path));
    assert.equal(source.slice(issue.authoredRange.start, issue.authoredRange.end), text);
  }
});

test("a range-only union issue retains its generated and authored intervals", () => {
  const source = "//𝄞\r\n" + field('<tuple len="2" [<boolean>, <union [<null>, <null>]>]>');
  const result = compile_schema_source(source);
  assert.ok(!result.ok);
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(issue.code, "INVALID_UNION");
  assert.deepEqual(issue.path, []);
  assert.deepEqual(issue.range, { start: 99, end: 189 });
  assert.deepEqual(issue.authoredRange, { start: 54, end: 78 });
  assert.equal(source.slice(54, 78), "<union [<null>, <null>]>");
});

test("252 arrays reach exact operand validation and 253 own the generated nesting overflow", () => {
  const smaller = "[".repeat(252) + "0" + "]".repeat(252);
  const source = field(`<exact ${smaller}>`);
  const result = compile_schema_source(source);
  assert.ok(!result.ok);
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(issue.code, "INVALID_SCHEMA_EXPRESSION");
  assert.deepEqual(issue.path, ["content", "v"]);
  assert.match(issue.message, /finite primitive or null/);
  assert.equal(source.slice(issue.authoredRange.start, issue.authoredRange.end), `<exact ${smaller}>`);
  const literal = "[".repeat(253) + "0" + "]".repeat(253);
  const read = read_schema_source(`<exact ${literal}>`);
  assert.ok(read.root.body?.kind === "value" && Array.isArray(read.root.body.value));
  rejection(field(`<exact ${literal}>`), "SCHEMA_LOWERING", literal, /nesting depth/);
});

test("private contentless expressions do not enter ordinary Data admission", () => {
  for (const source of ["<number>", "<'age' <number>>"]) {
    assert.ok(is_schema_occurrence(read_schema_source(source).root));
    assert.throws(() => HsonDataValue.fromSource(source));
  }
});

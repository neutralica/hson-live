import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HsonDataValue } from "../../src/api/data/hson-data.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { HsonSchema, compiled_hson_schema_of, hson_schema_digest } from "../../src/api/schema/hson-schema.js";
import { read_transform_error_details } from "../../src/core/errors.js";
import { parse_canonical_hson_data, serialize_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { ordered_projected_value_equal } from "../../src/core/ordered-projected-value.js";
import { compile_hson_schema } from "../../src/internal/hson-schema/compiler.js";
import { schema_definition_identity } from "../../src/internal/hson-schema/definition-identity.js";
import { compile_schema_source } from "./compile-source.js";
import { corpus } from "./corpus-goldens.js";
import { SchemaLoweringError } from "./lower-definition.js";
import { read_schema_source, SchemaSourceError, type ReadSchemaSource } from "./source-reader.js";
import { data, declarations, object, optional, str } from "./structural-fixtures.js";
import { application_name, header, is_schema_occurrence, type SchemaOrigin } from "./structure.js";

function authored(id: string) {
  return readFileSync(new URL(`./authored/${id}.hson`, import.meta.url), "utf8");
}

const field = (expr: string) => `<data <object <'v' ${expr}>>>`;

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
      assert.equal(source[range.start], record.kind === "name" ? "'" : "<");
      if (record.kind === "operation") assert.equal(source[range.end - 1], ">");
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
  assert.deepEqual(result.root, data(object(
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

test("an ordinary closed object owns required properties and the optional refined age", () => {
  const source = `<data <object <
  'name' <string>
  'age' optional <number int min="0">
  'active' <boolean>
>>>`;
  const { actual, expected } = compare(source, '<type "data" content <name "string" age <optional <number <int true min 0>>> active "boolean">>');
  for (const [candidate, accept] of [
    ['<name "A" active false>', true], ['<name "A" age 0 active true>', true],
    ['<name "A" age -1 active true>', false], ['<name "A" age 1.5 active true>', false],
    ['<name "A">', false], ['<name "A" active true other 0>', false], ["[]", false],
  ] as const) {
    const result = certify(actual, candidate);
    assert.equal(result.ok, accept);
    assert.deepEqual(result, certify(expected, candidate));
  }
});

test("nested open objects preserve field paths and distinct compiler issue origins", () => {
  const source = `<data <object <
  'address' <object <
    'city' <string>
    'state' <string>
  >>
>>>`;
  const schema1 = '<type "data" content <address <content <city "string" state "string">>>>';
  const { actual, expected } = compare(source, schema1);
  assert.ok(certify(actual, '<address <city "Madison" state "WI">>').ok);
  for (const [candidate, key] of [
    ['<address <city 1 state "WI">>', "city"], ['<address <city "Madison">>', "state"],
  ]) {
    const result = certify(actual, candidate);
    assert.deepEqual(result, certify(expected, candidate));
    assert.ok(!result.ok);
    assert.deepEqual(result.issues[0].path, ["address", key]);
  }

  const invalid = source.replaceAll("<string>", '<string minlen="-1">');
  const result = compile_schema_source(invalid);
  const target = parse_canonical_hson_data(schema1.replaceAll('"string"', '<string <minlen -1>>'));
  const control = compile_hson_schema(serialize_canonical_hson_data(target));
  assert.ok(!result.ok && !control.ok);
  assert.deepEqual(result.issues.map(({ origin, authoredRange, ...issue }) => issue), control.issues);
  assert.deepEqual(result.issues.map(issue => issue.path), ["city", "state"].map(key =>
    ["content", "address", "content", key, "string", "minlen"]));
  const header = 'minlen="-1"';
  assert.deepEqual(result.issues.map(issue => issue.authoredRange),
    [invalid.indexOf(header), invalid.lastIndexOf(header)].map(start => ({ start, end: start + header.length })));
});

test("quoted system vocabulary is application data throughout an object", () => {
  const keys = ["content", "ref", "object", "type", "data", "members", "defs", "any", "optional", "exact"];
  const source = `<data <object <${keys.map(key => `'${key}' <string>`).join(" ")}>>>`;
  const fields = keys.map(key => `${key} "string"`).join(" ");
  const result = compare(source, `<type "data" content <${fields}>>`);
  assert.ok(certify(result.actual, `<${fields}>`).ok);
  const map = result.root.body;
  assert.ok(map?.kind === "operation" && map.body?.kind === "members");
  assert.deepEqual(map.body.entries.map(member => [member.kind, member.name]), keys.map(key => ["name", key]));
  for (const key of keys) {
    const rejected = certify(result.actual, `<${fields.replace(`${key} "string"`, `${key} true`)}>`);
    assert.ok(!rejected.ok);
    assert.deepEqual(rejected.issues[0].path, [key]);
  }
});

test("sibling quotes delimit contentless, flagged, valued and adjacent member occurrences", () => {
  const source = "// 🧭\r\n<data <object <'first' // skipped > 'x'\r\n 'second' <string>'third' optional 'fourth' null 'last'>>>";
  const read = read_schema_source(source);
  assertOwned(read, source);
  const object = read.root.body;
  assert.ok(object?.kind === "operation" && object.body?.kind === "members");
  const entries = object.body.entries;
  assert.deepEqual(entries.map(entry => entry.name), ["first", "second", "third", "fourth", "last"]);
  assert.deepEqual(entries.map(entry => Object.hasOwn(entry, "body")), [false, true, false, true, false]);
  assert.deepEqual(entries.map(entry => entry.headers.map(h => h.name)), [[], [], ["optional"], [], []]);
  assert.ok(entries[3].body?.kind === "value" && entries[3].body.value === null);
  assert.deepEqual(entries.map(entry => {
    const { start, end } = read.rangeOf(entry)!;
    return source.slice(start, end);
  }), ["'first'", "'second' <string>", "'third' optional", "'fourth' null", "'last'"]);
  rejection(source, "SCHEMA_LOWERING", "'first'", /requires a nested Schema operation/);
});

test("tuple items and union alternatives can be objects inside a referenced definition", () => {
  const source = `<data
    <defs <'Pair' <tuple [<object <'x' <number>>>, <union [<object <'kind' <exact "text"> 'y' <string>>>, <object <'kind' <exact "end">>>]>]>>>
    <ref "Pair">
  >`;
  const result = compare(source, '<type "data" defs <Pair <tuple [<content <x "number">>, <union [<content <kind <exact "text"> y "string">>, <content <kind <exact "end">>>]>]>> content <ref "Pair">>');
  for (const [candidate, accept] of [
    ['[<x 2>, <kind "text" y "v">]', true], ['[<x 2>, <kind "end">]', true],
    ['[<x 2>, <kind "text">]', false], ['[<>, <kind "end">]', false],
  ] as const) {
    const checked = certify(result.actual, candidate);
    assert.equal(checked.ok, accept);
    assert.deepEqual(checked, certify(result.expected, candidate));
  }
});

test("repeated contentless numbers have independent positions in both HSON array spellings", () => {
  for (const [open, close] of [["[", "]"], ["«", "»"]]) {
    const source = `// 🧭\r\n<data <object <'position' <tuple ${open}<number>, // > ]\r\n <number>,${close}>>>>`;
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

test("the two Schema 1.0 root collisions select the authored meaning", () => {
  const defs = `<defs <'string' <number>>>`;
  const first = compare(`<data <object <'exact' <string>>>>`, '<type "data" content <exact "string">>');
  const second = compare(`<data <object <'content' <exact "string">>>>`,
    '<type "data" content <content <content <exact "string">>>>');
  const third = compare(`<data ${defs} <ref "string">>`, '<type "data" defs <string "number"> content <ref "string">>');
  const fourth = compare(`<data ${defs} <object <'ref' <string>>>>`,
    '<type "data" defs <string "number"> content <content <ref "string">>>');
  // Historical unwrapped alternatives both compile. Each reverses the two candidates.
  for (const [alternative, intended, other, yes, no] of [
    ['<type "data" content <content <exact "string">>>', second, first, '<content "string">', '<exact "abc">'],
    ['<type "data" defs <string "number"> content <ref "string">>', fourth, third, '<ref "P">', "2"],
  ] as const) {
    const historical = HsonSchema.fromHson(alternative);
    for (const [candidate, accept] of [[yes, true], [no, false]] as const) {
      assert.equal(certify(intended.actual, candidate).ok, accept);
      assert.equal(certify(historical, candidate).ok, !accept);
      assert.equal(certify(other.actual, candidate).ok, !accept);
    }
  }
  const optional = compare(`<data <object <'content' optional <string>>>>`,
    '<type "data" content <content <content <optional "string">>>>');
  assert.ok(certify(optional.actual, "<>").ok);
  compare(`<data <object <'content' <string>>>>`, '<type "data" content <content "string">>');
});

test("data owns its ordered defs and root reference directly", () => {
  const source = `<data
  <defs <
    'Score' <number int min="0" max="100">
  >>
  <ref "Score">
>`;
  const { root, rangeOf, actual } = compare(source,
    '<type "data" defs <Score <number <int true min 0 max 100>>> content <ref "Score">>');
  const clauses = root.body;
  assert.ok(clauses?.kind === "group");
  assert.deepEqual(clauses.items.map(clause => clause.name), ["defs", "ref"]);
  assert.deepEqual(rangeOf(clauses), { start: source.indexOf("<defs"), end: source.indexOf('<ref "Score">') + '<ref "Score">'.length });
  for (const [candidate, accept] of [["0", true], ["100", true], ["101", false], ["1.5", false]] as const) {
    assert.equal(certify(actual, candidate).ok, accept);
  }
});

test("generated collision wrappers project compiler failures to the precise authored operand", () => {
  for (const [name, modifier, child, path, fragment] of [
    ["content", "", '<string len="-1">', ["content", "content", "content", "string", "len"], 'len="-1"'],
    ["content", "optional ", '<ref "Missing">', ["content", "content", "content", "optional", "ref"], '"Missing"'],
    ["ref", "", '<ref "Missing">', ["content", "content", "ref", "ref"], '"Missing"'],
  ] as const) {
    const source = `<data <object <'${name}' ${modifier}${child}>>>`;
    const checked = compile_schema_source(source);
    assert.ok(!checked.ok);
    assert.equal(checked.issues.length, 1);
    const [issue] = checked.issues;
    assert.deepEqual(issue.path, path);
    assert.equal(issue.origin, checked.originAt(path));
    const start = source.indexOf(fragment);
    assert.deepEqual(issue.authoredRange, { start, end: start + fragment.length });
  }
});

test("absent root, empty maps and explicit any retain distinct identities", () => {
  const digests = [
    ["<data>", '<type "data">'],
    ["<data <any>>", '<type "data" content "any">'],
    ["<data <defs <>>>", '<type "data" defs <>>'],
    ["<data <object < // empty map\n >>>", '<type "data" content <>>'],
  ].map(([source, expected]) => hson_schema_digest(compare(source, expected).actual));
  assert.equal(new Set(digests).size, 4);
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
  const source = String.raw`<data <object <
    'obj\u0065ct' <object <'O\'Brien' optional <string contains="// >" suffix="\uD83C\uDF4E\t">>>
    '2' <number over="-1e2" int min="-0">
    '__proto__' <exact -0>
  >>>`;
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
    ["<data <object <'v' <number> 'v' <number>>>>", "'v' <number>"],
    ["<data <defs <'T' <string> 'T' <string>>>>", "'T' <string>"],
    [String.raw`<data <object <'age' <number> '\u0061ge' <number>>>>`, String.raw`'\u0061ge' <number>`],
    [String.raw`<data <defs <'T' <string> '\u0054' <string>>>>`, String.raw`'\u0054' <string>`],
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
    [field("<array []>"), "[]"], [field("<object []>"), "[]"], [field("<ref>"), "<ref>"],
    ["<data <members>>", "<members>"],
    ['<data <ref "R"> <defs <>>>', "<defs <>>"],
    ["<data <defs <>> <defs <>>>", "<defs <>>"], ["<data <any> <any>>", "<any>"],
    ["<data <number>>", "<number>"], ["<document>", "<document>"],
    ["<data <defs <'T' optional <number>>>>", "optional"],
    ["<data <object <'n' optional optional <number>>>>", "optional"],
    ["<data <object <'$_reserved' <number>>>>", "'$_reserved' <number>"],
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
    "<object <'v' <number> <string>>>", "<object <'v' <number> optional>>", "<object <'v' , <number>>>",
    "<object <'v' <string> bare <number>>>", "<object <'v' <string> 'w' <number>>",
    "<object <'one' <number>> <'two' <number>>>", "<object <<'one' <number>>>>",
    "<object <'one' <number>, 'two' <number>>>", "<object <bare <number>>>",
    '<object <"v" <string>>>', String.raw`<object <'bad\u123X' <number>>>`,
    "<object <'unterminated <number>>>", "<tuple [<'number'>]>", "<data []>", "<data [<any>]>",
    "<data [<members <'name' <string>>>]>", "<data <defs <>>, <any>>",
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
  const source = "// 🧭\r\n<data\r\n <object <'x\\q' <string>>>>";
  rejection(source, "invalid-name-escape", "\\", /3:13/);
  const missing = "// 🧭\r\n  <object <'x' <number>";
  rejection(missing, "SCHEMA_SOURCE_SYNTAX", "<", /2:11 Missing >/);
});

test("embedded Data failures display authored coordinates and preserve the operand-relative cause", () => {
  const prefix = "// check\r\n";
  for (const [source, start, position, operandColumn] of [
    [prefix + "<exact [<p/>]>", 18, "2:9", 2],
    [prefix + field("<exact <v [<p/>]>>"), 40, "2:31", 5],
    [prefix + field('<array unique={\r\n <by "🧭" cases [[<p/>]]>\r\n} <any>>'), 64, "3:19", 18],
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

// The field expression starts at depth 3. Each enclosing tuple adds a declaration and an array.
function insideTuples(count: number, expression: string): string {
  return field("<tuple [".repeat(count) + expression + "]>".repeat(count));
}

for (const [expression, body] of [["<tuple []>", "[]"], ["<object <>>", "<>"]]) {
  test(`the structural body of ${expression} admits depth 255 and rejects depth 256`, () => {
    assert.ok(compile_schema_source(insideTuples(125, `<array ${expression}>`)).ok);
    const source = insideTuples(125, `<array <array ${expression}>>`);
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
    assert.ok(compile_schema_source(insideTuples(125, expression)).ok);
    const source = insideTuples(125, `<array ${expression}>`);
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
  const source = field(`<tuple [<union [<null>, <number>]>, ${invalid}]>`);
  const result = compile_schema_source(source);
  assert.ok(!result.ok);
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(issue.code, "INVALID_UNION");
  assert.deepEqual(issue.path, []);
  assert.equal(issue.origin, result.originAt(["content", "v", "tuple", 1]));
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
  assert.deepEqual(issue.authoredRange, { start: 52, end: 76 });
  assert.equal(source.slice(52, 76), "<union [<null>, <null>]>");
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
  for (const source of ["<number>", "<object <'age' <number>>>"]) {
    assert.ok(is_schema_occurrence(read_schema_source(source).root));
    assert.throws(() => HsonDataValue.fromSource(source));
  }
});

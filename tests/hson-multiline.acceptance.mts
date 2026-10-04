import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Hson, hsonTransform } from "../src/index.ts";
import { tokenize_hson } from "../src/api/transform/parsers/tokenize-hson.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { HsonSchema, hson_schema_source_digest } from "../src/api/schema/hson-schema.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "hson.multiline", title: "Multiline Hson strings", category: "Transform", runtime: "node", tags: Object.freeze(["multiline", "parser", "serializer", "provenance"]) });
const testEvents = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
testEvents.case_begin("multiline-value-preservation", HSON_LIVE_TEST_METADATA.title);
try {
  const value = (source: string) => Hson.data.materialize(Hson.data.fromHson(source as never));
  const cases: readonly (readonly [string, string])[] = [
    ['"a\nb\rc\r\nd\\re"', "a\nb\nc\nd\re"],
    ['"\r\n  a\n  b\r  c\\r\r\n  "', "a\nb\nc\r"],
    ['"a\nb"', "a\nb"], ['"a\rb"', "a\nb"], ['"a\r\nb"', "a\nb"],
    ['"a\n  b"', "a\n  b"], ['"a\n"', "a\n"],
    ['"\n  a\n  b\n  "', "a\nb"], ['"\r\n  a\r\n  b\r\n  "', "a\nb"],
    ['"\r  a\r  b\r  "', "a\nb"], ['"\n  a\n    b\n  "', "a\n  b"],
    ['"\n    a\n b\n  "', "   a\nb"], ['"\n\t a\n\t   b\n\t"', "a\n  b"],
    ['"\n\t a\n \tb\n"', "\t a\n \tb"],
    ['"\n  a\n \n  \n    \n  b\n "', "a\n\n\n  \nb"],
    ['"\n \n  \n"', " \n  "], ['"\n  "', ""], ['"\n"', ""],
    ['"\n\n  a\n\n "', "\na\n"],
    ['"\n  \\na\\n\n "', "\na\n"], ['"\n  a\\n  b\n "', "a\n  b"],
    ['"\n  \\tspace\\r\\n\\u0001\\\"\\\\\n"', '\tspace\r\n\u0001"\\'],
    ['"a\n// >, ] « syntax\nb"', "a\n// >, ] « syntax\nb"],
  ];
  for (const [source, expected] of cases) {
    assert.equal(value(source), expected, JSON.stringify(source));
    assert.deepEqual(Hson.data.materialize(Hson.data.fromHson(`<v ${source}>` as never)), { v: expected });
    assert.deepEqual(value(`[${source}, ""]`), [expected, ""]);
    const document = Hson.document.fromHson(`<p ${source} "" "next"/>` as never);
    const node = Hson.document.toNode(document);
    const children = (node.$_content[0] as any).$_content[0].$_content;
    assert.equal(children.length, 3);
    assert.equal(children[0].$_content[0], expected);
    assert.equal(children[1].$_content[0], "");
  }
  for (let code = 0; code < 32; code++) {
    if ([9, 10, 13].includes(code)) continue;
    for (const source of [`"a${String.fromCharCode(code)}b"`, `<p "a${String.fromCharCode(code)}b"/>`]) {
      assert.throws(() => tokenize_hson(source), /unescaped control/);
    }
  }
  for (const eol of ["\n", "\r", "\r\n"]) {
    assert.throws(() => tokenize_hson(`<p title="a${eol}b"/>`), /control/);
    assert.throws(() => tokenize_hson(`"a\\${eol}b"`), /escape/);
    for (const source of [`"${eol} a >, ]`, `<p "${eol} a >, ]`, `<v "${eol} a >, ]'`]) {
      try { tokenize_hson(source); assert.fail("unterminated accepted"); }
      catch (error) {
        const details = read_transform_error_details(error);
        assert.equal(details?.code, "HSON_STRING_UNTERMINATED");
        assert.equal(details?.source?.index, source.indexOf('"'));
      }
    }
    const source = `<a "first${eol}second" b 2>`;
    const tokens = tokenize_hson(source);
    const member = tokens.find(token => token.kind === "OPEN" && token.tag === "b");
    assert.deepEqual(member?.pos, { index: source.indexOf("b 2"), line: 2, col: 9 });
    const parsed = parse_hson_with_provenance(source);
    assert.deepEqual(parsed.provenance.range({ kind: "node", path: [1], role: "name" }),
      { start: source.indexOf("b 2"), end: source.indexOf("b 2") + 1 });
  }
  const segments = ["", "a", " b", "\t", "  ", "\r", '"', "\\", "\u0000", "\n", "\n\n", "\t b"];
  for (const left of segments) for (const right of segments) {
    const original = left + "\n" + right;
    for (const input of [original, [original, ""], { text: original, items: [original] }]) {
      const render = hsonTransform.fromJson(typeof input === "string" ? JSON.stringify(input) : input);
      const readable = render.toHson().serialize();
      const compact = render.toHson().noBreak().serialize();
      assert.ok(readable.includes('"\n'));
      assert.equal(compact.includes("\n"), false);
      assert.deepEqual(value(readable), input);
      assert.deepEqual(value(compact), input);
      assert.deepEqual(value(hsonTransform.fromHson(readable).toHson().serialize()), input);
    }
    const document = Hson.document.fromHson(`<p ${JSON.stringify(original)} ""/>` as never);
    const output = hsonTransform.fromHson(document).toHson();
    assert.ok(canonical_hson_graph_equal(Hson.document.toNode(document), Hson.document.toNode(output.serialize() as never)));
    const html = hsonTransform.fromHson(document).toHtml().serialize();
    const back = hsonTransform.fromTrustedHtml(html).toHson().serialize();
    assert.ok(canonical_hson_graph_equal(Hson.document.toNode(document), Hson.document.toNode(Hson.document.fromHson(back))));
  }
  const compactSchema = '<type "data" content <message <exact "hello\\nworld">>>';
  const multilineSchema = '<type "data" content <message <exact "\n    hello\n    world\n  ">>>';
  assert.equal(hson_schema_source_digest(compactSchema), hson_schema_source_digest(multilineSchema));
  assert.equal(HsonSchema.fromHson(multilineSchema).certify(Hson.data.from({ message: "hello\nworld" })), Hson.data.from({ message: "hello\nworld" }));
  const readableOutput = hsonTransform.fromJson(JSON.stringify("hello\nworld")).toHson();
  const compactOutput = readableOutput.noBreak();
  assert.notEqual(readableOutput.serialize(), compactOutput.serialize());
  assert.equal(await readableOutput.sha256(), createHash("sha256").update(readableOutput.serialize()).digest("hex"));
  assert.equal(await compactOutput.sha256(), createHash("sha256").update(compactOutput.serialize()).digest("hex"));
  assert.notEqual(await readableOutput.sha256(), await compactOutput.sha256());
  console.log("multiline semantics, exact serialization, transport, provenance and identity passed");

  testEvents.case_end("multiline-value-preservation", "pass");
  testEvents.terminal("pass");
} catch (error) {
  testEvents.diagnostic("multiline-value-preservation", "assertion", error instanceof Error ? error.message : String(error));
  testEvents.case_end("multiline-value-preservation", "fail");
  testEvents.terminal("fail");
  throw error;
}

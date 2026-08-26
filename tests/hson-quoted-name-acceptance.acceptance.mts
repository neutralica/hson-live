// @hson-live-external-test
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";

import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";

let checks = 0;

function check(name: string, body: () => void): void {
  body();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function parse(source: string): HsonNode {
  return hson.fromHson(source).toNode();
}

function canonicalize(source: string): string {
  return hson.fromHson(source).toHson().serialize();
}

function compact(source: string): string {
  return hson.fromNode(parse(source)).toHson().noBreak().serialize();
}

function firstPropertyName(source: string): string {
  const object = parse(source);
  assert.equal(object.$_tag, "_hson_obj");
  const property = object.$_content[0];
  assert.ok(is_Node(property));
  return property.$_tag;
}

check("established bare names remain canonical", () => {
  assert.equal(compact("<bareName 1>"), "<bareName 1>");
});

check("single-quoted object member names admit spaces", () => {
  assert.equal(firstPropertyName("<'white space' 1>"), "white space");
});

check("single-quoted element names admit spaces", () => {
  const fragment = parse("<'white space' \"value\"/>");
  const element = fragment.$_content[0];
  assert.ok(is_Node(element));
  assert.equal(element.$_tag, "white space");
});

check("single-quoted names admit punctuation without broadening bare names", () => {
  assert.equal(firstPropertyName("<'major problem here:' \"\">"), "major problem here:");
});

check("quoted-name apostrophe escapes decode", () => {
  assert.equal(firstPropertyName("<'don\\'t' 1>"), "don't");
});

check("quoted-name backslash escapes decode", () => {
  assert.equal(firstPropertyName("<'back\\\\slash' 1>"), "back\\slash");
});

check("quoted-name backspace escapes decode", () => {
  assert.equal(firstPropertyName("<'back\\bspace' 1>"), "back\bspace");
});

check("quoted-name form-feed escapes decode", () => {
  assert.equal(firstPropertyName("<'form\\ffeed' 1>"), "form\ffeed");
});

check("quoted-name line-feed escapes decode", () => {
  assert.equal(firstPropertyName("<'line\\nname' 1>"), "line\nname");
});

check("quoted-name carriage-return escapes decode", () => {
  assert.equal(firstPropertyName("<'line\\rname' 1>"), "line\rname");
});

check("quoted-name horizontal-tab escapes decode", () => {
  assert.equal(firstPropertyName("<'line\\tname' 1>"), "line\tname");
});

check("quoted-name Unicode escapes decode one UTF-16 code unit", () => {
  assert.equal(firstPropertyName("<'unicode\\u2028name' 1>"), "unicode\u2028name");
});

check("quoted-name Unicode escapes preserve isolated surrogate code units", () => {
  assert.equal(firstPropertyName("<'high\\uD800name' 1>"), "high\uD800name");
  assert.equal(firstPropertyName("<'low\\uDC00name' 1>"), "low\uDC00name");
  assert.equal(firstPropertyName("<'pair\\uD83D\\uDE00name' 1>"), "pair😀name");
});

check("backticks are ordinary unescaped quoted-name data", () => {
  assert.equal(firstPropertyName("<'contains ` a backtick' 1>"), "contains ` a backtick");
});

check("backticks are ordinary unescaped string-value data", () => {
  assert.equal(hson.fromHson("<message \"contains ` a backtick\">").toJson().serialize(),
    "{\n  \"message\": \"contains ` a backtick\"\n}");
});

check("empty decoded names retain the established object-member-only behavior", () => {
  assert.equal(firstPropertyName("<'' 1>"), "");
  assert.equal(compact("<'' 1>"), "<'' 1>");
});

check("canonical serialization escapes apostrophes with a backslash", () => {
  assert.equal(compact("<'don\\'t' true>"), "<'don\\'t' true>");
});

check("canonical serialization escapes backslashes but not backticks", () => {
  assert.equal(compact("<'back\\\\slash ` data' 1>"), "<'back\\\\slash ` data' 1>");
});

check("canonical quoted-name output is byte-deterministic", () => {
  const node = parse("<'major problem here:' \"\">");
  const first = hson.fromNode(node).toHson().serialize();
  const second = hson.fromNode(node).toHson().serialize();
  assert.equal(first, "<'major problem here:' \"\">");
  assert.equal(second, first);
});

check("authored parse serialize reparse closes over demanding property names", () => {
  const source = "<'white space' 1 'don\\'t' 2 'back\\\\slash' 3 'tick`name' 4 'line\\nname' 5 'unicode\\u2028name' 6 'isolated\\uD800surrogate' 7 'problem:' 8>";
  const parsed = parse(source);
  const wire = hson.fromNode(parsed).toHson().serialize();
  assert.equal(wire.includes("`name`"), false);
  assert.equal(canonical_hson_graph_equal(parse(wire), parsed), true);
});

check("JSON transformation retains decoded quoted property names", () => {
  const source = "<'space key' 1 'don\\'t' 2 'back\\\\slash' 3 'tick`name' 4>";
  const json = hson.fromHson(source).toJson().serialize();
  assert.deepEqual(JSON.parse(json), {
    "space key": 1,
    "don't": 2,
    "back\\slash": 3,
    "tick`name": 4,
  });
});

check("HTML transport retains decoded quoted property names", () => {
  const source = "<'space key' 1 'don\\'t' 2 'tick`name' 3>";
  const node = parse(source);
  const html = hson.fromNode(node).toHtml().serialize();
  assert.match(html, /space_x20-key/);
  assert.match(html, /don_x27-t/);
  assert.match(html, /tick_x60-name/);
  assert.equal(html.includes("<'"), false);
  assert.equal(html.includes("<`"), false);
});

check("ordinary quoted names embed directly in a JavaScript template literal", () => {
  const source = `
<
  'major problem here:' ""
  'ordinary quoted name' "value"
>
`;
  assert.deepEqual(JSON.parse(hson.fromHson(source).toJson().serialize()), {
    "major problem here:": "",
    "ordinary quoted name": "value",
  });
});

check("host and HSON escaping layer once when a template-literal name contains an apostrophe", () => {
  const source = `<'don\\'t' 1>`;
  assert.equal(firstPropertyName(source), "don't");
  assert.equal(canonicalize(source), "<'don\\'t' 1>");
});

process.stdout.write(`# ${checks} quoted-name acceptance checks passed\n`);
emit_hson_live_test_completion("transform.hson-quoted-name-acceptance", checks, checks, 0);

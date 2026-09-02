import assert from "node:assert/strict";

import { discover_static_from_hson_sources } from "../src/internal/embedded-hson/discover-static-from-hson-sources.ts";
import { map_static_hson_point, map_static_hson_range } from "../src/internal/embedded-hson/static-hson-source.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "static-hson-js-literal-mapping",
  title: "D4 JavaScript literal cooking and source mapping",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "authoring", "diagnostics", "internal"]),
});

const testEvents = create_test_event_emitter("static-hson-js-literal-mapping");
let checks = 0;
const prefix = 'import { hsonTransform as t } from "hson-live/transform";\n';
function source(literal: string) {
  const text = `${prefix}t.fromHson(${literal});`;
  const found = discover_static_from_hson_sources("/project/source.ts", text).sources[0];
  assert.ok(found, literal);
  return found;
}
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
  } console.log(`ok ${++checks} - ${name}`); }
function pointSpelling(literal: string, index: number): string {
  const found = source(literal);
  const mapped = map_static_hson_point(found, index);
  assert.ok(mapped);
  return found.hostText.slice(mapped.start, mapped.end);
}

check("single quoted literal cooks through TypeScript", () => assert.equal(source("'<foo/>'").runtimeText, "<foo/>"));
check("double quoted literal cooks through TypeScript", () => assert.equal(source('"<foo/>"').runtimeText, "<foo/>"));
check("ordinary no-substitution template cooks through TypeScript", () => assert.equal(source('`<foo/>`').runtimeText, "<foo/>"));
check("escaped single delimiter maps as one authored escape", () => assert.equal(pointSpelling("'\"a\\\'b\"'", 2), "\\'"));
check("escaped double delimiter maps as one authored escape", () => assert.equal(pointSpelling('"\\\"x\\\""', 0), "\\\""));
check("backslash escape maps completely", () => assert.equal(pointSpelling('"\\\\<foo/>"', 0), "\\\\"));
check("newline escape cooks to newline", () => { const found = source('"\\n<foo/>"'); assert.equal(found.runtimeText[0], "\n"); assert.equal(pointSpelling('"\\n<foo/>"', 0), "\\n"); });
check("escaped backslash+n stays backslash+n", () => assert.equal(source('"\\\\n<foo/>"').runtimeText.slice(0, 2), "\\n"));
check("carriage return escape maps completely", () => assert.equal(pointSpelling('"\\r<foo/>"', 0), "\\r"));
check("tab escape maps completely", () => assert.equal(pointSpelling('"\\t<foo/>"', 0), "\\t"));
check("backspace form-feed and vertical-tab cook", () => assert.equal(source('"\\b\\f\\v"').runtimeText, "\b\f\v"));
check("nul escape cooks", () => assert.equal(source('"\\0<foo/>"').runtimeText.charCodeAt(0), 0));
check("hex escape maps complete spelling", () => assert.equal(pointSpelling('"\\x3cfoo/>"', 0), "\\x3c"));
check("four-digit unicode escape maps complete spelling", () => assert.equal(pointSpelling('"\\u003cfoo/>"', 0), "\\u003c"));
check("code-point unicode escape maps complete spelling", () => assert.equal(pointSpelling('"\\u{3c}foo/>"', 0), "\\u{3c}"));
check("astral code-point escape never splits", () => { const found = source('"\\u{1f600}<foo/>"'); assert.equal(found.runtimeText.slice(0, 2), "😀"); assert.equal(found.hostText.slice(map_static_hson_point(found, 1)!.start, map_static_hson_point(found, 1)!.end), "\\u{1f600}"); });
check("literal non-BMP scalar never splits", () => assert.equal(pointSpelling('"😀<foo/>"', 1), "😀"));
check("surrogate escape pair maps across both escapes", () => { const found = source('"\\uD83D\\uDE00<foo/>"'); const mapped = map_static_hson_point(found, 0)!; assert.equal(found.hostText.slice(mapped.start, mapped.end), "\\uD83D\\uDE00"); });
check("ordinary template literal CRLF normalizes to LF", () => { const found = source("`a\r\nb`"); assert.equal(found.runtimeText, "a\nb"); assert.equal(found.hostText.slice(map_static_hson_point(found, 1)!.start, map_static_hson_point(found, 1)!.end), "\r\n"); });
check("string line continuation creates no runtime source", () => { const found = source('"a\\\r\nb"'); assert.equal(found.runtimeText, "ab"); assert.equal(found.hostText.slice(map_static_hson_point(found, 1)!.start, map_static_hson_point(found, 1)!.end), "b"); });
check("template line continuation creates no runtime source", () => assert.equal(source("`a\\\nb`").runtimeText, "ab"));
check("EOF maps immediately before the JavaScript delimiter", () => { const found = source('"\\n<foo"'); assert.deepEqual(map_static_hson_point(found, found.runtimeText.length), { start: found.bodyRange.end, end: found.bodyRange.end }); });
check("Hson escape nested inside JavaScript escaping remains exact", () => assert.equal(source('"\\\"a\\\\nb\\\""').runtimeText, '"a\\nb"'));
check("multi-character runtime range covers complete endpoint escapes", () => { const found = source('"\\x3cfoo\\x2f>"'); const mapped = map_static_hson_range(found, { start: 0, end: found.runtimeText.length })!; assert.equal(found.hostText.slice(mapped.start, mapped.end), "\\x3cfoo\\x2f>"); });
check("invalid JavaScript literal syntax is rejected by TypeScript", () => { const text = `${prefix}t.fromHson("\\xZ1");`; assert.equal(discover_static_from_hson_sources("/project/source.ts", text).sources.length, 0); });

testEvents.terminal("pass");
emit_hson_live_test_completion("static-hson-js-literal-mapping", checks, checks, 0);

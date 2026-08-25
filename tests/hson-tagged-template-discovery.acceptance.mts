// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

import { TransformError } from "../src/core/errors.ts";
import { hsonString } from "../src/hson.ts";
import {
  discover_hson_tagged_templates,
  type HsonTaggedTemplateDiscoveryResult,
} from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { read_embedded_hson_body } from "../src/internal/embedded-hson/embedded-hson-source.ts";
import { map_transform_error_to_embedded_source } from "../src/internal/embedded-hson/map-transform-error.ts";

let checks = 0;

function check(name: string, body: () => void): void {
  body();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function discover(
  hostText: string,
  fileName = "/workspace/fixture.ts",
): HsonTaggedTemplateDiscoveryResult {
  return discover_hson_tagged_templates(fileName, hostText);
}

function bodySlices(result: HsonTaggedTemplateDiscoveryResult): readonly string[] {
  return result.sources.map(read_embedded_hson_body);
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

check("official root, hson, and transform entrypoints are recognized in source order", () => {
  const hostText = [
    'import { hsonString as root } from "hson-live";',
    'import { hsonString as hson } from "hson-live/hson";',
    'import { hsonString as transform } from "hson-live/transform";',
    "root`a`; hson`b`; transform`c`;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["a", "b", "c"]);
});

check("direct imports and aliases use the exact ImportSpecifier binding", () => {
  const hostText = [
    'import { hsonString, hsonString as markup } from "hson-live";',
    "hsonString`direct`; markup`alias`;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["direct", "alias"]);
});

check("function parameter and nested-scope shadowing are excluded", () => {
  const hostText = [
    'import { hsonString as markup } from "hson-live";',
    "markup`outer`;",
    "function example(markup: unknown) { markup`parameter`; }",
    "function nested() { { const markup = String.raw; markup`nested`; } markup`again`; }",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["outer", "again"]);
});

check("local, block, loop, and catch bindings shadow only their lexical regions", () => {
  const hostText = [
    'import { hsonString as markup } from "hson-live";',
    "function local() { const markup = String.raw; markup`local`; }",
    "{ let markup = String.raw; markup`block`; }",
    "for (const markup of []) { markup`loop`; }",
    "try {} catch (markup) { markup`catch`; }",
    "markup`official`;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["official"]);
});

check("unrelated and relative imports never establish official provenance", () => {
  const hostText = [
    'import { hsonString as wrong } from "other-package";',
    'import { hsonString as internal } from "../src/hson.js";',
    "wrong`a`; internal`b`;",
  ].join("\n");
  assert.deepEqual(discover(hostText), { sources: [], unsupported: [] });
});

check("namespace, default, type-only, re-export, CommonJS, alias, and wrapper forms are excluded", () => {
  const hostText = [
    'import api from "hson-live";',
    'import * as namespace from "hson-live";',
    'import type { hsonString as typed } from "hson-live";',
    'export { hsonString } from "hson-live";',
    'const required = require("hson-live");',
    "const assigned = namespace.hsonString;",
    "const wrapper = (value: unknown) => value;",
    "api`a`; namespace.hsonString`b`; typed`c`; required.hsonString`d`; assigned`e`; wrapper`f`;",
  ].join("\n");
  assert.deepEqual(discover(hostText), { sources: [], unsupported: [] });
});

check("facade, element, parenthesized, non-null, optional, and generic tag forms are excluded", () => {
  const hostText = [
    'import { hsonString } from "hson-live";',
    "({ hsonString }).hsonString`property`;",
    "({ hsonString })[\"hsonString\"]`element`;",
    "(hsonString)`parenthesized`;",
    "hsonString!`nonnull`;",
    "hsonString?.`optional`;",
    "hsonString<string>`generic`;",
  ].join("\n");
  assert.deepEqual(discover(hostText), { sources: [], unsupported: [] });
});

check("empty, one-line, multiline, indented, escaped, and terminal templates preserve exact bodies", () => {
  const hostText = [
    'import { hsonString as h } from "hson-live";',
    "h``; h`one`; h`\n  <main>\n`; h`escaped \\\` and \\\\`; h`last`",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["", "one", "\n  <main>\n", "escaped \\\` and \\\\", "last"]);
});

check("physical CRLF is retained in exact template and body ranges", () => {
  const hostText = 'import { hsonString } from "hson-live";\r\nconst x = hsonString`\r\n  <main>\r\n`;';
  const result = discover(hostText);
  assert.deepEqual(bodySlices(result), ["\r\n  <main>\r\n"]);
  const source = result.sources[0];
  assert.ok(source);
  assert.equal(hostText.slice(source.templateRange.start, source.templateRange.end), "`\r\n  <main>\r\n`");
});

check("TSX with adjacent JSX is supported while non-TS extensions fail closed", () => {
  const hostText = [
    'import { hsonString } from "hson-live";',
    "const view = <main>{hsonString`inside`}</main>;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText, "/workspace/view.tsx")), ["inside"]);
  assert.deepEqual(discover(hostText, "/workspace/view.js"), { sources: [], unsupported: [] });
  assert.deepEqual(discover(hostText, "/workspace/view.mts"), { sources: [], unsupported: [] });
});

check("one and multiple substitutions are classified without becoming HSON sources", () => {
  const hostText = [
    'import { hsonString as h } from "hson-live";',
    "h`<main ${value}>`;",
    "h`<pair ${a} ${b}>`;",
  ].join("\n");
  const result = discover(hostText);
  assert.equal(result.sources.length, 0);
  assert.deepEqual(result.unsupported.map((item) => item.substitutionRanges.length), [1, 2]);
  assert.deepEqual(
    result.unsupported.flatMap((item) => item.substitutionRanges.map((range) => hostText.slice(range.start, range.end))),
    ["${value}", "${a}", "${b}"],
  );
});

check("nested, multiline, and complex substitution expressions remain opaque exact ranges", () => {
  const hostText = [
    'import { hsonString as h } from "hson-live";',
    "h`a ${a + b} b ${fn({ nested: true })} c ${`nested ${template}`} d ${",
    "  condition ? left : right",
    "}`;",
  ].join("\n");
  const result = discover(hostText);
  assert.equal(result.sources.length, 0);
  assert.deepEqual(
    result.unsupported[0]?.substitutionRanges.map((range) => hostText.slice(range.start, range.end)),
    ["${a + b}", "${fn({ nested: true })}", "${`nested ${template}`}", "${\n  condition ? left : right\n}"],
  );
});

check("an unrelated recoverable parser error does not suppress a valid later template", () => {
  const hostText = [
    "const broken = ;",
    'import { hsonString } from "hson-live";',
    "hsonString`valid`;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["valid"]);
});

check("parser damage overlapping imports or tagged templates is omitted", () => {
  const damagedImport = 'import { hsonString as } from "hson-live";\nhsonString`x`;';
  const damagedTemplate = 'import { hsonString } from "hson-live";\nhsonString`unterminated';
  assert.deepEqual(discover(damagedImport), { sources: [], unsupported: [] });
  assert.deepEqual(discover(damagedTemplate), { sources: [], unsupported: [] });
});

check("LF integration discovers, parses, and maps primary plus related declaration evidence", () => {
  const hostText = 'import { hsonString } from "hson-live";\nconst value = hsonString`\n<a 1 a 2>\n`;';
  const result = discover(hostText);
  const source = result.sources[0];
  assert.ok(source);
  const body = read_embedded_hson_body(source);
  const error = captureTransformError(() => hsonString(body));
  const mapped = map_transform_error_to_embedded_source(error, source);
  assert.equal(mapped.status, "mapped");
  if (mapped.status !== "mapped") return;
  assert.equal(hostText.slice(mapped.range.start, mapped.range.end), "a");
  assert.equal(mapped.related[0]?.role, "first-declaration");
  const related = mapped.related[0]?.mapping;
  assert.equal(related?.status, "mapped");
  assert.equal(related?.status === "mapped" ? hostText.slice(related.range.start, related.range.end) : "", "a");
});

check("CRLF integration maps multiple original-host templates independently", () => {
  const hostText = [
    'import { hsonString as h } from "hson-live";',
    "const first = h`+1`;",
    "const second = h`01`;",
  ].join("\r\n");
  const result = discover(hostText);
  assert.deepEqual(bodySlices(result), ["+1", "01"]);
  const source = result.sources[1];
  assert.ok(source);
  const error = captureTransformError(() => hsonString(read_embedded_hson_body(source)));
  const mapped = map_transform_error_to_embedded_source(error, source);
  assert.equal(mapped.status, "mapped");
  if (mapped.status === "mapped") {
    assert.equal(mapped.start.line, 3);
    assert.equal(hostText.slice(mapped.range.start, mapped.range.end), "1");
  }
});

check("substituted discoveries remain segregated from authoritative HSON parsing", () => {
  const hostText = 'import { hsonString } from "hson-live";\nhsonString`<main ${value}>`;';
  const result = discover(hostText);
  assert.equal(result.sources.length, 0);
  assert.equal(result.unsupported.length, 1);
  assert.equal(result.unsupported[0]?.reason, "substitutions");
});

emit_hson_live_test_completion("transform.hson-tagged-template-discovery", checks, checks, 0);

// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

import { TransformError } from "../src/core/errors.ts";
import { hson } from "../src/hson.ts";
import {
  discover_hson_tagged_templates,
  type HsonTaggedTemplateDiscoveryResult,
} from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { read_embedded_hson_body } from "../src/internal/embedded-hson/embedded-hson-source.ts";
import { map_transform_error_to_embedded_source } from "../src/internal/embedded-hson/map-transform-error.ts";
import {
  HSON_TAGGED_TEMPLATE_DISCOVERY_PROPOSITIONS,
  type HsonTaggedTemplateDiscoveryProposition,
} from "../src/_tests/hson-tagged-template-discovery-propositions.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-tagged-template-discovery",
  title: "Hson tagged-template discovery",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "discovery", "tagged-template", "tooling", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.hson-tagged-template-discovery");
let checks = 0;

function check(name: HsonTaggedTemplateDiscoveryProposition, body: () => void): void {
  assert.equal(
    name,
    HSON_TAGGED_TEMPLATE_DISCOVERY_PROPOSITIONS[checks],
    "tagged-template discovery propositions must execute once in canonical inventory order",
  );

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

function validate(source: string): void {
  hson.fromHson(source).toNode();
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

check("official root and hson entrypoints are recognized in source order", () => {
  const hostText = [
    'import { Hson as root } from "hson-live";',
    'import { Hson as Hson } from "hson-live/hson";',
    "root`a`; Hson`b`;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["a", "b"]);
});

check("direct imports and aliases use the exact ImportSpecifier binding", () => {
  const hostText = [
    'import { Hson, Hson as markup } from "hson-live";',
    "Hson`direct`; markup`alias`;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["direct", "alias"]);
});

check("function parameter and nested-scope shadowing are excluded", () => {
  const hostText = [
    'import { Hson as markup } from "hson-live";',
    "markup`outer`;",
    "function example(markup: unknown) { markup`parameter`; }",
    "function nested() { { const markup = String.raw; markup`nested`; } markup`again`; }",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["outer", "again"]);
});

check("local, block, loop, and catch bindings shadow only their lexical regions", () => {
  const hostText = [
    'import { Hson as markup } from "hson-live";',
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
    'import { Hson as wrong } from "other-package";',
    'import { Hson as internal } from "../src/hson.js";',
    "wrong`a`; internal`b`;",
  ].join("\n");
  assert.deepEqual(discover(hostText), { sources: [], interpolated: [] });
});

check("namespace, default, type-only, re-export, CommonJS, alias, and wrapper forms are excluded", () => {
  const hostText = [
    'import api from "hson-live";',
    'import * as namespace from "hson-live";',
    'import type { Hson as typed } from "hson-live";',
    'export { Hson } from "hson-live";',
    'const required = require("hson-live");',
    "const assigned = namespace.Hson;",
    "const wrapper = (value: unknown) => value;",
    "api`a`; namespace.Hson`b`; typed`c`; required.Hson`d`; assigned`e`; wrapper`f`;",
  ].join("\n");
  assert.deepEqual(discover(hostText), { sources: [], interpolated: [] });
});

check("facade, element, parenthesized, non-null, optional, and generic tag forms are excluded", () => {
  const hostText = [
    'import { Hson } from "hson-live";',
    "({ Hson }).Hson`property`;",
    "({ Hson })[\"Hson\"]`element`;",
    "(Hson)`parenthesized`;",
    "Hson!`nonnull`;",
    "Hson?.`optional`;",
    "Hson<string>`generic`;",
  ].join("\n");
  assert.deepEqual(discover(hostText), { sources: [], interpolated: [] });
});

check("empty, one-line, multiline, indented, escaped, and terminal templates preserve exact bodies", () => {
  const hostText = [
    'import { Hson as h } from "hson-live";',
    "h``; h`one`; h`\n  <main>\n`; h`escaped \\\` and \\\\`; h`last`",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["", "one", "\n  <main>\n", "escaped \\\` and \\\\", "last"]);
});

check("physical CRLF is retained in exact template and body ranges", () => {
  const hostText = 'import { Hson } from "hson-live";\r\nconst x = Hson`\r\n  <main>\r\n`;';
  const result = discover(hostText);
  assert.deepEqual(bodySlices(result), ["\r\n  <main>\r\n"]);
  const source = result.sources[0];
  assert.ok(source);
  assert.equal(hostText.slice(source.templateRange.start, source.templateRange.end), "`\r\n  <main>\r\n`");
});

check("TSX with adjacent JSX is supported while non-TS extensions fail closed", () => {
  const hostText = [
    'import { Hson } from "hson-live";',
    "const view = <main>{Hson`inside`}</main>;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText, "/workspace/view.tsx")), ["inside"]);
  assert.deepEqual(discover(hostText, "/workspace/view.js"), { sources: [], interpolated: [] });
  assert.deepEqual(discover(hostText, "/workspace/view.mts"), { sources: [], interpolated: [] });
});

check("compiler-host filename identity supports editor-shaped TS and TSX paths", () => {
  const tsText = 'import { Hson } from "hson-live";\nHson`inside`;';
  const tsxText = 'import { Hson } from "hson-live";\nconst view = <main>{Hson`inside`}</main>;';
  const fileNames = [
    "fixture.ts",
    "/Users/example/project/fixture.ts",
    "/Users/example/project with spaces/fixture.ts",
    new URL("file:///Users/example/project/fixture.ts").pathname,
  ];
  for (const fileName of fileNames) {
    assert.deepEqual(bodySlices(discover(tsText, fileName)), ["inside"], fileName);
  }
  assert.deepEqual(
    bodySlices(discover(tsxText, "/Users/example/project with spaces/view.tsx")),
    ["inside"],
  );
});

check("one and multiple substitutions are classified without becoming Hson sources", () => {
  const hostText = [
    'import { Hson as h } from "hson-live";',
    "h`<main ${value}>`;",
    "h`<pair ${a} ${b}>`;",
  ].join("\n");
  const result = discover(hostText);
  assert.equal(result.sources.length, 0);
  assert.deepEqual(result.interpolated.map((item) => item.substitutionRanges.length), [1, 2]);
  assert.deepEqual(
    result.interpolated.flatMap((item) => item.substitutionRanges.map((range) => hostText.slice(range.start, range.end))),
    ["${value}", "${a}", "${b}"],
  );
});

check("nested, multiline, and complex substitution expressions remain opaque exact ranges", () => {
  const hostText = [
    'import { Hson as h } from "hson-live";',
    "h`a ${a + b} b ${fn({ nested: true })} c ${`nested ${template}`} d ${",
    "  condition ? left : right",
    "}`;",
  ].join("\n");
  const result = discover(hostText);
  assert.equal(result.sources.length, 0);
  assert.deepEqual(
    result.interpolated[0]?.substitutionRanges.map((range) => hostText.slice(range.start, range.end)),
    ["${a + b}", "${fn({ nested: true })}", "${`nested ${template}`}", "${\n  condition ? left : right\n}"],
  );
});

check("an unrelated recoverable parser error does not suppress a valid later template", () => {
  const hostText = [
    "const broken = ;",
    'import { Hson } from "hson-live";',
    "Hson`valid`;",
  ].join("\n");
  assert.deepEqual(bodySlices(discover(hostText)), ["valid"]);
});

check("parser damage overlapping imports or tagged templates is omitted", () => {
  const damagedImport = 'import { Hson as } from "hson-live";\nHson`x`;';
  const damagedTemplate = 'import { Hson } from "hson-live";\nHson`unterminated';
  assert.deepEqual(discover(damagedImport), { sources: [], interpolated: [] });
  assert.deepEqual(discover(damagedTemplate), { sources: [], interpolated: [] });
});

check("LF integration discovers, parses, and maps primary plus related declaration evidence", () => {
  const hostText = 'import { Hson } from "hson-live";\nconst value = Hson`\n<a 1 a 2>\n`;';
  const result = discover(hostText);
  const source = result.sources[0];
  assert.ok(source);
  const body = read_embedded_hson_body(source);
  const error = captureTransformError(() => validate(body));
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
    'import { Hson as h } from "hson-live";',
    "const first = h`+1`;",
    "const second = h`01`;",
  ].join("\r\n");
  const result = discover(hostText);
  assert.deepEqual(bodySlices(result), ["+1", "01"]);
  const source = result.sources[1];
  assert.ok(source);
  const error = captureTransformError(() => validate(read_embedded_hson_body(source)));
  const mapped = map_transform_error_to_embedded_source(error, source);
  assert.equal(mapped.status, "mapped");
  if (mapped.status === "mapped") {
    assert.equal(mapped.start.line, 3);
    assert.equal(hostText.slice(mapped.range.start, mapped.range.end), "1");
  }
});

check("substituted discoveries remain segregated from authoritative Hson parsing", () => {
  const hostText = 'import { Hson } from "hson-live";\nHson`<main ${value}>`;';
  const result = discover(hostText);
  assert.equal(result.sources.length, 0);
  assert.equal(result.interpolated.length, 1);
  assert.deepEqual(
    result.interpolated[0]?.substitutionRanges.map((range) => hostText.slice(range.start, range.end)),
    ["${value}"],
  );
});

assert.equal(
  checks,
  HSON_TAGGED_TEMPLATE_DISCOVERY_PROPOSITIONS.length,
  "every tagged-template discovery proposition must execute exactly once",
);

testEvents.terminal("pass");
emit_hson_live_test_completion("transform.hson-tagged-template-discovery", checks, checks, 0);

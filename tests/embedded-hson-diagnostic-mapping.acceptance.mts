// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

import {
  TransformError,
  type TransformErrorDetails,
} from "../src/core/errors.ts";
import { hson } from "../src/hson.ts";
import { HSON } from "../src/hson-authoring.ts";
import {
  host_source_position_at,
  read_embedded_hson_body,
  validate_embedded_hson_source,
  type EmbeddedHsonSource,
} from "../src/internal/embedded-hson/embedded-hson-source.ts";
import {
  map_transform_error_to_embedded_source,
  type EmbeddedDiagnosticMapping,
} from "../src/internal/embedded-hson/map-transform-error.ts";

let checks = 0;

function check(name: string, body: () => void): void {
  body();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function validate(source: string): void {
  hson.fromHson(source).toNode();
}

function descriptorFor(
  hostText: string,
  body: string,
  searchFrom = 0,
): EmbeddedHsonSource {
  const tagStart = hostText.indexOf("HSON", searchFrom);
  assert.notEqual(tagStart, -1);
  const templateStart = hostText.indexOf("`", tagStart + "HSON".length);
  assert.notEqual(templateStart, -1);
  const bodyStart = templateStart + 1;
  const templateEnd = bodyStart + body.length + 1;
  assert.equal(hostText.slice(bodyStart, bodyStart + body.length), body);
  assert.equal(hostText[templateEnd - 1], "`");
  const validation = validate_embedded_hson_source({
    fileName: "/workspace/fixture.ts",
    hostText,
    tagRange: { start: tagStart, end: tagStart + "HSON".length },
    templateRange: { start: templateStart, end: templateEnd },
    bodyRange: { start: bodyStart, end: bodyStart + body.length },
  });
  if (validation.status !== "valid") {
    throw new Error(`fixture descriptor rejected: ${validation.reason}`);
  }
  return validation.source;
}

function syntheticError(details: TransformErrorDetails): TransformError {
  return new TransformError("synthetic embedded-source diagnostic", details);
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

function expectMapped(
  mapping: EmbeddedDiagnosticMapping,
): Extract<EmbeddedDiagnosticMapping, Readonly<{ status: "mapped" }>> {
  if (mapping.status !== "mapped") throw new Error(`expected mapped, got ${mapping.status}`);
  return mapping;
}

function expectFallback(
  mapping: EmbeddedDiagnosticMapping,
): Extract<EmbeddedDiagnosticMapping, Readonly<{ status: "fallback" }>> {
  if (mapping.status !== "fallback") throw new Error(`expected fallback, got ${mapping.status}`);
  return mapping;
}

const simpleHost = "const value = HSON`01`;";
const simple = descriptorFor(simpleHost, "01");

check("a zero-width body range is valid and exactly reproducible", () => {
  const hostText = "const value = HSON``;";
  const source = descriptorFor(hostText, "");
  assert.equal(read_embedded_hson_body(source), "");
  assert.equal(source.bodyRange.start, source.bodyRange.end);
});

check("a nonempty range beginning at offset zero is valid", () => {
  const validation = validate_embedded_hson_source({
    fileName: "fixture.ts",
    hostText: "tag`x`",
    tagRange: { start: 0, end: 3 },
    templateRange: { start: 3, end: 6 },
    bodyRange: { start: 4, end: 5 },
  });
  assert.equal(validation.status, "valid");
});

check("a range may end exactly at host EOF", () => {
  const hostText = "HSON`x`";
  const validation = validate_embedded_hson_source({
    fileName: "fixture.ts",
    hostText,
    tagRange: { start: 0, end: 4 },
    templateRange: { start: 4, end: hostText.length },
    bodyRange: { start: 5, end: 6 },
  });
  assert.equal(validation.status, "valid");
});

check("a reversed range is rejected without repair", () => {
  const validation = validate_embedded_hson_source({
    ...simple,
    bodyRange: { start: simple.bodyRange.end, end: simple.bodyRange.start },
  });
  assert.deepEqual(validation, { status: "invalid", reason: "body-range-invalid" });
});

check("a negative range offset is rejected without clamping", () => {
  const validation = validate_embedded_hson_source({ ...simple, tagRange: { start: -1, end: 1 } });
  assert.deepEqual(validation, { status: "invalid", reason: "tag-range-invalid" });
});

check("an out-of-bounds range is rejected", () => {
  const validation = validate_embedded_hson_source({
    ...simple,
    templateRange: { start: simple.templateRange.start, end: simpleHost.length + 1 },
  });
  assert.deepEqual(validation, { status: "invalid", reason: "template-range-invalid" });
});

check("a non-integer range offset is rejected", () => {
  const validation = validate_embedded_hson_source({ ...simple, bodyRange: { start: 1.5, end: 2 } });
  assert.deepEqual(validation, { status: "invalid", reason: "body-range-invalid" });
});

check("non-string host source is rejected", () => {
  const validation = validate_embedded_hson_source({ ...simple, hostText: 42 });
  assert.deepEqual(validation, { status: "invalid", reason: "host-text-invalid" });
});

check("body ranges must remain inside template ranges", () => {
  const validation = validate_embedded_hson_source({
    ...simple,
    bodyRange: { start: simple.tagRange.start, end: simple.bodyRange.end },
  });
  assert.deepEqual(validation, { status: "invalid", reason: "body-outside-template" });
});

check("host position maps the first character", () => {
  assert.deepEqual(host_source_position_at("abc", 0), { offset: 0, line: 1, column: 1 });
});

check("LF creates one logical line boundary", () => {
  assert.deepEqual(host_source_position_at("a\nb", 2), { offset: 2, line: 2, column: 1 });
});

check("CRLF creates one line boundary after two UTF-16 offsets", () => {
  assert.deepEqual(host_source_position_at("a\r\nb", 3), { offset: 3, line: 2, column: 1 });
});

check("lone CR creates one logical line boundary", () => {
  assert.deepEqual(host_source_position_at("a\rb", 2), { offset: 2, line: 2, column: 1 });
});

check("mixed line endings retain exact lines and columns", () => {
  assert.deepEqual(host_source_position_at("a\r\nb\rc\nd", 7), { offset: 7, line: 4, column: 1 });
});

check("host EOF has a valid position", () => {
  assert.deepEqual(host_source_position_at("a\n", 2), { offset: 2, line: 2, column: 1 });
});

check("invalid host offsets do not map", () => {
  assert.equal(host_source_position_at("abc", 4), undefined);
});

check("a real HSON point maps at the body start", () => {
  const hostText = "const value = HSON`+1`;";
  const source = descriptorFor(hostText, "+1");
  const error = captureTransformError(() => validate("+1"));
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.deepEqual(mapped.range, { start: source.bodyRange.start, end: source.bodyRange.start + 1 });
});

check("a real HSON point maps in the body middle", () => {
  const error = captureTransformError(() => validate("01"));
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, simple));
  assert.deepEqual(mapped.range, { start: simple.bodyRange.start + 1, end: simple.bodyRange.end });
});

check("a final BMP code point receives one visible UTF-16 code unit", () => {
  const error = syntheticError({
    operation: "synthetic",
    code: "FINAL",
    source: { index: 1, line: 1, column: 2 },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, simple));
  assert.deepEqual(mapped.range, { start: simple.bodyRange.end - 1, end: simple.bodyRange.end });
});

check("EOF receives an explicit zero-width range", () => {
  const error = syntheticError({
    operation: "synthetic",
    code: "EOF",
    source: { index: 2, line: 1, column: 3 },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, simple));
  assert.equal(mapped.precision, "eof");
  assert.deepEqual(mapped.range, { start: simple.bodyRange.end, end: simple.bodyRange.end });
});

check("a real empty-source error maps to empty-body EOF", () => {
  const hostText = "const value = HSON``;";
  const source = descriptorFor(hostText, "");
  const error = captureTransformError(() => validate(""));
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.equal(mapped.precision, "eof");
  assert.equal(mapped.range.start, mapped.range.end);
});

check("an astral code point before the error counts as two offsets", () => {
  const hostText = "const value = HSON`😀x`;";
  const source = descriptorFor(hostText, "😀x");
  const error = syntheticError({
    operation: "synthetic",
    code: "AFTER_ASTRAL",
    source: { index: 2, line: 1, column: 3 },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.equal(mapped.range.start, source.bodyRange.start + 2);
  assert.equal(mapped.end.column, mapped.start.column + 1);
});

check("a point directly on an astral character spans its surrogate pair", () => {
  const hostText = "const value = HSON`😀x`;";
  const source = descriptorFor(hostText, "😀x");
  const error = syntheticError({
    operation: "synthetic",
    code: "ASTRAL",
    source: { index: 0, line: 1, column: 1 },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.deepEqual(mapped.range, { start: source.bodyRange.start, end: source.bodyRange.start + 2 });
});

check("a point on the low surrogate expands backward across its complete pair", () => {
  const hostText = "const value = HSON`😀x`;";
  const source = descriptorFor(hostText, "😀x");
  const error = syntheticError({
    operation: "synthetic",
    code: "LOW_SURROGATE",
    source: { index: 1, line: 1, column: 2 },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.deepEqual(mapped.range, { start: source.bodyRange.start, end: source.bodyRange.start + 2 });
});

check("an isolated surrogate receives one UTF-16 code unit", () => {
  const body = `\uD83Dx`;
  const hostText = `const value = HSON\`${body}\`;`;
  const source = descriptorFor(hostText, body);
  const error = syntheticError({
    operation: "synthetic",
    code: "ISOLATED",
    source: { index: 0, line: 1, column: 1 },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.equal(mapped.range.end - mapped.range.start, 1);
});

check("an indented multiline host maps body offsets to host coordinates", () => {
  const body = "<a 1\n a 2>";
  const hostText = `function f() {\n  return HSON\`${body}\`;\n}`;
  const source = descriptorFor(hostText, body);
  const error = captureTransformError(() => validate(body));
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.deepEqual(mapped.start, { offset: source.bodyRange.start + 6, line: 3, column: 2 });
});

check("multiple descriptors independently reference one host file", () => {
  const hostText = "const a = HSON`+1`;\nconst b = HSON`01`;";
  const first = descriptorFor(hostText, "+1");
  const second = descriptorFor(hostText, "01", first.templateRange.end);
  const firstError = captureTransformError(() => validate("+1"));
  const secondError = captureTransformError(() => validate("01"));
  assert.equal(expectMapped(map_transform_error_to_embedded_source(firstError, first)).start.line, 1);
  assert.equal(expectMapped(map_transform_error_to_embedded_source(secondError, second)).start.line, 2);
});

check("ordinary malformed authored HSON preserves exact index mapping", () => {
  const body = "<a 1b 2>";
  const hostText = `const value = HSON\`${body}\`;`;
  const source = descriptorFor(hostText, body);
  const error = captureTransformError(() => validate(body));
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.equal(error.code, "HSON_NUMBER_TRAILING_JUNK");
  assert.equal(mapped.range.start, source.bodyRange.start + 3);
});

check("duplicate declaration diagnostics map primary and related evidence", () => {
  const body = "<a 1 a 2>";
  const hostText = `const value = HSON\`${body}\`;`;
  const source = descriptorFor(hostText, body);
  const error = captureTransformError(() => validate(body));
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.equal(mapped.range.start, source.bodyRange.start + 5);
  assert.equal(mapped.related[0]?.role, "first-declaration");
  assert.equal(mapped.related[0]?.mapping.status, "mapped");
  assert.deepEqual(
    mapped.related[0]?.mapping.status === "mapped" ? mapped.related[0].mapping.range : undefined,
    { start: source.bodyRange.start + 1, end: source.bodyRange.start + 2 },
  );
});

check("a real source-less Transform error uses an explicit body fallback", () => {
  const value = {};
  const error = captureTransformError(() => (HSON as any)`<a ${value}/>`);
  const body = "<a ${value}/>";
  const hostText = `const value = HSON\`${body}\`;`;
  const source = descriptorFor(hostText, body);
  const mapped = expectFallback(map_transform_error_to_embedded_source(error, source));
  assert.equal(mapped.reason, "source-missing");
  assert.deepEqual(mapped.range, source.bodyRange);
});

function invalidIndexMapsToFallback(index: number): EmbeddedDiagnosticMapping {
  const error = syntheticError({
    operation: "synthetic",
    code: "INVALID_INDEX",
    source: { index, line: 1, column: 1 },
  });
  return map_transform_error_to_embedded_source(error, simple);
}

check("a negative source index is not clamped", () => {
  assert.equal(expectFallback(invalidIndexMapsToFallback(-1)).reason, "source-index-invalid");
});

check("a fractional source index is not clamped", () => {
  assert.equal(expectFallback(invalidIndexMapsToFallback(0.5)).reason, "source-index-invalid");
});

check("a NaN source index is not clamped", () => {
  assert.equal(expectFallback(invalidIndexMapsToFallback(Number.NaN)).reason, "source-index-invalid");
});

check("an infinite source index is not clamped", () => {
  assert.equal(expectFallback(invalidIndexMapsToFallback(Number.POSITIVE_INFINITY)).reason, "source-index-invalid");
});

check("a source index beyond body EOF is not clamped", () => {
  assert.equal(expectFallback(invalidIndexMapsToFallback(3)).reason, "source-index-invalid");
});

check("valid index mapping survives a line-column mismatch with a warning", () => {
  const error = syntheticError({
    operation: "synthetic",
    code: "MISMATCH",
    source: { index: 1, line: 9, column: 9 },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, simple));
  assert.deepEqual(mapped.warnings, ["source-line-column-mismatch"]);
});

check("valid index mapping survives malformed line-column evidence", () => {
  const error = syntheticError({
    operation: "synthetic",
    code: "MALFORMED_COORDINATE",
    source: { index: 1, line: 0, column: Number.NaN },
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, simple));
  assert.deepEqual(mapped.warnings, ["source-line-column-invalid"]);
});

check("a malformed related point does not invalidate a valid primary", () => {
  const error = syntheticError({
    operation: "synthetic",
    code: "RELATED_INVALID",
    source: { index: 1, line: 1, column: 2 },
    related: [{ role: "first-declaration", source: { index: 5, line: 1, column: 6 } }],
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, simple));
  assert.equal(mapped.related[0]?.mapping.status, "unmapped");
});

check("multiple related positions map independently", () => {
  const error = syntheticError({
    operation: "synthetic",
    code: "MULTIPLE_RELATED",
    source: { index: 1, line: 1, column: 2 },
    related: [
      { role: "first", source: { index: 0, line: 1, column: 1 } },
      { role: "second", source: { index: 2, line: 1, column: 3 } },
    ],
  });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, simple));
  assert.deepEqual(mapped.related.map((item) => [item.role, item.mapping.status]), [
    ["first", "mapped"],
    ["second", "mapped"],
  ]);
  const second = mapped.related[1]?.mapping;
  assert.equal(second?.status, "mapped");
  assert.equal(second?.status === "mapped" ? second.precision : undefined, "eof");
});

check("physical CRLF survives exact slicing, parsing, and host mapping", () => {
  const body = "<a 1\r\n a 2>";
  const hostText = `const value = HSON\`${body}\`;`;
  const source = descriptorFor(hostText, body);
  assert.equal(read_embedded_hson_body(source), body);
  const error = captureTransformError(() => validate(read_embedded_hson_body(source)));
  assert.deepEqual(error.source, { index: 7, line: 2, column: 2 });
  const mapped = expectMapped(map_transform_error_to_embedded_source(error, source));
  assert.deepEqual(mapped.start, { offset: source.bodyRange.start + 7, line: 2, column: 2 });
});

check("an invalid descriptor produces no fabricated source range", () => {
  const mapping = map_transform_error_to_embedded_source(
    captureTransformError(() => validate("01")),
    { ...simple, bodyRange: { start: -1, end: 2 } },
  );
  assert.deepEqual(mapping, {
    status: "invalid-descriptor",
    reason: "body-range-invalid",
    warnings: [],
    related: [],
  });
});

process.stdout.write(`# ${checks} embedded HSON diagnostic mapping checks passed\n`);
emit_hson_live_test_completion("transform.embedded-hson-diagnostic-mapping", checks, checks, 0);

import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { JsonValue } from "../src/core/types.ts";
import type { LiveMapSchemaValidation } from "../src/api/livemap/livemap.schema.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { projected_value_from_hson_node } from "../src/core/projected-value-graph.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import {
  resolve_projected_schema_issue_source,
  type ProjectedSchemaSourceResolution,
} from "../src/internal/projected-schema-source-lowering/projected-schema-source-lowering.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function resolve_first<TSchema extends Readonly<{
  validateRoot: (value: JsonValue | undefined) => LiveMapSchemaValidation;
}>>(
  source: string,
  schema: TSchema,
): ProjectedSchemaSourceResolution {
  const parsed = parse_hson_with_provenance(source);
  const value = materialize_projected_value(projected_value_from_hson_node(parsed.value));
  const issue = schema.validateRoot(value).issues[0];
  assert.notEqual(issue, undefined);
  return resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue);
}

function assert_exact_slice(result: ProjectedSchemaSourceResolution, source: string, expected: string): void {
  assert.equal(result.kind, "exact");
  if (result.kind !== "exact") return;
  assert.equal(source.slice(result.range.start, result.range.end), expected);
}

function assert_anchor_slice(result: ProjectedSchemaSourceResolution, source: string, expected: string): void {
  assert.equal(result.kind, "anchor");
  if (result.kind !== "anchor") return;
  assert.equal(source.slice(result.range.start, result.range.end), expected);
}

check("string member type failure resolves its scalar value", () => {
  assert_exact_slice(resolve_first(`<name "bad">`, hson.liveMap.schema.define((s) => s.object({ name: s.number }))), `<name "bad">`, `"bad"`);
});

check("number literal failure resolves its scalar value", () => {
  assert_exact_slice(resolve_first(`<count 1>`, hson.liveMap.schema.define((s) => s.object({ count: s.literal(2) }))), `<count 1>`, "1");
});

check("boolean literal failure resolves its scalar value", () => {
  assert_exact_slice(resolve_first(`<enabled false>`, hson.liveMap.schema.define((s) => s.object({ enabled: s.literal(true) }))), `<enabled false>`, "false");
});

check("nested object primitive failure resolves its scalar value", () => {
  assert_exact_slice(resolve_first(`<user <age "bad">>`, hson.liveMap.schema.define((s) => s.object({ user: s.object({ age: s.number }) }))), `<user <age "bad">>`, `"bad"`);
});

check("array element failure resolves its scalar value", () => {
  assert_exact_slice(resolve_first(`[1, "bad"]`, hson.liveMap.schema.define((s) => s.array(s.number))), `[1, "bad"]`, `"bad"`);
});

check("nested array element failure resolves its scalar value", () => {
  assert_exact_slice(resolve_first(`[[1, "bad"]]`, hson.liveMap.schema.define((s) => s.array(s.array(s.number)))), `[[1, "bad"]]`, `"bad"`);
});

check("object inside array resolves through item and object wrappers", () => {
  assert_exact_slice(resolve_first(`[<age "bad">]`, hson.liveMap.schema.define((s) => s.array(s.object({ age: s.number })))), `[<age "bad">]`, `"bad"`);
});

check("array inside object resolves through property and item wrappers", () => {
  assert_exact_slice(resolve_first(`<items [1, "bad"]>`, hson.liveMap.schema.define((s) => s.object({ items: s.array(s.number) }))), `<items [1, "bad"]>`, `"bad"`);
});

check("scalar root failure uses detached scalar value provenance", () => {
  const result = resolve_first(`"bad"`, hson.liveMap.schema.define((s) => s.number));
  assert_exact_slice(result, `"bad"`, `"bad"`);
  assert.deepEqual(result.kind === "exact" ? result.physicalPath : undefined, [0]);
});

check("container root failure uses detached root coverage", () => {
  const source = `<value 1>`;
  const result = resolve_first(source, hson.liveMap.schema.define((s) => s.array(s.number)));
  assert_exact_slice(result, source, source);
  assert.equal(result.kind === "exact" ? result.role : undefined, "coverage");
});

check("exact-object unknown key resolves the authored member name", () => {
  const result = resolve_first(`<nope 1>`, hson.liveMap.schema.define((s) => s.object.exact({})));
  assert_exact_slice(result, `<nope 1>`, "nope");
  assert.equal(result.kind === "exact" ? result.role : undefined, "name");
});

check("nested exact-object unknown key resolves the nested member name", () => {
  assert_exact_slice(resolve_first(`<box <nope 1>>`, hson.liveMap.schema.define((s) => s.object({ box: s.object.exact({}) }))), `<box <nope 1>>`, "nope");
});

check("missing root object member anchors the parent close", () => {
  assert_anchor_slice(resolve_first(`<name "ok">`, hson.liveMap.schema.define((s) => s.object({ name: s.string, age: s.number }))), `<name "ok">`, ">");
});

check("missing nested object member anchors the nested close", () => {
  assert_anchor_slice(resolve_first(`<user <name "ok">>`, hson.liveMap.schema.define((s) => s.object({ user: s.object({ name: s.string, age: s.number }) }))), `<user <name "ok">>`, ">");
});

check("missing tuple index anchors the array close", () => {
  assert_anchor_slice(resolve_first(`[1]`, hson.liveMap.schema.define((s) => s.tuple(s.number, s.string))), `[1]`, "]");
});

check("nested missing tuple index anchors the nested array close", () => {
  assert_anchor_slice(resolve_first(`<items [1]>`, hson.liveMap.schema.define((s) => s.object({ items: s.tuple(s.number, s.string) }))), `<items [1]>`, "]");
});

check("unicode-prefix scalar resolution retains UTF-16 offsets", () => {
  const source = `<emoji "😀" name "bad">`;
  const result = resolve_first(source, hson.liveMap.schema.define((s) => s.object({ emoji: s.string, name: s.number })));
  assert_exact_slice(result, source, `"bad"`);
  assert.equal(result.kind === "exact" ? result.range.start : undefined, 17);
});

check("object scalar carrier lowers to its physical payload value", () => {
  const result = resolve_first(`<name "bad">`, hson.liveMap.schema.define((s) => s.object({ name: s.number })));
  assert.deepEqual(result.kind === "exact" ? result.physicalPath : undefined, [0, 0, 0, 0]);
});

check("array scalar carrier lowers through its item wrapper", () => {
  const result = resolve_first(`["bad"]`, hson.liveMap.schema.define((s) => s.array(s.number)));
  assert.deepEqual(result.kind === "exact" ? result.physicalPath : undefined, [0, 0, 0]);
});

check("array nested under an object lowers through property and item wrappers", () => {
  const result = resolve_first(`<items ["bad"]>`, hson.liveMap.schema.define((s) => s.object({ items: s.array(s.number) })));
  assert.deepEqual(result.kind === "exact" ? result.physicalPath : undefined, [0, 0, 0, 0, 0]);
});

check("present optional member remains an exact existing-value failure", () => {
  assert_exact_slice(resolve_first(`<age "bad">`, hson.liveMap.schema.define((s) => s.object({ age: s.number.optional }))), `<age "bad">`, `"bad"`);
});

check("tuple extra index resolves the existing entry", () => {
  assert_exact_slice(resolve_first(`[1, "extra"]`, hson.liveMap.schema.define((s) => s.tuple(s.number))), `[1, "extra"]`, `"extra"`);
});

check("root constraint failure resolves root container coverage", () => {
  const source = `[1]`;
  const result = resolve_first(source, hson.liveMap.schema.define((s) => s.array(s.number).constrain((value) => value.length === 2)));
  assert_exact_slice(result, source, source);
});

check("an unknown projected schema path is explicitly unresolved", () => {
  const parsed = parse_hson_with_provenance(`<present 1>`);
  const schema = hson.liveMap.schema.define((s) => s.object({ present: s.number }));
  const issue = schema.validateValue(["ghost"], undefined).issues[0];
  assert.notEqual(issue, undefined);
  assert.equal(resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue).kind, "unresolved");
});

process.stdout.write(`# ${checks} projected Schema source-lowering checks passed\n`);
emit_hson_live_test_completion("livemap.projected-schema-source-lowering", checks, checks, 0);

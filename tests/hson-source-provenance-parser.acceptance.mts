import assert from "node:assert/strict";
import { is_Node } from "../src/core/node-guards.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import type { HsonNodeSourceRole, ParsedHsonWithProvenance } from "../src/internal/hson-source-provenance/hson-source-provenance.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-source-provenance-parser",
  title: "Hson source provenance parser",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "parsing", "source-provenance", "canonical-graph", "internal"]),
});

const testEvents = create_test_event_emitter("transform.hson-source-provenance-parser");
let checks = 0;
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
  } checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); }
function range(source: string, path: readonly number[], role: HsonNodeSourceRole) {
  return parse_hson_with_provenance(source).provenance.range({ kind: "node", path, role });
}
function assertEmptyObjectRange({ value, provenance }: ParsedHsonWithProvenance, path: readonly number[], start: number, end: number): void {
  let node = value;
  for (const index of path) {
    const child = node.$_content[index];
    assert.ok(is_Node(child));
    node = child;
  }
  assert.deepEqual(node, { $_tag: "_hson_obj", $_content: [] });
  assert.deepEqual(provenance.range({ kind: "node", path, role: "open" }), { start, end: start + 1 });
  assert.deepEqual(provenance.range({ kind: "node", path, role: "close" }), { start: end - 1, end });
  assert.deepEqual(provenance.range({ kind: "node", path, role: "coverage" }), { start, end });
}

check("primitive root carrier has semantic coverage", () => assert.deepEqual(range(`42`, [], "coverage"), { start: 0, end: 2 }));
check("primitive payload has value coverage", () => assert.deepEqual(range(`42`, [0], "value"), { start: 0, end: 2 }));
check("quoted string payload includes authored quotes", () => assert.deepEqual(range(`"a\\n"`, [0], "value"), { start: 0, end: 5 }));
check("negative zero retains its authored value range", () => assert.deepEqual(range(`-0`, [0], "value"), { start: 0, end: 2 }));
check("empty object owns authored delimiters", () => {
  assertEmptyObjectRange(parse_hson_with_provenance("<>"), [], 0, 2);
});
check("a named member's empty object owns the inner delimiters", () => {
  const parsed = parse_hson_with_provenance("<string <>>");
  assertEmptyObjectRange(parsed, [0, 0], 8, 10);
  assert.equal(parsed.provenance.range({ kind: "node", path: [0], role: "open" }), undefined);
  assert.equal(parsed.provenance.range({ kind: "node", path: [0], role: "close" }), undefined);
  assert.deepEqual(parsed.provenance.range({ kind: "node", path: [], role: "close" }), { start: 10, end: 11 });
  assert.throws(() => parse_hson_with_provenance("<string>"), /missing its value/);
});
check("adjacent empty and populated members retain distinct nested object ranges", () => {
  const parsed = parse_hson_with_provenance("<outer <empty <> full <n 1>>>");
  assertEmptyObjectRange(parsed, [0, 0, 0, 0], 14, 16);
  const full = [0, 0, 1, 0];
  assert.deepEqual(parsed.provenance.range({ kind: "node", path: full, role: "open" }), { start: 22, end: 23 });
  assert.deepEqual(parsed.provenance.range({ kind: "node", path: full, role: "close" }), { start: 26, end: 27 });
  const scalarWrapper = [...full, 0, 0];
  assert.deepEqual(parsed.provenance.range({ kind: "node", path: scalarWrapper, role: "coverage" }), { start: 25, end: 26 });
  assert.equal(parsed.provenance.range({ kind: "node", path: scalarWrapper, role: "open" }), undefined);
  assert.equal(parsed.provenance.range({ kind: "node", path: scalarWrapper, role: "close" }), undefined);
});
check("direct and member-valued empty objects retain their paths inside arrays", () => {
  const parsed = parse_hson_with_provenance("[<>, <item <>>]");
  assertEmptyObjectRange(parsed, [0, 0], 1, 3);
  assertEmptyObjectRange(parsed, [1, 0, 0, 0], 11, 13);
  assert.deepEqual(parsed.provenance.range({ kind: "node", path: [0], role: "coverage" }), { start: 1, end: 3 });
  assert.equal(parsed.provenance.range({ kind: "node", path: [0], role: "open" }), undefined);
  assert.equal(parsed.provenance.range({ kind: "node", path: [0], role: "close" }), undefined);
});
check("nested empty object ranges follow authored delimiters through comments and CRLF", () => {
  const compact = "<string // before <>\r\n  <> // after <>\r\n>";
  assertEmptyObjectRange(parse_hson_with_provenance(compact), [0, 0], 24, 26);
  const spaced = "<string < // inside\r\n >>";
  assertEmptyObjectRange(parse_hson_with_provenance(spaced), [0, 0], 8, 23);
});
check("populated object owns full coverage", () => assert.deepEqual(range(`<a 1>`, [], "coverage"), { start: 0, end: 5 }));
check("object member has authored name but no fabricated open", () => {
  assert.deepEqual(range(`<a 1>`, [0], "name"), { start: 1, end: 2 });
  assert.equal(range(`<a 1>`, [0], "open"), undefined);
});
check("object member coverage spans name and value", () => assert.deepEqual(range(`<a 1>`, [0], "coverage"), { start: 1, end: 4 }));
check("object member scalar reaches its physical payload path", () => assert.deepEqual(range(`<a 1>`, [0, 0, 0, 0], "value"), { start: 3, end: 4 }));
check("quoted object member name includes quotes", () => assert.deepEqual(range(`<'a b' 1>`, [0], "name"), { start: 1, end: 6 }));
check("element coverage owns the complete angle construct", () => assert.deepEqual(range(`<main/>`, [0], "coverage"), { start: 0, end: 7 }));
check("element opening role is only the actual less-than sign", () => assert.deepEqual(range(`<main/>`, [0], "open"), { start: 0, end: 1 }));
check("element closing role is the actual slash-greater-than pair", () => assert.deepEqual(range(`<main/>`, [0], "close"), { start: 5, end: 7 }));
check("element content leaf preserves its literal", () => assert.deepEqual(range(`<x "hi"/>`, [0, 0, 0, 0], "value"), { start: 3, end: 7 }));
check("guillemet array owns actual delimiters", () => {
  assert.deepEqual(range(`«1»`, [], "open"), { start: 0, end: 1 });
  assert.deepEqual(range(`«1»`, [], "close"), { start: 2, end: 3 });
});
check("bracket array owns actual delimiters", () => {
  assert.deepEqual(range(`[1]`, [], "open"), { start: 0, end: 1 });
  assert.deepEqual(range(`[1]`, [], "close"), { start: 2, end: 3 });
});
check("array item wrapper has coverage but no fabricated lexical roles", () => {
  assert.deepEqual(range(`[1]`, [0], "coverage"), { start: 1, end: 2 });
  assert.equal(range(`[1]`, [0], "name"), undefined);
  assert.equal(range(`[1]`, [0], "open"), undefined);
});
check("array scalar child shares authored coverage", () => assert.deepEqual(range(`[1]`, [0, 0], "coverage"), { start: 1, end: 2 }));
check("array scalar payload owns value spelling", () => assert.deepEqual(range(`[1]`, [0, 0, 0], "value"), { start: 1, end: 2 }));
check("nested arrays receive physical content paths", () => assert.deepEqual(range(`[[true]]`, [0, 0], "coverage"), { start: 1, end: 7 }));

check("adjacent member openers retain exact authored name, coverage and value delimiter ranges", () => {
  for (const value of ['<>', '<id 1>', '«1»', '[1]']) {
    const source = '<content' + value + '>';
    assert.deepEqual(range(source, [0], 'name'), { start: 1, end: 8 });
    assert.deepEqual(range(source, [0], 'coverage'), { start: 1, end: source.length - 1 });
    assert.equal(range(source, [0], 'open'), undefined);
    assert.equal(range(source, [0], 'close'), undefined);
    assert.deepEqual(range(source, [0, 0], 'open'), { start: 8, end: 9 });
    assert.deepEqual(range(source, [0, 0], 'close'), { start: source.length - 2, end: source.length - 1 });
  }
});

process.stdout.write(`# ${checks} Hson provenance-parser checks passed\n`);
testEvents.terminal("pass");

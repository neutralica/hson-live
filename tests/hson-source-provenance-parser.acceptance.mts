import assert from "node:assert/strict";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import type { HsonNodeSourceRole } from "../src/internal/hson-source-provenance/hson-source-provenance.ts";
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

check("primitive root carrier has semantic coverage", () => assert.deepEqual(range(`42`, [], "coverage"), { start: 0, end: 2 }));
check("primitive payload has value coverage", () => assert.deepEqual(range(`42`, [0], "value"), { start: 0, end: 2 }));
check("quoted string payload includes authored quotes", () => assert.deepEqual(range(`"a\\n"`, [0], "value"), { start: 0, end: 5 }));
check("negative zero retains its authored value range", () => assert.deepEqual(range(`-0`, [0], "value"), { start: 0, end: 2 }));
check("empty object owns authored delimiters", () => {
  assert.deepEqual(range(`<>`, [], "open"), { start: 0, end: 1 });
  assert.deepEqual(range(`<>`, [], "close"), { start: 1, end: 2 });
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

process.stdout.write(`# ${checks} Hson provenance-parser checks passed\n`);
testEvents.terminal("pass");

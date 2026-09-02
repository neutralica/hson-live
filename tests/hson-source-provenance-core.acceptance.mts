import assert from "node:assert/strict";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import type { HsonSourceLocation } from "../src/internal/hson-source-provenance/hson-source-provenance.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-source-provenance-core",
  title: "Hson source provenance core",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "parsing", "source-provenance", "internal"]),
});

const testEvents = create_test_event_emitter("transform.hson-source-provenance-core");
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
  } checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}
const node = (path: readonly number[], role: "coverage" | "name" | "value" | "open" | "close"): HsonSourceLocation =>
  ({ kind: "node", path, role });
const attr = (owner: readonly number[], name: string, role: "coverage" | "name" | "value"): HsonSourceLocation =>
  ({ kind: "attribute", owner, name, role });

check("sourceRange covers the complete authored UTF-16 snapshot", () => {
  assert.deepEqual(parse_hson_with_provenance(`  1\r\n`).provenance.sourceRange, { start: 0, end: 5 });
});
check("final ranges are immutable", () => {
  const range = parse_hson_with_provenance(`1`).provenance.range(node([0], "value"));
  assert.ok(range); assert.equal(Object.isFrozen(range), true);
});
check("parse result and sidecar are immutable facades", () => {
  const result = parse_hson_with_provenance(`1`);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.provenance), true);
});
check("unknown physical paths return undefined", () => {
  assert.equal(parse_hson_with_provenance(`1`).provenance.range(node([9], "coverage")), undefined);
});
check("unknown roles return undefined", () => {
  assert.equal(parse_hson_with_provenance(`1`).provenance.range(node([], "name")), undefined);
});
check("attribute lookup is separate from numeric content lookup", () => {
  const p = parse_hson_with_provenance(`<x id="a"/>`).provenance;
  assert.deepEqual(p.range(attr([0], "id", "coverage")), { start: 3, end: 9 });
  assert.equal(p.range(node([0], "value")), undefined);
});
check("attribute name range is exact", () => {
  const p = parse_hson_with_provenance(`<x id="a"/>`).provenance;
  assert.deepEqual(p.range(attr([0], "id", "name")), { start: 3, end: 5 });
});
check("quoted attribute value includes quotes", () => {
  const p = parse_hson_with_provenance(`<x id="a"/>`).provenance;
  assert.deepEqual(p.range(attr([0], "id", "value")), { start: 6, end: 9 });
});
check("unquoted attribute value is exact", () => {
  const p = parse_hson_with_provenance(`<x id=abc/>`).provenance;
  assert.deepEqual(p.range(attr([0], "id", "value")), { start: 6, end: 9 });
});
check("flag attributes have coverage and name but no value", () => {
  const p = parse_hson_with_provenance(`<x disabled/>`).provenance;
  assert.deepEqual(p.range(attr([0], "disabled", "coverage")), { start: 3, end: 11 });
  assert.deepEqual(p.range(attr([0], "disabled", "name")), { start: 3, end: 11 });
  assert.equal(p.range(attr([0], "disabled", "value")), undefined);
});
check("structured style remains one owner attribute facet", () => {
  const p = parse_hson_with_provenance(`<x style="color:red; width:2px"/>`).provenance;
  assert.deepEqual(p.range(attr([0], "style", "value")), { start: 9, end: 31 });
  assert.equal(p.range(attr([0], "color", "value")), undefined);
});
check("synthetic detached clusters expose coverage without lexical facets", () => {
  const p = parse_hson_with_provenance(`<x/>`).provenance;
  assert.deepEqual(p.range(node([], "coverage")), { start: 0, end: 4 });
  assert.equal(p.range(node([], "open")), undefined);
  assert.equal(p.range(node([], "close")), undefined);
});
check("authored element owns its lexical facets", () => {
  const p = parse_hson_with_provenance(`<x/>`).provenance;
  assert.deepEqual(p.range(node([0], "name")), { start: 1, end: 2 });
  assert.deepEqual(p.range(node([0], "open")), { start: 0, end: 1 });
  assert.deepEqual(p.range(node([0], "close")), { start: 2, end: 4 });
});
check("queries do not depend on caller path-array identity", () => {
  const p = parse_hson_with_provenance(`<x/>`).provenance;
  assert.deepEqual(p.range(node([0], "name")), p.range(node(Array.of(0), "name")));
});
check("same source produces structurally identical query results", () => {
  const locations = [node([], "coverage"), node([0], "name"), attr([0], "id", "value")];
  const first = parse_hson_with_provenance(`<x id="a"/>`).provenance;
  const second = parse_hson_with_provenance(`<x id="a"/>`).provenance;
  assert.deepEqual(locations.map((x) => first.range(x)), locations.map((x) => second.range(x)));
});

process.stdout.write(`# ${checks} Hson provenance-core checks passed\n`);
testEvents.terminal("pass");

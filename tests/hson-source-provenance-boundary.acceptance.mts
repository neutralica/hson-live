import assert from "node:assert/strict";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, body: () => void): void { body(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); }
const valueRange = (source: string, path: readonly number[]) =>
  parse_hson_with_provenance(source).provenance.range({ kind: "node", path, role: "value" });

check("provenance value is the exact detached canonical root", () => {
  const result = parse_hson_with_provenance(`<a 1>`);
  assert.equal(result.value.$_tag, "_hson_obj"); assert.notEqual(result.value.$_tag, "_hson_root");
});
check("ordinary parser still returns its internal root carrier", () => assert.equal(parse_hson(`1`).$_tag, "_hson_root"));
check("ordinary and provenance parses have equal detached graphs", () => {
  const source = `<a [1,"x",false]>`;
  assert.equal(canonical_hson_graph_equal(detach_hson_root_value(parse_hson(source)), parse_hson_with_provenance(source).value), true);
});
check("comments and whitespace do not alter literal targeting", () => assert.deepEqual(valueRange(`// lead\r\n  1`, [0]), { start: 11, end: 12 }));
check("LF offsets are source-global", () => assert.deepEqual(valueRange(`<a\n 1>`, [0, 0, 0, 0]), { start: 4, end: 5 }));
check("CRLF offsets are source-global", () => assert.deepEqual(valueRange(`<a\r\n 1>`, [0, 0, 0, 0]), { start: 5, end: 6 }));
check("lone CR offsets are source-global", () => assert.deepEqual(valueRange(`<a\r 1>`, [0, 0, 0, 0]), { start: 4, end: 5 }));
check("astral Unicode contributes two UTF-16 code units", () => assert.deepEqual(valueRange(`<a "😀"/>`, [0, 0, 0, 0]), { start: 3, end: 7 }));
check("escaped strings target original authored spelling", () => assert.deepEqual(valueRange(`"\\u0041"`, [0]), { start: 0, end: 8 }));
check("escaped quoted names target original authored spelling", () => {
  const p = parse_hson_with_provenance(`<'a\\u0020b'/>`).provenance;
  assert.deepEqual(p.range({ kind: "node", path: [0], role: "name" }), { start: 1, end: 11 });
});
check("escaped apostrophes remain within quoted-name ranges", () => {
  const source = `<'a\\'b'/>`;
  const range = parse_hson_with_provenance(source).provenance.range({ kind: "node", path: [0], role: "name" });
  assert.deepEqual(range, { start: 1, end: 7 });
  assert.equal(source.slice(range?.start, range?.end), `'a\\'b'`);
});
check("exponent normalization retains exponent spelling range", () => assert.deepEqual(valueRange(`1e+3`, [0]), { start: 0, end: 4 }));
check("boolean and null retain authored ranges", () => {
  assert.deepEqual(valueRange(`true`, [0]), { start: 0, end: 4 });
  assert.deepEqual(valueRange(`null`, [0]), { start: 0, end: 4 });
});
check("alternate array spelling retains bracket positions", () => {
  const p = parse_hson_with_provenance(`[1]`).provenance;
  assert.deepEqual(p.range({ kind: "node", path: [], role: "coverage" }), { start: 0, end: 3 });
});
check("element sequences have synthetic cluster coverage only", () => {
  const p = parse_hson_with_provenance(`<a/><b/>`).provenance;
  assert.deepEqual(p.range({ kind: "node", path: [], role: "coverage" }), { start: 0, end: 8 });
  assert.equal(p.range({ kind: "node", path: [], role: "open" }), undefined);
});
check("final-character range is half-open at EOF", () => assert.deepEqual(valueRange(`0`, [0]), { start: 0, end: 1 }));
check("repeated parse preserves value and range determinism", () => {
  const source = `<x style="color:red" "a\\n"/>`;
  const a = parse_hson_with_provenance(source); const b = parse_hson_with_provenance(source);
  assert.equal(canonical_hson_graph_equal(a.value, b.value), true);
  assert.deepEqual(a.provenance.range({ kind: "node", path: [0], role: "coverage" }), b.provenance.range({ kind: "node", path: [0], role: "coverage" }));
});

process.stdout.write(`# ${checks} Hson provenance-boundary checks passed\n`);
emit_hson_live_test_completion("transform.hson-source-provenance-boundary", checks, checks, 0);

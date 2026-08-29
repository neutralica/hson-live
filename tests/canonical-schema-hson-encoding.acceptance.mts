import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { LiveMapProjectedSchema } from "../src/api/livemap/livemap.schema.ts";
import { decode_canonical_schema_graph_hson, encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { lower_current_schema } from "../src/internal/canonical-schema/lower-current-schema.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { CANONICAL_SCHEMA_FORMAT, CANONICAL_SCHEMA_VERSION, type VerifiedCanonicalSchemaGraph } from "../src/internal/canonical-schema/graph.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const define = hson.liveMap.schema.define;
const lower = (schema: object): VerifiedCanonicalSchemaGraph => { const result = lower_current_schema(schema); assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.reasons)); if (!result.ok) throw new Error("unreachable"); return result.graph; };
const roundtrip = (name: string, schema: object): void => check(name, () => {
  const graph = lower(schema); const source = encode_canonical_schema_graph_hson(graph); const decoded = decode_canonical_schema_graph_hson(source);
  assert.equal(decoded.ok, true, decoded.ok ? "" : decoded.issues.map(issue => issue.message).join("; "));
  if (decoded.ok) assert.deepEqual(decoded.graph, graph);
});

roundtrip("primitive graph round-trips", define(s => s.string));
roundtrip("multi-literal graph round-trips", define(s => s.literal("x", 1, true, null)));
roundtrip("negative zero survives wire encoding", define(s => s.literal(-0)));
roundtrip("ordered literal object survives wire encoding", define(s => s.literal({ "2": "b", "1": "a", z: 0 })));
roundtrip("nested literal arrays and objects round-trip", define(s => s.literal([{ b: 2, a: 1 }, -0])));
roundtrip("open object graph round-trips", define(s => s.object({ x: s.number })));
roundtrip("exact object graph round-trips", define(s => s.object.exact({ x: s.number.optional })));
roundtrip("broad array graph round-trips", define(s => s.array()));
roundtrip("homogeneous array graph round-trips", define(s => s.array(s.boolean)));
roundtrip("tuple graph round-trips", define(s => s.tuple(s.string, s.number.optional)));
roundtrip("record graph round-trips", define(s => s.record(s.string.nullable)));
roundtrip("ordered union graph round-trips", define(s => s.pick(s.literal("a"), s.literal("b"))));
roundtrip("element root graph round-trips", define(s => s.main(s.string, s.tag())));
roundtrip("fragment root graph round-trips", define(s => s.tuple(s.string, s.tag())));
roundtrip("attrs and projected attr refs round-trip", define(s => s.button(s.attrs.exact({ disabled: s.flag, count: s.number.optional }))));
roundtrip("repeat graph round-trips", define(s => s.repeat(s.string)));
roundtrip("counted repeat graph round-trips", define(s => s.repeat(3, s.tag())));
roundtrip("document item union graph round-trips", define(s => s.tag(s.pick(s.string, s.tag()))));
roundtrip("document content union graph round-trips", define(s => s.pick(s.tuple(s.string), s.repeat(s.tag()))));

check("encoding is deterministic across equivalent lowerings", () => {
  const make = () => define(s => s.object.exact({ kind: s.literal("a"), values: s.array(s.number) }));
  assert.equal(encode_canonical_schema_graph_hson(lower(make())), encode_canonical_schema_graph_hson(lower(make())));
});
check("ordinary object closer is used and no magic structural tag is present", () => {
  const source = encode_canonical_schema_graph_hson(lower(define(s => s.string)));
  assert.equal(source.endsWith(">"), true); assert.equal(source.endsWith("/>"), false);
  assert.doesNotMatch(source, /<(object|_elem|element)(?:\s|>|\/)/);
});
check("changing ordinary object closer to element closer is rejected", () => {
  const source = encode_canonical_schema_graph_hson(lower(define(s => s.string)));
  const elementMode = `${source.slice(0, -1)}/>`;
  assert.equal(decode_canonical_schema_graph_hson(elementMode).ok, false);
});
check("malformed mixed closer remains an HSON rejection", () => {
  const source = encode_canonical_schema_graph_hson(lower(define(s => s.string)));
  assert.equal(decode_canonical_schema_graph_hson(`${source.slice(0, -1)}/>>`).ok, false);
});
check("unknown graph fields reject after decoding", () => {
  const source = '<format "hson-canonical-schema" version 1 capabilities <projectedRoot 0> nodes [<kind "projected-string">] surprise true>';
  const result = decode_canonical_schema_graph_hson(source); assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.issues.map(issue => issue.message).join("\n"), /Unknown field/);
});
check("bad capability refs reject after decoding", () => {
  const source = '<format "hson-canonical-schema" version 1 capabilities <projectedRoot 9> nodes [<kind "projected-string">]>';
  assert.equal(decode_canonical_schema_graph_hson(source).ok, false);
});
check("nonsemantic metadata is separated from semantic nodes", () => {
  const base = lower(define(s => s.string));
  const withDocs = verify_canonical_schema_graph({ ...base, documentationMetadata: { description: "docs only", sourceLocation: "/different/path" } });
  assert.equal(withDocs.ok, true);
  if (withDocs.ok) {
    assert.deepEqual(withDocs.graph.nodes, base.nodes);
    assert.deepEqual(withDocs.graph.capabilities, base.capabilities);
    assert.notEqual(encode_canonical_schema_graph_hson(withDocs.graph), encode_canonical_schema_graph_hson(base));
  }
});
check("semantic change changes deterministic machine encoding", () => {
  assert.notEqual(encode_canonical_schema_graph_hson(lower(define(s => s.literal("a")))), encode_canonical_schema_graph_hson(lower(define(s => s.literal("b")))));
  assert.notEqual(encode_canonical_schema_graph_hson(lower(define(s => s.object({ x: s.string })))), encode_canonical_schema_graph_hson(lower(define(s => s.object.exact({ x: s.string })))));
});
check("resolved productive recursion serializes as an acyclic node table", () => {
  let Tree: LiveMapProjectedSchema;
  Tree = define(s => s.object({ value: s.string, child: s.recurse(() => Tree).optional }));
  Tree.validateRoot({ value: "root", child: { value: "leaf" } });
  const graph = lower(Tree); const source = encode_canonical_schema_graph_hson(graph); const decoded = decode_canonical_schema_graph_hson(source);
  assert.equal(decoded.ok, true); assert.match(source, /projected-ref/);
});

emit_hson_live_test_completion("canonical-schema-hson-encoding", checks, checks, 0);

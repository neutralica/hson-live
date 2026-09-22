// @hson-live-external-test
import assert from "node:assert/strict";
import { hsonTransform } from "../src/api/transform/index.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { assign_hson_node_quid, read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { parse_hson_exact_runtime, serialize_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";

const Q1 = "000000001";
const Q2 = "000000002";
const graph = detach_hson_root_value(parse_hson_exact_runtime(`<main id="app"/>`));

function rejects_portable_quid(run: () => unknown): void {
  let observed: unknown;
  try { run(); } catch (error) { observed = error; }
  assert.equal(read_transform_error_details(observed)?.code, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
}

const source = hsonTransform.fromNode(graph);
assign_hson_node_quid(graph.$_content[0] as typeof graph, Q1);
const hson = source.toHson().serialize();
const json = source.toJson().serialize();
const value = source.toJson().value();
const html = source.toHtml().serialize();
assert.equal(hson, `<main id="app"/>`);
assert.doesNotMatch(json, /"quid"/);
assert.deepEqual(value, { _hson_elem: [{ main: { _hson_elem: [] }, $_attrs: { id: "app" } }] });
assert.equal(html, `<main id="app"></main>`);
assert.throws(
  () => Reflect.apply(source.toHson().withOptions, undefined, [{ noQuid: true }]),
  /noQuid is retired/,
);
assert.equal(read_hson_node_quid(graph.$_content[0] as typeof graph), Q1);

rejects_portable_quid(() => hsonTransform.fromHson(`<main @${Q1}/>`).toNode());
rejects_portable_quid(() => hsonTransform.fromJson({ main: "", $_meta: { quid: Q1 } }).toNode());
rejects_portable_quid(() => hsonTransform.fromJson(JSON.stringify({ main: "", $_meta: { quid: Q1 } })).toNode());
rejects_portable_quid(() => hsonTransform.fromTrustedHtml(`<main hson:quid="${Q1}"></main>`).toNode());
rejects_portable_quid(() => hsonTransform.fromUntrustedHtml(`<main hson:quid="${Q1}"></main>`).toNode());

const reparsed = hsonTransform.fromHson(hson).toNode();
assert.equal(read_hson_node_quid(reparsed.$_content[0] as typeof reparsed), undefined);
assert.equal(serialize_hson_exact_runtime(reparsed), hson);
assert.equal(canonical_hson_graph_equal(graph, reparsed), false);
const otherIdentity = detach_hson_root_value(parse_hson_exact_runtime(`<main @${Q2} id="app"/>`));
assert.equal(canonical_hson_graph_equal(graph, otherIdentity), false);
assert.equal(serialize_hson(otherIdentity), hson);

const arrayHtml = hsonTransform.fromJson([1]).toHtml().serialize();
assert.match(arrayHtml, /hson:index="0"/);
assert.doesNotMatch(arrayHtml, /hson:quid/);

process.stdout.write("portable Transform QUID boundary checks passed\n");

import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import { exact_tagged_payload, invalid_tagged_graphs } from "./helpers/tagged-codec-fixture.mts";
import { decode_exact_hson_value, encode_exact_hson_value } from "../src/api/livemap/livemap.document.view-state-codec.ts";
import {
  decode_locus_graph_content,
  decode_locus_portable_graph_content,
  encode_locus_portable_graph_content,
  encode_locus_graph_content,
  is_locus_encoded_graph_content,
  LocusGraphContentCodecError,
} from "../src/api/locus/locus.graph-content-codec.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.graph-content-codec",
  title: "Locus graph-content codec",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "codec", "serialization", "canonicalization"]),
});

const testEvents = create_test_event_emitter("locus.graph-content-codec");
let checks = 0;
function check(name: string, fn: () => void): void {
  testEvents.case_begin(name, name);
  try {
    fn();
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

function expect_rejection(value: unknown, code: string): void {
  assert.throws(
    () => decode_locus_graph_content(value),
    (cause) => cause instanceof LocusGraphContentCodecError && cause.code === code,
  );
}

check("exact graph payload round-trips nested nodes, typed attributes, structured style, and runtime QUIDs", () => {
  const source = detach_hson_root_value(parse_hson_exact_runtime(
    `<main @000000001 <input @000000002 checked=false/>/>`,
  ));
  assert.equal(source.$_tag, "_hson_elem");
  const main = source.$_content[0];
  if (!is_Node(main)) throw new Error("Expected main");
  main.$_attrs = { style: { color: "red", width: { value: 2, unit: "px" } } };
  const encoded = encode_locus_graph_content(source);
  const decoded = decode_locus_graph_content(encoded);
  assert.equal(is_Node(decoded), true);
  if (!is_Node(decoded)) throw new Error("Expected node");
  assert.equal(canonical_hson_graph_equal(decoded, source), true);
  assert.notEqual(decoded, source);
  assert.deepEqual(Object.keys(encoded).sort(), ["format", "payload"]);
  assert.equal(encoded.format, "hson-graph");
  assert.equal(JSON.stringify(encoded).includes("$_tag"), false);
  assert.match(encoded.payload, /000000001/);
  const portable = encode_locus_portable_graph_content(source);
  assert.equal(portable.format, "hson-graph-portable");
  assert.doesNotMatch(portable.payload, /@00000000/);
  assert.ok(is_Node(decode_locus_portable_graph_content(portable)));
  assert.throws(() => decode_locus_graph_content(portable), /format is unknown/);
  assert.throws(() => decode_locus_portable_graph_content(encoded), /format is unknown/);
  assert.throws(() => decode_locus_portable_graph_content({ ...portable, payload: encoded.payload }), /content is invalid/);

});

check("canonical primitives round-trip without JSON-node projection", () => {
  for (const value of ["text", "", 0, -0, false, true, null] as const) {
    assert.deepEqual(decode_locus_graph_content(encode_locus_graph_content(value)), value);
  }
});

check("direct malformed machine graphs reject without selecting recovery", () => {
  for (const invalid of invalid_tagged_graphs) {
    const payload = exact_tagged_payload(invalid.value);
    assert.throws(() => decode_exact_hson_value(payload), invalid.name);
    expect_rejection({ format: "hson-graph", payload }, "LOCUS_GRAPH_CONTENT_PAYLOAD_INVALID");
    assert.equal(is_locus_encoded_graph_content({ format: "hson-graph", payload }), false, invalid.name);
    assert.throws(() => decode_locus_portable_graph_content({ format: "hson-graph-portable", payload }), invalid.name);
  }
  const invalidGraphs: HsonNode[] = [
    { $_tag: "span", $_content: [], $_meta: {} },
    { $_tag: "_hson_elem", $_content: [{ $_tag: "span", $_content: [], $_meta: {} }] },
    { $_tag: "_hson_obj", $_content: [{ $_tag: "_hson_obj", $_content: [] }] },
  ];
  for (const invalid of invalidGraphs) {
    assert.throws(() => encode_exact_hson_value(invalid));
    assert.throws(() => encode_locus_graph_content(invalid));
  }
});

check("generic carriers preserve lawful runtime distinctions with independent graph oracles", () => {
  const str = (value: string): HsonNode => ({ $_tag: "_hson_str", $_content: [value] });
  const graphs: HsonNode[] = [
    { $_tag: "_hson_root", $_content: [{ $_tag: "_hson_obj", $_content: [] }] },
    { $_tag: "_hson_root", $_content: [{ $_tag: "_hson_arr", $_content: [] }] },
    { $_tag: "_hson_root", $_content: [{ $_tag: "_hson_val", $_content: [-0] }] },
    { $_tag: "_hson_root", $_content: [{ $_tag: "_hson_elem", $_content: [str("")] }] },
    { $_tag: "_hson_arr", $_content: [] },
    { $_tag: "_hson_val", $_content: [-0] },
    { $_tag: "_hson_elem", $_content: [str("")] },
    { $_tag: "span", $_content: [{ $_tag: "_hson_elem", $_content: [str(""), str(" "), str("tail")] }],
      $_attrs: { checked: false, count: -0, optional: null, style: { width: { value: 2, unit: undefined } } }, $_meta: { quid: "000000001" } },
    { $_tag: "span", $_content: [], $_attrs: { style: {} } },
    { $_tag: "member", $_content: [{ $_tag: "_hson_obj", $_content: [str("")] }] },
  ];
  for (const graph of graphs) {
    const wire = encode_locus_graph_content(graph);
    const decoded = decode_locus_graph_content(wire);
    assert.ok(is_Node(decoded));
    assert.equal(canonical_hson_graph_equal(decoded, graph), true);
    assert.equal(is_locus_encoded_graph_content(wire), true);
    assert.equal(encode_locus_graph_content(decoded).payload, wire.payload);
    if (graph.$_meta?.quid) {
      assert.throws(() => decode_locus_portable_graph_content({ format: "hson-graph-portable", payload: wire.payload }));
      const style = decoded.$_attrs?.style;
      assert.ok(typeof style === "object" && style !== null && "width" in style);
      const width = style.width;
      assert.ok(typeof width === "object" && width !== null);
      assert.equal(Object.hasOwn(width, "unit"), true);
    }
  }
});

check("multiNodeDocument and empty-multiNodeDocument roots retain exact structure", () => {
  for (const source of [`"before" <em "middle"/> "after"`, ``]) {
    const root = source === ""
      ? { $_tag: "_hson_root", $_content: [] }
      : parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true });
    const decoded = decode_locus_graph_content(encode_locus_graph_content(root));
    assert.equal(is_Node(decoded), true);
    if (!is_Node(decoded)) throw new Error("Expected node");
    assert.equal(canonical_hson_graph_equal(decoded, root), true);
  }
});

check("strict envelopes reject missing, extra, and malformed Hson fields", () => {
  expect_rejection(
    { format: "hson-graph" },
    "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
  );
  expect_rejection(
    { format: "hson-graph", payload: "", extra: true },
    "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
  );
  expect_rejection(
    { format: "hson-graph", payload: "<broken" },
    "LOCUS_GRAPH_CONTENT_PAYLOAD_INVALID",
  );
  expect_rejection(
    { format: "hson-graph", payload: "<main @0000000000000001/>" },
    "LOCUS_GRAPH_CONTENT_PAYLOAD_INVALID",
  );
});

check("duplicate runtime QUIDs and structurally invalid canonical nodes are rejected", () => {
  const valid = encode_locus_graph_content(
    detach_hson_root_value(parse_hson_exact_runtime(`<main @000000001 <p @000000002/>/>`)),
  );
  expect_rejection(
    { ...valid, payload: valid.payload.replace("000000002", "000000001") },
    "LOCUS_GRAPH_CONTENT_GRAPH_INVALID",
  );
  assert.throws(
    () => encode_locus_graph_content({ $_tag: "bad" } as never),
    (cause) => cause instanceof LocusGraphContentCodecError
      && cause.code === "LOCUS_GRAPH_CONTENT_GRAPH_INVALID",
  );
});

process.stdout.write(`# ${checks} Locus graph-content codec checks passed\n`);
testEvents.terminal("pass");

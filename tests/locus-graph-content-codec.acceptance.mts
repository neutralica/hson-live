import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import {
  decode_locus_graph_content,
  encode_locus_graph_content,
  LocusGraphContentCodecError,
} from "../src/api/locus/locus.graph-content-codec.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function expect_rejection(value: unknown, code: string): void {
  assert.throws(
    () => decode_locus_graph_content(value),
    (cause) => cause instanceof LocusGraphContentCodecError && cause.code === code,
  );
}

check("exact graph payload round-trips nested nodes, typed attributes, structured style, and persisted QUIDs", () => {
  const source = hson.fromHson(
    `<main @000000001 <input @000000002 checked=false/>/>`,
  ).toNode();
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
});

check("canonical primitives round-trip without JSON-node projection", () => {
  for (const value of ["text", 0, false, null] as const) {
    assert.deepEqual(decode_locus_graph_content(encode_locus_graph_content(value)), value);
  }
});

check("fragment and empty-fragment roots retain exact structure", () => {
  for (const source of [`"before" <em "middle"/> "after"`, ``]) {
    const map = source === ""
      ? hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] })
      : hson.liveMap.fromHson(source);
    if (map.mode !== "element" && map.mode !== "fragment") throw new Error("Expected document map");
    const root = map.capture().root;
    const decoded = decode_locus_graph_content(encode_locus_graph_content(root));
    assert.equal(is_Node(decoded), true);
    if (!is_Node(decoded)) throw new Error("Expected node");
    assert.equal(canonical_hson_graph_equal(decoded, root), true);
  }
});

check("strict envelopes reject missing, extra, removed-version, and malformed HSON fields", () => {
  expect_rejection(
    { format: "hson-graph" },
    "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
  );
  expect_rejection(
    { format: "hson-graph", payload: "", extra: true },
    "LOCUS_GRAPH_CONTENT_ENVELOPE_INVALID",
  );
  expect_rejection(
    { format: "hson-graph", formatVersion: 2, payload: "" },
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

check("duplicate persisted QUIDs and structurally invalid canonical nodes are rejected", () => {
  const valid = encode_locus_graph_content(
    hson.fromHson(`<main @000000001 <p @000000002/>/>`).toNode(),
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

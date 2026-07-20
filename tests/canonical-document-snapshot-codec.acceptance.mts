import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { HsonAttrs, HsonMeta, HsonNode, JsonValue } from "../src/core/types.ts";
import type { DocumentLiveMapCapture, DocumentLiveMapMode } from "../src/types/livemap.types.ts";
import {
  decode_canonical_document_snapshot,
  encode_canonical_document_snapshot,
  type CanonicalDocumentSnapshotEncoding,
} from "../src/api/livemap/livemap.document.snapshot-codec.ts";
import {
  CanonicalDocumentSnapshotCodecError,
  type CanonicalDocumentSnapshotCodecErrorCode,
} from "../src/api/livemap/livemap.document.snapshot-codec.error.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(
  tag: string,
  content: HsonNode["$_content"] = [],
  attrs?: HsonAttrs,
  meta?: HsonMeta,
): HsonNode {
  return {
    $_tag: tag,
    ...(attrs === undefined ? {} : { $_attrs: attrs }),
    ...(meta === undefined ? {} : { $_meta: meta }),
    $_content: content,
  };
}

function element_capture(
  element: HsonNode,
  rev = 7,
  rootMeta?: HsonMeta,
  clusterMeta?: HsonMeta,
): DocumentLiveMapCapture<"element"> {
  return {
    kind: "hson-document",
    version: 1,
    mode: "element",
    rev,
    root: node("_hson_root", [node("_hson_elem", [element], undefined, clusterMeta)], undefined, rootMeta),
  };
}

function fragment_capture(
  content: HsonNode["$_content"],
  rev = 9,
  rootMeta?: HsonMeta,
  clusterMeta?: HsonMeta,
): DocumentLiveMapCapture<"fragment"> {
  return {
    kind: "hson-document",
    version: 1,
    mode: "fragment",
    rev,
    root: node("_hson_root", [node("_hson_elem", content, undefined, clusterMeta)], undefined, rootMeta),
  };
}

function empty_fragment_capture(rev = 3): DocumentLiveMapCapture<"fragment"> {
  return {
    kind: "hson-document",
    version: 1,
    mode: "fragment",
    rev,
    root: node("_hson_root"),
  };
}

function round_trip<TMode extends DocumentLiveMapMode>(
  capture: DocumentLiveMapCapture<TMode>,
): Readonly<{ encoded: CanonicalDocumentSnapshotEncoding; decoded: DocumentLiveMapCapture }> {
  const encoded = encode_canonical_document_snapshot(capture);
  const decoded = decode_canonical_document_snapshot(encoded);
  assert.equal(decoded.mode, capture.mode);
  assert.equal(decoded.rev, capture.rev);
  assert.equal(canonical_hson_graph_equal(decoded.root, capture.root), true);
  assert.notEqual(decoded.root, capture.root);
  return { encoded, decoded };
}

function expect_codec_error(
  fn: () => unknown,
  code: CanonicalDocumentSnapshotCodecErrorCode,
  forbidden?: string,
): CanonicalDocumentSnapshotCodecError {
  let observed: unknown;
  try {
    fn();
  } catch (error) {
    observed = error;
  }
  assert.equal(observed instanceof CanonicalDocumentSnapshotCodecError, true);
  if (!(observed instanceof CanonicalDocumentSnapshotCodecError)) throw new Error("Expected codec error.");
  assert.equal(observed.code, code);
  if (forbidden !== undefined) assert.doesNotMatch(observed.message, new RegExp(forbidden));
  return observed;
}

function unsafe_encoding(value: unknown): CanonicalDocumentSnapshotEncoding {
  return value as CanonicalDocumentSnapshotEncoding;
}

function compact_json_payload(value: JsonValue): string {
  return hson.fromJson(value).toHson().noBreak().serialize();
}

function decoded_payload_value(encoded: CanonicalDocumentSnapshotEncoding): JsonValue {
  return hson.fromHson(encoded.payload).toJson().value();
}

function encoding_with_payload(value: JsonValue): CanonicalDocumentSnapshotEncoding {
  return Object.freeze({
    format: "canonical-hson",
    formatVersion: 1,
    payload: compact_json_payload(value),
  });
}

check("element capture round-trips with detached nested identity and typed document data", () => {
  const capture = element_capture(node(
    "main",
    [node("_hson_elem", [
      node("_hson_str", ["before"]),
      node("section", [node("_hson_elem", [node("_hson_str", ["inside"])])], { hidden: false }, {
        "data-_quid": "0000000000000002",
        "data-_custom": "nested",
      }),
    ])],
    { count: 0, title: "0", enabled: true },
    { "data-_quid": "0000000000000001", "data-_custom": "root" },
  ));
  const { encoded, decoded } = round_trip(capture);
  assert.equal(encoded.format, "canonical-hson");
  assert.equal(encoded.formatVersion, 1);
  assert.notEqual(decoded.root.$_content[0], capture.root.$_content[0]);

  const target = hson.liveMap.fromNode(element_capture(node("aside"), 0).root);
  if (target.mode !== "element") throw new Error("Expected element map.");
  target.restore(decoded);
  assert.equal(canonical_hson_graph_equal(target.capture().root, capture.root), true);
});

check("nontrivial fragment capture round-trips in order", () => {
  const capture = fragment_capture([
    node("_hson_str", ["before"]),
    node("article", [], { rank: 2 }, { "data-_quid": "0000000000000003" }),
    node("_hson_str", ["after"]),
  ]);
  round_trip(capture);
});

check("empty fragment root uses a non-empty parseable codec payload", () => {
  const capture = empty_fragment_capture();
  const { encoded, decoded } = round_trip(capture);
  assert.notEqual(encoded.payload.length, 0);
  assert.deepEqual(decoded.root.$_content, []);
  assert.throws(() => hson.fromNode(capture.root).toHson().noBreak().serialize(), /empty _hson_root/);
});

check("typed attrs and raw style strings retain exact types", () => {
  const attrs: HsonAttrs = {
    zero: 0,
    zeroString: "0",
    disabled: false,
    disabledString: "false",
    missing: null,
    missingString: "null",
    empty: "",
  };
  Reflect.set(attrs, "style", "color:red");
  const capture = element_capture(node("div", [], attrs));
  const { decoded } = round_trip(capture);
  const cluster = decoded.root.$_content[0];
  if (typeof cluster !== "object" || cluster === null) throw new Error("Expected element cluster.");
  const root = cluster.$_content[0];
  if (typeof root !== "object" || root === null) throw new Error("Expected element.");
  assert.deepEqual(root.$_attrs, attrs);
  assert.equal(typeof root.$_attrs?.zero, "number");
  assert.equal(typeof root.$_attrs?.zeroString, "string");
  assert.equal(typeof root.$_attrs?.disabled, "boolean");
  assert.equal(root.$_attrs?.missing, null);
});

check("supported metadata string values retain type-like spellings exactly", () => {
  const capture = element_capture(node("div", [], undefined, {
    "data-_zero": "0",
    "data-_false": "false",
    "data-_null": "null",
    "data-_empty": "",
  }));
  const { decoded } = round_trip(capture);
  const cluster = decoded.root.$_content[0];
  if (typeof cluster !== "object" || cluster === null) throw new Error("Expected cluster.");
  const root = cluster.$_content[0];
  if (typeof root !== "object" || root === null) throw new Error("Expected element.");
  assert.deepEqual(root.$_meta, {
    "data-_empty": "",
    "data-_false": "false",
    "data-_null": "null",
    "data-_zero": "0",
  });
});

check("structured style records retain nested typed values", () => {
  const capture = element_capture(node("div", [], {
    style: {
      color: "red",
      opacity: 0,
      enabled: false,
      fallback: null,
      _hover: { color: "blue", opacity: 1 },
    },
  }));
  round_trip(capture);
});

check("metadata on canonical wrappers survives without melting", () => {
  const text = node("_hson_str", ["value"], undefined, { "data-_text": "kept" });
  const capture = fragment_capture(
    [text, node("span")],
    4,
    { "data-_root": "kept" },
    { "data-_cluster": "kept" },
  );
  const { decoded } = round_trip(capture);
  assert.deepEqual(decoded.root.$_meta, { "data-_root": "kept" });
  const cluster = decoded.root.$_content[0];
  if (typeof cluster !== "object" || cluster === null) throw new Error("Expected cluster.");
  assert.deepEqual(cluster.$_meta, { "data-_cluster": "kept" });
  const decodedText = cluster.$_content[0];
  if (typeof decodedText !== "object" || decodedText === null) throw new Error("Expected text wrapper.");
  assert.deepEqual(decodedText.$_meta, { "data-_text": "kept" });
});

check("persisted QUIDs round-trip and invalid identity is rejected", () => {
  round_trip(element_capture(node("div", [], undefined, { "data-_quid": "0000000000000004" })));
  const duplicate = fragment_capture([
    node("div", [], undefined, { "data-_quid": "0000000000000005" }),
    node("span", [], undefined, { "data-_quid": "0000000000000005" }),
  ]);
  expect_codec_error(
    () => encode_canonical_document_snapshot(duplicate),
    "CANONICAL_SNAPSHOT_IDENTITY_INVALID",
    "0000000000000005",
  );
  const malformed = element_capture(node("div", [], undefined, { "data-_quid": "bad" }));
  expect_codec_error(
    () => encode_canonical_document_snapshot(malformed),
    "CANONICAL_SNAPSHOT_GRAPH_INVALID",
    "bad",
  );
});

check("absent and explicitly empty attrs and metadata remain distinct", () => {
  const absent = round_trip(element_capture(node("div"))).decoded;
  const emptyAttrs = round_trip(element_capture(node("div", [], {}))).decoded;
  const emptyMeta = round_trip(element_capture(node("div", [], undefined, {}))).decoded;
  const rootOf = (capture: DocumentLiveMapCapture): HsonNode => {
    const cluster = capture.root.$_content[0];
    if (typeof cluster !== "object" || cluster === null) throw new Error("Expected cluster.");
    const root = cluster.$_content[0];
    if (typeof root !== "object" || root === null) throw new Error("Expected element.");
    return root;
  };
  assert.equal(Object.hasOwn(rootOf(absent), "$_attrs"), false);
  assert.equal(Object.hasOwn(rootOf(emptyAttrs), "$_attrs"), true);
  assert.deepEqual(rootOf(emptyAttrs).$_attrs, {});
  assert.equal(Object.hasOwn(rootOf(absent), "$_meta"), false);
  assert.equal(Object.hasOwn(rootOf(emptyMeta), "$_meta"), true);
  assert.deepEqual(rootOf(emptyMeta).$_meta, {});
  assert.equal(canonical_hson_graph_equal(absent.root, emptyAttrs.root), false);
  assert.equal(canonical_hson_graph_equal(absent.root, emptyMeta.root), false);
});

check("record insertion order does not affect deterministic payload text", () => {
  const left = element_capture(node("div", [], {
    z: "last",
    a: 0,
    style: { zIndex: 1, color: "red", _hover: { opacity: 0, color: "blue" } },
  }, {
    "data-_z": "last",
    "data-_a": "first",
  }), 11);
  const right = element_capture(node("div", [], {
    style: { _hover: { color: "blue", opacity: 0 }, color: "red", zIndex: 1 },
    a: 0,
    z: "last",
  }, {
    "data-_a": "first",
    "data-_z": "last",
  }), 11);
  assert.equal(canonical_hson_graph_equal(left.root, right.root), true);
  assert.equal(
    encode_canonical_document_snapshot(left).payload,
    encode_canonical_document_snapshot(right).payload,
  );
});

check("ordered content and semantic capture differences remain distinguishable", () => {
  const first = fragment_capture([node("a"), node("b")], 12);
  const reordered = fragment_capture([node("b"), node("a")], 12);
  const otherRevision = fragment_capture([node("a"), node("b")], 13);
  const typed = element_capture(node("div", [], { value: 0 }), 12);
  const typedString = element_capture(node("div", [], { value: "0" }), 12);
  assert.equal(canonical_hson_graph_equal(first.root, reordered.root), false);
  assert.notEqual(encode_canonical_document_snapshot(first).payload, encode_canonical_document_snapshot(reordered).payload);
  assert.notEqual(encode_canonical_document_snapshot(first).payload, encode_canonical_document_snapshot(otherRevision).payload);
  assert.notEqual(encode_canonical_document_snapshot(typed).payload, encode_canonical_document_snapshot(typedString).payload);
  assert.notEqual(
    encode_canonical_document_snapshot(element_capture(node("div"), 12)).payload,
    encode_canonical_document_snapshot(fragment_capture([node("div"), node("span")], 12)).payload,
  );
});

check("non-finite numbers are rejected with sanitized controlled errors", () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    const capture = element_capture(node("div", [], { value }));
    expect_codec_error(
      () => encode_canonical_document_snapshot(capture),
      "CANONICAL_SNAPSHOT_NON_FINITE_NUMBER",
      "Infinity|NaN",
    );
  }
});

check("format and version reject before malformed payload parsing", () => {
  expect_codec_error(
    () => decode_canonical_document_snapshot(unsafe_encoding({ format: "other", formatVersion: 1, payload: "secret <" })),
    "CANONICAL_SNAPSHOT_FORMAT_UNKNOWN",
    "secret",
  );
  expect_codec_error(
    () => decode_canonical_document_snapshot(unsafe_encoding({ format: "canonical-hson", formatVersion: 2, payload: "secret <" })),
    "CANONICAL_SNAPSHOT_VERSION_UNSUPPORTED",
    "secret",
  );
});

check("syntax and explicit representation failures remain classified and sanitized", () => {
  expect_codec_error(
    () => decode_canonical_document_snapshot({ format: "canonical-hson", formatVersion: 1, payload: "secret <" }),
    "CANONICAL_SNAPSHOT_SYNTAX_INVALID",
    "secret",
  );
  const valid = encode_canonical_document_snapshot(element_capture(node("div")));
  const base = decoded_payload_value(valid);
  if (typeof base !== "object" || base === null || Array.isArray(base)) throw new Error("Expected payload record.");

  expect_codec_error(
    () => decode_canonical_document_snapshot(encoding_with_payload({ ...base, unexpected: true })),
    "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
  );
  expect_codec_error(
    () => decode_canonical_document_snapshot(encoding_with_payload({ ...base, root: { type: "unknown" } })),
    "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
  );
  const missingRoot = { ...base };
  delete missingRoot.root;
  expect_codec_error(
    () => decode_canonical_document_snapshot(encoding_with_payload(missingRoot)),
    "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
  );
  expect_codec_error(
    () => decode_canonical_document_snapshot(encoding_with_payload({ ...base, mode: "data-object" })),
    "CANONICAL_SNAPSHOT_MODE_MISMATCH",
  );
  expect_codec_error(
    () => decode_canonical_document_snapshot(encoding_with_payload({ ...base, revision: -1 })),
    "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID",
  );
});

check("UTF-8 payload bytes, depth, and node-count limits are enforced", () => {
  expect_codec_error(
    () => decode_canonical_document_snapshot(
      { format: "canonical-hson", formatVersion: 1, payload: "é" },
      { maxPayloadBytes: 1 },
    ),
    "CANONICAL_SNAPSHOT_PAYLOAD_TOO_LARGE",
  );

  const capture = element_capture(node("main", [node("_hson_elem", [node("span")])]));
  expect_codec_error(
    () => encode_canonical_document_snapshot(capture, { maxDepth: 2 }),
    "CANONICAL_SNAPSHOT_DEPTH_LIMIT",
  );
  expect_codec_error(
    () => encode_canonical_document_snapshot(capture, { maxNodes: 2 }),
    "CANONICAL_SNAPSHOT_NODE_LIMIT",
  );
  expect_codec_error(
    () => encode_canonical_document_snapshot(capture, { maxPayloadBytes: 8 }),
    "CANONICAL_SNAPSHOT_PAYLOAD_TOO_LARGE",
  );

  const encoded = encode_canonical_document_snapshot(capture);
  expect_codec_error(
    () => decode_canonical_document_snapshot(encoded, { maxDepth: 2 }),
    "CANONICAL_SNAPSHOT_DEPTH_LIMIT",
  );
  expect_codec_error(
    () => decode_canonical_document_snapshot(encoded, { maxNodes: 2 }),
    "CANONICAL_SNAPSHOT_NODE_LIMIT",
  );
});

check("encoding does not mutate source structure or insertion order", () => {
  const capture = element_capture(node("main", [node("_hson_elem", [node("span")])], {
    z: "last",
    style: { zIndex: 1, color: "red" },
    a: "first",
  }, {
    "data-_z": "last",
    "data-_quid": "0000000000000006",
    "data-_a": "first",
  }), 20, { "data-_root": "kept" }, { "data-_cluster": "kept" });
  const before = structuredClone(capture);
  const root = capture.root.$_content[0];
  if (typeof root !== "object" || root === null) throw new Error("Expected cluster.");
  const element = root.$_content[0];
  if (typeof element !== "object" || element === null) throw new Error("Expected element.");
  const attrsOrder = Object.keys(element.$_attrs ?? {});
  const metaOrder = Object.keys(element.$_meta ?? {});
  const style = element.$_attrs?.style;
  const styleOrder = typeof style === "object" && style !== null ? Object.keys(style) : [];
  const contentOrder = [...element.$_content];

  const decoded = decode_canonical_document_snapshot(encode_canonical_document_snapshot(capture));
  assert.deepEqual(capture, before);
  assert.deepEqual(Object.keys(element.$_attrs ?? {}), attrsOrder);
  assert.deepEqual(Object.keys(element.$_meta ?? {}), metaOrder);
  assert.deepEqual(typeof style === "object" && style !== null ? Object.keys(style) : [], styleOrder);
  assert.deepEqual(element.$_content, contentOrder);
  assert.notEqual(decoded.root, capture.root);
});

process.stdout.write(`# ${checks} canonical document snapshot codec checks passed\n`);

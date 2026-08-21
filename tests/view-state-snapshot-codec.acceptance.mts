import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { HsonAttrs, HsonMeta, HsonNode, JsonValue } from "../src/core/types.ts";
import type { DocumentLiveMapCapture, DocumentLiveMapMode } from "../src/types/livemap.types.ts";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
  type ViewStateSnapshotEncoding,
} from "../src/api/livemap/livemap.document.view-state-codec.ts";
import {
  ViewStateSnapshotCodecError,
  type ViewStateSnapshotCodecErrorCode,
} from "../src/api/livemap/livemap.document.view-state-codec.error.ts";

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
    mode: "fragment",
    rev,
    root: node("_hson_root", [node("_hson_elem", content, undefined, clusterMeta)], undefined, rootMeta),
  };
}

function empty_fragment_capture(rev = 3): DocumentLiveMapCapture<"fragment"> {
  return {
    kind: "hson-document",
    mode: "fragment",
    rev,
    root: node("_hson_root"),
  };
}

function round_trip<TMode extends DocumentLiveMapMode>(
  capture: DocumentLiveMapCapture<TMode>,
): Readonly<{ encoded: ViewStateSnapshotEncoding; decoded: DocumentLiveMapCapture }> {
  const encoded = encode_view_state_snapshot(capture);
  const decoded = decode_view_state_snapshot(encoded);
  assert.equal(decoded.mode, capture.mode);
  assert.equal(decoded.rev, capture.rev);
  assert.equal(canonical_hson_graph_equal(decoded.root, capture.root), true);
  assert.notEqual(decoded.root, capture.root);
  return { encoded, decoded };
}

function expect_codec_error(
  fn: () => unknown,
  code: ViewStateSnapshotCodecErrorCode,
  forbidden?: string,
): ViewStateSnapshotCodecError {
  let observed: unknown;
  try {
    fn();
  } catch (error) {
    observed = error;
  }
  assert.equal(observed instanceof ViewStateSnapshotCodecError, true);
  if (!(observed instanceof ViewStateSnapshotCodecError)) throw new Error("Expected codec error.");
  assert.equal(observed.code, code);
  if (forbidden !== undefined) assert.doesNotMatch(observed.message, new RegExp(forbidden));
  return observed;
}

function unsafe_encoding(value: unknown): ViewStateSnapshotEncoding {
  return value as ViewStateSnapshotEncoding;
}

function compact_json_payload(value: JsonValue): string {
  return hson.fromJson(value).toHson().noBreak().serialize();
}

function decoded_payload_value(encoded: ViewStateSnapshotEncoding): JsonValue {
  return hson.fromHson(encoded.payload).toJson().value();
}

function encoding_with_payload(value: JsonValue): ViewStateSnapshotEncoding {
  return Object.freeze({
    format: "view-state",
    payload: compact_json_payload(value),
  });
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replace_persisted_quid(value: JsonValue, from: string, to: string): JsonValue {
  const copy: JsonValue = structuredClone(value);
  let replacements = 0;
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!is_record(current)) return;
    const record = current;
    const encodedValue = record.value;
    if (record.key === "quid"
      && is_record(encodedValue)) {
      const tagged = encodedValue;
      if (tagged.type === "string" && tagged.value === from) {
        tagged.value = to;
        replacements += 1;
      }
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(copy);
  assert.equal(replacements, 1);
  return copy;
}

function replace_style_with_nested_rule(value: JsonValue): JsonValue {
  const copy: JsonValue = structuredClone(value);
  let replacements = 0;
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!is_record(current)) return;
    if (current.key === "style" && is_record(current.value) && current.value.type === "record") {
      current.value = {
        type: "record",
        entries: [{
          key: "_hover",
          value: {
            type: "record",
            entries: [{ key: "color", value: { type: "string", value: "private-blue" } }],
          },
        }],
      };
      replacements += 1;
      return;
    }
    for (const item of Object.values(current)) visit(item);
  };
  visit(copy);
  assert.equal(replacements, 1);
  return copy;
}

function add_root_structural_metadata(value: JsonValue): JsonValue {
  const copy: JsonValue = structuredClone(value);
  if (!is_record(copy) || !is_record(copy.root)) throw new Error("Expected encoded root.");
  copy.root.meta = {
    presence: "present",
    entries: [{
      key: "data-_root",
      value: { type: "string", value: "invalid" },
    }],
  };
  return copy;
}

check("element capture round-trips with detached nested identity and typed document data", () => {
  const capture = element_capture(node(
    "main",
    [node("_hson_elem", [
      node("_hson_str", ["before"]),
      node("section", [node("_hson_elem", [node("_hson_str", ["inside"])])], {
        "data-user": "nested",
        hidden: false,
      }, { quid: "000000002" }),
    ])],
    { count: 0, "data-theme": "dark", title: "0", enabled: true },
    { quid: "000000001" },
  ));
  const { encoded, decoded } = round_trip(capture);
  assert.equal(encoded.format, "view-state");
  assert.equal(Object.hasOwn(encoded, "formatVersion"), false);
  assert.notEqual(decoded.root.$_content[0], capture.root.$_content[0]);

  const target = hson.liveMap.fromNode(element_capture(node("aside"), 0).root);
  if (target.mode !== "element") throw new Error("Expected element map.");
  target.restore(decoded);
  assert.equal(canonical_hson_graph_equal(target.capture().root, capture.root), true);
});

check("nontrivial fragment capture round-trips in order", () => {
  const capture = fragment_capture([
    node("_hson_str", ["before"]),
    node("article", [], { rank: 2 }, { quid: "000000003" }),
    node("_hson_str", ["after"]),
  ]);
  round_trip(capture);
});

check("empty fragment root uses a non-empty parseable codec payload", () => {
  const capture = empty_fragment_capture();
  const { encoded, decoded } = round_trip(capture);
  assert.notEqual(encoded.payload.length, 0);
  assert.deepEqual(decoded.root.$_content, []);
  assert.throws(
    () => hson.fromNode(capture.root).toHson().noBreak().serialize(),
    /_hson_root is an internal attachment carrier/,
  );
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
  Object.defineProperty(attrs, "__proto__", {
    value: "data",
    enumerable: true,
    writable: true,
    configurable: true,
  });
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
  assert.equal(Object.hasOwn(root.$_attrs ?? {}, "__proto__"), true);
  assert.equal(Reflect.getOwnPropertyDescriptor(root.$_attrs, "__proto__")?.value, "data");
  assert.equal(Object.getPrototypeOf(root.$_attrs), Object.prototype);
});

check("ordinary data attribute string values retain type-like spellings exactly", () => {
  const capture = element_capture(node("div", [], {
    "data-zero": "0",
    "data-false": "false",
    "data-null": "null",
    "data-empty": "",
  }));
  const { decoded } = round_trip(capture);
  const cluster = decoded.root.$_content[0];
  if (typeof cluster !== "object" || cluster === null) throw new Error("Expected cluster.");
  const root = cluster.$_content[0];
  if (typeof root !== "object" || root === null) throw new Error("Expected element.");
  assert.deepEqual(root.$_attrs, {
    "data-empty": "",
    "data-false": "false",
    "data-null": "null",
    "data-zero": "0",
  });
});

check("structured style records retain typed declaration leaves", () => {
  const capture = element_capture(node("div", [], {
    style: {
      color: "red",
      opacity: 0,
      enabled: false,
      fallback: null,
      width: { value: 2, unit: "px" },
    },
  }));
  round_trip(capture);
});

check("nested inline stylesheet structures fail canonical graph validation", () => {
  const invalidCapture = element_capture(node("div", [], {
    style: { _hover: { color: "private-blue" } },
  }));
  expect_codec_error(
    () => encode_view_state_snapshot(invalidCapture),
    "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
    "private-blue",
  );

  const valid = encode_view_state_snapshot(element_capture(node("div", [], {
    style: { color: "red" },
  })));
  const invalidEncoding = encoding_with_payload(
    replace_style_with_nested_rule(decoded_payload_value(valid)),
  );
  const error = expect_codec_error(
    () => decode_view_state_snapshot(invalidEncoding),
    "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
    "private-blue",
  );
  assert.equal(error.message.includes(invalidEncoding.payload), false);
});

check("view-state preserves defined QUID metadata and ordinary data attributes exactly", () => {
  const capture = fragment_capture([
    node("_hson_str", ["before"]),
    node("span", [], { "data-user": "kept" }, { quid: "000000007" }),
  ], 4);
  const { decoded } = round_trip(capture);
  const cluster = decoded.root.$_content[0];
  if (typeof cluster !== "object" || cluster === null) throw new Error("Expected cluster.");
  const span = cluster.$_content[1];
  if (typeof span !== "object" || span === null) throw new Error("Expected span.");
  assert.deepEqual(span.$_attrs, { "data-user": "kept" });
  assert.deepEqual(span.$_meta, { quid: "000000007" });
});

for (const [tag, key, content] of [
  ["_hson_root", "data-_root", []],
  ["_hson_elem", "data-_cluster", []],
  ["_hson_str", "data-_text", ["value"]],
  ["_hson_elem", "data-_custom", []],
] as const) {
  check(`${key} is rejected on ${tag} with its exact graph path`, () => {
    const invalid = tag === "_hson_root"
      ? node(tag, [...content], undefined, { [key]: "invalid" } as unknown as HsonMeta)
      : node("_hson_root", [node("_hson_elem", [
        node("section", [node("_hson_elem", [
          node(tag, [...content], undefined, { [key]: "invalid" } as unknown as HsonMeta),
        ])]),
      ])]);
    const error = expect_codec_error(
      () => encode_view_state_snapshot(fragment_capture([invalid])),
      "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
    );
    const diagnostic = String(error.cause);
    assert.match(diagnostic, new RegExp(`${tag}.*${key}|${key}.*${tag}`));
    assert.match(diagnostic, /unknown canonical metadata key/);
  });
}

check("snapshot decoding rejects unsupported structural metadata", () => {
  const valid = encode_view_state_snapshot(fragment_capture([
    node("_hson_str", ["before"]),
    node("span"),
  ]));
  const invalid = encoding_with_payload(
    add_root_structural_metadata(decoded_payload_value(valid)),
  );
  expect_codec_error(
    () => decode_view_state_snapshot(invalid),
    "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID",
  );
});

check("persisted QUIDs round-trip and invalid identity is rejected", () => {
  round_trip(element_capture(node("div", [], undefined, { quid: "000000004" })));
  const duplicate = fragment_capture([
    node("div", [], undefined, { quid: "000000005" }),
    node("span", [], undefined, { quid: "000000005" }),
  ]);
  expect_codec_error(
    () => encode_view_state_snapshot(duplicate),
    "VIEW_STATE_SNAPSHOT_IDENTITY_INVALID",
    "000000005",
  );
  const malformed = element_capture(node("div", [], undefined, { quid: "bad" }));
  expect_codec_error(
    () => encode_view_state_snapshot(malformed),
    "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
    "bad",
  );
  expect_codec_error(
    () => encode_view_state_snapshot(element_capture(node("div", [], undefined, { quid: "0000000000000001" }))),
    "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
    "0000000000000001",
  );
});

check("view-state requires canonical empty attributes and preserves metadata presence exactly", () => {
  const absent = round_trip(element_capture(node("div"))).decoded;
  const emptyAttrsCandidate = element_capture(node("div", [], {}));
  expect_codec_error(
    () => encode_view_state_snapshot(emptyAttrsCandidate),
    "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
  );
  const admittedRoot = hson.fromNode(emptyAttrsCandidate.root).toNode();
  const admitted = round_trip({ ...emptyAttrsCandidate, root: admittedRoot }).decoded;
  const emptyMeta = round_trip(element_capture(node("div", [], undefined, {}))).decoded;
  const rootOf = (capture: DocumentLiveMapCapture): HsonNode => {
    const cluster = capture.root.$_content[0];
    if (typeof cluster !== "object" || cluster === null) throw new Error("Expected cluster.");
    const root = cluster.$_content[0];
    if (typeof root !== "object" || root === null) throw new Error("Expected element.");
    return root;
  };
  assert.equal(Object.hasOwn(rootOf(absent), "$_attrs"), false);
  assert.equal(Object.hasOwn(rootOf(admitted), "$_attrs"), false);
  assert.equal(Object.hasOwn(rootOf(absent), "$_meta"), false);
  assert.equal(Object.hasOwn(rootOf(emptyMeta), "$_meta"), true);
  assert.deepEqual(rootOf(emptyMeta).$_meta, {});
  assert.equal(canonical_hson_graph_equal(absent.root, admitted.root), true);
  assert.equal(canonical_hson_graph_equal(absent.root, emptyMeta.root), false);
});

check("record insertion order does not affect deterministic payload text", () => {
  const left = element_capture(node("div", [], {
    z: "last",
    a: 0,
    "data-z": "last",
    "data-a": "first",
    style: { zIndex: 1, color: "red", width: { value: 2, unit: "px" } },
  }), 11);
  const right = element_capture(node("div", [], {
    style: { width: { unit: "px", value: 2 }, color: "red", zIndex: 1 },
    "data-a": "first",
    "data-z": "last",
    a: 0,
    z: "last",
  }), 11);
  assert.equal(canonical_hson_graph_equal(left.root, right.root), true);
  assert.equal(
    encode_view_state_snapshot(left).payload,
    encode_view_state_snapshot(right).payload,
  );
});

check("ordered content and semantic capture differences remain distinguishable", () => {
  const first = fragment_capture([node("a"), node("b")], 12);
  const reordered = fragment_capture([node("b"), node("a")], 12);
  const otherRevision = fragment_capture([node("a"), node("b")], 13);
  const typed = element_capture(node("div", [], { value: 0 }), 12);
  const typedString = element_capture(node("div", [], { value: "0" }), 12);
  assert.equal(canonical_hson_graph_equal(first.root, reordered.root), false);
  assert.notEqual(encode_view_state_snapshot(first).payload, encode_view_state_snapshot(reordered).payload);
  assert.notEqual(encode_view_state_snapshot(first).payload, encode_view_state_snapshot(otherRevision).payload);
  assert.notEqual(encode_view_state_snapshot(typed).payload, encode_view_state_snapshot(typedString).payload);
  assert.notEqual(
    encode_view_state_snapshot(element_capture(node("div"), 12)).payload,
    encode_view_state_snapshot(fragment_capture([node("div"), node("span")], 12)).payload,
  );
});

check("non-finite numbers are rejected with sanitized controlled errors", () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    const capture = element_capture(node("div", [], { value }));
    expect_codec_error(
      () => encode_view_state_snapshot(capture),
      "VIEW_STATE_SNAPSHOT_NON_FINITE_NUMBER",
      "Infinity|NaN",
    );
  }
});

check("unknown formats and removed generation fields reject before payload parsing", () => {
  expect_codec_error(
    () => decode_view_state_snapshot(unsafe_encoding({ format: "other", formatVersion: 2, payload: "secret <" })),
    "VIEW_STATE_SNAPSHOT_FORMAT_UNKNOWN",
    "secret",
  );
  expect_codec_error(
    () => decode_view_state_snapshot(unsafe_encoding({ format: "view-state", formatVersion: 1, payload: "secret <" })),
    "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID",
    "secret",
  );
});

check("syntax and explicit representation failures remain classified and sanitized", () => {
  expect_codec_error(
    () => decode_view_state_snapshot({ format: "view-state", payload: "secret <" }),
    "VIEW_STATE_SNAPSHOT_SYNTAX_INVALID",
    "secret",
  );
  const valid = encode_view_state_snapshot(element_capture(node("div")));
  const base = decoded_payload_value(valid);
  if (typeof base !== "object" || base === null || Array.isArray(base)) throw new Error("Expected payload record.");

  expect_codec_error(
    () => decode_view_state_snapshot(encoding_with_payload({ ...base, unexpected: true })),
    "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID",
  );
  expect_codec_error(
    () => decode_view_state_snapshot(encoding_with_payload({ ...base, captureVersion: 2 })),
    "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID",
  );
  expect_codec_error(
    () => decode_view_state_snapshot(encoding_with_payload({ ...base, root: { type: "unknown" } })),
    "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID",
  );
  const missingRoot = { ...base };
  delete missingRoot.root;
  expect_codec_error(
    () => decode_view_state_snapshot(encoding_with_payload(missingRoot)),
    "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID",
  );
  expect_codec_error(
    () => decode_view_state_snapshot(encoding_with_payload({ ...base, mode: "data-object" })),
    "VIEW_STATE_SNAPSHOT_MODE_MISMATCH",
  );
  expect_codec_error(
    () => decode_view_state_snapshot(encoding_with_payload({ ...base, revision: -1 })),
    "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID",
  );
});

check("semantically valid noncanonical HSON is rejected after deterministic re-encoding", () => {
  const documentText = "recognizable-codec-content";
  const encoded = encode_view_state_snapshot(element_capture(node("div", [
    node("_hson_elem", [node("_hson_str", [documentText])]),
  ])));
  const representation = decoded_payload_value(encoded);
  const alteredPayload = hson.fromJson(representation).toHson().serialize();
  assert.notEqual(alteredPayload, encoded.payload);
  assert.deepEqual(hson.fromHson(alteredPayload).toJson().value(), representation);
  const error = expect_codec_error(
    () => decode_view_state_snapshot({ ...encoded, payload: alteredPayload }),
    "VIEW_STATE_SNAPSHOT_ROUND_TRIP_MISMATCH",
    documentText,
  );
  assert.equal(error.message.includes(alteredPayload), false);
});

check("decode rejects duplicate and malformed persisted QUIDs without exposing identity", () => {
  const firstQuid = "000000010";
  const secondQuid = "000000011";
  const duplicateSource = encode_view_state_snapshot(fragment_capture([
    node("div", [], undefined, { quid: firstQuid }),
    node("span", [], undefined, { quid: secondQuid }),
  ]));
  const duplicateRepresentation = replace_persisted_quid(
    decoded_payload_value(duplicateSource),
    secondQuid,
    firstQuid,
  );
  const duplicateEncoding = encoding_with_payload(duplicateRepresentation);
  const duplicateError = expect_codec_error(
    () => decode_view_state_snapshot(duplicateEncoding),
    "VIEW_STATE_SNAPSHOT_IDENTITY_INVALID",
    firstQuid,
  );
  assert.equal(duplicateError.message.includes(duplicateEncoding.payload), false);

  const validQuid = "000000012";
  const malformedQuid = "malformed-persisted-quid";
  const malformedSource = encode_view_state_snapshot(element_capture(
    node("div", [], undefined, { quid: validQuid }),
  ));
  const malformedRepresentation = replace_persisted_quid(
    decoded_payload_value(malformedSource),
    validQuid,
    malformedQuid,
  );
  const malformedEncoding = encoding_with_payload(malformedRepresentation);
  const malformedError = expect_codec_error(
    () => decode_view_state_snapshot(malformedEncoding),
    "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
    malformedQuid,
  );
  assert.equal(malformedError.message.includes(malformedEncoding.payload), false);

  const legacyQuid = "0000000000000001";
  const legacyRepresentation = replace_persisted_quid(
    decoded_payload_value(malformedSource),
    validQuid,
    legacyQuid,
  );
  expect_codec_error(
    () => decode_view_state_snapshot(encoding_with_payload(legacyRepresentation)),
    "VIEW_STATE_SNAPSHOT_GRAPH_INVALID",
    legacyQuid,
  );
});

check("UTF-8 payload bytes, depth, and node-count limits are enforced", () => {
  expect_codec_error(
    () => decode_view_state_snapshot(
      { format: "view-state", payload: "é" },
      { maxPayloadBytes: 1 },
    ),
    "VIEW_STATE_SNAPSHOT_PAYLOAD_TOO_LARGE",
  );

  const capture = element_capture(node("main", [node("_hson_elem", [node("span")])]));
  expect_codec_error(
    () => encode_view_state_snapshot(capture, { maxDepth: 2 }),
    "VIEW_STATE_SNAPSHOT_DEPTH_LIMIT",
  );
  expect_codec_error(
    () => encode_view_state_snapshot(capture, { maxNodes: 2 }),
    "VIEW_STATE_SNAPSHOT_NODE_LIMIT",
  );
  expect_codec_error(
    () => encode_view_state_snapshot(capture, { maxPayloadBytes: 8 }),
    "VIEW_STATE_SNAPSHOT_PAYLOAD_TOO_LARGE",
  );

  const encoded = encode_view_state_snapshot(capture);
  expect_codec_error(
    () => decode_view_state_snapshot(encoded, { maxDepth: 2 }),
    "VIEW_STATE_SNAPSHOT_DEPTH_LIMIT",
  );
  expect_codec_error(
    () => decode_view_state_snapshot(encoded, { maxNodes: 2 }),
    "VIEW_STATE_SNAPSHOT_NODE_LIMIT",
  );
});

check("encoding does not mutate source structure or insertion order", () => {
  const capture = element_capture(node("main", [node("_hson_elem", [node("span")])], {
    z: "last",
    "data-z": "last",
    "data-a": "first",
    style: { zIndex: 1, color: "red" },
    a: "first",
  }, {
    quid: "000000006",
  }), 20);
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

  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(capture));
  assert.deepEqual(capture, before);
  assert.deepEqual(Object.keys(element.$_attrs ?? {}), attrsOrder);
  assert.deepEqual(Object.keys(element.$_meta ?? {}), metaOrder);
  assert.deepEqual(typeof style === "object" && style !== null ? Object.keys(style) : [], styleOrder);
  assert.deepEqual(element.$_content, contentOrder);
  assert.notEqual(decoded.root, capture.root);
});

process.stdout.write(`# ${checks} view-state snapshot codec checks passed\n`);
emit_hson_live_test_completion("livemap.view-state-snapshot-codec", checks, checks, 0);

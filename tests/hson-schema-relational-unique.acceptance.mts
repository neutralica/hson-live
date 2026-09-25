import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform, type HsonSchema } from "../src/index.ts";
import { HsonSchemaError } from "../src/api/livemap/livemap.error.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { compile_hson_schema, HSON_SCHEMA_MVP_COMPATIBILITY_VERSION } from "../src/internal/hson-schema/compiler.ts";
import { generate_hson_schema_types } from "../src/internal/hson-schema/generate-types.ts";
import { decode_canonical_schema_graph_hson, encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { CANONICAL_SCHEMA_FORMAT, CANONICAL_SCHEMA_FORMAT_LIMITS, CANONICAL_SCHEMA_VERSION } from "../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-relational-unique",
  title: "Hson Schema relational unique",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "unique", "canonical-schema", "livemap"]),
});

const testEvents = create_test_event_emitter("hson-schema-relational-unique");
let checks = 0;
const check = (name: string, run: () => void): void => {
  testEvents.case_begin(name, name);
  try { run(); testEvents.case_end(name, "pass"); }
  catch (error) {
    testEvents.diagnostic(name, "assertion", (error instanceof Error ? error.message : "Check failed.").slice(0, 1_000));
    testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error;
  }
  console.log(`ok ${++checks} - ${name}`);
};

const DecksSchema: HsonSchema = Hson.schema`<type "data" content <cells <array <
  content <content <position <optional "any"> body "string">>
  unique <
    by "position"
    cases [
      ["top-left", ["TL"]],
      ["top-right", ["TR"]],
      ["bottom-left", ["BL"]],
      ["bottom-right", ["BR"]],
      ["top-half", ["TL", "TR"]],
      ["bottom-half", ["BL", "BR"]],
      ["left-half", ["TL", "BL"]],
      ["right-half", ["TR", "BR"]],
      ["full", ["TL", "TR", "BL", "BR"]],
      ["decorative", []]
    ]
  >
>>>>`;

function cells(positions: readonly string[]): ReturnType<typeof Hson.canonical> {
  return hsonTransform.fromJson({ cells: positions.map((position, index) => ({ position, body: `body-${index}` })) }).toHson().serialize();
}

function accepts(schema: HsonSchema, candidate: ReturnType<typeof Hson.canonical>): boolean {
  try { assert.equal(schema.certify(candidate), candidate); return true; }
  catch { return false; }
}

check("Decks positive matrix is order-independent", () => {
  for (const positions of [
    [], ["top-right"], ["top-right", "top-left"], ["top-left", "top-right"],
    ["top-right", "bottom-left"], ["top-right", "bottom-half"], ["bottom-half", "top-right"],
    ["left-half", "right-half"], ["right-half", "left-half"], ["top-half", "bottom-half"],
    ["full"], ["decorative", "top-right"], ["top-right", "decorative"], ["decorative", "decorative"],
  ]) assert.equal(accepts(DecksSchema, cells(positions)), true, positions.join(" + "));
});

check("Decks overlap matrix rejects in both orders and duplicate selectors reject independently of payload", () => {
  for (const positions of [
    ["top-right", "top-half"], ["top-half", "top-right"], ["top-right", "right-half"], ["right-half", "top-right"],
    ["top-left", "left-half"], ["left-half", "top-left"], ["top-half", "left-half"], ["left-half", "top-half"],
    ["full", "top-left"], ["top-left", "full"], ["top-left", "top-left"],
  ]) assert.equal(accepts(DecksSchema, cells(positions)), false, positions.join(" + "));
  assert.equal(accepts(DecksSchema, Hson.canonical`<cells [<position "top-left" body "same">, <position "top-left" body "same">]>`), false);
});

check("selector boundary rejects missing, nonprimitive, and unmapped values at the direct member", () => {
  const failures: readonly (readonly [ReturnType<typeof Hson.canonical>, "MISSING_REQUIRED" | "TYPE_MISMATCH" | "INVALID_CONSTRAINT"])[] = [
    [Hson.canonical`<cells [<body "missing">]>`, "MISSING_REQUIRED"],
    [Hson.canonical`<cells [<position ["top-right"] body "array">]>`, "TYPE_MISMATCH"],
    [Hson.canonical`<cells [<position <nested true> body "object">]>`, "TYPE_MISMATCH"],
    [Hson.canonical`<cells [<position "unknown" body "unmapped">]>`, "INVALID_CONSTRAINT"],
  ];
  for (const [candidate, code] of failures) {
    assert.throws(() => DecksSchema.certify(candidate), (error: unknown) => {
      assert.equal(error instanceof HsonSchemaError, true);
      if (!(error instanceof HsonSchemaError)) return false;
      assert.deepEqual(error.path, ["cells", 0, "position"]);
      assert.equal(error.issues[0]?.code, code);
      return true;
    });
  }
});

check("conflict diagnostics retain later primary path, earlier related path, and exact key", () => {
  assert.throws(() => DecksSchema.certify(cells(["top-right", "top-half"])), (error: unknown) => {
    assert.equal(error instanceof HsonSchemaError, true);
    if (!(error instanceof HsonSchemaError)) return false;
    assert.deepEqual(error.path, ["cells", 1, "position"]);
    assert.deepEqual(error.issues[0]?.relatedPath, ["cells", 0, "position"]);
    assert.equal(error.issues[0]?.conflictingKey, "TR");
    return true;
  });
});

check("HsonData and runtime-origin canonical ingress use the identical evaluator", () => {
  const valid = Hson.data.from({ cells: [{ position: "top-right", body: "a" }, { position: "bottom-left", body: "b" }] });
  const invalid = Hson.data.from({ cells: [{ position: "top-right", body: "a" }, { position: "top-half", body: "b" }] });
  assert.equal(DecksSchema.certify(valid), valid);
  assert.throws(() => DecksSchema.certify(invalid));
});

check("selector and derived-key equality distinguish positive and negative zero", () => {
  const selectors: HsonSchema = Hson.schema`<type "data" content <cells <array <content <content <position "any">> unique <by "position" cases [[0, ["positive"]], [-0, ["negative"]]]>>>>>`;
  assert.equal(accepts(selectors, Hson.canonical`<cells [<position 0>, <position -0>]>`), true);
  const keys: HsonSchema = Hson.schema`<type "data" content <cells <array <content <content <position "string">> unique <by "position" cases [["a", [0]], ["b", [-0]]]>>>>>`;
  assert.equal(accepts(keys, Hson.canonical`<cells [<position "a">, <position "b">]>`), true);
});

check("ordinary and configured unique remain independent at different array locations", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <cells <array <content <content <position "string">> unique <by "position" cases [["a", ["A"]], ["b", ["B"]]]>>> ids <array <content "number" unique true>>>>`;
  const valid = Hson.canonical`<cells [<position "a">, <position "b">] ids [0, -0]>`;
  assert.equal(schema.certify(valid), valid);
  assert.throws(() => schema.certify(Hson.canonical`<cells [<position "a">, <position "b">] ids [1, 1]>`));
  assert.throws(() => schema.certify(Hson.canonical`<cells [<position "a">, <position "a">] ids [1, 2]>`));
});

check("generic scheduling and hardware relations are not domain-specific", () => {
  const scheduling: HsonSchema = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["morning-hour", ["09:00", "09:30"]], ["single-0930", ["09:30"]], ["single-1000", ["10:00"]]]>>>>>`;
  assert.equal(accepts(scheduling, Hson.canonical`<items [<kind "morning-hour">, <kind "single-0930">]>`), false);
  assert.equal(accepts(scheduling, Hson.canonical`<items [<kind "morning-hour">, <kind "single-1000">]>`), true);
  const hardware: HsonSchema = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["video-call", ["camera", "microphone", "encoder"]], ["recording", ["camera", "encoder"]], ["speaker", ["speaker"]]]>>>>>`;
  assert.equal(accepts(hardware, Hson.canonical`<items [<kind "video-call">, <kind "recording">]>`), false);
  assert.equal(accepts(hardware, Hson.canonical`<items [<kind "video-call">, <kind "speaker">]>`), true);
});

check("configured unique compiler rejects every malformed closed relation shape", () => {
  const compile = (unique: string) => compile_hson_schema(`<type "data" content <items <array <content "any" unique ${unique}>>>>`);
  for (const unique of [
    "<by \"x\">", "<cases []>", "<by \"x\" cases [] extra true>", "<by \"x\" cases [\"bad\"]>",
    "<by \"x\" cases [[[\"array\"], []]]>", "<by \"x\" cases [[\"a\", [<bad true>]]]>",
    "<by \"x\" cases [[\"a\", []], [\"a\", []]]>", "<by \"x\" cases [[\"a\", [\"K\", \"K\"]]]>",
  ]) assert.equal(compile(unique).ok, false, unique);
  const ranged = compile_hson_schema(`<type "data" content <items <array <content "any" unique <by "x" cases [["a", ["K"]], ["a", []]]>>>>>`);
  assert.equal(ranged.ok, false);
  if (!ranged.ok) {
    assert.deepEqual(ranged.issues[0]?.path, ["content", "items", "array", "unique", "cases", 1, 0]);
    assert.notEqual(ranged.issues[0]?.range, undefined);
  }
});

check("canonical verifier, graph version, compatibility token, and round-trip close the rule", () => {
  assert.equal(CANONICAL_SCHEMA_VERSION, 3);
  assert.equal(HSON_SCHEMA_MVP_COMPATIBILITY_VERSION, "hson-schema-mvp-10");
  const compiled = compile_hson_schema(DecksSchema.toHson());
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const encoded = encode_canonical_schema_graph_hson(compiled.value.graph);
  const decoded = decode_canonical_schema_graph_hson(encoded);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.graph, compiled.value.graph);
  const generated = generate_hson_schema_types("Relational", compiled.value.semantic, compiled.value.definitions).declarations;
  assert.match(generated, /UniqueR0Proof/);
  assert.doesNotMatch(generated, /top-left|top-right|TL|TR/);
  const verifiesRule = (rule: unknown) => verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes: [{ kind: "projected-refinement", base: 1, rule }, { kind: "projected-array" }] }).ok;
  for (const rule of [
    { kind: "array-unique-by-cases", by: "_hson_private", cases: [] },
    { kind: "array-unique-by-cases", by: "position", cases: "bad" },
    { kind: "array-unique-by-cases", by: "position", cases: [["a"]] },
    { kind: "array-unique-by-cases", by: "position", cases: [[["array"], []]] },
    { kind: "array-unique-by-cases", by: "position", cases: [["a", [{ object: true }]]] },
    { kind: "array-unique-by-cases", by: "position", cases: [["a", []], ["a", []]] },
    { kind: "array-unique-by-cases", by: "position", cases: [["a", ["K", "K"]]] },
    { kind: "array-unique-by-cases", by: "position", cases: [], extra: true },
  ]) assert.equal(verifiesRule(rule), false);
  const tooManyCases = Array.from({ length: CANONICAL_SCHEMA_FORMAT_LIMITS.maxUniqueCases + 1 }, (_, index) => [String(index), []]);
  assert.equal(verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes: [{ kind: "projected-refinement", base: 1, rule: { kind: "array-unique-by-cases", by: "position", cases: tooManyCases } }, { kind: "projected-array" }] }).ok, false);
  const signed = compile_hson_schema(Hson.canonical`<type "data" content <items <array <content <content <value "any">> unique <by "value" cases [[0, [-0]], [-0, [0]]]>>>>>`);
  assert.equal(signed.ok, true);
  if (signed.ok) {
    const signedRoundTrip = decode_canonical_schema_graph_hson(encode_canonical_schema_graph_hson(signed.value.graph));
    assert.equal(signedRoundTrip.ok, true);
    if (signedRoundTrip.ok) assert.deepEqual(signedRoundTrip.graph, signed.value.graph);
  }
});

check("case-row order is canonical identity but cannot change acceptance", () => {
  const left: HsonSchema = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["a", ["A"]], ["b", ["B"]]]>>>>>`;
  const right: HsonSchema = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["b", ["B"]], ["a", ["A"]]]>>>>>`;
  const candidate = Hson.canonical`<items [<kind "a">, <kind "b">]>`;
  assert.equal(accepts(left, candidate), accepts(right, candidate));
  const a = compile_hson_schema(left.toHson()), b = compile_hson_schema(right.toHson());
  assert.equal(a.ok && b.ok, true);
  if (a.ok && b.ok) assert.notDeepEqual(a.value.graph, b.value.graph);
});

check("registry admission, mutation, staging, restore, and aggregate commits converge", () => {
  const initial = { cells: [{ position: "top-right", body: "a" }, { position: "bottom-left", body: "b" }] };
  const map = hsonLiveMap.fromLibraries({ state: { data: initial, schema: DecksSchema } });
  const state = map.lib("state");
  const aggregate = internal_livemap_aggregate_authority(map);
  const library = aggregate.libraries()[0];
  if (library === undefined) throw new Error("Expected one application Library.");
  state.at(["cells", 1, "position"]).set("bottom-half");
  assert.equal(map.rev, 1);
  const before = state.snap(); const beforeRev = map.rev;
  assert.throws(() => state.at(["cells", 1, "position"]).set("top-half"));
  assert.deepEqual(state.snap(), before); assert.equal(map.rev, beforeRev);
  assert.throws(() => state.at(["cells", 1, "position"]).set("top-right"));
  assert.deepEqual(state.snap(), before); assert.equal(map.rev, beforeRev);

  const valid = aggregate.prepare([
    { target: aggregate.target(library, ["cells", 0, "position"]), kind: "set", value: "top-left" },
    { target: aggregate.target(library, ["cells", 1, "position"]), kind: "set", value: "bottom-right" },
  ]);
  aggregate.accept(valid);
  assert.deepEqual(state.snap(["cells"]), [{ position: "top-left", body: "a" }, { position: "bottom-right", body: "b" }]);
  const stagedRev = map.rev;
  assert.throws(() => aggregate.prepare([
    { target: aggregate.target(library, ["cells", 0, "position"]), kind: "set", value: "top-half" },
    { target: aggregate.target(library, ["cells", 1, "position"]), kind: "set", value: "left-half" },
  ]));
  assert.equal(map.rev, stagedRev);

  const capture = map.capture();
  const entry = capture.libraries[0];
  if (entry === undefined) throw new Error("Expected state capture.");
  const invalid = { ...capture, libraries: [{ ...entry, root: encode_hosted_root(hsonTransform.fromJson({ cells: [{ position: "top-right", body: "a" }, { position: "top-half", body: "b" }] }).toNode()) }] };
  assert.throws(() => map.restore(invalid));
  assert.equal(map.rev, stagedRev);
  assert.throws(() => aggregate.commit([{ target: aggregate.target(library, ["cells", 1, "position"]), kind: "set", value: "left-half" }]));
  assert.equal(map.rev, stagedRev);
});

testEvents.terminal("pass");

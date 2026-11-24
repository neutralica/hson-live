import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, hsonTransform, read_transform_error_details, type LiveMapDataLibrary } from "../src/index.js";
import type { JsonValue } from "../src/core/types.js";
import { is_Node } from "../src/core/node-guards.js";
import { HsonDataValue, decode_hson_data_internal } from "../src/api/data/hson-data.js";
import { compiled_hson_schema_of } from "../src/api/schema/hson-schema.js";
import { parse_ordered_json_text } from "../src/core/exact-data-codec.js";
import { evaluate_static_schema_candidate } from "../src/internal/hson-schema/candidate-evaluation.js";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.js";
import { add_interaction, enable_interactions, replace_interaction } from "../src/api/interactions/interactions.js";
import type { InteractionDescriptor } from "../src/types/interaction.types.js";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.js";
import { create_test_event_emitter } from "./test-events.mjs";
import { produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.js";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "reserved-data-names",
  title: "Reserved Data names reject before evidence or publication",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["data", "admission", "libraries", "parts", "schema", "actions", "interactions"]),
});

const events = create_test_event_emitter("reserved-data-names");
let checks = 0;
async function check(name: string, run: () => unknown): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", String(error).slice(0, 1_000));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write("ok " + ++checks + " - " + name + "\n");
}

const names = ["$_", "$_meta", "$_attrs", "$_tag", "$_content", "$_future", "_hson_", "_hson_root", "_hson_obj", "_hson_future"];
const invalidValues: JsonValue[] = names.flatMap((name): JsonValue[] => [
  { [name]: 1 }, { before: 1, nested: { [name]: 1 } },
  [{ [name]: 1 }], { nested: [0, [{ [name]: 1 }]] },
]);
invalidValues.push({ "$_meta": { quid: "000000001" }, a: 1 }, { _hson_root: { a: 1 } });
const sources = names.flatMap(name => [
  "<'" + name + "' 1>", "<before 1 nested <'" + name + "' 1>>",
  "«<'" + name + "' 1>»", "<nested «0,«<'" + name + "' 1>»»>",
]);
const data_source = (source: string) => Reflect.apply(Hson.data.fromSource, Hson.data, [source]);
const certify = (value: unknown) => Reflect.apply(ANY_DATA.certify, ANY_DATA, [value]);

await check("exact values, Hson source, and D2 certification reject reserved names recursively", () => {
  for (const value of invalidValues) {
    assert.throws(() => HsonDataValue.from(value), /Reserved Hson prefix/);
    assert.throws(() => Hson.data.from(value), /Reserved Hson prefix/);
    assert.throws(() => Hson.data.fromSource(JSON.stringify(value)), /Data/);
    let certificate: unknown;
    assert.throws(() => { certificate = certify(value); });
    assert.equal(certificate, undefined);
  }
  for (const source of sources) {
    assert.throws(() => data_source(source));
    assert.throws(() => certify(Hson.data.fromSource(source)));
  }
});

await check("all static Data routes withhold evidence for reserved names rejected by public admission", () => {
  const schema = compiled_hson_schema_of(ANY_DATA);
  for (const source of [...sources, String.raw`<outer «<'\u0024_tag' 1>»>`]) {
    assert.throws(() => Hson.data.parse(source));
    assert.equal(evaluate_static_schema_candidate(schema, { source, family: "data" }, "data").kind, "unknown", source);
  }
  for (const source of [...invalidValues.map(value => JSON.stringify(value)), String.raw`{"outer":[{"\u005fhson_future":1}]}`]) {
    const json = JSON.parse(source);
    const data = parse_ordered_json_text(source);
    assert.throws(() => Hson.data.from(json), /Reserved Hson prefix/);
    assert.throws(() => data_source(source));
    assert.equal(evaluate_static_schema_candidate(schema, { json }, "data").kind, "unknown", `JSON ${source}`);
    assert.equal(evaluate_static_schema_candidate(schema, { data }, "data").kind, "unknown", `Ordered Data ${source}`);
  }
});

await check("Data Library construction rejects values and decoded JSON names without unwrapping", () => {
  for (const value of invalidValues) for (const data of [value]) {
    assert.throws(() => hsonLiveMap.fromLibraries({ rejected: { json: data } }), /Reserved Hson prefix/);
    assert.throws(() => hsonLiveMap.locus.create({ rejected: { json: data } }), /Reserved Hson prefix/);
  }
  for (const data of [
    String.raw`{"\u0024\u005fmeta":{"quid":"000000001"},"a":1}`,
    String.raw`{"nested":[{"$\u005ffuture":1}]}`,
    String.raw`[{"\u005fhson_root":{"a":1}}]`,
    String.raw`{"\u005fhson_root":{"a":1}}`,
  ]) {
    assert.throws(() => hsonLiveMap.fromLibraries({ rejected: { json: Hson.data.fromSource(data) } }));
    assert.throws(() => Hson.data.from(JSON.parse(data)), /Reserved Hson prefix/);
    assert.throws(() => certify(JSON.parse(data)), /Reserved Hson prefix/);
  }
  // This internal transport is canonical JSON, with the same Data qualification.
  assert.throws(() => decode_hson_data_internal('{\n  "$_meta": 1\n}'), /Reserved Hson prefix/);
});

await check("Library addition and mutation publish no partial state or identity", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { value: 0, nested: {}, items: [0] } } });
  const state = map.data.must("state"), owner = internal_livemap_aggregate_authority(map);
  let publications = 0, watches = 0;
  map.commits.observe(() => { publications++; });
  state.at([]).watch(() => { watches++; });
  const before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
  const writes: readonly ((state: LiveMapDataLibrary, value: JsonValue) => unknown)[] = [
    (state, value) => state.at(["nested"]).set(value),
    (state, value) => state.at(["nested"]).replace(value),
    (state, value) => state.at(["nested"]).update(() => value),
    (state, value) => state.at([]).asObject()!.object.setKey("nested", value),
    (state, value) => state.at([]).asObject()!.object.setMany({ value: 2, nested: value }),
    (state, value) => state.at(["items"]).asArray()!.array.push(value),
    (state, value) => state.at(["items"]).asArray()!.array.pushMany([1, value]),
    (state, value) => state.at(["items"]).asArray()!.array.unshift(value),
    (state, value) => state.at(["items"]).asArray()!.array.insert(0, value),
    (state, value) => state.at(["items"]).asArray()!.array.replace(0, value),
    (state, value) => state.at(["items"]).asArray()!.array.splice(0, 1, value),
  ];
  for (const value of invalidValues) {
    for (const write of writes) assert.throws(() => write(state, value));
    for (const data of [value]) {
      assert.throws(() => map.addLibraries({ first: { json: 1 }, rejected: { json: data } }));
      assert.equal(map.data("first"), undefined);
      assert.equal(map.data("rejected"), undefined);
    }
    assert.throws(() => map.batch(writer => {
      writer.data.must("state").at(["value"]).set(2);
      writer.data.must("state").at(["nested"]).set(value);
    }));
    assert.deepEqual(owner.captureSemanticCheckpoint(), before);
    assert.equal(owner.identityEpoch().issued(), issued);
  }
  for (const name of names) {
    assert.throws(() => state.at([]).asObject()!.object.setKey(name, 1));
    assert.throws(() => state.at([]).asObject()!.object.setMany({ value: 2, [name]: 1 }));
    assert.throws(() => state.at([]).asObject()!.object.renameKey("value", name));
    assert.throws(() => state.at([name]).set(1));
  }
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.equal(owner.identityEpoch().issued(), issued);
  assert.equal(map.rev, 0); assert.equal(publications, 0); assert.equal(watches, 0);
});

await check("D2 direct Part Data rejects before writing; source validation stays at composition", () => {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    value: { kind: "document", document: '<p hson:part data:d="%{incoming}" "^{d}"/>' },
  } } });
  const part = map.parts.components.value, owner = internal_livemap_aggregate_authority(map);
  const before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
  let publications = 0;
  map.commits.observe(() => { publications++; });
  for (const value of invalidValues) {
    assert.throws(() => part.write({ incoming: value }), /Reserved Hson prefix/);
  }
  for (const source of [...sources, '<p @000000001/>', '<_hson_obj @000000001>']) {
    assert.throws(() => part.write({ incoming: Hson.data.fromSource(source) }));
    assert.equal(map.doc("rejected"), undefined);
  }
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.equal(owner.identityEpoch().issued(), issued);
  assert.equal(publications, 0);
  const literal = Hson.data.from("$_meta _hson_root");
  map.addLibraries({ valid: { document: part.write({ incoming: literal }) } });
  assert.match(map.doc.must("valid").render(), /<p>\$_meta _hson_root<\/p>/);
});

await check("action input rejects before handlers and invalid computed results cannot certify success", async () => {
  let executions = 0, computations = 0, resultValue: unknown = null;
  const locus = hsonLiveMap.locus.create({ state: { json: { value: 0 } } }, {
    actions: {
      probe: () => { executions++; },
      // @ts-expect-error Deliberately invalid output exercises runtime admission.
      result: () => { computations++; return resultValue; },
    },
  });
  let publications = 0;
  locus.commits.observe(() => { publications++; });
  try {
    for (const payload of invalidValues) {
      const rejected = await Reflect.apply(locus.dispatchAction, locus, [{ type: "action", id: "invalid", name: "probe", payload }]);
      assert.equal(rejected.type, "error");
      assert.equal(rejected.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");
      assert.equal(executions, 0);
      resultValue = payload;
      const result = await locus.dispatchAction({ type: "action", id: "result", name: "result" });
      assert.equal(result.type, "error");
      if (result.type === "error") assert.equal(result.error.code, "LOCUS_ACTION_FAILED");
    }
    assert.equal(computations, invalidValues.length);
    for (const source of sources) assert.throws(() => Hson.data.fromSource(source));
    assert.equal(locus.rev, 0); assert.equal(publications, 0);
    assert.deepEqual(locus.data.must("state").snap(), { value: 0 });
    const accepted = await locus.dispatchAction({ type: "action", id: "valid", name: "probe", payload: Hson.data.from({ text: "$_meta _hson_root" }) });
    assert.equal(accepted.type, "ack"); assert.equal(executions, 1);
  } finally { locus.dispose(); }
});

await check("interaction args and payload reject without replacing installed descriptors", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  enable_interactions(map);
  const descriptor: InteractionDescriptor = {
    id: "valid", subject: { library: "page", path: [0, 0] },
    listener: { event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
    kind: "browser", key: "run", args: Hson.data.from("$_meta _hson_root"),
  };
  add_interaction(map, descriptor);
  const { args: _args, ...base } = descriptor;
  add_interaction(map, { ...base, id: "authority", kind: "locus", payload: Hson.data.from("$_meta _hson_root") });
  const owner = internal_livemap_aggregate_authority(map);
  const before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
  let publications = 0;
  map.commits.observe(() => { publications++; });
  for (const value of invalidValues) {
    for (const invalid of [
      { ...descriptor, args: value },
      { ...base, kind: "locus", payload: value },
    ]) {
      assert.throws(() => Reflect.apply(add_interaction, undefined, [map, { ...invalid, id: "rejected" }]));
      assert.throws(() => Reflect.apply(replace_interaction, undefined, [map, invalid]));
    }
  }
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.equal(owner.identityEpoch().issued(), issued);
  assert.equal(publications, 0);
});

await check("strings, exact ordering, ownership, structural Transform and Document contexts remain valid", () => {
  const ordinaryNames = Object.fromEntries(["$", "$meta", "prefix$_meta", "_hson", "prefix_hson_", ""].map(name => [name, true]));
  assert.deepEqual((Hson.data.from(ordinaryNames)).materialize(), ordinaryNames);
  const values = { text: "$_meta _hson_root", nested: ["$_", { text: '{"$_meta":{"quid":"000000001"}}' }] };
  assert.deepEqual((Hson.data.from(values)).materialize(), values);
  assert.equal((certify(values) as HsonDataValue).toHson(), Hson.data.from(values).toHson());
  const map = hsonLiveMap.fromLibraries({ state: { json: Hson.data.fromSource(JSON.stringify(values)) }, literal: { json: "$_meta _hson_root" } });
  values.nested.push("later");
  assert.notDeepEqual(map.data.must("state").snap(), values);
  assert.equal(map.data.must("literal").snap(), "$_meta _hson_root");
  for (const invalidSource of ["$_meta", "<p/>"]) {
    assert.throws(() => hsonLiveMap.fromLibraries({ rejected: { json: Hson.data.fromSource(invalidSource) } }));
  }
  assert.equal((certify("42") as HsonDataValue).scalar(), "42");
  assert.equal((Hson.data.from("42")).toHson(), Hson.data`"42"`);
  const ordered = hsonLiveMap.fromLibraries({ state: { json: Hson.data.fromSource('{"10":-0,"2":2,"__proto__":true}') } }).data.must("state").at([]).hson()!;
  assert.deepEqual(Hson.data.fromSource((ordered)).entries()?.map(([key]) => key), ["10", "2", "__proto__"]);
  assert.ok(Object.is(Hson.data.fromSource(ordered).entries()![0]![1].materialize(), -0));
  // Explicit general Transform envelopes retain their established interpretation.
  assert.deepEqual(hsonTransform.fromJson({ _hson_root: { a: 1 } }).toJson().value(), { a: 1 });
  const envelope = { _hson_root: { _hson_elem: [{ p: "$_meta _hson_root", $_attrs: { title: "$_attrs" } }] }, $_meta: {} };
  const node = hsonTransform.fromJson(envelope).toNode();
  assert.equal(node.$_tag, "_hson_root");
  assert.equal(hsonTransform.fromNode(detach_hson_root_value(node)).toHson().serialize(), hsonTransform.fromJson(envelope).toHson().serialize());
  const document = Hson.document`<p title="$_meta _hson_root" "$_meta _hson_root"/>`;
  assert.equal(ANY_DOCUMENT.certify(document), document);
  assert.throws(() => hsonTransform.fromJson({ _hson_root: {}, $_meta: { quid: "000000001" } }), /QUID/);
  assert.throws(() => data_source('<_hson_obj @000000001>'));
});

await check("reserved Document names reject across authored and structural admission", () => {
  for (const name of [...names.filter(name => name.startsWith("$_")), "$_widget", "$_operator-extra"]) {
    for (const source of ["<'" + name + "'/>", "<" + name + "/>", "<main <'" + name + "'/>/>"]) {
      assert.throws(() => Reflect.apply(Hson.document.fromHson, Hson.document, [source]), source);
      assert.throws(() => hsonTransform.fromHson(source).toNode(), source);
      assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: source } }), source);
      assert.throws(() => hsonLiveMap.locus.create({ page: { document: source } }), source);
    }
    const partSource = "<main hson:part <'" + name + "'/>/>";
    assert.throws(() => hsonLiveMap.fromLibraries({ components: { parts: {
      bad: { kind: "document", document: partSource },
    } } }), /authored-reserved-name/);
    assert.throws(() => hsonLiveMap.locus.create({ components: { parts: {
      bad: { kind: "document", document: partSource },
    } } }), /authored-reserved-name/);
    // Mutate a producer-created canonical graph only as a malformed rejection input.
    const graph = hsonTransform.fromHson("<valid/>").toNode();
    const element = graph.$_content[0];
    assert.ok(is_Node(element));
    element.$_tag = name;
    assert.throws(() => hsonTransform.fromNode(graph));
    assert.throws(() => Hson.document.fromNode(graph));
    if (name !== "$_meta" && name !== "$_attrs") {
      const input = { _hson_elem: [{ [name]: "" }] };
      assert.throws(() => hsonTransform.fromJson(JSON.stringify(input)));
      assert.throws(() => hsonTransform.fromJsonValue(input));
    }
  }
  assert.throws(() => Hson.document`<'$_widget'/>`);
  assert.throws(() => Hson.document`<main <'$_meta'/>/>`);
  assert.throws(() => Hson.document`<'\u0024\u005fattrs'/>`);
  for (const source of ["<'widget.card' title=\"$_attrs\" \"text\"/>", "<main <custom-element/>/>", "<'prefix$_meta'/>"]) {
    const document = Reflect.apply(Hson.document.fromHson, Hson.document, [source]);
    assert.equal(ANY_DOCUMENT.certify(document), document);
    const transform = hsonTransform.fromHson(source);
    const output = transform.toJson();
    for (const restored of [hsonTransform.fromJson(output.serialize()), hsonTransform.fromJsonValue(output.value())]) {
      assert.equal(restored.toHson().serialize(), document);
    }
    const map = hsonLiveMap.fromLibraries({ page: { document } });
    assert.equal(map.doc.must("page").root().$_tag, "_hson_root");
  }
  const array = hsonTransform.fromJson([1]).toNode();
  const value = detach_hson_root_value(array);
  const item = value.$_content[0];
  assert.ok(is_Node(item));
  assert.equal(item.$_meta?.index, "0");
  assert.equal(hsonTransform.fromNode(value).toHson().serialize(), "«\n  1\n»");
});

await check("reserved name diagnostics identify the authored source point", () => {
  for (const source of ["<main\n  <'$_widget'/>/>", String.raw`<main <'\u0024\u005fmeta'/>/>`]) {
    const start = source.indexOf("'");
    assert.throws(() => hsonTransform.fromHson(source).toNode(), error => {
      const details = read_transform_error_details(error);
      assert.equal(details?.code, "authored-reserved-name");
      assert.equal(details?.source?.index, start);
      assert.equal(details?.source?.line, source.includes("\n") ? 2 : 1);
      return true;
    });
    const issues = produce_document_diagnostics({ fileName: "case.hson", languageId: "hson", text: source, authoringMode: "document" });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, "authored-reserved-name");
    assert.deepEqual(issues[0]?.range, { start, end: start + 1 });
    assert.equal(issues[0]?.precision, "point");
  }
  const text = "import { Hson } from 'hson-live';\nconst page = Hson.document`<main <'$_widget'/>/>`;";
  const start = text.indexOf("'$_widget'");
  const issues = produce_document_diagnostics({ fileName: "case.ts", languageId: "typescript", text });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "authored-reserved-name");
  assert.deepEqual(issues[0]?.range, { start, end: start + 1 });
});

await check("Part Document inputs and Schema controls retain their existing contracts", () => {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    host: { kind: "document", document: '<main hson:part doc:c="%{content}" <hson-part ^{c}/>/>' },
  } } });
  const good = map.parts.components.host.write({ content: '<custom-element title="$_meta" "42"/>' });
  map.addLibraries({ page: { document: good } });
  assert.match(map.doc.must("page").render(), /<custom-element title="\$_meta">42<\/custom-element>/);
  const bad = map.parts.components.host.write({ content: "<'$_meta'/>" });
  assert.throws(() => map.addLibraries({ rejected: { document: bad } }), /authored-reserved-name/);
  const documentSchema = Hson.schema`<type "document" tag "main">`;
  const dataSchema = Hson.schema`<type "data" root <object <value "string">>>`;
  assert.equal(documentSchema.certify(Hson.document`<main title="$_attrs"/>`), Hson.document`<main title="$_attrs"/>`);
  assert.deepEqual(dataSchema.certify(Hson.data.from({ value: "$_meta" })).materialize(), { value: "$_meta" });
});

await check("generic Hson conversion rejects reserved ordinary Data and Document names", () => {
  for (const source of [...sources,
    String.raw`<'\u0024\u005fmeta' 1>`,
    String.raw`<nested «<'\u0024_future' 1>»>`,
  ]) {
    for (const terminal of [
      () => hsonTransform.fromHson(source).toNode(),
      () => hsonTransform.fromHson(source).toHtml().serialize(),
      () => hsonTransform.fromHson(source).toJson().value(),
      () => hsonTransform.fromHson(source).toHson().serialize(),
    ]) assert.throws(terminal);
  }
  for (const terminal of [
    () => hsonTransform.fromHson("<'$_meta'/>").toNode(),
    () => hsonTransform.fromHson("<'$_meta'/>").toHtml().serialize(),
    () => hsonTransform.fromHson("<'$_meta'/>").toJson().value(),
    () => hsonTransform.fromHson("<'$_meta'/>").toHson().serialize(),
  ]) assert.throws(terminal);
});

events.terminal("pass");
process.stdout.write("1.." + checks + "\n");

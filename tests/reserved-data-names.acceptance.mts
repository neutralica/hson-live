import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, hsonTransform, type LiveMapDataLibrary } from "../src/index.js";
import type { JsonValue } from "../src/core/types.js";
import { is_Node } from "../src/core/node-guards.js";
import { ExactDataCarrier, decode_hson_data_internal } from "../src/api/data/hson-data.js";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.js";
import { add_interaction, enable_interactions, replace_interaction } from "../src/api/interactions/interactions.js";
import type { InteractionDescriptor } from "../src/types/interaction.types.js";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.js";
import { create_test_event_emitter } from "./test-events.mjs";

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
const data_source = (source: string) => Reflect.apply(Hson.data.fromHson, Hson.data, [source]);
const certify = (value: unknown) => Reflect.apply(ANY_DATA.certify, ANY_DATA, [value]);

await check("exact values, Hson source, and D2 certification reject reserved names recursively", () => {
  for (const value of invalidValues) {
    assert.throws(() => ExactDataCarrier.from(value), /Reserved Hson prefix/);
    assert.throws(() => Hson.data.from(value), /Reserved Hson prefix/);
    let certificate: unknown;
    assert.throws(() => { certificate = certify(value); });
    assert.equal(certificate, undefined);
  }
  for (const source of sources) {
    assert.throws(() => data_source(source));
    assert.throws(() => certify(source));
  }
});

await check("Data Library construction rejects values and decoded JSON names without unwrapping", () => {
  for (const value of invalidValues) for (const data of [value, JSON.stringify(value)]) {
    assert.throws(() => hsonLiveMap.fromLibraries({ rejected: { data } }), /Reserved Hson prefix/);
    assert.throws(() => hsonLiveMap.locus.create({ rejected: { data } }), /Reserved Hson prefix/);
  }
  for (const data of [
    String.raw`{"\u0024\u005fmeta":{"quid":"000000001"},"a":1}`,
    String.raw`{"nested":[{"$\u005ffuture":1}]}`,
    String.raw`[{"\u005fhson_root":{"a":1}}]`,
    String.raw`{"\u005fhson_root":{"a":1}}`,
  ]) {
    assert.throws(() => hsonLiveMap.fromLibraries({ rejected: { data } }), /Reserved Hson prefix/);
    assert.throws(() => Hson.data.from(JSON.parse(data)), /Reserved Hson prefix/);
    assert.throws(() => certify(JSON.parse(data)), /Reserved Hson prefix/);
  }
  // This internal transport is canonical JSON, with the same Data qualification.
  assert.throws(() => decode_hson_data_internal('{\n  "$_meta": 1\n}'), /Reserved Hson prefix/);
});

await check("Library addition and mutation publish no partial state or identity", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0, nested: {}, items: [0] } } });
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
    for (const data of [value, JSON.stringify(value)]) {
      assert.throws(() => map.addLibraries({ first: { data: 1 }, rejected: { data } }));
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
    const invocation = part.write({ incoming: source });
    assert.equal(typeof invocation, "string");
    assert.throws(() => map.addLibraries({ rejected: { document: invocation } }));
    assert.equal(map.doc("rejected"), undefined);
  }
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.equal(owner.identityEpoch().issued(), issued);
  assert.equal(publications, 0);
  const literal = Hson.data.from("$_meta _hson_root");
  map.addLibraries({ valid: { document: part.write({ incoming: literal }) } });
  assert.match(map.doc.must("valid").render(), /<p>\$_meta _hson_root<\/p>/);
});

await check("action payloads and decoder outputs reject before handlers; results cannot certify success", async () => {
  let executions = 0, decoderValue: unknown = null, resultValue: unknown = null;
  const locus = hsonLiveMap.locus.create({ state: { data: { value: 0 } } }, {
    actions: {
      probe: () => { executions++; },
      decoded: () => { executions++; },
      result: () => resultValue,
    },
    schema: { actions: { decoded: { payload: () => ({ ok: true, value: decoderValue }) } } },
  });
  let publications = 0;
  locus.commits.observe(() => { publications++; });
  try {
    for (const payload of [...invalidValues, ...sources]) {
      const rejected = await Reflect.apply(locus.dispatchAction, locus, [{ type: "action", id: "invalid", name: "probe", payload }]);
      assert.equal(rejected.type, "error");
      assert.equal(rejected.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");
      assert.equal(executions, 0);
      decoderValue = payload;
      const decoded = await locus.dispatchAction({ type: "action", id: "decoded", name: "decoded" });
      assert.equal(decoded.type, "error");
      assert.equal(executions, 0);
      resultValue = payload;
      const result = await locus.dispatchAction({ type: "action", id: "result", name: "result" });
      assert.equal(result.type, "error");
      if (result.type === "error") assert.equal(result.error.code, "LOCUS_ACTION_FAILED");
    }
    assert.equal(locus.rev, 0); assert.equal(publications, 0);
    assert.deepEqual(locus.data.must("state").snap(), { value: 0 });
    const accepted = await locus.dispatchAction({ type: "action", id: "valid", name: "probe", payload: Hson.data.from("$_meta _hson_root") });
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
  for (const value of [...invalidValues, ...sources]) {
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
  assert.deepEqual(Hson.data.materialize(Hson.data.from(ordinaryNames)), ordinaryNames);
  const values = { text: "$_meta _hson_root", nested: ["$_", { text: '{"$_meta":{"quid":"000000001"}}' }] };
  assert.deepEqual(Hson.data.materialize(Hson.data.from(values)), values);
  assert.equal(certify(values), Hson.data.from(values));
  const map = hsonLiveMap.fromLibraries({ state: { data: JSON.stringify(values) }, literal: { data: '"$_meta _hson_root"' } });
  values.nested.push("later");
  assert.notDeepEqual(map.data.must("state").snap(), values);
  assert.equal(map.data.must("literal").snap(), "$_meta _hson_root");
  for (const invalidSource of ["$_meta", "<p/>"]) {
    assert.throws(() => hsonLiveMap.fromLibraries({ rejected: { data: invalidSource } }));
  }
  assert.equal(certify("42"), Hson.data.from(42));
  assert.equal(Hson.data.from("42"), Hson.data`"42"`);
  const ordered = hsonLiveMap.fromLibraries({ state: { data: '{"10":-0,"2":2,"__proto__":true}' } }).data.must("state").at([]).hson()!;
  assert.deepEqual(Hson.data.entries(ordered)?.map(([key]) => key), ["10", "2", "__proto__"]);
  assert.ok(Object.is(Hson.data.materialize(Hson.data.entries(ordered)![0]![1]), -0));
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

await check("Document element names retain their context through certification, ownership and Transform envelopes", () => {
  for (const name of [...names.filter(name => name.startsWith("$_")), "$_widget"]) {
    const source = "<'" + name + "'/>";
    const document = Reflect.apply(Hson.document.fromHson, Hson.document, [source]);
    assert.equal(ANY_DOCUMENT.certify(document), document);
    const map = hsonLiveMap.fromLibraries({ page: { document } });
    assert.equal(map.doc.must("page").root().$_tag, "_hson_root");
    // JSON element envelopes reserve these two slots for actual metadata/attrs.
    const converted = name === "$_meta" || name === "$_attrs"
      ? hsonTransform.fromHson(source)
      : hsonTransform.fromJson({ _hson_elem: [{ [name]: "" }] });
    assert.equal(converted.toHson().serialize(), document);
    const graph = converted.toNode();
    assert.equal(hsonTransform.fromNode(graph.$_tag === "_hson_root" ? detach_hson_root_value(graph) : graph).toHson().serialize(), document);
    assert.throws(() => Hson.data.from({ [name]: 1 }), /Reserved Hson prefix/);
  }
  const array = hsonTransform.fromJson([1]).toNode();
  const value = detach_hson_root_value(array);
  const item = value.$_content[0];
  assert.ok(is_Node(item));
  assert.equal(item.$_meta?.index, "0");
  assert.equal(hsonTransform.fromNode(value).toHson().serialize(), "«\n  1\n»");
});

await check("generic Hson conversion qualifies unambiguous Data members without banning Document spellings", () => {
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
  const source = "<'$_meta'/>";
  const converted = hsonTransform.fromHson(source);
  assert.equal(converted.toNode().$_tag, "_hson_elem");
  assert.equal(converted.toHson().serialize(), source);
  assert.equal(typeof converted.toHtml().serialize(), "string");
});

events.terminal("pass");
process.stdout.write("1.." + checks + "\n");

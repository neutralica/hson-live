import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, HsonDataValue, hsonLiveMap, type HsonSchema } from "../../src/index.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.js";
import { ProjectedValueAdmissionError } from "../../src/core/projected-value-admission.js";

function rejects_unsupported(admit: (value: unknown) => unknown): void {
  let getterCalls = 0, toJsonCalls = 0;
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { getterCalls++; return 1; } });
  class Instance { value = 1; }
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, Symbol("value"), () => 1,
    new Date(), new Instance(), cycle, [, 1], [undefined], { value: undefined }, { value: NaN },
    accessor, Object.defineProperty({}, "hidden", { value: 1 }), { [Symbol("key")]: 1 },
    Object.assign([1], { extra: 2 }), { toJSON() { toJsonCalls++; return {}; } },
    { _hson_quid: "000000001" }, { nested: { _hson_root: 1 } }]) {
    assert.throws(() => admit(value), TypeError);
  }
  assert.equal(getterCalls, 0); assert.equal(toJsonCalls, 0);
  assert.throws(() => admit({ nested: [true, undefined] }), (error: unknown) => {
    assert.ok(error instanceof ProjectedValueAdmissionError);
    assert.equal(error.code, "UNDEFINED_VALUE"); assert.deepEqual(error.path, ["nested", 1]);
    return true;
  });
}

export function direct_data_part_cases(): void {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    value: { kind: "document", document: '<p hson:part data:record="%{incoming}" "^{record}"/>' },
    record: { kind: "document", document: '<p hson:part data:record="%{incoming}" "^{record.label}:^{record.count}"/>' },
    list: { kind: "document", document: '<ul hson:part data:items="%{incoming}" <li for:item="^{items}" "^{item}"/>/>' },
    entries: { kind: "document", document: '<ul hson:part data:items="%{incoming}" <li per::item="^{items}" "^{item}"/>/>' },
    forward: { kind: "document", document: '<main hson:part data:record="%{incoming}" <hson-part at="record" incoming:data="^{record}"/>/>' },
    scalar: { kind: "document", document: '<p hson:part "%{incoming}"/>' },
    document: { kind: "document", document: '<main hson:part doc:record="%{incoming}" <hson-part ^{record}/>/>' },
  } } });
  const parts = map.parts.components, owner = internal_livemap_aggregate_authority(map);
  const before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
  // Different invocations of one immutable definition retain their own values and shapes.
  const values: import("../../src/api/data/hson-data.js").HsonDataInput[] = [{ count: 42, label: "Example" }, ["42", 42, true, null, -0, [], {}], 42, true, false, null, -0,
    {}, [], { nested: [[], {}, { text: "", zero: -0, booleanText: "true", nullText: "null" }] }];
  const invocations = values.map(incoming => parts.value.write({ incoming }));
  for (const [index, source] of invocations.entries()) {
    const connector = parse_authored_document_library(source).root.$_content[0];
    assert.ok(typeof connector === "object" && connector !== null);
    assert.deepEqual(Object.keys(connector.$_attrs!).sort(), ["at", "incoming:data", "lib"]);
    assert.equal(connector.$_attrs!["incoming:data"], (Reflect.apply(Hson.data.from, Hson.data, [values[index]])).toHson());
    assert.equal(source, parts.value.write({ incoming: Reflect.apply(Hson.data.from, Hson.data, [values[index]]) }));
  }
  assert.notEqual(parts.value.write({ incoming: "42" }), parts.value.write({ incoming: 42 }));
  assert.notEqual(parts.value.write({ incoming: Hson.data.from("42") }), parts.value.write({ incoming: 42 }));
  const direct = { count: 42, label: "Example" };
  const recordSource = parts.record.write({ incoming: direct });
  direct.count = 99;
  const listSource = parts.list.write({ incoming: ["42", 42, true, null, -0] });
  const scalarSources = [42, true, false, null, -0].map(incoming => parts.value.write({ incoming }));
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.equal(owner.identityEpoch().issued(), issued);
  map.addLibraries({ page: { document: Hson.document`<section ${recordSource} ${listSource} ${scalarSources.join(" ")}/>` },
    forwarded: { document: parts.forward.write({ incoming: { label: "Forwarded", count: 7 } }) } });
  assert.match(map.doc.must("page").render(), /<p>Example:42<\/p><ul><li>42<\/li><li>42<\/li><li>true<\/li><li>null<\/li><li>0<\/li><\/ul><p>42<\/p><p>true<\/p><p>false<\/p><p>null<\/p><p>0<\/p>/);
  assert.match(map.doc.must("forwarded").render(), /<main><p>Forwarded:7<\/p><\/main>/);
  for (const incoming of [[], {}]) {
    const name = Array.isArray(incoming) ? "emptyArray" : "emptyObject";
    map.addLibraries({ [name]: { document: (Array.isArray(incoming) ? parts.list : parts.entries).write({ incoming }) } });
    assert.match(map.doc.must(name).render(), /<ul><\/ul>/);
  }
  const ordered = Object.fromEntries([["z", -0], ["a", "42"], ["__proto__", null]]);
  const orderedSource = parts.entries.write({ incoming: ordered });
  map.addLibraries({ ordered: { document: orderedSource } });
  assert.match(map.doc.must("ordered").render(), /<li>0<\/li><li>42<\/li><li>null<\/li>/);
  const numericKeys = Object.fromEntries([["10", -0], ["2", 42]]);
  const numericSource = parts.entries.write({ incoming: numericKeys });
  const numericConnector = parse_authored_document_library(numericSource).root.$_content[0];
  assert.ok(typeof numericConnector === "object" && numericConnector !== null);
  assert.equal(numericConnector.$_attrs!["incoming:data"], (Hson.data`<'2' 42 '10' -0>`).toHson());
  const exactSource = Hson.data`<'10' -0 '2' "42" tail false>`;
  const exactInvocation = parts.entries.write({ incoming: exactSource });
  const exactConnector = parse_authored_document_library(exactInvocation).root.$_content[0];
  assert.ok(typeof exactConnector === "object" && exactConnector !== null);
  assert.equal(exactConnector.$_attrs!["incoming:data"], exactSource.toHson());
  map.addLibraries({ exact: { document: exactInvocation } });
  assert.match(map.doc.must("exact").render(), /<li>0<\/li><li>42<\/li><li>false<\/li>/);
  // A declaration chooses transport even when the caller uses identical keys.
  assert.throws(() => parts.scalar.write({ incoming: {} }), /finite scalar/);
  assert.throws(() => parts.document.write({ incoming: {} }), /finite scalar/);
  assert.throws(() => parts.document.write({ incoming: false }), /serialized strings/);
  assert.throws(() => parts.record.write({ record: {} }), /unexpected/);
  const checkpoint = owner.captureSemanticCheckpoint(), ledger = owner.identityEpoch().issued();
  rejects_unsupported(value => Reflect.apply(parts.value.write, undefined, [{ incoming: value }]));
  // Source-looking strings are ordinary Data; explicit source admission rejects invalid claims.
  for (const incoming of ["<broken", '<p @000000001/>', '<_hson_obj @000000001>']) {
    const source = parts.value.write({ incoming });
    const connector = parse_authored_document_library(source).root.$_content[0];
    assert.ok(typeof connector === "object" && connector !== null);
    assert.equal(connector.$_attrs?.["incoming:data"], Hson.data.from(incoming).toHson());
    assert.throws(() => parts.value.write({ incoming: Hson.data.fromSource(incoming) }));
  }
  // A supported value can still fail its receiving use; that remains a composition failure.
  const wrongShape = parts.record.write({ incoming: { count: 1 } });
  assert.throws(() => map.addLibraries({ rejected: { document: wrongShape } }), /label/);
  assert.deepEqual(owner.captureSemanticCheckpoint(), checkpoint);
  assert.equal(owner.identityEpoch().issued(), ledger);
  const hostile = new Proxy({}, { ownKeys() {
    map.addLibraries({ duringCapture: { data: 1 } }); return [];
  } });
  assert.throws(() => parts.value.write({ incoming: hostile }), /changed during capture/);
}

export function direct_data_schema_cases(): void {
  const number: HsonSchema = Hson.schema`<type "data" defs <Value "number"> content <ref "Value">>`;
  const boolean: HsonSchema = Hson.schema`<type "data" defs <Value "boolean"> content <ref "Value">>`;
  const nothing: HsonSchema = Hson.schema`<type "data" defs <Value "null"> content <ref "Value">>`;
  const negativeZero: HsonSchema = Hson.schema`<type "data" defs <Value <exact -0>> content <ref "Value">>`;
  const string: HsonSchema = Hson.schema`<type "data" defs <Value "string"> content <ref "Value">>`;
  const object: HsonSchema = Hson.schema`<type "data" content <count "number" label "string" note <optional "boolean">>>`;
  const array: HsonSchema = Hson.schema`<type "data" defs <Value <array "number">> content <ref "Value">>`;
  const union: HsonSchema = Hson.schema`<type "data" defs <Value <union ["number", "boolean", "null"]>> content <ref "Value">>`;
  const choice: HsonSchema = Hson.schema`<type "data" defs <Value <union [<content <kind <exact "count"> count "number">>, <content <kind <exact "label"> label "string">>]>> content <ref "Value">>`;
  for (const [schema, candidates] of [[number, [42, -0]], [boolean, [true, false]], [nothing, [null]], [negativeZero, [-0]],
    [object, [{ count: 42, label: "Example" }, { count: -0, label: "", note: false }]],
    [array, [[], [42, -0]]], [union, [42, false, null]],
    [choice, [{ kind: "count", count: 42 }, { kind: "label", label: "Example" }]]] as const) {
    const identity = schema.toHson();
    for (const candidate of candidates) {
      const certified = Reflect.apply(schema.certify, schema, [candidate]);
      assert.ok(certified instanceof HsonDataValue);
      assert.ok((Reflect.apply(schema.certify, schema, [Reflect.apply(Hson.data.from, Hson.data, [candidate])]) as HsonDataValue).equals(certified));
      assert.deepEqual(certified.materialize(), candidate);
    }
    assert.equal(schema.toHson(), identity); assert.ok(Object.isFrozen(schema));
  }
  const input = { nested: [-0, "42", 42, "true", true, "null", null, "", [], {}] };
  const certificate = ANY_DATA.certify(input);
  input.nested.push("after");
  assert.equal((certificate).toHson(), (Hson.data`<nested [-0,"42",42,"true",true,"null",null,"",[],<>]>`).toHson());
  const ordinary = Object.fromEntries([["z", -0], ["a", true], ["__proto__", { constructor: null }]]);
  const ordered = ANY_DATA.certify(ordinary);
  assert.deepEqual((ordered).entries()?.map(([name]) => name), ["z", "a", "__proto__"]);
  assert.ok(Object.is(((ordered).entries()![0]![1]).materialize(), -0));
  assert.equal((ANY_DATA.certify(Object.fromEntries([["10", -0], ["2", 42]]))).toHson(), (Hson.data`<'2' 42 '10' -0>`).toHson());
  const authored = Hson.data`<'10' -0 '2' "42" tail false>`;
  assert.equal((ANY_DATA.certify(authored)).toHson(), (authored).toHson());
  // D4c makes ordinary strings literal, and source admission explicit.
  assert.throws(() => Reflect.apply(number.certify, number, ["42"]), HsonSchemaError);
  assert.equal((Reflect.apply(string.certify, string, ["42"]) as HsonDataValue).scalar(), "42");
  assert.equal((Reflect.apply(number.certify, number, [Hson.data.fromSource("42")]) as HsonDataValue).scalar(), 42);
  for (const candidate of [42, [], {}, { count: "42", label: "x" }, { count: 1, label: "x", extra: true },
    { count: 1, label: "x", note: null }]) {
    const failure = (value: unknown): HsonSchemaError => {
      try { Reflect.apply(object.certify, object, [value]); }
      catch (error) { assert.ok(error instanceof HsonSchemaError); return error; }
      throw Error("Expected certification failure");
    };
    const direct = failure(candidate), serialized = failure(Reflect.apply(Hson.data.from, Hson.data, [candidate]));
    assert.equal(direct.code, "SCHEMA_VALIDATION"); assert.equal(direct.message, serialized.message);
    assert.deepEqual(direct.path, serialized.path); assert.deepEqual(direct.issues, serialized.issues);
  }
  assert.throws(() => object.certify({ count: "42", label: "x" }), (error: unknown) => {
    assert.ok(error instanceof HsonSchemaError);
    assert.deepEqual(error.path, ["count"]);
    assert.equal(error.issues[0]?.expected, "number"); assert.equal(error.issues[0]?.received, "string");
    return true;
  });
  for (const [schema, value] of [[number, false], [boolean, 1], [nothing, 0], [negativeZero, 0], [array, [1, "2"]], [union, []],
    [choice, { kind: "count", count: "42" }]] as const) {
    assert.throws(() => schema.certify(value), HsonSchemaError);
  }
  rejects_unsupported(value => Reflect.apply(ANY_DATA.certify, ANY_DATA, [value]));
  for (const source of ["<broken", '<p @000000001/>', '<_hson_obj @000000001>']) {
    assert.throws(() => Hson.data.fromSource(source), TypeError);
  }
  const document = Hson.document`<main "Existing"/>`;
  assert.equal(ANY_DOCUMENT.certify(document), document);
  assert.throws(() => Reflect.apply(ANY_DOCUMENT.certify, ANY_DOCUMENT, [{ count: 42 }]), /requires Hson text/);
}

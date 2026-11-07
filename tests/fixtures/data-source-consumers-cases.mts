import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, HsonDataValue, hsonLiveMap, hsonTransform, type HsonDataInput } from "../../src/index.js";
import { admit_data_input, decode_hson_data_internal, encode_hson_data_internal, hson_data_value } from "../../src/api/data/hson-data.js";
import { admit_echo_action_payload } from "../../src/api/echo/echo.request.js";
import { decodeEndpointMessage, encodeEndpointMessage } from "../../src/api/echo/echo.semantic-codec.internal.js";
import { decode_locus_message, encode_locus_client_message } from "../../src/api/locus/locus.protocol.js";
import { decode_locus_action_payload } from "../../src/api/locus/locus.action-validation.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { document_composition_options } from "../../src/api/livemap/livemap.document.composition.js";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.js";
import { decode_projected_value_payload } from "../../src/api/livemap/livemap.transport.js";
import { decode_hosted_root } from "../../src/api/livemap/livemap.hosted.js";
import { add_interaction, enable_interactions } from "../../src/api/interactions/interactions.js";
import { is_Node } from "../../src/core/node-guards.js";
import { projected_value_from_hson_node } from "../../src/core/projected-value-graph.js";
import { materialize_projected_value } from "../../src/core/projected-value-materialization.js";
import { hson_schema_digest } from "../../src/api/schema/hson-schema.js";
import { read_transform_error_details } from "../../src/core/errors.js";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
const orderedJson = String.raw`{"10":-0,"2":{"text":"quote\" slash\\ line\n\u0061","nested":[{},[],"42",true,null]},"tail":[]}`;
const orderedHson = String.raw`<'10' -0 '2' <text "quote\" slash\\ line\n\u0061" nested [<>,[],"42",true,null,]> tail []>`;
const pairs: readonly (readonly [string, string])[] = [
  [orderedJson, orderedHson], ["{}", "<>"], ["[]", "«»"],
  ['[{"a":[]},{}]', '[<a []>,<>,]'], ["-0", "// zero\n-0"],
  ['"42"', '// string\n"42"'], ["true", "// boolean\ntrue"], ["false", "false"], ["null", "null"],
];
const invalidSources = [
  '{"nested":[{"$_meta":{"quid":"000000001"}}]}', '<nested [<_hson_quid "000000001">]>',
  String.raw`{"nested":{"\u005fhson_root":1}}`, '{"_hson_root":{"a":1}}',
  '<p/>', '<p title="x"/>', '<_hson_obj @000000001>', '<p @000000001/>',
  '{"a":1,}', '<a 1', '[{"a":1},<b 2>]',
];
const literals = ["42", "true", "null", "{}", "<count 1>", "<broken", orderedJson, orderedHson];
const invalidValues = [Object.create(HsonDataValue.prototype), { nested: undefined }, { _hson_root: 1 }, { $_meta: { quid: "000000001" } }, new Date(), () => 1, 1n];

export async function data_source_consumer_cases(check: Check): Promise<void> {
  await check("Data source authoring and HSON-only exact parsing share ordered admission", () => {
    const source = Hson.data`<slides []>`;
    assert.equal(typeof source, "string");
    assert.deepEqual(hsonTransform.fromHson(source).toJson().value(), { slides: [] });
    assert.ok(Hson.data.parse(source) instanceof HsonDataValue);
    assert.ok(Hson.data.parse`<slides []>`.equals(Hson.data.parse(source)));
    const nested = Hson.data`<'10' -0 '2' <empty "" values [true,false,null,[],<>]>>`;
    const exact = Hson.data.parse(nested);
    assert.deepEqual(exact.entries()?.map(([name]) => name), ["10", "2"]);
    assert.ok(Object.is(exact.entries()?.[0]?.[1].scalar(), -0));
    assert.equal(exact.toHson(), nested);
    assert.ok(Hson.data.parse`<outer ${nested} quoted "pre${true}${null}${-0}post">`
      .equals(Hson.data.parse(Hson.data`<outer ${nested} quoted "pre${true}${null}${-0}post">`)));
    for (const [source, value] of [['""', ""], ['"true"', "true"], ["true", true], ["false", false], ["null", null], ["-0", -0]] as const) {
      assert.ok(Object.is(Hson.data.parse(source).scalar(), value));
    }
    for (const source of ['{"a":1}', '{}', '<a 1 a 2>', '<a 1', '<p/>', '<p title="x"/>', '<a <p/>>', '<@000000001 a 1>', '<a <_hson_root 1>>', '[] []', '', 'NaN', '+1']) {
      assert.throws(() => Hson.data.parse(source));
      assert.throws(() => Hson.data.parse`${source}`);
    }
    for (const input of [undefined, null, {}, [], new String("true"), exact, Object.create(HsonDataValue.prototype)]) {
      assert.throws(() => Reflect.apply(Hson.data.parse, undefined, [input]));
    }
    const capture = (strings: TemplateStringsArray, _value: unknown) => strings;
    for (const strings of [capture`<a ${0}>`, capture`<a "${0}">`]) {
      for (const invalid of [undefined, {}, [], exact, NaN, Infinity, 1n]) assert.throws(() => Reflect.apply(Hson.data.parse, undefined, [strings, invalid]));
    }
    assert.throws(() => Hson.data.parse`<a ${"bare"}>`);
    assert.throws(() => Hson.data.parse`<${"name"} 1>`);
    assert.equal(Hson.data.parse`<a "${""}">`.entries()?.[0]?.[1].scalar(), "");
    assert.ok(Object.is(Hson.data.parse`${-0}`.scalar(), -0));
    const syntaxTemplate = (strings: TemplateStringsArray) => strings;
    for (const tag of [Hson.data, Hson.data.parse]) {
      assert.throws(() => Reflect.apply(tag, undefined, [syntaxTemplate`<@000000001 a 1>`]), error =>
        read_transform_error_details(error)?.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN");
    }
    const forgedSource = '<p/>' as ReturnType<typeof Hson.data>;
    assert.throws(() => Hson.data.parse(forgedSource));
    assert.throws(() => Reflect.apply(Hson.data.parse, undefined, ["true", false]));
    // No public serializer or factory participates in private exact capture.
    const serializer = HsonDataValue.prototype.toHson;
    try {
      HsonDataValue.prototype.toHson = () => { throw new Error("public serializer invoked"); };
      assert.ok(Hson.data.parse`<a ${nested}>` instanceof HsonDataValue);
    } finally { HsonDataValue.prototype.toHson = serializer; }
  });

  await check("native Data.from captures current mutable values without changing source semantics", () => {
    const S = Hson.schema`<type "data" content <n "number">>`;
    const A = Hson.schema`<type "data" defs <Numbers <array "number">> content <ref "Numbers">>`;
    const value: { n: string | number } = { n: "before" };
    value.n = 1;
    const exact = Hson.data.from(value);
    assert.ok(exact instanceof HsonDataValue);
    assert.equal(S.certify(exact), exact);
    assert.deepEqual(exact.materialize(), { n: 1 });
    const array: (string | number)[] = ["before"];
    array[0] = 1;
    assert.deepEqual(A.certify(Hson.data.from(array)).materialize(), [1]);
    const appended: (string | number)[] = ["before"];
    appended.splice(0, 1, 1);
    assert.deepEqual(A.certify(Hson.data.from(appended)).materialize(), [1]);
    assert.throws(() => S.certify(Hson.data.from({ n: "invalid" })));
    assert.throws(() => A.certify(Hson.data.from(["invalid"])));
    assert.deepEqual(S.certify(Hson.data.parse`<n 1>`).materialize(), { n: 1 });
    assert.deepEqual(S.certify(Hson.data.parse("<n 1>")).materialize(), { n: 1 });
    assert.deepEqual(S.certify(Hson.data.fromSource('{"n":1}')).materialize(), { n: 1 });
    assert.throws(() => S.certify(Hson.data.from("<n 1>")));
    assert.throws(() => Hson.data.parse('{"n":1}'));
  });

  await check("explicit Library channels preserve representation, complete validation and single capture", () => {
    const source = Hson.data`<slides []>`;
    const schema = Hson.schema`<type "data" content <slides <array "any">>>`;
    const fromSource = hsonLiveMap.fromLibraries({ slides: { hson: source, schema } });
    const fromNative = hsonLiveMap.fromLibraries({ slides: { json: { slides: [] }, schema } });
    assert.equal(fromSource.data.slides.hson(), fromNative.data.slides.hson());
    assert.strictEqual(fromSource.data.slides.schema.get(), schema);
    assert.strictEqual(fromNative.data.slides.schema.get(), schema);
    const kinds = hsonLiveMap.fromLibraries({ text: { json: "true" }, bool: { json: true }, parsed: { hson: "true" },
      exact: { json: Hson.data.parse(source), schema } });
    assert.equal(kinds.data.text.snap(), "true"); assert.equal(kinds.data.bool.snap(), true); assert.equal(kinds.data.parsed.snap(), true);
    // JavaScript cannot authenticate a primitive string's erased source brand.
    // Static callers receive a representation diagnostic; runtime remains literal.
    const erased = Reflect.apply(hsonLiveMap.fromLibraries, undefined, [{ literal: { json: Hson.data`<a 1>` } }]);
    assert.equal(erased.data.literal.snap(), Hson.data`<a 1>`);
    const nestedSource = hsonLiveMap.fromLibraries({ object: { json: { source } }, array: { json: [source] } });
    assert.equal(nestedSource.data.object.snap().source, source);
    assert.deepEqual(nestedSource.data.array.snap(), [source]);
    assert.equal(kinds.data.exact.hson(), fromSource.data.slides.hson());
    let reads = 0, schemaReads = 0;
    const captured = hsonLiveMap.fromLibraries({ slides: {
      get hson() { reads++; return reads === 1 ? source : '<slides "changed">'; },
      get schema() { schemaReads++; return schema; },
    } });
    assert.equal(reads, 1); assert.equal(schemaReads, 1); assert.equal(captured.data.slides.hson(), fromSource.data.slides.hson());
    const invalid = [{}, { data: {} }, { json: undefined }, { hson: undefined }, { hson: {} }, { hson: new String(source) },
      { json: true, hson: "true" }, { json: true, hson: undefined }, { json: undefined, hson: "true" },
      { json: Object.create(HsonDataValue.prototype) }, { json: { nested: Hson.data.parse(source) } },
      { hson: '<slides "invalid">', schema }, { json: { slides: "invalid" }, schema },
      { hson: '<@000000001 slides []>' }, { json: { $_meta: { quid: "000000001" } } }];
    const map = hsonLiveMap.fromLibraries({ state: { json: true } });
    const owner = internal_livemap_aggregate_authority(map), before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
    let publications = 0; map.commits.observe(() => publications++);
    for (const definition of invalid) {
      assert.throws(() => Reflect.apply(hsonLiveMap.fromLibraries, undefined, [{ bad: definition }]));
      assert.throws(() => Reflect.apply(map.addLibraries, map, [{ first: { json: 1 }, bad: definition }]));
      assert.throws(() => Reflect.apply(hsonLiveMap.locus.create, undefined, [{ bad: definition }]));
    }
    assert.deepEqual(owner.captureSemanticCheckpoint(), before); assert.equal(owner.identityEpoch().issued(), issued); assert.equal(publications, 0);
    const order = hsonLiveMap.fromLibraries({ source: { hson: "<'10' -0 '2' 2>" }, native: { json: { "10": -0, "2": 2 } } });
    assert.deepEqual(Hson.data.parse(order.data.source.hson()).entries()?.map(([name]) => name), ["10", "2"]);
    assert.deepEqual(Hson.data.parse(order.data.native.hson()).entries()?.map(([name]) => name), ["2", "10"]);
  });

  await check("Data Libraries and Schema receive literal values or explicit bilingual source admission", () => {
    for (const text of literals) {
      const data = Hson.data.from(text), map = hsonLiveMap.fromLibraries({ state: { json: text } });
      assert.equal(data.scalar(), text); assert.equal(admit_data_input(text).scalar(), text);
      assert.equal(ANY_DATA.certify(text).scalar(), text);
      assert.equal(map.data.must("state").snap(), text);
      assert.equal(map.data.must("state").hson(), data.toHson());
    }
    for (const [json, hson] of pairs) {
      const expected = Hson.data.fromSource(hson);
      for (const source of [json, hson]) {
        const data = Hson.data.fromSource(source), map = hsonLiveMap.fromLibraries({ state: { json: data } });
        assert.ok(data.equals(expected)); assert.strictEqual(admit_data_input(data), data);
        assert.strictEqual(Hson.data.from(data), data); assert.strictEqual(ANY_DATA.certify(data), data);
        assert.equal(map.data.must("state").hson(), expected.toHson());
        assert.deepEqual(map.data.must("state").snap(), expected.materialize());
      }
    }
    const exact = Hson.data.fromSource(orderedJson);
    assert.deepEqual(exact.entries()?.map(([name]) => name), ["10", "2", "tail"]);
    assert.ok(Object.is(exact.entries()?.[0]?.[1].scalar(), -0));
    const schema = Hson.schema`<type "data" content <count "number" label "string">>`;
    const identity = hson_schema_digest(schema), source = schema.toHson();
    for (const text of ['{"count":-0,"label":"42"}', '<count -0 label "42">']) {
      const data = Hson.data.fromSource(text), expected = Hson.data.parse`<count -0 label "42">`;
      assert.strictEqual(schema.certify(data), data);
      assert.ok(schema.certify(data).equals(expected));
      const map = hsonLiveMap.fromLibraries({ state: { json: data, schema } });
      assert.equal(map.data.must("state").hson(), expected.toHson());
      assert.throws(() => schema.certify(text), /Schema/);
    }
    assert.equal(hson_schema_digest(schema), identity); assert.equal(schema.toHson(), source);
    for (const text of ['{"count":"42","label":"x"}', '<count "42" label "x">']) {
      const data = Hson.data.fromSource(text);
      assert.throws(() => schema.certify(data), /Schema/);
      assert.throws(() => hsonLiveMap.fromLibraries({ state: { json: data, schema } }), /Schema/);
    }
  });

  await check("authentication precedes object capture; literal nesting and exact setters retain ownership", () => {
    const value = { text: '{"a":1}', nested: ["<a 1>", "42", "true", "null", -0] };
    const exact = Hson.data.from(value), owned = hson_data_value(exact);
    assert.strictEqual(admit_data_input(exact), exact); assert.strictEqual(hson_data_value(admit_data_input(exact)), owned);
    assert.ok(Object.isFrozen(exact));
    value.nested.push("later"); assert.notDeepEqual(exact.materialize(), value);
    assert.throws(() => admit_data_input(Object.create(HsonDataValue.prototype)), TypeError);
    assert.throws(() => admit_data_input({ nested: exact }), TypeError);
    assert.throws(() => Reflect.construct(HsonDataValue, [{}, {}]), TypeError);
    assert.equal("fromHson" in Hson.data, false); assert.equal("fromHson" in HsonDataValue, false);
    const source = Hson.canonical`42`, documentSource = Hson.document`<p/>`;
    assert.equal(Hson.data.from(source).scalar(), source); assert.equal(ANY_DATA.certify(documentSource).scalar(), documentSource);
    const capture = (strings: TemplateStringsArray, _value: unknown) => strings;
    for (const template of [capture`${0}`, capture`"${0}"`]) assert.throws(() => Reflect.apply(Hson.data, Hson, [template, exact]));
    const map = hsonLiveMap.fromLibraries({ state: { json: { text: "before", value: {}, items: [] } } });
    const state = map.data.must("state");
    state.at(["text"]).set(orderedJson); assert.equal(state.snap()?.text, orderedJson);
    const ordered = Hson.data.fromSource("<'10' -0 '2' <text \"42\">>");
    state.at(["value"]).replace(ordered); assert.equal(state.at(["value"]).hson(), ordered.toHson());
    state.at(["value"]).set(ordered); assert.equal(state.at(["value"]).hson(), ordered.toHson());
    const array = state.at(["items"]).asArray()!.array;
    array.push(ordered); assert.equal(state.at(["items", 0]).hson(), ordered.toHson());
    assert.ok(array.includes(ordered)); assert.equal(array.indexOf(ordered), 0);
    array.replace(0, Hson.data.from("42")); assert.equal(state.at(["items", 0]).snap(), "42");
    array.pushMany(Hson.data.fromSource('["true",-0]')); assert.ok(Object.is(state.at(["items", 2]).snap(), -0));
  });

  await check("Part writing encodes admitted values and composition recovers exact forwarding", () => {
    const map = hsonLiveMap.fromLibraries({ components: { parts: {
      value: { kind: "document", document: '<p hson:part data:d="%{incoming}" "^{d}"/>' },
      leaf: { kind: "document", document: '<p hson:part data:d="%{incoming}" "^{d.label}:^{d.count}"/>' },
      outer: { kind: "document", document: '<main hson:part data:d="%{incoming}" <hson-part at="leaf" incoming:data="^{d.child}"/>/>' },
      nested: { kind: "document", document: '<section hson:part <hson-part at="leaf" incoming:data="{\\"label\\":\\"literal\\",\\"count\\":-0}"/>/>' },
      list: { kind: "document", document: '<ul hson:part data:d="%{incoming}" <li per:key:value="^{d}" "^{key}:^{value}"/>/>' },
      document: { kind: "document", document: '<main hson:part doc:d="%{incoming}" <hson-part ^{d}/>/>' },
      optional: { kind: "document", document: '<p hson:part data:d="%{incoming?}" "^{d.label?}"/>' },
    } } });
    const owner = internal_livemap_aggregate_authority(map), before = owner.captureSemanticCheckpoint();
    for (const text of literals) {
      const invocation = map.parts.components.value.write({ incoming: text });
      const connector = parse_authored_document_library(invocation).root.$_content[0]; assert.ok(is_Node(connector));
      assert.equal(connector.$_attrs?.["incoming:data"], Hson.data.from(text).toHson());
      assert.equal(invocation, map.parts.components.value.write({ incoming: Hson.data.from(text) }));
      assert.deepEqual(owner.captureSemanticCheckpoint(), before);
    }
    for (const [index, text] of ['{"child":{"label":"json","count":-0}}', '<child <label "json" count -0>>'].entries()) {
      const incoming = Hson.data.fromSource(text), invocation = map.parts.components.outer.write({ incoming });
      const connector = parse_authored_document_library(invocation).root.$_content[0]; assert.ok(is_Node(connector));
      assert.equal(connector.$_attrs?.["incoming:data"], incoming.toHson());
      map.addLibraries({ ["page" + index]: { document: invocation } });
      assert.match(map.doc.must("page" + index).render(), /<main><p>json:0<\/p><\/main>/);
    }
    for (const [index, incoming] of literals.entries()) {
      map.addLibraries({ ["literal" + index]: { document: map.parts.components.value.write({ incoming }) } });
      const text = map.doc.must("literal" + index).root();
      assert.ok(JSON.stringify(text).includes(JSON.stringify(incoming).slice(1, -1)));
    }
    map.addLibraries({ nested: { document: map.parts.components.nested.write() }, optional: { document: map.parts.components.optional.write() } });
    assert.match(map.doc.must("nested").render(), /literal:0/); assert.match(map.doc.must("optional").render(), /<p><\/p>/);
    for (const [index, text] of ['{"10":-0,"2":"42"}', "<'10' -0 '2' \"42\">"].entries()) {
      map.addLibraries({ ["list" + index]: { document: map.parts.components.list.write({ incoming: Hson.data.fromSource(text) }) } });
      assert.match(map.doc.must("list" + index).render(), /<li>10:0<\/li><li>2:42<\/li>/);
    }
    const carrier = Hson.data.fromSource('<child <label "private" count -0>>'), expectedText = carrier.toHson();
    const publicSerializer = HsonDataValue.prototype.toHson;
    const publicFrom = HsonDataValue.from, publicSource = HsonDataValue.fromSource;
    try {
      HsonDataValue.prototype.toHson = () => { throw new Error("A public inspection method cannot control Data admission."); };
      HsonDataValue.from = HsonDataValue.fromSource = () => { throw new Error("A public factory cannot control private admission."); };
      const invocation = map.parts.components.outer.write({ incoming: carrier });
      const connector = parse_authored_document_library(invocation).root.$_content[0]; assert.ok(is_Node(connector));
      assert.equal(connector.$_attrs?.["incoming:data"], expectedText);
      assert.strictEqual(ANY_DATA.certify(carrier), carrier);
      map.addLibraries({ protectedValue: { json: carrier } });
      assert.equal(map.data.must("protectedValue").hson(), expectedText);
      assert.equal(encode_hson_data_internal(carrier), encode_hson_data_internal(Hson.data.fromSource(expectedText)));
    } finally { HsonDataValue.prototype.toHson = publicSerializer; HsonDataValue.from = publicFrom; HsonDataValue.fromSource = publicSource; }
    const failureCheckpoint = owner.captureSemanticCheckpoint(), failureLedger = owner.identityEpoch().issued();
    let publications = 0; map.commits.observe(() => { publications++; });
    for (const incoming of invalidValues) assert.throws(() => Reflect.apply(map.parts.components.outer.write, undefined, [{ incoming }]));
    const documentInvocation = map.parts.components.document.write({ incoming: '{"label":"json"}' });
    assert.throws(() => map.addLibraries({ rejected: { document: documentInvocation } }));
    assert.deepEqual(owner.captureSemanticCheckpoint(), failureCheckpoint); assert.equal(owner.identityEpoch().issued(), failureLedger); assert.equal(publications, 0);
    for (const configuration of ['{"attrs":{"title":"configured"}}', '<attrs <title "configured">>']) {
      assert.deepEqual(Reflect.apply(document_composition_options, undefined, [{ configuration }]).configuration.attrs, [["title", "configured"]]);
    }
  });

  await check("Data and explicit-source failures publish no Library, revision, QUID or observation", () => {
    const map = hsonLiveMap.fromLibraries({ state: { json: { value: 0 } } });
    const owner = internal_livemap_aggregate_authority(map), before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
    let publications = 0; map.commits.observe(() => { publications++; });
    for (const source of invalidSources) {
      assert.throws(() => map.addLibraries({ first: { json: 1 }, rejected: { json: Hson.data.fromSource(source) } }));
      assert.equal(map.data("first"), undefined); assert.equal(map.data("rejected"), undefined);
      assert.throws(() => ANY_DATA.certify(Hson.data.fromSource(source)));
    }
    for (const data of invalidValues) assert.throws(() => Reflect.apply(map.addLibraries, map, [{ first: { json: 1 }, rejected: { json: data } }]));
    assert.deepEqual(owner.captureSemanticCheckpoint(), before); assert.equal(owner.identityEpoch().issued(), issued);
    assert.equal(publications, 0); assert.equal(map.rev, 0);
  });

  await check("Locus payloads, validators, authorizers, decoder output and results use authenticated values", async () => {
    const received: HsonDataValue[] = [], validated: HsonDataValue[] = [];
    let resultValue: HsonDataInput = {}, decoderValue: HsonDataInput = {};
    const locus = hsonLiveMap.locus.create({ state: { json: { value: 0 } } }, {
      actions: { probe: (_context, payload) => { received.push(payload!); return resultValue; }, decoded: (_context, payload) => { received.push(payload!); } },
      schema: { actions: { decoded: { payload: input => {
        if (input !== undefined) { assert.ok(input instanceof HsonDataValue); validated.push(input); }
        return { ok: true, value: decoderValue };
      } } } },
    });
    let publications = 0; locus.commits.observe(() => { publications++; });
    const publicFrom = HsonDataValue.from;
    try {
      HsonDataValue.from = () => { throw new Error("A public factory cannot control action admission."); };
      for (const value of [...literals, Hson.data.fromSource(orderedJson), Hson.data.fromSource(orderedHson)]) {
        const expected = Hson.data.from(value); resultValue = value; decoderValue = value;
        const result = await locus.dispatchAction({ type: "action", id: "value", name: "probe", payload: value });
        assert.equal(result.type, "ack"); if (result.type !== "ack") throw new Error("Missing acknowledgment.");
        assert.ok(result.result?.equals(expected)); assert.ok(received.at(-1)?.equals(expected));
        assert.equal((await locus.dispatchAction({ type: "action", id: "decoder", name: "decoded", payload: expected })).type, "ack");
        assert.strictEqual(validated.at(-1), expected); assert.ok(received.at(-1)?.equals(expected));
        const decoded = decode_locus_action_payload(() => ({ ok: true, value }), undefined);
        assert.ok(decoded.ok); assert.ok(decoded.value?.equals(expected));
      }
      const count = received.length;
      for (const payload of invalidValues) {
        const result = await Reflect.apply(locus.dispatchAction, locus, [{ type: "action", id: "invalid", name: "probe", payload }]);
        assert.equal(result.type, "error"); assert.equal(result.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");
      }
      assert.equal(received.length, count); assert.equal(locus.rev, 0); assert.equal(publications, 0);
      assert.deepEqual(locus.data.must("state").snap(), { value: 0 });
    } finally { HsonDataValue.from = publicFrom; locus.dispose(); }
  });

  await check("Echo and Locus retain exact canonical wire bytes and strict decoding", () => {
    for (const value of [...literals, Hson.data.fromSource(orderedJson), Hson.data.fromSource(orderedHson)]) {
      const expected = Hson.data.from(value); assert.ok(admit_echo_action_payload(value).equals(expected));
      const message = { type: "action", id: "value", name: "probe", payload: value } as const;
      const locusWire = encode_locus_client_message(message);
      assert.equal(encodeEndpointMessage(message), locusWire);
      assert.equal(locusWire, JSON.stringify({ type: "action", id: "value", name: "probe", payloadData: encode_hson_data_internal(expected) }));
      const decoded = decode_locus_message(locusWire); assert.ok(decoded.ok);
      assert.ok(decoded.value.type === "action" && Hson.data.from(decoded.value.payload!).equals(expected));
      assert.ok(decode_hson_data_internal(JSON.parse(locusWire).payloadData).equals(expected));
      const ack = decodeEndpointMessage(JSON.stringify({ type: "ack", id: "result", ok: true, seq: 0, resultData: JSON.parse(locusWire).payloadData }));
      assert.ok(ack?.type === "ack" && ack.result?.equals(expected));
    }
    for (const source of [orderedHson, '{ "a": 1 }', '[1,]', '<p/>']) {
      assert.throws(() => decode_hson_data_internal(source));
      assert.equal(decode_locus_message(JSON.stringify({ type: "action", id: "source", name: "probe", payloadData: source })).ok, false);
      assert.equal(decodeEndpointMessage(JSON.stringify({ type: "ack", id: "result", ok: true, seq: 0, resultData: source })), undefined);
    }
    assert.throws(() => decode_projected_value_payload(orderedHson)); assert.throws(() => decode_projected_value_payload('[1,]'));
    assert.doesNotThrow(() => decode_projected_value_payload('{ "a": 1 }'));
    assert.throws(() => Reflect.apply(ANY_DOCUMENT.certify, ANY_DOCUMENT, [orderedJson]));
    assert.equal(ANY_DOCUMENT.certify(Hson.document`<main/>`), Hson.document`<main/>`);
    assert.doesNotThrow(() => hsonTransform.fromJson('{"_hson_root":{"a":1}}'));
  });

  await check("Interaction descriptor values retain literals, explicit admission, ownership and atomicity", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } }); enable_interactions(map);
    const owner = internal_livemap_aggregate_authority(map);
    const base = { subject: { library: "page", path: [0, 0] }, key: "probe", listener: {
      event: "click", target: "element", capture: false, once: false, passive: false, missingTarget: "throw",
      preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
    } } as const;
    const values = [...literals, Hson.data.fromSource(orderedJson), Hson.data.fromSource(orderedHson)];
    for (const [index, args] of values.entries()) add_interaction(map, { ...base, id: "browser" + index, kind: "browser", args });
    const typed = { text: orderedJson, nested: ["<a 1>"] }; add_interaction(map, { ...base, id: "typed", kind: "locus", payload: typed }); typed.nested.push("later");
    const captured = map.capture().libraries.find(entry => entry.name === "@hson/canonical-interactions"); assert.ok(captured);
    const value = materialize_projected_value(projected_value_from_hson_node(decode_hosted_root(captured.root)));
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value)); assert.ok(Array.isArray(value.descriptors));
    assert.equal(value.descriptors.length, values.length + 1);
    for (const [index, descriptor] of value.descriptors.entries()) {
      assert.ok(descriptor !== null && typeof descriptor === "object" && !Array.isArray(descriptor));
      assert.deepEqual(descriptor[descriptor.kind === "browser" ? "args" : "payload"], index < values.length
        ? Hson.data.from(values[index]!).materialize() : { text: orderedJson, nested: ["<a 1>"] });
    }
    const before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
    for (const args of invalidValues) assert.throws(() => Reflect.apply(add_interaction, undefined, [map, { ...base, id: "invalid", kind: "browser", args }]));
    assert.deepEqual(owner.captureSemanticCheckpoint(), before); assert.equal(owner.identityEpoch().issued(), issued);
  });
}

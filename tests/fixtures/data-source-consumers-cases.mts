import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, hsonTransform } from "../../src/index.js";
import { ExactDataCarrier, admit_data_input, decode_hson_data_internal, hson_data_value } from "../../src/api/data/hson-data.js";
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
import type { HsonData } from "../../src/api/transform/transform.types.js";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
const certify = (value: unknown): HsonData => Reflect.apply(ANY_DATA.certify, ANY_DATA, [value]);
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

export async function data_source_consumer_cases(check: Check): Promise<void> {
  await check("Data Libraries, shared input and Schema certify both source notations exactly", () => {
    for (const [json, hson] of pairs) {
      const expected = Reflect.apply(Hson.data.fromHson, Hson.data, [hson]);
      for (const source of [json, hson]) {
        const map = hsonLiveMap.fromLibraries({ state: { data: source } });
        assert.equal(map.data.must("state").at([]).hson(), expected);
        assert.equal(admit_data_input(source).toHson(), expected);
        assert.equal(certify(source), expected);
        assert.deepEqual(map.data.must("state").snap(), Hson.data.materialize(expected));
      }
    }
    const exact = admit_data_input(orderedJson);
    assert.deepEqual(exact.entries()?.map(([name]) => name), ["10", "2", "tail"]);
    assert.ok(Object.is(exact.entries()?.[0]?.[1].scalar(), -0));
    const schema = Hson.schema`<type "data" content <count "number" label "string">>`;
    const identity = hson_schema_digest(schema), source = schema.toHson();
    for (const data of ['{"count":-0,"label":"42"}', '<count -0 label "42">']) {
      assert.equal(Reflect.apply(schema.certify, schema, [data]), Hson.data`<count -0 label "42">`);
      const map = hsonLiveMap.fromLibraries({ state: { data, schema } });
      assert.equal(map.data.must("state").at([]).hson(), Hson.data`<count -0 label "42">`);
    }
    assert.equal(hson_schema_digest(schema), identity); assert.equal(schema.toHson(), source);
    for (const data of ['{"count":"42","label":"x"}', '<count "42" label "x">']) {
      assert.throws(() => Reflect.apply(schema.certify, schema, [data]), /Schema/);
      assert.throws(() => hsonLiveMap.fromLibraries({ state: { data, schema } }), /Schema/);
    }
  });

  await check("source strings remain distinct from literal values and authentic exact carriers", () => {
    const value = { text: '{"a":1}', nested: ["<a 1>", "42", "true", "null", -0] };
    const exact = admit_data_input(value), owned = hson_data_value(exact);
    assert.equal(admit_data_input(exact), exact); assert.equal(hson_data_value(admit_data_input(exact)), owned);
    assert.ok(Object.isFrozen(exact));
    value.nested.push("later"); assert.notDeepEqual(exact.materialize(), value);
    const literal = ExactDataCarrier.from(orderedJson);
    assert.equal(admit_data_input(literal), literal); assert.equal(literal.scalar(), orderedJson);
    assert.equal(Hson.data.materialize(Hson.data.from(orderedJson)), orderedJson);
    assert.equal(admit_data_input("42").scalar(), 42);
    assert.equal(ExactDataCarrier.from("42").scalar(), "42");
    assert.throws(() => admit_data_input(Object.create(ExactDataCarrier.prototype)), TypeError);
    const map = hsonLiveMap.fromLibraries({ state: { data: { text: "before" } } });
    map.data.must("state").at(["text"]).set(orderedJson);
    assert.deepEqual(map.data.must("state").snap(), { text: orderedJson });
    for (const source of ["<broken", "ordinary unquoted string", ...invalidSources]) {
      assert.throws(() => admit_data_input(source), error => error instanceof TypeError && error.cause instanceof Error);
    }
  });

  await check("Parts preserve authored transport and compose JSON/Hson through nested forwarding", () => {
    const map = hsonLiveMap.fromLibraries({ components: { parts: {
      leaf: { kind: "document", document: '<p hson:part data:d="%{incoming}" "^{d.label}:^{d.count}"/>' },
      outer: { kind: "document", document: '<main hson:part data:d="%{incoming}" <hson-part at="leaf" incoming:data="^{d.child}"/>/>' },
      nested: { kind: "document", document: '<section hson:part <hson-part at="leaf" incoming:data="{\\"label\\":\\"literal\\",\\"count\\":-0}"/>/>' },
      list: { kind: "document", document: '<ul hson:part data:d="%{incoming}" <li per:key:value="^{d}" "^{key}:^{value}"/>/>' },
      document: { kind: "document", document: '<main hson:part doc:d="%{incoming}" <hson-part ^{d}/>/>' },
      optional: { kind: "document", document: '<p hson:part data:d="%{incoming?}" "^{d.label?}"/>' },
    } } });
    const owner = internal_livemap_aggregate_authority(map), before = owner.captureSemanticCheckpoint();
    const sources = ['{"child":{"label":"json","count":-0}}', '<child <label "json" count -0>>'];
    const invocations = sources.map(incoming => map.parts.components.outer.write({ incoming }));
    for (const [index, invocation] of invocations.entries()) {
      const connector = parse_authored_document_library(invocation).root.$_content[0];
      assert.ok(is_Node(connector));
      assert.equal(connector.$_attrs?.["incoming:data"], sources[index]);
    }
    assert.deepEqual(owner.captureSemanticCheckpoint(), before);
    for (const [index, document] of invocations.entries()) {
      map.addLibraries({ ["page" + index]: { document } });
      assert.match(map.doc.must("page" + index).render(), /<main><p>json:0<\/p><\/main>/);
    }
    map.addLibraries({ nested: { document: map.parts.components.nested.write() }, optional: { document: map.parts.components.optional.write() } });
    assert.match(map.doc.must("nested").render(), /literal:0/);
    assert.match(map.doc.must("optional").render(), /<p><\/p>/);
    for (const [index, incoming] of ['{"10":-0,"2":"42"}', "<'10' -0 '2' \"42\">"].entries()) {
      map.addLibraries({ ["list" + index]: { document: map.parts.components.list.write({ incoming }) } });
      assert.match(map.doc.must("list" + index).render(), /<li>10:0<\/li><li>2:42<\/li>/);
    }
    const failureCheckpoint = owner.captureSemanticCheckpoint(), failureLedger = owner.identityEpoch().issued();
    let publications = 0; map.commits.observe(() => { publications++; });
    for (const source of invalidSources) {
      const invocation = map.parts.components.outer.write({ incoming: source });
      assert.throws(() => map.addLibraries({ rejected: { document: invocation } }));
      assert.equal(map.doc("rejected"), undefined);
    }
    const documentInvocation = map.parts.components.document.write({ incoming: '{"label":"json"}' });
    assert.throws(() => map.addLibraries({ rejected: { document: documentInvocation } }));
    assert.deepEqual(owner.captureSemanticCheckpoint(), failureCheckpoint);
    assert.equal(owner.identityEpoch().issued(), failureLedger); assert.equal(publications, 0);
    for (const configuration of ['{"attrs":{"title":"configured"}}', '<attrs <title "configured">>']) {
      assert.deepEqual(Reflect.apply(document_composition_options, undefined, [{ configuration }]).configuration.attrs, [["title", "configured"]]);
    }
  });

  await check("Data failures publish no Library, revision, QUID or observation", () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
    const owner = internal_livemap_aggregate_authority(map), before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
    let publications = 0; map.commits.observe(() => { publications++; });
    for (const source of invalidSources) {
      assert.throws(() => map.addLibraries({ first: { data: "<a 1>" }, rejected: { data: source } }));
      assert.equal(map.data("first"), undefined); assert.equal(map.data("rejected"), undefined);
      assert.throws(() => certify(source));
    }
    assert.deepEqual(owner.captureSemanticCheckpoint(), before);
    assert.equal(owner.identityEpoch().issued(), issued); assert.equal(publications, 0); assert.equal(map.rev, 0);
  });

  await check("Locus payloads, decoder output and results converge while invalid admission is atomic", async () => {
    const received: unknown[] = [];
    let resultSource = "{}", decoderSource = "{}";
    const locus = hsonLiveMap.locus.create({ state: { data: { value: 0 } } }, {
      actions: { probe: (_context, payload) => { received.push(payload); return resultSource; }, decoded: (_context, payload) => { received.push(payload); } },
      schema: { actions: { decoded: { payload: () => ({ ok: true, value: decoderSource }) } } },
    });
    let publications = 0; locus.commits.observe(() => { publications++; });
    try {
      for (const source of [orderedJson, orderedHson]) {
        resultSource = source; decoderSource = source;
        const result = await Reflect.apply(locus.dispatchAction, locus, [{ type: "action", id: "source", name: "probe", payload: source }]);
        assert.equal(result.type, "ack"); assert.equal(result.result, certify(source));
        assert.equal(received.at(-1), certify(source));
        assert.equal((await locus.dispatchAction({ type: "action", id: "decoder", name: "decoded" })).type, "ack");
        assert.equal(received.at(-1), certify(source));
        const decoded = decode_locus_action_payload(() => ({ ok: true, value: source }), undefined);
        assert.ok(decoded.ok); assert.equal(decoded.value?.toHson(), certify(source));
      }
      const count = received.length;
      for (const payload of invalidSources) {
        const result = await Reflect.apply(locus.dispatchAction, locus, [{ type: "action", id: "invalid", name: "probe", payload }]);
        assert.equal(result.type, "error"); assert.equal(result.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");
      }
      assert.equal(received.length, count); assert.equal(locus.rev, 0); assert.equal(publications, 0);
      assert.deepEqual(locus.data.must("state").snap(), { value: 0 });
    } finally { locus.dispose(); }
  });

  await check("Echo authoring and Locus encoders converge without widening fixed-format decoders", () => {
    for (const source of [orderedJson, orderedHson]) {
      assert.equal(admit_echo_action_payload(source), certify(source));
      const message = { type: "action", id: "source", name: "probe", payload: source };
      const locusWire = Reflect.apply(encode_locus_client_message, undefined, [message]);
      assert.equal(Reflect.apply(encodeEndpointMessage, undefined, [message]), locusWire);
      const decoded = decode_locus_message(locusWire); assert.ok(decoded.ok);
      assert.equal(decode_hson_data_internal(JSON.parse(locusWire).payloadData).toHson(), certify(source));
      assert.equal(decodeEndpointMessage(JSON.stringify({ type: "ack", id: "result", ok: true, seq: 0, resultData: JSON.parse(locusWire).payloadData }))?.type, "ack");
    }
    for (const source of [orderedHson, '{ "a": 1 }', '[1,]', '<p/>']) {
      assert.throws(() => decode_hson_data_internal(source));
      const wire = JSON.stringify({ type: "action", id: "source", name: "probe", payloadData: source });
      assert.equal(decode_locus_message(wire).ok, false);
      assert.equal(decodeEndpointMessage(JSON.stringify({ type: "ack", id: "result", ok: true, seq: 0, resultData: source })), undefined);
    }
    assert.throws(() => decode_projected_value_payload(orderedHson));
    assert.throws(() => decode_projected_value_payload('[1,]'));
    assert.doesNotThrow(() => decode_projected_value_payload('{ "a": 1 }'));
    assert.throws(() => Reflect.apply(Hson.data.fromHson, Hson.data, [orderedJson]));
    assert.throws(() => Reflect.apply(ANY_DOCUMENT.certify, ANY_DOCUMENT, [orderedJson]));
    assert.equal(ANY_DOCUMENT.certify(Hson.document`<main/>`), Hson.document`<main/>`);
    assert.doesNotThrow(() => hsonTransform.fromJson('{"_hson_root":{"a":1}}'));
  });

  await check("Interaction args and payload use the shared Data boundary with detached literal properties", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
    enable_interactions(map);
    const owner = internal_livemap_aggregate_authority(map);
    const base = { subject: { library: "page", path: [0, 0] }, key: "probe", listener: {
      event: "click", target: "element", capture: false, once: false, passive: false, missingTarget: "throw",
      preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
    } };
    for (const [index, source] of [orderedJson, orderedHson].entries()) for (const kind of ["browser", "locus"]) {
      const field = kind === "browser" ? "args" : "payload";
      Reflect.apply(add_interaction, undefined, [map, { ...base, id: kind + index, kind, [field]: source }]);
    }
    const typed = { text: orderedJson, nested: ["<a 1>"] };
    Reflect.apply(add_interaction, undefined, [map, { ...base, id: "typed", kind: "browser", args: typed }]);
    typed.nested.push("later");
    // Read installed application data rather than reparsing its authored transport.
    const captured = map.capture().libraries.find(entry => entry.name === "@hson/canonical-interactions");
    assert.ok(captured);
    const root = decode_hosted_root(captured.root);
    const value = materialize_projected_value(projected_value_from_hson_node(root));
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    assert.ok(Array.isArray(value.descriptors)); assert.equal(value.descriptors.length, 5);
    for (const descriptor of value.descriptors.slice(0, 4)) {
      assert.ok(descriptor !== null && typeof descriptor === "object" && !Array.isArray(descriptor));
      assert.deepEqual(descriptor[descriptor.kind === "browser" ? "args" : "payload"], admit_data_input(orderedJson).materialize());
    }
    const literal = value.descriptors[4];
    assert.ok(literal !== null && typeof literal === "object" && !Array.isArray(literal));
    assert.deepEqual(literal.args, { text: orderedJson, nested: ["<a 1>"] });
    const before = owner.captureSemanticCheckpoint(), issued = owner.identityEpoch().issued();
    for (const args of invalidSources) assert.throws(() => Reflect.apply(add_interaction, undefined, [map, { ...base, id: "invalid", kind: "browser", args }]));
    assert.deepEqual(owner.captureSemanticCheckpoint(), before); assert.equal(owner.identityEpoch().issued(), issued);
  });
}

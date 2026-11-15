import assert from "node:assert/strict";
import { Hson, add_interaction, hsonLiveMap, hsonTransform, replace_interaction, type LiveMap, type LiveMapDocumentPart } from "../../src/index.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { make_livemap_mirror_from_semantic_checkpoint_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { resolve_document_path, validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../src/internal/interaction-storage.ts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { hson_data_from_value, hson_data_value } from "../../src/api/data/hson-data.ts";
import { projected_value_from_hson_node, projected_value_to_hson_root } from "../../src/core/projected-value-graph.ts";
import { is_ordered_projected_object, ordered_projected_array, ordered_projected_object, type OrderedProjectedValue } from "../../src/core/ordered-projected-value.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { read_transform_error_details } from "../../src/core/errors.ts";
import { deferred, MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { durable_aggregate_commit, write_semantic_checkpoint, type LocusHostedAggregatePersistedCommit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { encode_checkpoint_chunks } from "../../src/api/locus/locus.checkpoint-chunks.ts";
import { hson_schema_digest } from "../../src/api/schema/hson-schema.ts";
import { interaction_schema_internal } from "../../src/api/interactions/interactions.projection.ts";
import { interaction_descriptors_from_root } from "../../src/internal/interaction-partitions.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { decode_livemap_replay_payload, encode_livemap_replay_transport } from "../../src/api/livemap/livemap.transport.ts";
import { admit_authority_projection_snapshot, capture_selected_authority_projection_snapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { decode_locus_live_projected_envelope_internal, LOCUS_LIVE_PROJECTED_WIRE_FORMAT, project_locus_live_transition_internal } from "../../src/api/locus/locus.live-projection.ts";
import { create_echo_scoped_replica_internal } from "../../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { local_initializers } from "../helpers/client-projection.mts";
import { decode_hosted_root, encode_hosted_root, registry_from_entries, type HostedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { plan_browser_realization } from "../../src/internal/browser-realization/browser-realization-plan.ts";
import { assertCanonicalClosure, assertCanonicalSerializedClosure, TransformOracleAssertionError } from "../../src/diagnostics/transform-test-oracle.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LocusProjectionAuthorizer } from "../../src/types/locus.types.ts";
import { parse_authored_event } from "../../src/internal/authored-events.ts";

const advance = "<hson:event once stopProp document capture passive preventDefault stopImmediateProp on:click host:ADVANCE_SLIDE step:num=\"3\" <> >";
const literal = { kind: "document", document: Hson.document`<button hson:part event:advance id="literal" "Next"/>`,
  events: { advance } } satisfies LiveMapDocumentPart;
const typed = { kind: "document", document: Hson.document`<section hson:part data:args=%{args}
  <button event:advance class="one"/> <button event:advance class="two"/>/>`,
  events: { advance: "<hson:event on:click local:OPEN_PANEL panel:data=^{args} <> >" } } satisfies LiveMapDocumentPart;
const incoming = { kind: "document", document: Hson.document`<button hson:part event:advance id="incoming"/>`,
  events: { advance: "<hson:event on:click local:OPEN_PANEL title:str=%{text} <> >" } } satisfies LiveMapDocumentPart;
const withoutInput = { ...literal, events: { advance: "<hson:event window capture preventDefault on:click local:RESET_PANEL <> >" } };
const collection = { parts: { literal, typed, incoming, withoutInput } };
const invocation = '<hson-part lib="parts" at="literal"/>';
const connector = (source: string) => {
  const node = hsonTransform.fromHson(source).toNode().$_content[0];
  assert.ok(is_Node(node));
  return node;
};
const parent = { kind: "path", path: validate_document_path([0, 0, 1, 0, 0, 0]) } as const;
const authority = internal_livemap_aggregate_authority;

function descriptor_data(root: HsonNode) {
  const value = hson_data_from_value(projected_value_from_hson_node(root));
  const entries = value.entries()?.find(([key]) => key === "descriptors")?.[1].items();
  assert.ok(entries);
  return entries;
}

function descriptors(map: LiveMap, library = "page") {
  const system = authority(map).systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  assert.ok(system);
  return descriptor_data(authority(map).systemRoot(system)).flatMap(entry => {
    const fields = new Map(entry.entries());
    const subject = new Map(fields.get("subject")?.entries());
    if (subject.get("library")?.scalar() !== library) return [];
    const path = validate_document_path(subject.get("path")?.materialize());
    const node = resolve_document_path(map.doc.must(library).root(), "document", path);
    assert.ok(is_Node(node) && node.$_tag === "button");
    assert.equal(Object.hasOwn(node.$_attrs ?? {}, "event:advance"), false);
    return [{ id: fields.get("id")?.scalar(), path: [...path], attrs: node.$_attrs,
      listener: fields.get("listener")?.materialize(), kind: fields.get("kind")?.scalar(),
      key: fields.get("key")?.scalar(), data: fields.get("payload") ?? fields.get("args") }];
  });
}

function grammar_cases() {
  const admit = (source: string, document: string = literal.document) =>
    hsonLiveMap.fromLibraries({ parts: { parts: { literal: { ...literal, document, events: { advance: source } } } },
      page: { document: invocation } });
  const literalDescriptor = descriptors(admit(advance))[0]!;
  assert.equal(literalDescriptor.kind, "locus");
  assert.equal(literalDescriptor.key, "ADVANCE_SLIDE");
  assert.equal(literalDescriptor.attrs?.id, "literal");
  assert.ok(typeof literalDescriptor.listener === "object" && literalDescriptor.listener !== null);
  assert.deepEqual({ ...literalDescriptor.listener }, {
    event: "click", target: "document", capture: true, once: true, passive: true, missingTarget: "ignore",
    preventDefault: true, stopPropagation: true, stopImmediatePropagation: true,
  });
  assert.ok(literalDescriptor.data?.equals(Hson.data.from({ step: 3 })));
  const flagSource = (flags: string) => `<hson:event on:click local:run ${flags} <> >`;
  const defaults = parse_authored_event(flagSource("")).listener;
  assert.deepEqual(defaults, { event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false });
  for (const [flag, field, value] of [
    ["once", "once", true], ["capture", "capture", true], ["passive", "passive", true],
    ["preventDefault", "preventDefault", true], ["stopProp", "stopPropagation", true],
    ["stopImmediateProp", "stopImmediatePropagation", true], ["document", "target", "document"], ["window", "target", "window"],
  ] as const) {
    assert.deepEqual(parse_authored_event(flagSource(flag)).listener, { ...defaults, [field]: value });
    assert.throws(() => parse_authored_event(flagSource(`${flag} ${flag}`)), /Duplicate authored event header/);
    assert.throws(() => parse_authored_event(flagSource(`${flag}="true"`)), /Invalid Event argument/);
  }
  for (const [first, second] of [["document", "window"], ["window", "document"]]) {
    const conflict = flagSource(`${first} ${second}`);
    assert.throws(() => parse_authored_event(conflict), cause => {
      const details = read_transform_error_details(cause);
      return cause instanceof Error && /Ambiguous listener target/.test(cause.message)
        && details?.source?.index === conflict.indexOf(second!)
        && details.related?.[0]?.source.index === conflict.indexOf(first!);
    });
  }
  const literalArgs = 'input:data={<step 3>} x:num="-0" title:str="Example" extra:data={null}';
  const named = descriptors(admit(advance.replace('step:num="3"', literalArgs)))[0]?.data;
  assert.ok(named);
  assert.ok(named.equals(Hson.data.fromSource('{"input":{"step":3},"x":-0,"title":"Example","extra":null}')));
  assert.deepEqual(named.entries()?.map(([name]) => name), ["input", "x", "title", "extra"]);
  assert.ok(Object.is(named.entries()?.[1]?.[1].scalar(), -0));
  const escaped = String.raw`label:str="Example \u005e{literal}"`;
  assert.ok(descriptors(admit(advance.replace('step:num="3"', escaped)))[0]?.data
    ?.equals(Hson.data.from({ label: "Example ^{literal}" })));
  for (const [destination, inputField] of [["host", "payload"], ["local", "args"]]) {
    const omission = advance.replace("host:", `${destination}:`).replace(' step:num="3"', "");
    const map = admit(omission);
    assert.equal(descriptors(map)[0]?.data, undefined);
    const aggregate = authority(map);
    const root = aggregate.systemRoot(aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!);
    assert.equal(new Map(descriptor_data(root)[0]?.entries()).has(inputField), false);
    assert.throws(() => admit(omission.replace("<> ", "")), /requires an outcome object/);
  }

  for (const [source, diagnostic] of [
    [advance.replace('step:num="3"', 'step:num="3" step:str="three"'), /Duplicate Event argument "step"/],
    [advance.replace('step:num="3"', 'step:doc={<i/>}'), /Invalid Event argument/],
    [advance.replace('step:num="3"', 'step=3'), /Invalid Event argument/],
    [advance.replace('step:num="3"', 'step:num=3'), /double-quoted literal/],
    [advance.replace('step:num="3"', 'step:num="03"'), /quoted finite JSON number/],
    [advance.replace('step:num="3"', 'step:num="1e999"'), /quoted finite JSON number/],
    [advance.replace('step:num="3"', 'step:num="%{n}0"'), /numeric interpolation is unsupported/],
    [advance.replace('step:num="3"', 'step:num'), /Expected a value/],
    [advance.replace("once", "unknownOption"), /Unsupported authored event header/],
    [advance.replace("once", 'once="once"'), /Invalid Event argument/],
    [advance.replace("once", "once once"), /Duplicate authored event header/],
    [advance.replace("on:click", "on:click on:click"), /Duplicate authored event header/],
    [advance.replace("on:click", "on:click on:keydown"), /exactly one on:/],
    [advance.replace("host:ADVANCE_SLIDE", "host:ADVANCE_SLIDE local:OPEN_PANEL"), /exactly one host:/],
    [advance.replace("<> ", ""), /requires an outcome object/],
    [advance.replace("<>", "<> <>"), /single authored event outcome object/],
    [advance.replace("<>", "<success local:SHOW_SAVED>"), /Nonempty authored event outcomes.*Use <>/],
    [advance.replace('step:num="3"', 'step:data="<step 3>"'), /one whole Part reference/],
    [advance.replace('step:num="3"', "step:data={1 2}"), /one Hson Data value/],
    [advance.replace('step:num="3"', "step:data={<button/>}"), /element-mode value/],
    [advance.replace('step:num="3"', "step:data={<@000008398 step 3>}"), /runtime QUID/],
    [advance.replace("hson:event", "'hson:event'"), /literal <hson:event/],
    [advance + advance, /exactly one authored event declaration/],
    [advance.replace('step:num="3"', "step:num=^{undeclared}"), /Missing Part local declaration/],
    [advance.replace('step:num="3"', "step:data=%{args.field}"), /Structured Part inputs/],
  ] as const) assert.throws(() => admit(source), diagnostic);

  const conflict = advance.replace("host:ADVANCE_SLIDE", "host:ADVANCE_SLIDE local:OPEN_PANEL");
  assert.throws(() => admit(conflict), error => {
    const details = error instanceof Error ? read_transform_error_details(error.cause) : undefined;
    return details?.source?.index === conflict.indexOf("local:") && details.related?.[0]?.source.index === conflict.indexOf("host:");
  });
  const missing = advance.replace('step:num="3"', "step:num=^{undeclared}");
  assert.throws(() => admit(missing), error => read_transform_error_details(error)?.source?.index === missing.indexOf("^{undeclared}"));
  assert.throws(() => admit(advance, "<button hson:part event:unknown/>"), /Missing Part event declaration/);
  assert.throws(() => hsonLiveMap.fromLibraries({ parts: { parts: { missing: {
    kind: "document", document: literal.document,
  } } } }), /requires a governed Part's events collection/);
  const phase = Hson.document`<button event:phase="ready"/>`;
  assert.equal(phase, '<button event:phase="ready"/>');
  assert.match(hsonLiveMap.fromLibraries({ page: { document: phase } }).doc.page.render(), /event:phase="ready"/);
  const valued = '<button event:advance="event:advance"/>';
  assert.equal(Hson.canonical`<button event:advance="event:advance"/>`, valued);
  assert.equal(hsonTransform.fromHson(valued).toHson().serialize(), valued);
  const normalized = Hson.document`<button event:advance="event:advance"/>`;
  assert.equal(normalized, valued);
  assert.equal(Hson.document`<button event:advance="${"event:advance"}"/>`, valued);
  const inert = admit(advance, Hson.document`<main hson:part ${normalized}/>`);
  assert.deepEqual(descriptors(inert), []);
  assert.match(inert.doc.page.render(), /event:advance="event:advance"/);
  const mixed = admit(advance, Hson.document`<button hson:part event:phase="ready" event:advance/>`);
  assert.equal(descriptors(mixed)[0]?.attrs?.["event:phase"], "ready");
  const bare = Hson.document`<button event:advance/>`;
  assert.equal(bare, "<button event:advance/>");
  assert.equal(Hson.canonical`${bare}`, bare);
  assert.equal(Hson.document.fromHson(Hson.canonical`${bare}`), bare);
  const source = hsonTransform.fromHson(bare), observed = source.toNode(), button = observed.$_content[0];
  assert.ok(is_Node(button) && button.$_attrs);
  assert.equal(hsonTransform.fromNode(observed).toHson().serialize(), valued);
  delete button.$_attrs["event:advance"];
  button.$_attrs["event:advance"] = "ready";
  assert.equal(hsonTransform.fromNode(observed).toHson().serialize(), '<button event:advance="ready"/>');
  button.$_attrs["event:advance"] = "event:advance";
  const serialized = hsonTransform.fromNode(observed).toHson().serialize();
  assert.equal(serialized, valued);
  assert.equal(Hson.document.fromNode(observed), valued);
  assert.equal(source.toHson().serialize(), bare);
  assert.equal(hsonTransform.fromNode(hsonTransform.fromHson("<button disabled/>").toNode()).toHson().serialize(), "<button disabled/>");
  const readmitted = admit(advance, Hson.document`<main hson:part ${serialized}/>`);
  assert.deepEqual(descriptors(readmitted), []);
  assert.match(readmitted.doc.page.render(), /event:advance="event:advance"/);
  assert.equal(descriptors(admit(advance, Hson.document`<main hson:part ${bare}/>`)).length, 1);

  const oracle = { launcher: "authored-event-cases", caseId: "public graph provenance" };
  const authored = "<button disabled event:advance/>";
  const closure = assertCanonicalClosure({ ...oracle, ingress: "hson-source", source: authored, cycles: 3 });
  const controls = Hson.document`<main hson:part ${Hson.document`<section ${closure.serialized}/>`}/>`;
  assert.equal(descriptors(admit(advance, controls)).length, 1);
  const serialize = (node: HsonNode) => assertCanonicalClosure({ ...oracle, ingress: "canonical-node", node }).serialized;
  const assertInert = (fragment: string, route: string) => {
    const candidate = admit(advance, Hson.document`<main hson:part ${Hson.document`<section ${fragment}/>`}/>`);
    assert.equal(descriptors(candidate).length, 0, route);
    assert.match(candidate.doc.page.render(), /event:advance="event:advance"/, route);
  };
  const reparsedButton = closure.reparsed.$_content[0];
  assert.ok(is_Node(reparsedButton) && reparsedButton.$_attrs);
  delete reparsedButton.$_attrs["event:advance"];
  reparsedButton.$_attrs["event:advance"] = "event:advance";
  assertInert(serialize(closure.reparsed), "oracle delete and reassign");
  assertInert(serialize(closure.semantic), "oracle semantic observation");
  assertInert(serialize({ ...closure.semantic }), "shallow oracle copy");
  assertInert(serialize(structuredClone(closure.semantic)), "deep oracle copy");

  const serializedClosure = assertCanonicalSerializedClosure({ ...oracle, node: closure.semantic, serialized: closure.serialized });
  const donor = serializedClosure.$_content[0], receiver = hsonTransform.fromHson("<button/>").toNode();
  assert.ok(is_Node(donor) && donor.$_attrs && is_Node(receiver.$_content[0]));
  receiver.$_content[0].$_attrs = donor.$_attrs;
  const transplanted = serialize(receiver);
  assertInert(transplanted, "oracle attribute record transplant");
  assert.match(transplanted, / disabled\/>$/);
  assert.throws(() => assertCanonicalClosure({ ...oracle, ingress: "hson-source", source: authored, compareFluent: false,
    expectedNode: { ...closure.semantic, $_content: ["unexpected text"] } }), error => {
    assert.ok(error instanceof TransformOracleAssertionError);
    const witness = error.witness.firstCanonicalDifference?.right;
    assert.ok(is_Node(witness));
    assertInert(serialize({ ...closure.semantic, $_content: [witness] }), "oracle failure witness");
    return true;
  });
  const document = Hson.document.fromHson(Hson.canonical`${bare}`);
  assertInert(Hson.document.fromNode(Hson.document.toNode(document)), "Document graph observation");
  assertInert(hsonTransform.fromBinary(source.toBinary().serialize()).toHson().serialize(), "Binary transport");
  assertInert(hsonTransform.fromTrustedHtml(source.toHtml().serialize()).toHson().serialize(), "HTML transport");

  assert.throws(() => admit(advance, "<button hson:part event:unknown/>"), error =>
    read_transform_error_details(error)?.source?.index === "<button hson:part ".length);
  const qualified = descriptors(admit(advance.replace("ADVANCE_SLIDE", "deck.advance")));
  assert.equal(qualified[0]?.key, "deck.advance");
  assert.throws(() => admit(advance.replace("host:ADVANCE_SLIDE", "host:")), /Expected an action name/);
  assert.throws(() => admit(advance.replace("host:", "remote:")), /Unsupported authored event header/);
  assert.throws(() => hsonLiveMap.locus.create({}, { actions: { "document.attrs.set": () => {} } }), /reserved for a built-in/);
  assert.throws(() => admit(advance, '<div hson:part <hson-part event:advance at="literal"/>/>'), /ordinary Part element/);
  assert.throws(() => hsonLiveMap.fromLibraries({ parts: collection, page: { document: "<button event:advance/>" } }), /governed Part/);
  assert.throws(() => hsonTransform.fromHson("<hson:event/>").toNode(), /reserved/);
  assert.throws(() => plan_browser_realization(parse_authored_document_library(bare).root), /must be composed/);
  assert.throws(() => hsonTransform.fromHson("<button input:data={<step 3>}/>").toNode());
  assert.deepEqual(Hson.data.fromSource("<hson:event 1>").materialize(), { "hson:event": 1 });
  const ordinary = hsonLiveMap.create();
  ordinary.addLibraries({ data: { json: { "hson:event": 1, "event:advance": null } } });
  const snapshot = ordinary.data.must("data").snap();
  assert.ok(typeof snapshot === "object" && snapshot !== null);
  assert.deepEqual({ ...snapshot }, { "hson:event": 1, "event:advance": null });
}

function event_reference_ranges() {
  const document = '<button hson:part data:args=%{args} event:advance/>';
  const expression = "^{args.missing}";
  const declaration = `<hson:event on:click local:OPEN_PANEL
  item:data=${expression} <> >`;
  const use = (data: string) => `<hson-part lib="parts" at="path" args:data="${data}"/>`;
  const compose = (source: string, second: string) => hsonLiveMap.fromLibraries({
    parts: { parts: { path: { kind: "document", document, events: { advance: source } } } },
    page: { document: `<main ${use("<missing 1>")} ${use(second)}/>` },
  });
  const start = declaration.indexOf(expression);
  for (const [data, problem] of [["<>", "Missing"], ["1", "Invalid"]] as const) {
    assert.throws(() => compose(declaration, data), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`${problem} Part path ${expression} in "parts/path" at [0,0,1]`), error.message);
      const details = read_transform_error_details(error);
      assert.equal(details?.code, "HSON_EVENT_REFERENCE_INVALID");
      assert.deepEqual(details?.source, { index: start, line: 2, column: 13 });
      assert.deepEqual(details?.related?.find(item => item.role === "value-end")?.source,
        { index: start + expression.length, line: 2, column: 13 + expression.length });
      assert.equal(details?.related?.find(item => item.role === "event-attachment")?.source.index, document.indexOf("event:advance"));
      return true;
    });
  }
  assert.deepEqual(descriptors(compose(declaration, "<missing 2>")).map(descriptor => descriptor.data?.materialize()), [{ item: 1 }, { item: 2 }]);
  const optional = declaration.replace(expression, "^{args.missing?}");
  assert.equal(descriptors(compose(optional, "<missing 2>")).length, 2);
  assert.ok(descriptors(compose(optional, "<>"))[1]?.data?.equals(Hson.data.from({})));
  const malformed = "^{args.missing.}";
  assert.throws(() => compose(declaration.replace(expression, malformed), "<>"), error => {
    const details = error instanceof Error ? read_transform_error_details(error.cause) : undefined;
    return details?.source?.index === start
      && details.related?.find(item => item.role === "value-end")?.source.index === start + malformed.length;
  });
}

function event_reference_comments() {
  const compose = (local: string, incoming: string, newline: string, label = ' label:str="Ready"') =>
    hsonLiveMap.fromLibraries({
      parts: { parts: { card: {
        kind: "document", document: '<button hson:part data:record=%{record} str:text=%{label?} event:advance/>',
        events: { advance: `<hson:event on:click local:OPEN_PANEL
          input:data=${local}// comment with < and >
          title:str=${incoming}// another comment${newline}<> >` },
      } } },
      page: { document: `<hson-part at=parts/card record:data="<'a//b' -0>"${label}/>` },
    });
  for (const newline of ["\n", "\r\n", "\r"]) {
    const present = descriptors(compose('^{record["a//b"]}', "%{label?}", newline))[0]?.data;
    assert.ok(present?.equals(Hson.data.from({ input: -0, title: "Ready" })));
    const absent = descriptors(compose("^{record.missing?}", "%{label?}", newline, ""))[0]?.data;
    assert.ok(absent?.equals(Hson.data.from({})));
  }
  assert.throws(() => compose("^{record.}", "%{label?}", "\n"), /one whole Part reference/);
  assert.throws(() => compose("^{record}suffix", "%{label?}", "\n"), /one whole Part reference/);
  assert.throws(() => compose("^{record}", "%{label??}", "\n"), /one whole Part reference/);
}

function forwarded_event_cases() {
  const map = hsonLiveMap.fromLibraries({ parts: { parts: {
    leaf: { kind: "document", document: '<button hson:part part:optional data:args=%{args} event:advance/>',
      events: { advance: "<hson:event on:click local:OPEN_PANEL value:num=^{args.value?} <> >" } },
    wrap: { kind: "document", document: '<main hson:part data:model=%{model?} <hson-part at="leaf" args:data="^{model?}"/>/>' },
  } }, page: { document: '<hson-part lib="parts" at="wrap" model:data="<value -0>"/>' } });
  assert.ok(descriptors(map)[0]?.data?.equals(Hson.data.from({ value: -0 })));
  assert.doesNotThrow(() => map.parts.parts.leaf.write());
  assert.throws(() => map.parts.parts.leaf.write({ other: true }), /unexpected/);
  const without = hsonLiveMap.fromLibraries({ parts: { parts: {
    leaf: { ...map.parts.parts.leaf.snap()!, kind: "document" },
  } }, page: { document: '<main <hson-part lib="parts" at="leaf"/>/>' } });
  assert.deepEqual(descriptors(without), []);
  assert.doesNotMatch(without.doc.page.render(), /button/);
}

function iterator_event_arguments() {
  const events = { advance: '<hson:event on:click local:SELECT slide:data=^{row} index:num=^{i} title:str="Slide ^{i}: ^{row.title}" caption:str=%{caption} note:str=^{row.note?} <> >' };
  const slide = { kind: "document", document: '<section hson:part str:label=%{caption?} data:rows=%{slides} <button for:row:i=^{rows} event:advance/>/>', events } satisfies LiveMapDocumentPart;
  const make = (rows: string, caption = '') => hsonLiveMap.fromLibraries({
    parts: { parts: { slide } },
    page: { document: `<hson-part at=parts/slide ${caption} slides:data="${rows}"/>` },
  });
  const first = '<title "First" note "Ready" x -0>';
  const second = '<title "Second">';
  const rows = `[${first},${second}]`.replaceAll('"', '\\"');
  assert.deepEqual(descriptors(make(rows)).map(({ data }) => data?.materialize()), [
    { slide: { title: "First", note: "Ready", x: -0 }, index: 0, title: "Slide 0: First", note: "Ready" },
    { slide: { title: "Second" }, index: 1, title: "Slide 1: Second" },
  ]);
  assert.deepEqual(descriptors(make(rows, 'caption:str="Deck"')).map(({ data }) =>
    data?.entries()?.map(([name]) => name)), [
    ["slide", "index", "title", "caption", "note"], ["slide", "index", "title", "caption"],
  ]);
  assert.throws(() => make('[<title true note 5>]'), /Event argument "note" requires a str value/);
  assert.throws(() => make('[<title <> >]'), /interpolation requires a primitive/);
  assert.throws(() => hsonLiveMap.fromLibraries({ parts: { parts: {
    button: { kind: "document", document: '<button hson:part doc:fragment=%{fragment} event:advance/>',
      events: { advance: '<hson:event on:click local:SELECT fragment:data=^{fragment} <> >' } },
  } } }), /Document bindings cannot be sent/);
}

async function native_event_cases() {
  const move = '<hson:event on:pointer:move local:MOVE x:num=^{pointer.movementX} row:data=^{row} note:str=^{row.note?} y:data=^{pointer["clientY"]?} offset:num="-0" <> >';
  const down = '<hson:event on:pointer:down host:DOWN x:num=^{pointer.clientX} y:num=^{pointer.movementY} <> >';
  const release = '<hson:event on:pointer:up local:RELEASE id:num=^{pointer.pointerId} changed:num=^{pointer.button} held:num=^{pointer.buttons} <> >';
  const cancel = '<hson:event on:pointer:cancel host:CANCEL kind:str=^{pointer.pointerType} primary:data=^{pointer.isPrimary} <> >';
  const shortcut = '<hson:event on:key:down local:SHORTCUT key:str=^{key.key} row:data=^{row} note:str=^{row.note?} code:data=^{key["code"]?} repeat:data=^{key.repeat} offset:num="-0" <> >';
  const keyup = '<hson:event on:key:up host:KEYUP location:num=^{key.location} composing:data=^{key.isComposing} <> >';
  const control = { kind: "document", document: '<main hson:part data:rows=%{rows} <button for:row=^{rows} event:move event:down event:release event:cancel event:shortcut event:keyup/>/>',
    events: { move, down, release, cancel, shortcut, keyup } } satisfies LiveMapDocumentPart;
  const startup = { parts: { parts: { control } } };
  const rows = '[<value -0 note "ready">,<value 2>]';
  const composition = `<hson-part at=parts/control rows:data=${JSON.stringify(rows)}/>`;
  const projectedState = (map: LiveMap) => {
    const engine = authority(map);
    return engine.systemRoot(engine.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!);
  };
  const read = (root: HsonNode) => descriptor_data(root).map(entry => new Map(entry.entries()));
  const map = hsonLiveMap.fromLibraries({ ...startup, page: { document: composition } });
  const entries = read(projectedState(map));
  const names = ["pointermove", "pointerdown", "pointerup", "pointercancel", "keydown", "keyup"];
  assert.equal(entries.length, 2 * names.length);
  for (let index = 0; index < entries.length; index++) {
    const descriptor = entries[index]!;
    assert.equal(new Map(descriptor.get("listener")?.entries()).get("event")?.scalar(), names[index % names.length]);
    assert.equal(descriptor.has("args") || descriptor.has("payload"), false);
  }
  const first = Hson.data.fromSource('[["x","num","pointer","movementX"],["row","data",{"value":-0,"note":"ready"}],["note","str","ready"],["y","data","pointer","clientY"],["offset","num",-0]]');
  const second = Hson.data.fromSource('[["x","num","pointer","movementX"],["row","data",{"value":2}],["note","str"],["y","data","pointer","clientY"],["offset","num",-0]]');
  assert.ok(entries[0]?.get("eventArgs")?.equals(first));
  assert.ok(entries[names.length]?.get("eventArgs")?.equals(second));
  const keyboardFirst = Hson.data.fromSource('[["key","str","key","key"],["row","data",{"value":-0,"note":"ready"}],["note","str","ready"],["code","data","key","code"],["repeat","data","key","repeat"],["offset","num",-0]]');
  const keyboardSecond = Hson.data.fromSource('[["key","str","key","key"],["row","data",{"value":2}],["note","str"],["code","data","key","code"],["repeat","data","key","repeat"],["offset","num",-0]]');
  assert.ok(entries[4]?.get("eventArgs")?.equals(keyboardFirst));
  assert.ok(entries[names.length + 4]?.get("eventArgs")?.equals(keyboardSecond));
  assert.doesNotMatch(map.doc.page.render(), /event:|hson:event/);

  const admit = (document: string, action: string) => hsonLiveMap.fromLibraries({ parts: { parts: {
    control: { ...control, document, events: { move: action } },
  } } });
  const button = '<button hson:part event:move/>';
  for (const property of ['pointer', 'pointer.pressure', 'pointer.clientX.foo', 'pointer[0]']) {
    assert.throws(() => admit(button, move.replace('pointer.movementX', property)), /Unsupported pointer Event lookup/);
  }
  assert.throws(() => admit(button, move.replace('x:num=', 'x:str=')), /requires a whole :num or :data argument/);
  assert.throws(() => admit(button, '<hson:event on:pointer:move local:MOVE x:str="x ^{pointer.clientX}" <> >'), /requires a whole/);
  for (const selector of ['on:pointermove', 'on:wheel', 'on:keydown', 'on:key:press']) {
    assert.throws(() => admit(button, move.replace('on:pointer:move', selector)), /Unsupported Event selector/);
  }
  assert.throws(() => admit(button, move.replace('on:pointer:move', 'on:click')), /native pointer binding requires/);
  const conflict = '<button hson:part data:pointer=%{stored} event:move "^{pointer.label}"/>';
  assert.throws(() => admit(conflict, move), error => {
    assert.match(String(error), /Rename the Part local or its iterator alias/);
    assert.equal(read_transform_error_details(error)?.related?.find(item => item.role === "event-attachment")?.source.index, conflict.indexOf("event:move"));
    return true;
  });
  assert.throws(() => admit('<main hson:part data:rows=%{rows} <button for:pointer=^{rows} event:move/>/>',
    '<hson:event on:pointer:move local:MOVE <> >'), /Part local "pointer" conflicts/);

  const lexical = admit('<main hson:part data:rows=%{rows} num:stored=%{pointer} <b for:pointer=^{rows} "^{pointer.label}"/> <button event:move/>/>',
    '<hson:event on:pointer:move local:MOVE x:num=^{pointer.clientX} copy:data=%{pointer?} <> >');
  lexical.addLibraries({ page: { document: lexical.parts.parts.control.write({ rows: [{ label: "ordinary" }], pointer: -0 }) } });
  assert.match(lexical.doc.must("page").render(), /<b>ordinary<\/b>/);
  assert.ok(read(projectedState(lexical))[0]?.get("eventArgs")?.equals(Hson.data.fromSource('[["x","num","pointer","clientX"],["copy","data",-0]]')));
  const click = admit('<button hson:part data:pointer=%{stored} event:move/>',
    '<hson:event on:click local:MOVE x:num=^{pointer.clientX} <> >');
  click.addLibraries({ page: { document: click.parts.parts.control.write({ stored: { clientX: -0 } }) } });
  assert.ok(descriptors(click)[0]?.data?.equals(Hson.data.from({ x: -0 })));

  const keyboard = '<hson:event on:key:down local:SHORTCUT code:str=^{key.code} copy:data=%{key?} <> >';
  for (const property of ['key', 'key.keyCode', 'key.pressed', 'key.code.extra', 'key[0]', 'key.constructor']) {
    assert.throws(() => admit(button, keyboard.replace('key.code', property)), /Unsupported key Event lookup/);
  }
  assert.throws(() => admit(button, keyboard.replace('code:str=', 'code:num=')), /whole :str or :data/);
  assert.throws(() => admit(button, keyboard.replace('key.code', 'key.repeat')), /whole :data/);
  assert.throws(() => admit(button, keyboard.replace('^{key.code}', '"^{key.code} suffix"')), /requires a whole :str or :data/);
  assert.throws(() => admit(button, keyboard.replace('key.code', 'keyboard.key')), /Missing Part local declaration "keyboard"/);
  assert.throws(() => admit(button, keyboard.replace('on:key:down', 'on:pointer:up')), /native key binding requires on:key:down or on:key:up/);
  assert.throws(() => admit(button, move.replace('on:pointer:move', 'on:key:up')), /native pointer binding requires/);
  const local = '<button hson:part data:key=%{stored} event:move "^{key.code}"/>';
  assert.throws(() => admit(local, keyboard), /Part local "key" conflicts/);
  assert.throws(() => admit('<main hson:part data:rows=%{rows} <button for:row:key=^{rows} event:move/>/>',
    '<hson:event on:key:up local:SHORTCUT <> >'), /Part local "key" conflicts/);
  const nonKeyboard = admit(local, '<hson:event on:pointer:cancel local:CANCEL id:num=^{pointer.pointerId} code:str=^{key.code} <> >');
  nonKeyboard.addLibraries({ page: { document: nonKeyboard.parts.parts.control.write({ stored: { code: "stored" } }) } });
  assert.match(nonKeyboard.doc.must("page").render(), /stored/);
  assert.ok(read(projectedState(nonKeyboard))[0]?.get("eventArgs")?.equals(Hson.data.from([['id', 'num', 'pointer', 'pointerId'], ['code', 'str', 'stored']])));
  const lexicalKeyboard = admit('<button hson:part num:stored=%{key} event:move/>', keyboard);
  lexicalKeyboard.addLibraries({ page: { document: lexicalKeyboard.parts.parts.control.write({ key: -0 }) } });
  assert.ok(read(projectedState(lexicalKeyboard))[0]?.get("eventArgs")?.equals(Hson.data.from([['code', 'str', 'key', 'code'], ['copy', 'data', -0]])));
  const ordinaryKeyboard = admit('<button hson:part data:keyboard=%{stored} event:move/>',
    '<hson:event on:key:down local:SHORTCUT pressed:str=^{key.key} saved:str=^{keyboard.key} label:str="saved: ^{keyboard.key}" <> >');
  ordinaryKeyboard.addLibraries({ page: { document: ordinaryKeyboard.parts.parts.control.write({ stored: { key: "saved" } }) } });
  assert.ok(read(projectedState(ordinaryKeyboard))[0]?.get("eventArgs")?.equals(Hson.data.from([
    ['pressed', 'str', 'key', 'key'], ['saved', 'str', 'saved'], ['label', 'str', 'saved: saved'],
  ])));

  // A portable capture of an ordinary document can also carry an admitted plan.
  const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
  const listener = { event: "pointermove", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } as const;
  add_interaction(plain, { id: "plan", subject: { library: "page", path: [0] }, kind: "browser", key: "MOVE", listener, eventArgs: first });
  const keyboardListener = { ...listener, event: "keydown" };
  add_interaction(plain, { id: "keyboard-plan", subject: { library: "page", path: [0] }, kind: "locus", key: "SHORTCUT", listener: keyboardListener, eventArgs: keyboardFirst });
  const snapshot = plain.capture();
  assert.deepEqual(install_libraries_snapshot(structuredClone(snapshot)).map.capture(), snapshot);
  const revision = plain.rev;
  for (const [event, source] of [["click", '[["x","num","pointer","clientX"]]'], ["pointermove", '[]'],
    ["pointermove", '[["x","str","pointer","clientX"]]'], ["pointermove", '[["x","num","pointer","pressure"]]'],
    ["pointermove", '[["x","num","pointer","clientX"],["x","num",0]]'],
    ["pointermove", '[["bad.name","num","pointer","clientX"]]'],
    ["pointermove", '[["x","num","pointer","clientX"],["y","num","2"]]'],
    ["pointercancel", '[["key","str","key","key"]]'], ["keydown", '[["key","num","pointer","pointerId"]]'],
    ["keydown", '[["pressed","str","keyboard","key"]]'], ["keydown", '[["pressed","str","key","pressed"]]'],
    ["keyup", '[["repeat","num","key","repeat"]]'], ["keydown", '[["key","data","key","__proto__"]]'],
    ["keydown", '[["key","str","key","code"],["x","num","pointer","clientX"]]'],
    ["keydown", '[["location","str","key","location"]]']] as const) {
    assert.throws(() => add_interaction(plain, { id: "bad", subject: { library: "page", path: [0] },
      kind: "locus", key: "DOWN", listener: { ...listener, event }, eventArgs: Hson.data.fromSource(source) }), /canonical event argument plan/i);
  }
  assert.throws(() => add_interaction(plain, { id: "hybrid", subject: { library: "page", path: [0] },
    kind: "browser", key: "MOVE", listener, args: {}, eventArgs: first }), /cannot accompany/);
  const badPlan = hson_data_value(Hson.data.fromSource('[["pressed","str","keyboard","key"]]'));
  const forge = (root: HsonNode) => ordered_projected_array(interaction_descriptors_from_root(projected_value_from_hson_node(root)).map(entry => {
    assert.ok(is_ordered_projected_object(entry));
    if (!entry.entries.some(([key, value]) => key === "key" && value === "SHORTCUT")) return entry;
    return ordered_projected_object(entry.entries.map(([key, value]) => [key, key === "eventArgs" ? badPlan : value]));
  }));
  const invalid = forge(projectedState(plain));
  const engine = authority(plain);
  assert.throws(() => engine.commit([{ target: engine.systemTarget(engine.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!, ["descriptors"]),
    kind: "replace", value: invalid }]), /Invalid canonical event argument plan operand/);
  const invalidRoot = projected_value_to_hson_root(ordered_projected_object([["descriptors", invalid]]));
  const forged = { ...snapshot, libraries: snapshot.libraries.map(entry => entry.name === INTERACTION_RESERVED_LIBRARY_KEY
    ? { ...entry, root: encode_hosted_root(invalidRoot) } : entry) };
  assert.throws(() => plain.restore(forged), /Invalid canonical event argument plan operand/);
  assert.deepEqual(plain.capture(), snapshot);
  assert.equal(plain.rev, revision);

  // Original registry fences can recover the new state and existing click-only state.
  assert.equal(hson_schema_digest(interaction_schema_internal()), 'ff3888042afcbbda80f45c417e2323db8fd6460a377ca38057d25449bc41042b');
  const persistence = new MemoryCheckpointAdapter();
  const authorizeProjection: LocusProjectionAuthorizer = ({ requested }) => requested;
  const config = { persistence, logicalMapId: "native-event-checkpoint", authorizeProjection };
  let locus = await hsonLiveMap.locus.resume(startup, config);
  let expected: string;
  try {
    await locus.admit({ page: { document: composition, access: "shared" } });
    expected = encode_hosted_root(projectedState(locus_map_internal(locus))).payload;
  } finally { locus.dispose(); }
  for (const compact of [true, false]) {
    locus = await hsonLiveMap.locus.resume(startup, config);
    try {
      assert.equal(encode_hosted_root(projectedState(locus_map_internal(locus))).payload, expected);
      const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
      const projection = session.now({ html: "page" }).libs;
      assert.equal(projection.system?.interactions.payload, expected);
      const malformed = projected_value_to_hson_root(ordered_projected_object([["descriptors", forge(decode_hosted_root(projection.system!.interactions))]]));
      assert.throws(() => admit_authority_projection_snapshot({ ...projection, system: { interactions: encode_hosted_root(malformed) } }));
      if (compact) await hsonLiveMap.locus.checkpoint(locus);
    } finally { locus.dispose(); }
  }

  const persisted = new MemoryCheckpointAdapter();
  const coveredConfig = { persistence: persisted, logicalMapId: "covered-keyboard-plan" };
  const flat = { ...startup, page: { document: '<main/>' } } as const;
  const hosted = await hsonLiveMap.locus.resume(flat, coveredConfig);
  const intent = { id: "retained-plan", subject: { library: "page", path: [0] }, kind: "browser", key: "SHORTCUT", listener: keyboardListener } as const;
  const before = Hson.data.from([["value", "str", "key", "key"]]);
  const after = Hson.data.from([["value", "str", "key", "code"]]);
  let malformed: OrderedProjectedValue;
  try {
    await hosted.stage(stage => add_interaction(stage, { ...intent, eventArgs: before }));
    await hosted.stage(stage => replace_interaction(stage, { ...intent, eventArgs: after }));
    malformed = forge(projectedState(locus_map_internal(hosted)));
    await hosted.admit({ extra: { document: composition, access: "shared" } });
    persisted.failPrune = new Error("Fixture retained checkpoint-covered history.");
    await assert.rejects(hsonLiveMap.locus.checkpoint(hosted), /checkpoint/i);
  } finally { hosted.dispose(); }
  persisted.failPrune = undefined;
  const checkpoint = persisted.state(coveredConfig.logicalMapId)!;
  const [firstCommit, secondCommit, ...later] = checkpoint.commits;
  assert.equal(checkpoint.checkpoint.rev, 3);
  assert.equal(later.length, 1);
  const active = hsonLiveMap.fromLibraries(flat);
  add_interaction(active, { ...intent, eventArgs: before });
  const activeEngine = authority(active);
  const activeSystem = activeEngine.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!;
  const activeDescriptors = interaction_descriptors_from_root(projected_value_from_hson_node(projectedState(active)));
  assert.ok(Array.isArray(malformed) && malformed[0] !== undefined);
  const obsoletePlan = ordered_projected_array([ordered_projected_array(["value", "str", "keyboard", "code"])]);
  const edits = [
    { path: ["descriptors"], invalid: malformed },
    { path: ["descriptors", 0], prev: activeDescriptors[0], invalid: malformed[0] },
    { path: ["descriptors", 0, "eventArgs"], prev: hson_data_value(before), next: hson_data_value(after), invalid: obsoletePlan },
    { path: ["descriptors", 0, "eventArgs", 0, 3], prev: "key", next: "code", invalid: "pressed" },
    { path: ["descriptors", 0, "eventArgs", 0, 2], prev: "key", invalid: "keyboard" },
  ] as const;
  for (const { path, invalid } of edits) {
    assert.throws(() => activeEngine.commit([{ target: activeEngine.systemTarget(activeSystem, path),
      kind: "replace", value: invalid }]), /Invalid canonical event argument plan operand/);
  }
  const write = secondCommit!.commit.operations[0]!;
  assert.equal(write.domain, "data");
  const [edit] = decode_livemap_replay_payload(write.payload);
  assert.ok(edit);
  assert.equal(edit.kind, "replace");
  assert.deepEqual(edit.path, ["descriptors"]);
  const seed = (path: readonly (string | number)[], prev: OrderedProjectedValue | undefined, next: OrderedProjectedValue) => {
    const payload = encode_livemap_replay_transport([{ ...edit, kind: "replace", path, prev, next }]).payload;
    persisted.seed(coveredConfig.logicalMapId, { ...checkpoint, commits: [firstCommit!, { ...secondCommit!,
      commit: { ...secondCommit!.commit, operations: [{ ...write, payload }] } }, ...later] });
  };
  for (const entry of edits) {
    const prev = "prev" in entry ? entry.prev : edit.prev;
    seed(entry.path, prev, entry.invalid);
    await assert.rejects(hsonLiveMap.locus.resume(flat, coveredConfig), { code: "LOCUS_PERSISTED_STATE_INVALID" }, JSON.stringify(entry.path));
    if ("next" in entry) {
      replace_interaction(active, { ...intent, eventArgs: before });
      activeEngine.commit([{ target: activeEngine.systemTarget(activeSystem, entry.path), kind: "replace", value: entry.next }]);
      assert.ok(read(projectedState(active))[0]?.get("eventArgs")?.equals(after));
      seed(entry.path, prev, entry.next);
      const recovered = await hsonLiveMap.locus.resume(flat, coveredConfig);
      try {
        assert.equal(recovered.rev, 3);
        const recoveredEntries = read(projectedState(locus_map_internal(recovered)));
        assert.ok(recoveredEntries[0]?.get("eventArgs")?.equals(after));
        assert.ok(recoveredEntries[1]?.get("eventArgs")?.equals(first));
        assert.ok(recoveredEntries[5]?.get("eventArgs")?.equals(keyboardFirst));
      } finally { recovered.dispose(); }
    }
  }
  // A valid final checkpoint can cover a later edit whose previous state is
  // invalid. Checking the submitted next value alone misses that boundary.
  seed(["descriptors", 0, "eventArgs", 0, 2], "keyboard", "key");
  await assert.rejects(hsonLiveMap.locus.resume(flat, coveredConfig), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "LOCUS_PERSISTED_STATE_INVALID"
    && error.cause instanceof TypeError && error.cause.message === 'Invalid canonical event argument plan operand for "value".');
  seed(["descriptors", 0, "listener", "target"], "invalid-target", "element");
  await assert.rejects(hsonLiveMap.locus.resume(flat, coveredConfig), { code: "LOCUS_PERSISTED_STATE_INVALID" });
}

export async function covered_event_recovery_cases(): Promise<void> {
  class PartialPruneAdapter extends MemoryCheckpointAdapter {
    pruneRevision: number | undefined;
    override async pruneCommitsThrough(id: string, checkpointId: string, rev: number): Promise<void> {
      if (this.pruneRevision === undefined) return super.pruneCommitsThrough(id, checkpointId, rev);
      const active = this.state(id)!;
      assert.equal(active.checkpoint.checkpointId, checkpointId);
      assert.equal(active.checkpoint.rev, rev);
      assert.ok(this.pruneRevision <= rev);
      this.seed(id, { ...active, commits: active.commits.filter(record => record.commit.rev !== this.pruneRevision) });
      throw new Error("Pruning interrupted after deleting one covered record.");
    }
  }
  const definitions = { page: { document: '<main/>' }, state: { json: { count: 0 } } } as const;
  const listener = { event: "pointermove", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } as const;
  const pointer = { id: "pointer", subject: { library: "page", path: [0] }, kind: "browser", key: "MOVE", listener } as const;
  const keyboard = { ...pointer, id: "key", key: "KEY", listener: { ...listener, event: "keydown" } } as const;
  const pointerBefore = Hson.data.fromSource('[["x","num","pointer","clientX"],["offset","num",-0],["row","data",{"z":-0,"a":1}]]');
  const pointerAfter = Hson.data.fromSource('[["x","num","pointer","clientY"],["offset","num",-0],["row","data",{"z":-0,"a":1}]]');
  const keyBefore = Hson.data.fromSource('[["code","str","key","key"],["offset","num",-0]]');
  const keyAfter = Hson.data.fromSource('[["code","str","key","code"],["offset","num",-0]]');
  const systemRoot = (map: LiveMap) => authority(map).systemRoot(authority(map).systemState(INTERACTION_RESERVED_LIBRARY_KEY)!);
  const invalid = { code: "LOCUS_PERSISTED_STATE_INVALID" };

  for (const rewriteDescriptor of [false, true]) {
    const persistence = new PartialPruneAdapter();
    const config = { persistence, logicalMapId: `partial-prune-event-${rewriteDescriptor}` };
    let hosted = await hsonLiveMap.locus.resume(definitions, config);
    // Retain a complete Descriptor list at revision 1 as a history anchor.
    await hosted.stage(stage => {
      add_interaction(stage, { ...pointer, eventArgs: pointerBefore });
      add_interaction(stage, { ...keyboard, eventArgs: keyBefore });
    });
    const uncovered = persistence.state(config.logicalMapId)!;
    const map = make_livemap_mirror_from_semantic_checkpoint_internal(authority(locus_map_internal(hosted)).captureSemanticCheckpoint());
    hosted.dispose();

    // Use the same admissible semantic transition and encoder as durable replay.
    const engine = authority(map);
    const system = engine.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!;
    const pointerPath = ["descriptors", 0, "eventArgs", 0, 3] as const;
    const keyPath = ["descriptors", 1, "eventArgs"] as const;
    assert.throws(() => engine.commit([{ target: engine.systemTarget(system, pointerPath), kind: "replace", value: "pressure" }]),
      /Invalid canonical event argument plan operand/);
    const { hosted: nested } = engine.commit([
      { target: engine.systemTarget(system, pointerPath), kind: "replace", value: "clientY" },
      { target: engine.systemTarget(system, keyPath), kind: "replace", value: hson_data_value(keyAfter) },
    ]);
    assert.ok(nested);
    const record = durable_aggregate_commit(nested);
    const firstWrite = record.commit.operations[0]!;
    assert.equal(firstWrite.domain, "data");
    const [edit] = decode_livemap_replay_payload(firstWrite.payload);
    assert.ok(edit?.kind === "replace");
    assert.deepEqual(edit.path, pointerPath);
    const malformed = { ...record, commit: { ...record.commit, operations: [
      { ...firstWrite, payload: encode_livemap_replay_transport([{ ...edit, next: "pressure" }]).payload },
      ...record.commit.operations.slice(1),
    ] } };
    persistence.seed(config.logicalMapId, { ...uncovered, commits: [...uncovered.commits, malformed] });
    await assert.rejects(hsonLiveMap.locus.resume(definitions, config), invalid, "uncovered nested operation requires canonical state");
    persistence.seed(config.logicalMapId, { ...uncovered, commits: [record] });
    await assert.rejects(hsonLiveMap.locus.resume(definitions, config), invalid, "uncovered replay cannot skip a revision");
    persistence.seed(config.logicalMapId, uncovered);
    await persistence.appendCommit(record);
    hosted = await hsonLiveMap.locus.resume(definitions, config);
    try {
      assert.equal(hosted.rev, 2);
      const replayed = descriptor_data(systemRoot(locus_map_internal(hosted)));
      assert.ok(new Map(replayed[0]?.entries()).get("eventArgs")?.equals(pointerAfter));
      assert.ok(new Map(replayed[1]?.entries()).get("eventArgs")?.equals(keyAfter));
      await hosted.stage(stage => {
        stage.data.state.at(["count"]).set(3);
        if (rewriteDescriptor) replace_interaction(stage, { ...pointer, eventArgs: pointerBefore });
      });
      persistence.pruneRevision = rewriteDescriptor ? 2 : 3;
      await assert.rejects(hsonLiveMap.locus.checkpoint(hosted), { code: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" });
    } finally { hosted.dispose(); }

    const pruned = persistence.state(config.logicalMapId)!;
    assert.equal(pruned.checkpoint.rev, 3);
    assert.deepEqual(pruned.commits.map(entry => entry.commit.rev), rewriteDescriptor ? [1, 3] : [1, 2]);
    const assertCheckpoint = async (revision = 3) => {
      const recovered = await hsonLiveMap.locus.resume(definitions, config);
      try {
        assert.equal(recovered.rev, revision);
        assert.equal(recovered.data.state.snap(["count"]), revision);
        const entries = descriptor_data(systemRoot(locus_map_internal(recovered)));
        assert.ok(new Map(entries[0]?.entries()).get("eventArgs")?.equals(rewriteDescriptor ? pointerBefore : pointerAfter));
        assert.ok(new Map(entries[1]?.entries()).get("eventArgs")?.equals(keyAfter));
      } finally { recovered.dispose(); }
    };
    await assertCheckpoint();
    const [first, second, third] = persistence.appendCalls;
    assert.ok(first && second && third);
    assert.deepEqual(persistence.appendCalls.map(entry => entry.commit.rev), [1, 2, 3]);
    for (const commits of [[first, second, third], [first, third], [first, second], [second, third], [second], []]) {
      persistence.seed(config.logicalMapId, { ...pruned, commits });
      await assertCheckpoint();
    }
    persistence.seed(config.logicalMapId, { ...pruned, commits: [first, malformed] });
    await assert.rejects(hsonLiveMap.locus.resume(definitions, config), invalid, "retained complete Descriptor list establishes historical context");
    persistence.seed(config.logicalMapId, { ...pruned, commits: [third, first] });
    await assert.rejects(hsonLiveMap.locus.resume(definitions, config), invalid, "partial pruning does not permit out-of-order records");
    persistence.seed(config.logicalMapId, { ...pruned, commits: [first, third, third] });
    await assert.rejects(hsonLiveMap.locus.resume(definitions, config), invalid, "partial pruning does not permit duplicate records");

    if (rewriteDescriptor) {
      persistence.seed(config.logicalMapId, { ...pruned, commits: [first, second, third] });
      hosted = await hsonLiveMap.locus.resume(definitions, config);
      try {
        await hosted.stage(stage => stage.data.state.at(["count"]).set(4));
        persistence.pruneRevision = 3;
        await assert.rejects(hsonLiveMap.locus.checkpoint(hosted), { code: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" });
      } finally { hosted.dispose(); }
      const withGap = persistence.state(config.logicalMapId)!;
      assert.deepEqual(withGap.commits.map(entry => entry.commit.rev), [1, 2, 4]);
      await assertCheckpoint(4);
      // The retained nested write can be checked against revision 1. It cannot
      // be rewound from revision 4 across the missing Descriptor rewrite.
      persistence.seed(config.logicalMapId, { ...withGap, commits: withGap.commits.slice(1) });
      await assertCheckpoint(4);
      persistence.seed(config.logicalMapId, { ...withGap, commits: [first, malformed, withGap.commits[2]!] });
      await assert.rejects(hsonLiveMap.locus.resume(definitions, config), invalid, "validating a detached run still uses its retained anchor");
    }

    const invalidDescriptors = interaction_descriptors_from_root(projected_value_from_hson_node(systemRoot(map))).map(entry => {
      assert.ok(is_ordered_projected_object(entry));
      return ordered_projected_object(entry.entries.map(([name, value]) => [name, name === "eventArgs" ? ordered_projected_array([]) : value]));
    });
    const invalidRoot = projected_value_to_hson_root(ordered_projected_object([["descriptors", ordered_projected_array(invalidDescriptors)]]));
    const { checkpoint } = pruned;
    const chunks = checkpoint.chunks.flatMap(descriptor => {
      if (descriptor.owner !== INTERACTION_RESERVED_LIBRARY_KEY || descriptor.part !== "root") return [descriptor];
      const [replacement] = encode_checkpoint_chunks(checkpoint.checkpointId, checkpoint.rev, descriptor.owner, "root", invalidRoot);
      persistence.chunks.set(replacement!.chunk.id, replacement!.chunk);
      return [replacement!.descriptor];
    });
    persistence.seed(config.logicalMapId, { checkpoint: { ...checkpoint, chunks }, commits: [] });
    await assert.rejects(hsonLiveMap.locus.resume(definitions, config), invalid, "the active checkpoint itself requires canonical state");
  }
}

async function composition_cases() {
  const locus = hsonLiveMap.locus.create({ parts: { ...collection, access: "private" },
    page: { document: `<main ${invocation}/>`, access: "shared" } }, {
    authorizeProjection: ({ requested }) => requested,
  });
  const map = locus_map_internal(locus);
  try {
    const writer = locus.parts.parts.typed;
    assert.throws(() => writer.write(), /missing/);
    assert.throws(() => locus.parts.parts.incoming.write(), /missing/);
    const first = Hson.data.fromSource('<label "first" count -0>');
    const second = Hson.data.fromSource('<count 2 label "second">');
    const insert = (data: typeof first) => connector(writer.write({ args: data }));
    const scalarText = connector(locus.parts.parts.incoming.write({ text: "<step 3>" }));
    const firstNode = insert(first), secondNode = insert(second);
    const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
    const initial = descriptors(map)[0]!;
    assert.equal(initial.attrs?.id, "literal");
    let published = 0;
    const off = map.commits.observe(() => { published++; });
    await locus.stage(stage => {
      const page = stage.doc.must("page");
      page.content.insert(parent, 1, firstNode);
      page.content.insert(parent, 2, secondNode);
      page.content.insert(parent, 3, scalarText);
    });
    assert.equal(published, 1);
    const all = descriptors(map);
    assert.equal(all.length, 6);
    assert.equal(new Set(all.map(entry => entry.id)).size, 6);
    for (const [index, expected] of [first, first, second, second].entries()) {
      const descriptor = all[index + 1]!;
      assert.equal(descriptor.kind, "browser");
      assert.equal(descriptor.key, "OPEN_PANEL");
      assert.equal(descriptor.attrs?.class, index % 2 === 0 ? "one" : "two");
      assert.ok(descriptor.data?.equals(panel_args(expected)));
    }
    assert.ok(all[5]?.data?.equals(Hson.data.from({ title: "<step 3>" })));
    const beforeFailure = authority(map).captureSemanticCheckpoint();
    const epoch = authority(map).identityEpoch().current();
    await assert.rejects(locus.stage(stage => {
      const page = stage.doc.must("page");
      page.content.insert(parent, 0, firstNode);
      page.content.insert(parent, 1, connector('<hson-part lib="parts" at="typed"/>'));
    }), /missing/);
    assert.equal(published, 1);
    assert.equal(authority(map).identityEpoch().current(), epoch);
    assert.deepEqual(authority(map).captureSemanticCheckpoint(), beforeFailure);

    await locus.stage(stage => stage.doc.must("page").content.move(parent, 1, 0));
    const moved = descriptors(map);
    assert.deepEqual(moved.map(entry => entry.id), all.map(entry => entry.id));
    assert.deepEqual(moved[1]?.path, [...parent.path, 0, 0, 0]);
    assert.deepEqual(moved[0]?.path, [...parent.path, 1]);
    const checkpoint = authority(map).captureSemanticCheckpoint();
    const recovered = make_livemap_mirror_from_semantic_checkpoint_internal(checkpoint);
    assert.deepEqual(descriptors(recovered).map(({ data, ...entry }) => [entry, data?.toHson()]),
      moved.map(({ data, ...entry }) => [entry, data?.toHson()]));
    const rendered = session.now({ html: "page" });
    assert.doesNotMatch(JSON.stringify(rendered), /event:advance|hson:event|hson-part|input:data/);
    assert.match(rendered.html, /id="literal"/);

    await locus.stage(stage => {
      const page = stage.doc.must("page");
      page.content.remove(parent, 0);
      page.content.replace(parent, 0, connector(invocation));
    });
    const after = descriptors(map);
    assert.equal(after.length, 4);
    assert.deepEqual(after.slice(0, 3).map(entry => entry.id), all.slice(3).map(entry => entry.id));
    assert.notEqual(after[3]?.id, initial.id);
    assert.equal(after[3]?.attrs?.id, "literal");
    off();
    await locus.admit({ next: { document: invocation, access: "shared" } });
    assert.deepEqual(descriptors(map, "next").map(entry => entry.attrs?.id), ["literal"]);
  } finally { locus.dispose(); }

  const mapWithEmptyPage = hsonLiveMap.fromLibraries({ parts: collection, page: { document: "<main <i/>/>" } });
  mapWithEmptyPage.batch(stage => {
    const page = stage.doc.must("page");
    page.content.insert(parent, 1, connector(invocation));
    page.content.move(parent, 1, 0);
  });
  assert.deepEqual(descriptors(mapWithEmptyPage).map(entry => entry.path), [[...parent.path, 0]]);
  const aggregate = authority(mapWithEmptyPage);
  const page = aggregate.libraries().at(-1)!;
  const beforeDetached = aggregate.captureSemanticCheckpoint();
  const source = (text: string) => ({ root: parse_authored_document_library(text).root });
  assert.throws(() => aggregate.prepareScopedDocument(page, source(invocation)), /Detached scoped preparation cannot carry authored interactions/);
  const plain = aggregate.prepareScopedDocument(page, source("<main <i/>/>"));
  assert.throws(() => aggregate.prepareScopedDocumentOperations(plain, [{
    domain: "graph", op: "insert-content", target: parent, index: 0, content: connector(invocation),
  }]), /Detached scoped preparation cannot carry authored interactions/);
  assert.deepEqual(aggregate.captureSemanticCheckpoint(), beforeDetached);
  const revision = mapWithEmptyPage.rev;
  mapWithEmptyPage.addLibraries({ next: { document: invocation } });
  assert.equal(mapWithEmptyPage.rev, revision + 1);
  assert.deepEqual(descriptors(mapWithEmptyPage, "next").map(entry => entry.attrs?.id), ["literal"]);
}

const panel_args = (panel: ReturnType<typeof Hson.data.fromSource>) => Hson.data.fromSource(`<panel ${panel.toHson()}>`);
const runtimeInput = Hson.data.fromSource('<label "dynamic" count -0>');
const runtimeDocument = Hson.document`<main <i/> <hson-part lib="runtimeParts" at="typed" args:data="${runtimeInput.toHson()}"/>/>`;
const runtimeLibraries = {
  page: { document: runtimeDocument, access: "shared" },
  privatePage: { document: '<hson-part lib="runtimeParts" at="hidden"/>', access: "private" },
  runtimeParts: { access: "private", parts: { typed, literal, hidden: { ...literal,
    events: { advance: advance.replace("ADVANCE_SLIDE", "PRIVATE_INTERACTION_SENTINEL") } } } },
} as const;

function local_library_cases() {
  const map = hsonLiveMap.create(), aggregate = authority(map);
  const initialSystem = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  assert.ok(initialSystem);
  const ordinary = map.addLibraries({ anchor: { document: "<aside/>" }, state: { json: { value: 0 } } });
  assert.match(ordinary.libraries.anchor.render(), /<aside/);
  ordinary.libraries.state.at(["value"]).set(1);
  const parts = map.addLibraries({ runtimeParts: { parts: runtimeLibraries.runtimeParts.parts } });
  assert.equal(map.rev, 3);
  assert.equal(aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY), initialSystem);
  const interactive = map.addLibraries({ page: { document: runtimeDocument } });
  assert.equal(map.rev, 4);
  assert.deepEqual(descriptors(map).map(entry => entry.attrs?.class), ["one", "two"]);
  assert.ok(descriptors(map).every(entry => entry.data?.equals(panel_args(runtimeInput))));
  const replica = hsonLiveMap.create();
  replica.replay(ordinary.commit);
  replica.data.must("state").at(["value"]).set(1);
  replica.replay(parts.commit);
  assert.throws(() => replica.replay(interactive.commit), /Library transport has unknown or missing fields/);
  assert.equal(replica.rev, parts.commit.rev);
  assert.throws(() => replica.doc.must("page"));
  replica.addLibraries({ page: { document: runtimeDocument } });
  assert.ok(descriptors(replica).every(entry => entry.data?.equals(panel_args(runtimeInput))));
}

async function live_library_projection_cases() {
  const map = hsonLiveMap.fromLibraries({ anchor: { document: "<aside/>" }, parts: collection });
  const aggregate = authority(map);
  const select = (libraries: readonly string[], interactions: boolean) => {
    const registry = aggregate.hostedRegistry();
    const catalog = registry.libraries.filter(entry => entry.scope === undefined).map(({ name }) => ({ name,
      ownership: name === "anchor" || name === "page" ? "shared" as const : "private" as const }));
    return normalize_locus_effective_projection(make_locus_hosted_projection_policy(registry,
      aggregate.hostedPosition().authority, catalog, undefined, ({ requested }) => requested), {
      libraries, systemFeatures: interactions ? ["interactions"] : [],
    });
  };
  const client = async (interactions: boolean) => create_echo_scoped_replica_internal(
    capture_selected_authority_projection_snapshot(map, await select(["anchor"], interactions), true),
    local_initializers({ localDoc: { document: "<aside/>" } }));
  const enabled = await client(true), featureless = await client(false);
  const ids = (receiver: LiveMap) => {
    const a = authority(receiver), system = a.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
    assert.ok(system);
    return descriptor_data(a.systemRoot(system)).map(entry => new Map(entry.entries()).get("id")?.scalar());
  };
  try {
    for (const receiver of [enabled.map, featureless.map]) {
      assert.ok(receiver);
      add_interaction(receiver, { id: "local-descriptor", kind: "browser", key: "LOCAL_BEHAVIOR", args: Hson.data.from(null),
        subject: { library: "localDoc", path: [99] }, listener: { event: "click", target: "element", capture: false,
          once: false, passive: false, missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } });
    }
    let hosted: HostedAggregateCommit | undefined;
    const off = aggregate.observe(commit => { hosted = commit.hosted; });
    const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!;
    const beforeSystem = aggregate.systemRoot(system);
    map.addLibraries({ page: { document: runtimeDocument }, privatePage: { document: runtimeLibraries.privatePage.document },
      runtimeParts: { parts: runtimeLibraries.runtimeParts.parts } });
    off();
    assert.ok(hosted);
    const names = ["anchor", "page", "privatePage", "runtimeParts"];
    const capable = project_locus_live_transition_internal(hosted, await select(names, true),
      beforeSystem, aggregate.systemRoot(system));
    const plain = project_locus_live_transition_internal(hosted, await select(names, false));
    assert.equal(capable.kind, "commit");
    assert.equal(plain.kind, "commit");
    assert.ok(capable.commit.topology?.operation.interactionAdds);
    assert.ok(plain.commit.topology);
    assert.deepEqual(capable.commit.topology.operation.libraries.map(entry => entry.name), ["page"]);
    assert.doesNotMatch(JSON.stringify(capable), /PRIVATE_INTERACTION_SENTINEL|privatePage|runtimeParts|local-descriptor/);
    assert.equal(plain.commit.topology.operation.interactionAdds, undefined);
    assert.doesNotMatch(JSON.stringify(plain), /OPEN_PANEL|canonical-interactions/);

    assert.ok(enabled.map && featureless.map);
    const rejected = authority(featureless.map), before = rejected.captureSemanticCheckpoint();
    const expectedIds = [...descriptors(map).map(entry => entry.id), "local-descriptor"];
    assert.throws(() => featureless.installProjectedTopology(capable.commit.topology!, plain.commit.registryDigest), /interactions feature/);
    assert.deepEqual(rejected.captureSemanticCheckpoint(), before);
    assert.throws(() => featureless.map!.doc.must("page"));
    featureless.installProjectedTopology(plain.commit.topology, plain.commit.registryDigest);
    assert.deepEqual(ids(featureless.map), ["local-descriptor"]);

    const enabledMap = enabled.map;
    const { logicalMapId, incarnationId } = capable.commit.authority;
    const wire = JSON.parse(JSON.stringify({ format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT, logicalMapId, incarnationId,
      registryDigest: capable.commit.registryDigest, commit: capable.commit }));
    const previous = enabled.clientProjection();
    assert.ok(previous);
    const decoded = decode_locus_live_projected_envelope_internal(wire, { logicalMapId, incarnationId, registryDigest: previous.registry.digest });
    assert.ok(decoded.topology);
    let observed: unknown;
    const stop = authority(enabledMap).observe(() => { observed = [enabledMap.doc.must("page").mode, ids(enabledMap)]; });
    try { enabled.installProjectedTopology(decoded.topology, decoded.registryDigest); }
    finally { stop(); }
    enabled.advanceHostedProgress({ logicalMapId, incarnationId, registryDigest: decoded.registryDigest, prevRev: decoded.prevRev, rev: decoded.rev });
    assert.deepEqual(observed, ["document", expectedIds]);
    assert.ok(descriptors(enabledMap).every(entry => entry.data?.equals(panel_args(runtimeInput))));
    assert.equal(enabled.clientProjection()?.registry.digest, decoded.registryDigest);
    assert.equal(enabled.clientProjection()?.revision, decoded.rev);
  } finally { enabled.dispose(); featureless.dispose(); }
}

async function hosted_library_cases() {
  const entered = deferred(), release = deferred();
  let holdAppend = false;
  const persistence = new class extends MemoryCheckpointAdapter {
    override async appendCommit(record: LocusHostedAggregatePersistedCommit) {
      if (holdAppend) { entered.resolve(); await release.promise; }
      return super.appendCommit(record);
    }
  }();
  const startup = { anchor: { document: "<aside/>", access: "shared" }, state: { json: { value: 0 } } } as const;
  const config = { logicalMapId: "dynamic-interactions", persistence,
    authorizeProjection: ({ requested }: { requested: import("../../src/types/locus.projection.types.ts").LocusRequestedProjection }) => requested };
  const locus = await hsonLiveMap.locus.resume(startup, config);
  const map = locus_map_internal(locus), aggregate = authority(map);
  const initial = aggregate.captureSemanticCheckpoint(), epoch = aggregate.identityEpoch().current();
  const issued = aggregate.identityEpoch().issued(), registry = aggregate.hostedRegistry();
  const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  assert.ok(system);
  const anchor = locus.doc.must("anchor");
  const session = await locus.session.create({ libraries: ["anchor"], systemFeatures: ["interactions"] });
  const before = session.now();
  const durableBefore = persistence.state(config.logicalMapId);
  assert.ok(before.libs.system);
  assert.ok(durableBefore?.checkpoint.registry.libraries.some(entry => entry.scope === "hson-internal"));
  const published: Array<{ topology: HostedAggregateCommit["topology"]; descriptors: number }> = [];
  const off = aggregate.observe(commit => published.push({ topology: commit.hosted?.topology,
    descriptors: descriptors(map).length }));
  const unchanged = () => {
    assert.deepEqual(aggregate.captureSemanticCheckpoint(), initial);
    assert.equal(aggregate.hostedRegistry(), registry);
    assert.equal(aggregate.identityEpoch().issued(), issued);
    assert.equal(aggregate.identityEpoch().current(), epoch);
    assert.equal(aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY), system);
    assert.equal(locus.doc.must("anchor"), anchor);
    assert.throws(() => locus.doc.must("page"));
    assert.throws(() => locus.parts.must("runtimeParts"));
    assert.deepEqual(session.now(), before);
    assert.equal(published.length, 0);
    assert.deepEqual(persistence.state(config.logicalMapId), durableBefore);
  };
  let expected: ReturnType<typeof descriptors>;
  try {
    await assert.rejects(locus.admit({ anchorCopy: { document: "<aside/>" }, bad: { parts: { invalid: { ...literal,
      events: { advance: advance.replace("once", "unknownOption") } } } } }), /Unsupported authored event header/);
    unchanged();
    await assert.rejects(locus.admit({ ...runtimeLibraries,
      page: { document: '<hson-part lib="runtimeParts" at="typed"/>', access: "shared" } }), /missing/);
    unchanged();

    // Force a Descriptor collision only after the new Documents have staged their QUIDs.
    const ownRandom = Object.getOwnPropertyDescriptor(crypto, "getRandomValues"), random = crypto.getRandomValues.bind(crypto);
    let identities = 0, descriptorIds = 0;
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value(bytes: Uint8Array) {
      if (bytes.length === 16) { descriptorIds++; return bytes.fill(0); }
      if (bytes.length === 6) identities++;
      return random(bytes);
    } });
    try { await assert.rejects(locus.admit(runtimeLibraries), /descriptor ID.*duplicated/); }
    finally {
      if (ownRandom === undefined) Reflect.deleteProperty(crypto, "getRandomValues");
      else Object.defineProperty(crypto, "getRandomValues", ownRandom);
    }
    assert.ok(identities > 0);
    assert.equal(descriptorIds, 3);
    unchanged();

    persistence.failAppend = new Error("declined topology append");
    await assert.rejects(locus.admit(runtimeLibraries), /durably append/);
    unchanged();
    holdAppend = true;
    const pending = locus.admit(runtimeLibraries);
    try { await Promise.race([entered.promise, pending]); unchanged(); }
    finally { release.resolve(); }
    await pending;
    assert.equal(locus.rev, initial.revision + 1);
    assert.equal(published.length, 1);
    assert.equal(published[0]?.descriptors, 2);
    assert.equal(aggregate.identityEpoch().current(), epoch);
    expected = descriptors(map);
    assert.deepEqual(expected.map(entry => entry.path), [[...parent.path, 1, 0, 0], [...parent.path, 1, 0, 1]]);
    assert.deepEqual(expected.map(entry => entry.attrs?.class), ["one", "two"]);
    assert.equal(new Set([...expected, ...descriptors(map, "privatePage")].map(entry => entry.id)).size, 3);
    assert.ok(expected.every(entry => entry.data?.equals(panel_args(runtimeInput))));
    const accepted = persistence.state(config.logicalMapId)?.commits.at(-1)?.commit;
    assert.equal(accepted?.previousRegistryDigest, registry.digest);
    assert.equal(accepted?.registryDigest, aggregate.hostedRegistry().digest);
    assert.deepEqual(accepted?.topology, published[0]?.topology);
    assert.deepEqual(accepted?.topology?.operation.libraries.map(entry => entry.name), ["page", "privatePage", "runtimeParts"]);
    assert.ok(accepted?.topology?.operation.interactionAdds);
    assert.deepEqual(accepted?.operations, []);

    await session.update({ libraries: ["anchor", "page", "privatePage"], systemFeatures: ["interactions"] });
    const selected = session.now().libs;
    assert.deepEqual(selected.libraries.map(entry => entry.name), ["anchor", "page"]);
    assert.ok(selected.system);
    assert.equal(descriptor_data(decode_hosted_root(selected.system.interactions)).length, 2);
    assert.doesNotMatch(JSON.stringify(selected), /PRIVATE_INTERACTION_SENTINEL|runtimeParts|privatePage/);
    const featureless = await locus.session.create({ libraries: ["page"] });
    assert.equal(featureless.now().libs.system, null);
  } finally { off(); locus.dispose(); }

  const evidence = (entries: ReturnType<typeof descriptors>) => entries.map(({ data, ...entry }) => [entry, data?.toHson()]);
  const saved = persistence.state(config.logicalMapId);
  assert.ok(saved);
  const malformed = structuredClone(saved), effect = malformed.commits.at(-1)?.commit.topology?.operation;
  assert.ok(effect?.interactionAdds);
  Reflect.set(effect, "interactionAdds", { format: "hson-exact-value", payload: "malformed" });
  persistence.seed(config.logicalMapId, malformed);
  await assert.rejects(hsonLiveMap.locus.resume(startup, config), { code: "LOCUS_PERSISTED_STATE_INVALID" });
  persistence.seed(config.logicalMapId, saved);
  const replayed = await hsonLiveMap.locus.resume(startup, config);
  try {
    assert.deepEqual(evidence(descriptors(locus_map_internal(replayed))), evidence(expected));
    persistence.failPrune = new Error("interrupted after checkpoint activation");
    await assert.rejects(hsonLiveMap.locus.checkpoint(replayed), { code: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" });
    assert.equal(persistence.state(config.logicalMapId)?.checkpoint.rev, replayed.rev);
    assert.equal(persistence.state(config.logicalMapId)?.commits.length, 1);
  } finally { replayed.dispose(); }
  const checkpointed = await hsonLiveMap.locus.resume(startup, config);
  try {
    const restored = locus_map_internal(checkpointed);
    assert.deepEqual(evidence(descriptors(restored)), evidence(expected));
    await hsonLiveMap.locus.checkpoint(checkpointed);
    assert.deepEqual(persistence.state(config.logicalMapId)?.commits, []);
    await checkpointed.stage(stage => stage.doc.must("page").content.move(parent, 1, 0));
    const moved = descriptors(restored);
    assert.deepEqual(moved.map(entry => entry.id), expected.map(entry => entry.id));
    assert.deepEqual(moved.map(entry => entry.path), [[...parent.path, 0, 0, 0], [...parent.path, 0, 0, 1]]);
    await checkpointed.stage(stage => stage.doc.must("page").content.replace(parent, 0,
      connector('<hson-part lib="runtimeParts" at="literal"/>')));
    const replaced = descriptors(restored);
    assert.equal(replaced.length, 1);
    assert.ok(!moved.some(entry => entry.id === replaced[0]?.id));
    assert.equal(replaced[0]?.attrs?.id, "literal");
    await checkpointed.stage(stage => stage.doc.must("page").content.remove(parent, 0));
    assert.deepEqual(descriptors(restored), []);
    assert.equal(descriptors(restored, "privatePage").length, 1);
  } finally { checkpointed.dispose(); }
}

async function accumulated_root_cases() {
  const text = "x".repeat(756_000);
  const document = `<hson-part lib="parts" at="incoming" text="${text}"/>`;
  const startup = { parts: collection, state: { json: { value: 0 } } };
  const overLimit = { code: "VIEW_STATE_SNAPSHOT_PAYLOAD_TOO_LARGE" };
  const rootBound = 4 * 1_024 * 1_024;
  const bytes = (root: { payload: string }) => new TextEncoder().encode(root.payload).byteLength;
  const local = hsonLiveMap.fromLibraries(startup);
  const localAuthority = authority(local);
  const localSystem = localAuthority.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!;
  let lastDeltaBytes = 0;
  const stop = localAuthority.observe(commit => {
    const delta = commit.hosted?.topology?.operation.interactionAdds;
    if (delta !== undefined) lastDeltaBytes = bytes(delta);
  });
  try {
    for (let index = 0; index < 5; index++) local.addLibraries({ [`page${index}`]: { document } });
    const installed = localAuthority.systemRoot(localSystem);
    const acceptedRoot = encode_hosted_root(installed);
    const acceptedBytes = bytes(acceptedRoot);
    assert.ok(acceptedBytes < rootBound && lastDeltaBytes < rootBound && acceptedBytes + lastDeltaBytes > rootBound);
    const ledger = localAuthority.identityEpoch().issued(), registry = localAuthority.hostedRegistry();
    const publication = localAuthority.telemetry().aggregatePublications;
    assert.throws(() => local.addLibraries({ overflow: { document } }), overLimit);
    assert.equal(local.rev, 5);
    assert.equal(localAuthority.hostedRegistry(), registry);
    assert.equal(localAuthority.systemRoot(localSystem), installed);
    assert.equal(encode_hosted_root(localAuthority.systemRoot(localSystem)).payload, acceptedRoot.payload);
    assert.equal(localAuthority.identityEpoch().issued(), ledger);
    assert.equal(localAuthority.telemetry().aggregatePublications, publication);
    assert.throws(() => local.doc.must("overflow"), /Unknown LiveMap Library/);
    local.data.state.at(["value"]).set(1);
    local.addLibraries({ ordinary: { document: "<main/>" } });
    assert.equal(local.rev, 7);
  } finally { stop(); }

  const persistence = new MemoryCheckpointAdapter();
  const config = { persistence, logicalMapId: "authored-root-bound" };
  const locus = await hsonLiveMap.locus.resume(startup, config);
  const map = locus_map_internal(locus), aggregate = authority(map);
  const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!;
  let expected: string;
  try {
    for (let index = 0; index < 5; index++) await locus.admit({ [`page${index}`]: { document } });
    const installed = aggregate.systemRoot(system);
    expected = encode_hosted_root(installed).payload;
    const issued = aggregate.identityEpoch().issued(), epoch = aggregate.identityEpoch().current();
    const position = aggregate.hostedPosition(), registry = aggregate.hostedRegistry();
    const durable = persistence.state(config.logicalMapId);
    const appends = persistence.appendCalls.length, publication = aggregate.telemetry().aggregatePublications;
    await assert.rejects(locus.admit({ overflow: { document } }), overLimit);
    assert.deepEqual(aggregate.hostedPosition(), position);
    assert.equal(aggregate.hostedRegistry(), registry);
    assert.equal(aggregate.systemRoot(system), installed);
    assert.equal(encode_hosted_root(aggregate.systemRoot(system)).payload, expected);
    assert.equal(aggregate.identityEpoch().issued(), issued);
    assert.equal(aggregate.identityEpoch().current(), epoch);
    assert.equal(aggregate.telemetry().aggregatePublications, publication);
    assert.equal(persistence.appendCalls.length, appends);
    assert.deepEqual(persistence.state(config.logicalMapId), durable);
    await locus.stage(stage => stage.data.state.at(["value"]).set(1));
    await locus.admit({ ordinary: { document: "<main/>" } });
    assert.equal(locus.rev, 7);
  } finally { locus.dispose(); }

  const resumed = await hsonLiveMap.locus.resume(startup, config);
  try {
    const restored = authority(locus_map_internal(resumed));
    const root = restored.systemRoot(restored.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!);
    assert.equal(encode_hosted_root(root).payload, expected);
    assert.equal(resumed.rev, 7);
    assert.equal(resumed.data.state.snap(["value"]), 1);
    assert.equal(resumed.doc.must("ordinary").mode, "document");
    assert.throws(() => resumed.doc.must("overflow"), /Unknown LiveMap Library/);
    await resumed.stage(stage => stage.data.state.at(["value"]).set(2));
    assert.equal(resumed.rev, 8);
  } finally { resumed.dispose(); }
}

async function durable_cases() {
  const page = { document: "<main <i/>/>", access: "shared" } as const;
  const plain = { kind: "document", document: "<aside hson:part/>" } as const;
  const definitions = { parts: { parts: { plain, ...collection.parts } }, page };
  const subset = { parts: { parts: { plain } }, page };
  const persistence = new class extends MemoryCheckpointAdapter {
    loads = 0;
    failLoad: Error | undefined;
    override async load(logicalMapId: string) {
      this.loads++;
      if (this.failLoad !== undefined) throw this.failLoad;
      return super.load(logicalMapId);
    }
  }();
  const unsupported = hsonLiveMap.fromLibraries({ parts: subset.parts, page: { document: page.document } });
  const unsupportedAuthority = authority(unsupported);
  const { authority: fence } = unsupportedAuthority.hostedPosition();
  const captured = unsupportedAuthority.captureSemanticCheckpoint();
  await write_semantic_checkpoint(captured, persistence);
  const valid = persistence.state(fence.logicalMapId)!;
  const registry = registry_from_entries(captured.registry.libraries.filter(entry => entry.scope === undefined));
  const saved = { ...valid, checkpoint: { ...valid.checkpoint, registryDigest: registry.digest,
    registry: { ...valid.checkpoint.registry, digest: registry.digest,
      libraries: valid.checkpoint.registry.libraries.filter(entry => entry.scope === undefined) },
    chunks: valid.checkpoint.chunks.filter(entry => entry.owner !== INTERACTION_RESERVED_LIBRARY_KEY) } };
  persistence.seed(fence.logicalMapId, saved);
  await assert.rejects(hsonLiveMap.locus.resume(subset, { logicalMapId: fence.logicalMapId, persistence }),
    { code: "LOCUS_PERSISTED_STATE_INVALID", message: /required canonical interaction binding/ });
  assert.deepEqual(persistence.state(fence.logicalMapId), saved);

  const activeConfig = { persistence, logicalMapId: "authored-active-slot" };
  const fresh = await hsonLiveMap.locus.resume(definitions, activeConfig);
  const activeMap = locus_map_internal(fresh);
  const first = await (async () => {
    try {
      assert.deepEqual(descriptors(activeMap), []);
      await fresh.stage(writer => writer.doc.page.content.insert(parent, 0, connector(invocation)));
      const firstId = descriptors(activeMap)[0]?.id;
      assert.ok(firstId);
      await fresh.stage(writer => writer.doc.page.content.insert(parent, 1, connector(invocation.replace('at="literal"', 'at="withoutInput"'))));
      assert.deepEqual(descriptors(activeMap).map(entry => entry.id === firstId), [true, false]);
      assert.equal(descriptors(activeMap)[1]?.data, undefined);
      return authority(activeMap).captureSemanticCheckpoint();
    } finally { fresh.dispose(); }
  })();
  const before = persistence.state(activeConfig.logicalMapId);
  assert.equal(before?.commits.length, 2);
  const loads = persistence.loads;
  const writes = [persistence.checkpointCalls.length, persistence.appendCalls.length];
  const schemaConflict = { ...subset, page: { ...page, schema: Hson.schema`<type "document" tag "html">` } };
  await assert.rejects(hsonLiveMap.locus.resume(schemaConflict, activeConfig), /conflicts with durable topology/);
  await assert.rejects(hsonLiveMap.locus.resume({ ...subset, parts: { parts: { plain: { ...plain, document: "<p hson:part/>" } } } },
    activeConfig), /Immutable Part.*durable resume/);
  const loadError = new Error("load failed");
  persistence.failLoad = loadError;
  await assert.rejects(hsonLiveMap.locus.resume(subset, activeConfig), {
    code: "LOCUS_PERSISTENCE_LOAD_FAILED", cause: loadError,
  });
  assert.equal(persistence.loads, loads + 3);
  assert.deepEqual(persistence.state(activeConfig.logicalMapId), before);
  assert.deepEqual([persistence.checkpointCalls.length, persistence.appendCalls.length], writes);
  persistence.failLoad = undefined;

  for (const explicit of [false, true]) {
    let reads = 0;
    const startup = new Proxy(subset, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
    const loads = persistence.loads;
    const again = await hsonLiveMap.locus.resume(startup, explicit ? { ...activeConfig, interactions: [] } : activeConfig);
    try {
      assert.equal(reads, 2);
      assert.equal(persistence.loads, loads + 1);
      assert.deepEqual(authority(locus_map_internal(again)).captureSemanticCheckpoint(), first);
      assert.equal(descriptors(locus_map_internal(again))[1]?.data, undefined);
      assert.deepEqual(persistence.state(activeConfig.logicalMapId), before);
      if (explicit) await hsonLiveMap.locus.checkpoint(again);
    } finally { again.dispose(); }
  }
  assert.deepEqual(persistence.state(activeConfig.logicalMapId)?.commits, []);
  const compacted = await hsonLiveMap.locus.resume(subset, activeConfig);
  try {
    assert.deepEqual(authority(locus_map_internal(compacted)).captureSemanticCheckpoint(), first);
    assert.equal(descriptors(locus_map_internal(compacted))[1]?.data, undefined);
  }
  finally { compacted.dispose(); }
}

export async function authored_event_cases(): Promise<void> {
  grammar_cases();
  event_reference_ranges();
  event_reference_comments();
  forwarded_event_cases();
  iterator_event_arguments();
  await native_event_cases();
  await covered_event_recovery_cases();
  await composition_cases();
  local_library_cases();
  await live_library_projection_cases();
  await hosted_library_cases();
  await accumulated_root_cases();
  await durable_cases();
}

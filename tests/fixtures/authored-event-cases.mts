import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform, type LiveMap, type LiveMapDocumentPart } from "../../src/index.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { make_livemap_mirror_from_semantic_checkpoint_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { resolve_document_path, validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../src/internal/interaction-storage.ts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { hson_data_from_value } from "../../src/api/data/hson-data.ts";
import { projected_value_from_hson_node } from "../../src/core/projected-value-graph.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { read_transform_error_details } from "../../src/core/errors.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { plan_browser_realization } from "../../src/internal/browser-realization/browser-realization-plan.ts";
import { assertCanonicalClosure, assertCanonicalSerializedClosure, TransformOracleAssertionError } from "../../src/diagnostics/transform-test-oracle.ts";
import type { HsonNode } from "../../src/core/types.ts";

const advance = "<hson:event once stopProp on:click host:ADVANCE_SLIDE input:data={<step 3>} <> >";
const literal = { kind: "document", document: Hson.document`<button hson:part event:advance id="literal" "Next"/>`,
  events: { advance } } satisfies LiveMapDocumentPart;
const typed = { kind: "document", document: Hson.document`<section hson:part data:args=%{args}
  <button event:advance class="one"/> <button event:advance class="two"/>/>`,
  events: { advance: "<hson:event on:click local:OPEN_PANEL input:data=^{args} <> >" } } satisfies LiveMapDocumentPart;
const incoming = { kind: "document", document: Hson.document`<button hson:part event:advance id="incoming"/>`,
  events: { advance: "<hson:event on:click local:OPEN_PANEL input:data=%{text} <> >" } } satisfies LiveMapDocumentPart;
const collection = { parts: { literal, typed, incoming } };
const invocation = '<hson-part lib="parts" at="literal"/>';
const connector = (source: string) => {
  const node = hsonTransform.fromHson(source).toNode().$_content[0];
  assert.ok(is_Node(node));
  return node;
};
const parent = { kind: "path", path: validate_document_path([0, 0, 1, 0, 0, 0]) } as const;
const authority = internal_livemap_aggregate_authority;

function descriptors(map: LiveMap) {
  const system = authority(map).systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  assert.ok(system);
  const value = hson_data_from_value(projected_value_from_hson_node(authority(map).systemRoot(system)));
  const entries = value.entries()?.find(([key]) => key === "descriptors")?.[1].items();
  assert.ok(entries);
  return entries.map(entry => {
    const fields = new Map(entry.entries());
    const subject = new Map(fields.get("subject")?.entries());
    const path = validate_document_path(subject.get("path")?.materialize());
    const library = subject.get("library")?.scalar();
    assert.equal(library, "page");
    const node = resolve_document_path(map.doc.must("page").root(), "document", path);
    assert.ok(is_Node(node) && node.$_tag === "button");
    assert.equal(Object.hasOwn(node.$_attrs ?? {}, "event:advance"), false);
    return { id: fields.get("id")?.scalar(), path: [...path], attrs: node.$_attrs,
      listener: fields.get("listener")?.materialize(), kind: fields.get("kind")?.scalar(),
      key: fields.get("key")?.scalar(), data: fields.get("payload") ?? fields.get("args") };
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
    event: "click", target: "element", capture: false, once: true, passive: false, missingTarget: "ignore",
    preventDefault: false, stopPropagation: true, stopImmediatePropagation: false,
  });
  assert.ok(literalDescriptor.data?.equals(Hson.data.from({ step: 3 })));
  assert.equal(descriptors(admit(advance.replace("{<step 3>}", "{null}")))[0]?.data?.scalar(), null);
  assert.equal(descriptors(admit(advance.replace("{<step 3>}", '{"<step 3>"}')))[0]?.data?.scalar(), "<step 3>");
  assert.equal(descriptors(admit(advance.replace("{<step 3>}", "{-0}")))[0]?.data?.scalar(), -0);

  for (const [source, diagnostic] of [
    [advance.replace("once", "capture"), /Unsupported authored event header/],
    [advance.replace("once", 'once="once"'), /Only input:data takes a value/],
    [advance.replace("once", "once once"), /Duplicate authored event header/],
    [advance.replace("on:click", "on:click on:click"), /Duplicate authored event header/],
    [advance.replace("on:click", "on:click on:keydown"), /exactly one on:/],
    [advance.replace("host:ADVANCE_SLIDE", "host:ADVANCE_SLIDE local:OPEN_PANEL"), /exactly one host:/],
    [advance.replace("<> ", ""), /requires an outcome object/],
    [advance.replace("<>", "<> <>"), /single authored event outcome object/],
    [advance.replace("<>", "<success local:SHOW_SAVED>"), /Nonempty authored event outcomes.*Use <>/],
    [advance.replace("input:data={<step 3>} ", ""), /requires explicit input:data/],
    [advance.replace("{<step 3>}", '"<step 3>"'), /one whole Part reference/],
    [advance.replace("{<step 3>}", "{1 2}"), /one Hson Data value/],
    [advance.replace("{<step 3>}", "{<button/>}"), /element-mode value/],
    [advance.replace("{<step 3>}", "{<@000008398 step 3>}"), /runtime QUID/],
    [advance.replace("hson:event", "'hson:event'"), /literal <hson:event/],
    [advance + advance, /exactly one authored event declaration/],
    [advance.replace("{<step 3>}", "^{undeclared}"), /Missing Part local declaration/],
    [advance.replace("{<step 3>}", "%{args.field}"), /Structured Part inputs/],
  ] as const) assert.throws(() => admit(source), diagnostic);

  const conflict = advance.replace("host:ADVANCE_SLIDE", "host:ADVANCE_SLIDE local:OPEN_PANEL");
  assert.throws(() => admit(conflict), error => {
    const details = error instanceof Error ? read_transform_error_details(error.cause) : undefined;
    return details?.source?.index === conflict.indexOf("local:") && details.related?.[0]?.source.index === conflict.indexOf("host:");
  });
  const missing = advance.replace("{<step 3>}", "^{undeclared}");
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
  assert.throws(() => admit(advance.replace("host:ADVANCE_SLIDE", "host:")), /Expected a behavior name/);
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
  input:data=${expression} <> >`;
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
      assert.deepEqual(details?.source, { index: start, line: 2, column: 14 });
      assert.deepEqual(details?.related?.find(item => item.role === "value-end")?.source,
        { index: start + expression.length, line: 2, column: 14 + expression.length });
      assert.equal(details?.related?.find(item => item.role === "event-attachment")?.source.index, document.indexOf("event:advance"));
      return true;
    });
  }
  assert.deepEqual(descriptors(compose(declaration, "<missing 2>")).map(descriptor => descriptor.data?.scalar()), [1, 2]);
  const optional = declaration.replace(expression, "^{args.missing?}");
  assert.equal(descriptors(compose(optional, "<missing 2>")).length, 2);
  assert.throws(() => compose(optional, "<>"), /input:data must resolve to present Data/);
  const malformed = "^{args.missing.}";
  assert.throws(() => compose(declaration.replace(expression, malformed), "<>"), error => {
    const details = error instanceof Error ? read_transform_error_details(error.cause) : undefined;
    return details?.source?.index === start
      && details.related?.find(item => item.role === "value-end")?.source.index === start + malformed.length;
  });
}

function forwarded_event_cases() {
  const map = hsonLiveMap.fromLibraries({ parts: { parts: {
    leaf: { kind: "document", document: '<button hson:part part:optional data:args=%{args} event:advance/>',
      events: { advance: "<hson:event on:click local:OPEN_PANEL input:data=^{args.value?} <> >" } },
    wrap: { kind: "document", document: '<main hson:part data:model=%{model?} <hson-part at="leaf" args:data="^{model?}"/>/>' },
  } }, page: { document: '<hson-part lib="parts" at="wrap" model:data="<value -0>"/>' } });
  assert.equal(descriptors(map)[0]?.data?.scalar(), -0);
  assert.doesNotThrow(() => map.parts.parts.leaf.write());
  assert.throws(() => map.parts.parts.leaf.write({ other: true }), /unexpected/);
  const without = hsonLiveMap.fromLibraries({ parts: { parts: {
    leaf: { ...map.parts.parts.leaf.snap()!, kind: "document" },
  } }, page: { document: '<main <hson-part lib="parts" at="leaf"/>/>' } });
  assert.deepEqual(descriptors(without), []);
  assert.doesNotMatch(without.doc.page.render(), /button/);
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
    const initialRev = locus.rev;
    const beforeTopology = authority(map).captureSemanticCheckpoint();
    await assert.rejects(locus.admit({ unsupported: { document: invocation, access: "shared" } }), /topology changes cannot carry authored events/);
    assert.equal(locus.rev, initialRev);
    assert.deepEqual(authority(map).captureSemanticCheckpoint(), beforeTopology);
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
      assert.ok(descriptor.data?.equals(expected));
    }
    assert.equal(all[5]?.data?.scalar(), "<step 3>");
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
  assert.throws(() => mapWithEmptyPage.addLibraries({ unsupported: { document: invocation } }), /topology changes cannot carry authored events/);
  assert.equal(mapWithEmptyPage.rev, revision);
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
  const config = { logicalMapId: "authored-no-slot", persistence };
  const empty = await hsonLiveMap.locus.resume({ parts: { parts: {} }, page }, config);
  try {
    assert.equal(authority(locus_map_internal(empty)).systemState(INTERACTION_RESERVED_LIBRARY_KEY), undefined);
    await empty.parts.must("parts").at([]).set(definitions.parts.parts);
  } finally { empty.dispose(); }
  const restored = await hsonLiveMap.locus.resume(definitions, config);
  try {
    const map = locus_map_internal(restored), before = authority(map).captureSemanticCheckpoint();
    assert.equal(authority(map).systemState(INTERACTION_RESERVED_LIBRARY_KEY), undefined);
    assert.equal(restored.parts.parts.literal.snap()?.document, literal.document);
    await assert.rejects(restored.stage(writer => writer.doc.page.content.insert(parent, 0, connector(invocation))), /require canonical interactions/);
    assert.deepEqual(authority(map).captureSemanticCheckpoint(), before);
  } finally { restored.dispose(); }
  await assert.rejects(hsonLiveMap.locus.resume(definitions, { ...config, interactions: [] }), /conflicts with durable topology/);
  await assert.rejects(hsonLiveMap.locus.resume({ ...definitions, page: { ...page, document: invocation } }, config), /conflicts with durable topology/);
  await assert.rejects(hsonLiveMap.locus.resume({ ...definitions, page: { ...page, schema: Hson.schema`<type "document" tag "html">` } }, config),
    /conflicts with durable topology/);
  await assert.rejects(hsonLiveMap.locus.resume({ ...definitions, parts: { parts: { ...collection.parts, literal: {
    ...literal, events: { advance: advance.replace("ADVANCE_SLIDE", "deck.advance") },
  } } } }, config), /Immutable Part.*durable resume/);

  const activeConfig = { ...config, logicalMapId: "authored-active-slot" };
  const fresh = await hsonLiveMap.locus.resume(definitions, activeConfig);
  const activeMap = locus_map_internal(fresh);
  const first = await (async () => {
    try {
      assert.deepEqual(descriptors(activeMap), []);
      await fresh.stage(writer => writer.doc.page.content.insert(parent, 0, connector(invocation)));
      const firstId = descriptors(activeMap)[0]?.id;
      assert.ok(firstId);
      await fresh.stage(writer => writer.doc.page.content.insert(parent, 1, connector(invocation)));
      assert.deepEqual(descriptors(activeMap).map(entry => entry.id === firstId), [true, false]);
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
      assert.deepEqual(persistence.state(activeConfig.logicalMapId), before);
      if (explicit) await hsonLiveMap.locus.checkpoint(again);
    } finally { again.dispose(); }
  }
  assert.deepEqual(persistence.state(activeConfig.logicalMapId)?.commits, []);
  const compacted = await hsonLiveMap.locus.resume(subset, activeConfig);
  try { assert.deepEqual(authority(locus_map_internal(compacted)).captureSemanticCheckpoint(), first); }
  finally { compacted.dispose(); }
}

export async function authored_event_cases(): Promise<void> {
  grammar_cases();
  event_reference_ranges();
  forwarded_event_cases();
  await composition_cases();
  await durable_cases();
}

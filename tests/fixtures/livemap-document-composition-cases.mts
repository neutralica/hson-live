import assert from "node:assert/strict";
import { realize_document } from "../../src/internal/document-cut.ts";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { read_livemap_part_internal as readPart, compose_livemap_document_internal as compose,
  prepare_hosted_livemap_library_add_internal as hostedAdd } from "../../src/api/livemap/livemap.libraries.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup, parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options, type DocumentCompositionOptions } from "../../src/api/livemap/livemap.document.composition.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { ROOT_TAG, ELEM_TAG, STR_TAG, VAL_TAG } from "../../src/core/constants.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { overwrite_hson_node } from "../../src/api/livemap/livemap.editor.ts";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.ts";
import { livemap_document_identity_effects_for, type LiveMapDocumentIdentityEffect } from "../../src/api/livemap/livemap.document.identity.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapGraphOp } from "../../src/types/livemap.types.ts";
import { styled_composition_cases } from "./livemap-styled-composition-cases.mts";
import { document_css_state_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";

export const part = (document: string, css?: string) => ({ kind: "document" as const, document, ...(css === undefined ? {} : { stylesheet: css }) });
export const doc = (map: LiveMap, name = "page"): LiveMapDocumentLibrary => {
  const selected = map.doc.must(name); if (selected.mode !== "document") throw Error("document"); return selected;
};
export const element = (source: string): HsonNode => {
  const first = hsonTransform.fromHson(source).toNode().$_content[0]; if (!is_Node(first)) throw Error("element"); return first;
};
export function atomic(map: LiveMap, run: () => unknown, reason?: RegExp) {
  const aggregate = owner(map), capture = () => aggregate.libraries().some(id => aggregate.documentScopes(id) !== undefined)
    ? aggregate.captureSemanticCheckpoint() : map.capture();
  const before = capture(), ledger = aggregate.identityEpoch().issued();
  const registry = aggregate.hostedRegistry(), epoch = aggregate.identityEpoch(), position = aggregate.hostedPosition();
  const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id));
  const overlays = ids.map((id,index) => registry.libraries[index]?.mode === "document" ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id));
  let events = 0, positions = 0;
  const off = map.commits.observe(() => events++), stop = aggregate.observeAuthorityPosition(() => positions++);
  try { if (reason) assert.throws(run, reason); else assert.throws(run); } finally { off(); stop(); }
  assert.deepEqual(capture(), before); assert.equal(aggregate.identityEpoch().issued(), ledger);
  assert.equal(aggregate.hostedRegistry(), registry); assert.equal(aggregate.identityEpoch(), epoch); assert.deepEqual(aggregate.hostedPosition(), position);
  ids.forEach((id,index) => {
    assert.equal(aggregate.root(id), roots[index]);
    assert.equal(registry.libraries[index]?.mode === "document" ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id), overlays[index]);
  });
  assert.equal(events, 0); assert.equal(positions, 0);
}
function leaves(root: HsonNode): readonly unknown[] {
  return root.$_tag === STR_TAG || root.$_tag === VAL_TAG ? root.$_content : root.$_content.flatMap(child => is_Node(child) ? leaves(child) : [child]);
}
export function document_composition_cases(check: (name: string, run: () => void) => void) {
  check("Part declaration: mandatory root flag, retained source, deferred write and canonical removal", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<button hson:part @:root "%{label}"/>', ':scope{color:red}') } },
      page: { document: '<main/>' } });
    const definition = map.parts.parts.x.snap()!;
    assert.match(definition.document, /hson:part/);
    const before = owner(map).captureSemanticCheckpoint(), issued = owner(map).identityEpoch().issued();
    const connector = map.parts.parts.x.write({ label: 'Save' });
    assert.equal(connector, Hson.document`<hson-part lib="parts" at="x" label="Save"/>`);
    assert.deepEqual(owner(map).captureSemanticCheckpoint(), before);
    assert.equal(owner(map).identityEpoch().issued(), issued);
    assert.deepEqual(map.parts.parts.x.snap(), definition);
    map.addLibraries({ final: { document: Hson.document`<html <head/> <body ${connector}/>/>` } });
    const final = doc(map, 'final'), canonical = Hson.document.fromNode(final.root());
    assert.doesNotMatch(JSON.stringify(final.root()), /hson:part/);
    assert.doesNotMatch(final.render(), /hson:part/);
    const transform = hsonTransform.fromHson(canonical);
    for (const output of [canonical, transform.toJson().serialize(),
      hsonTransform.fromBinary(transform.toBinary().serialize()).toHson().serialize()]) assert.doesNotMatch(output, /hson:part/);
    assert.match(map.parts.parts.x.snap()!.document, /hson:part/);
    for (const document of ['<p/>', '<p part:optional/>', '<p part:optional <b hson:part/>/>',
      '<p hson:part=""/>', '<p hson:part="true"/>', '<p hson:part="hson:part"/>', '<p hson:part=hson:part/>',
      '<p hson:part=/>', '<p HSON:PART/>', '<p hson:part <b HSON:PART/>/>', '<p hson:part hson:part/>', '<p hson:part <b hson:part/>/>',
      '<p hson:part <hson-part hson:part at="x"/>/>']) {
      atomic(map, () => map.addLibraries({ invalid: { parts: { unused: { kind: 'document', document } } } }));
      atomic(map, () => map.parts.parts.x.replace({ kind: 'document', document }));
    }
    // Omission cannot hide invalid definitions, including an uninvoked sibling.
    atomic(map, () => map.addLibraries({ invalid: { parts: {
      omitted: part('<p hson:part part:optional/>'), unused: { kind: 'document', document: '<p/>' },
    } }, omitted: { document: '<hson-part lib="invalid" at="omitted"/>' } }), /hson:part/);
    for (const document of ['<p hson:part/>', '<p HSON:PART/>', '<p Hson:part="x"/>', '<main <p hson:part/>/>', '<hson-part hson:part lib="parts" at="x" label="x"/>']) {
      atomic(map, () => map.addLibraries({ invalid: { document } }), /hson:part/);
    }
    atomic(map, () => doc(map).document.flags.set({ kind: 'path', path: [0] }, 'hson:part'), /construction|reserved|metadata/);
    atomic(map, () => map.addLibraries({ invalid: { document: hsonTransform.fromHson('<p hson:part/>').toNode() } }), /construction|hson:part/);
    const uppercase: HsonNode = { $_tag: ROOT_TAG, $_content: [{ $_tag: 'p', $_attrs: { 'HSON:PART': 'HSON:PART' }, $_content: [] }] };
    atomic(map, () => map.addLibraries({ invalid: { document: uppercase } }), /reserved/);
    assert.throws(() => Hson.document`<p hson:part="hson:part"/>`, /hson:part/);
  });
  check("Part interfaces: prefix-free authoring, explicit transports, namespaces and canonical closure", () => {
    const map = hsonLiveMap.fromLibraries({ components: { parts: {
      button: part('<button hson:part @:root "%{label}"/>', ':scope{color:red}'),
      page: part('<main hson:part model:data="%{model}" control:doc="%{control}" other:data="%{other}" title="%{title}" <h1 "#{model.title}:#{other[0]}"/><hson-part @:slot #{control}/>/>' ),
    } } });
    const control = map.parts.components.button.write({ label: 'Save %{title} #{model.title}' });
    map.parts.components.button.replace(part('<button hson:part @:root "%{label}"/>', ':scope{color:blue}'));
    const model = Hson.data.from({ title: 'Dashboard' }), other = Hson.data.from([false]);
    const source = map.parts.components.page.write({ model, other, control, title: 'Page' });
    assert.equal(source, Hson.document`<hson-part lib="components" at="page" data:model="${model}" data:other="${other}" doc:control="${control}" title="Page"/>`);
    map.addLibraries({ page: { document: source } });
    assert.ok(leaves(doc(map).root()).includes('Dashboard:false'));
    assert.ok(leaves(doc(map).root()).includes('Save %{title} #{model.title}'));
    assert.match(doc(map).css.snapshot(), /color:blue/);
    const state = owner(map).scopedDocumentState(owner(map).libraries()[1]!);
    assert.equal(state.scopes.occurrences.length, 2);
    const canonical = Hson.document.fromNode(doc(map).root());
    const transform = hsonTransform.fromHson(canonical);
    assert.equal(Hson.document.fromNode(hsonTransform.fromJson(transform.toJson().value()).toNode()), canonical);
    assert.equal(Hson.document.fromNode(hsonTransform.fromBinary(transform.toBinary().serialize()).toNode()), canonical);
    assert.doesNotMatch(canonical, /hson-part|:data|:doc/);
    for (const args of [{ 'data:model': model }, { control: false }, { unknown: 'x' }]) assert.throws(() => Reflect.apply(map.parts.components.page.write, undefined, [args]));
    const captured = source;
    map.parts.components.page.replace(part('<main hson:part "%{control}"/>'));
    atomic(map, () => map.addLibraries({ bad: { document: captured } }), /receiving interface|Unknown Part parameter/);
  });

  check("Part Document structure: ordinary source isolation, independent QUAD scopes and repeated invocation", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      pair: part('<main hson:part control:doc="%{control}" <hson-part #{control}/><hson-part #{control}/>/>' ),
      leaf: part('<b hson:part @:root "%{text}"/>', ':scope{color:blue}'),
      forward: part('<section hson:part control:doc="%{control}" <hson-part at="pair" doc:control="#{control}"/>/>' ),
    } } });
    const ordinary = Hson.document`<article @:root <b @:label "%{literal}:#{literal}"/>/>`;
    map.addLibraries({ page: { document: map.parts.parts.pair.write({ control: ordinary }) } });
    assert.deepEqual(leaves(doc(map).root()), ['%{literal}:#{literal}', '%{literal}:#{literal}']);
    assert.equal(owner(map).scopedDocumentState(owner(map).libraries()[1]!).scopes.occurrences.length, 3);
    const child = map.parts.parts.leaf.write({ text: 'Child' });
    map.addLibraries({ nested: { document: map.parts.parts.forward.write({ control: child }) } });
    const scopes = owner(map).scopedDocumentState(owner(map).libraries()[2]!).scopes.occurrences;
    assert.equal(scopes.length, 4); assert.equal(new Set(scopes.map(occurrence => JSON.stringify(occurrence.root))).size, 4);
    assert.equal((doc(map, 'nested').css.snapshot().match(/color:blue/g) ?? []).length, 2);
    const aliased = Hson.document`<hson-part @:alias lib="parts" at="leaf" text="Alias"/>`;
    map.addLibraries({ aliases: { document: map.parts.parts.pair.write({ control: aliased }) } });
    assert.equal(owner(map).scopedDocumentState(owner(map).libraries()[3]!).scopes.occurrences.filter(occurrence => occurrence.bindings.some(binding => binding.name === 'alias')).length, 2);
  });

  check("Part Document structure: strict admission, required bindings and atomic recovery", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<main hson:part control:doc="%{control}" <hson-part part:optional #{control}/>/>' ) } } });
    const before = owner(map).captureSemanticCheckpoint(), issued = owner(map).identityEpoch().issued();
    for (const control of ['', '"text"', '<b/><i/>', '<broken', '<b @000000001/>', '<b @:same <i @:same/>/>', '<hson-part #{outside}/>', '<hson-part lib="parts" at="missing"/>', '<hson-part at="x"/>', '<b part:optional/>']) {
      const source = map.parts.parts.x.write({ control });
      atomic(map, () => map.addLibraries({ bad: { document: source } }));
    }
    atomic(map, () => map.addLibraries({ bad: { document: map.parts.parts.x.write() } }), /Missing/);
    assert.deepEqual(owner(map).captureSemanticCheckpoint(), before); assert.equal(owner(map).identityEpoch().issued(), issued);
    map.addLibraries({ page: { document: map.parts.parts.x.write({ control: '<b "Recovered"/>' }) } });
    assert.equal(doc(map).render(), '<main><b>Recovered</b></main>');
    for (const template of ['<main hson:part <hson-part #{control}/>/>' , '<main hson:part c:data="%{payload}" <hson-part #{c}/>/>' , '<main hson:part c:doc="%{payload}" "#{c.title}"/>', '<main hson:part d:data="%{payload}" "%{d.title}"/>', '<main hson:part c:doc="%{payload}" c:data="%{other}" <hson-part #{c}/>/>' ]) {
      atomic(map, () => map.addLibraries({ invalid: { parts: { x: part(template) } }, bad: { document: '<hson-part lib="invalid" at="x" doc:payload="<b/>" data:other="null"/>' } }));
    }
    for (const source of ['<b #{x}/>', '<hson-part #{x} lib="p" at="x"/>', '<hson-part #{x} title="x"/>', '<hson-part #{x} #{y}/>', '<hson-part #{x} "text"/>', '<hson-part #{x.path}/>']) assert.throws(() => Reflect.apply(Hson.document.fromHson, undefined, [source]));
    atomic(map, () => map.addLibraries({ bad: { document: '<hson-part part:structure="#{control}"/>' } }));
    const raw: HsonNode = { $_tag: 'hson-part', $_attrs: { '#{control}': '#{control}' }, $_content: [] };
    assert.equal(Hson.document.fromNode(raw), '<hson-part #{control}/>');
    for (const invalid of [
      { ...raw, $_tag: 'b' }, { ...raw, $_attrs: { '#{control}': true } },
      { ...raw, $_attrs: { '#{control}': '#{control}', lib: 'parts', at: 'x' } },
      { ...raw, $_attrs: { '#{control.path}': '#{control.path}' } },
      { ...raw, $_content: [element('<b/>')] },
      { ...raw, $_attrs: { '#{control}': '#{control}', '#{other}': '#{other}' } },
    ]) assert.throws(() => Hson.document.fromNode(invalid));

  });

  check("Part Document structure: optional zero output retires anchors and CSS without dummy occurrences", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      outer: part('<main hson:part c:doc="%{control}" <hson-part @:slot #{c}/>/>' , '[hson\\:quad="slot"]{color:red}'),
      empty: part('<b hson:part part:optional d:data="%{payload}" "#{d.missing}"/>', ':scope{color:blue}'),
    } } });
    const control = map.parts.parts.empty.write({ payload: Hson.data.from({}) });
    map.addLibraries({ page: { document: map.parts.parts.outer.write({ control }) } });
    assert.deepEqual(leaves(doc(map).root()), []);
    assert.equal(owner(map).scopedDocumentState(owner(map).libraries()[1]!).scopes.occurrences.length, 1);
    assert.doesNotMatch(doc(map).css.snapshot(), /color:blue/);
  });

  check("Part Document structure: scoped replacements preserve lifecycle and late failure is atomic", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<section hson:part c:doc="%{control}" <hson-part #{c}/>/>' ), leaf: part('<b hson:part @:root "Live"/>', ':scope{color:red}') } }, page: { document: '<main <i/>/>' } });
    const source = map.parts.parts.x.write({ control: map.parts.parts.leaf.write() });
    doc(map).document.content.replace({ kind: 'path', path: [0, 0] }, 0, element(source));
    assert.ok(leaves(doc(map).root()).includes('Live')); assert.match(doc(map).css.snapshot(), /color:red/);
    atomic(map, () => map.batch(draft => {
      draft.doc.must('page').content.insert({kind:'path',path:[0,0]}, 1, element(source));
      draft.doc.must('page').content.insert({kind:'path',path:[0,0]}, 2, element(map.parts.parts.x.write({control:'<broken'})));
    }));
    doc(map).document.content.replace({ kind: 'path', path: [0, 0] }, 0, element('<i/>'));
    assert.equal(doc(map).css.snapshot(), '');
  });

  check("Part Document structure: shared budgets, active selections and alias collisions remain strict", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      pair: part('<main hson:part c:doc="%{control}" <hson-part #{c}/><hson-part #{c}/>/>' ),
      loop: part('<main hson:part c:doc="%{control}" <hson-part #{c}/>/>' ),
      collision: part('<b hson:part @:root <i @:alias/>/>' ),
    } } });
    const control = '<article "' + 'x'.repeat(300) + '"/>';
    const authored = parse_authored_document_library(map.parts.parts.pair.write({ control }));
    const expand = (options: DocumentCompositionOptions) => expand_document_composition('shell', () => ({root: authored.root}),
      document_composition_options(options), (lib, at) => readPart(map, lib, at));
    assert.equal(leaves(expand({}).root).length, 2);
    assert.throws(() => expand({maxCharacters: control.length * 2}), /character limit/);
    assert.throws(() => expand({maxDepth: 2}), /depth limit/);
    assert.throws(() => expand({maxNodes: 5}), /node limit/);
    const recursive = Hson.document`<hson-part lib="parts" at="loop" doc:control="<b/>"/>`;
    atomic(map, () => map.addLibraries({bad:{document:map.parts.parts.loop.write({control:recursive})}}), /Recursive/);
    const collision = Hson.document`<hson-part @:alias lib="parts" at="collision"/>`;
    atomic(map, () => map.addLibraries({bad:{document:map.parts.parts.pair.write({control:collision})}}), /Conflicting structural root QUAD/);
  });

  check("optional connector argument checks follow the existing configured Part selection", () => {
    for (const flag of ['', 'part:optional']) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: {
        outer: part(`<section hson:part d:data="%{payload}" <hson-part @:slot ${flag} at="unselected" label="#{d.label}"/>/>`),
        chosen: part('<b hson:part "%{label}"/>'),
      } } });
      const source = parse_authored_document_library('<hson-part @:entry lib="parts" at="outer" data:payload="<label 0>"/>');
      const result = expand_document_composition('test', () => ({ root: source.root, quads: source.declarations }),
        document_composition_options({ configuration: { at: { entry: { at: { slot: { use: { at: 'chosen' } } } } } } }), (lib, at) => readPart(map, lib, at));
      assert.deepEqual(leaves(result.root), ['0']);
    }
  });

  check("optional omission preserves cardinality, resource budgets and canonical metadata fences", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      empty: part('<section hson:part part:optional ' + '<b/>'.repeat(20) + '/>'),
      deep: part('<section hson:part part:optional <a <b <i/>/>/>/>'),
    } }, page: { document: '<main/>' } });
    const source = parse_authored_document_library('<hson-part lib="parts" at="empty"/>');
    for (const limits of [{ maxNodes: 5 }, { maxCharacters: 20 }]) assert.throws(() => expand_document_composition('test', () => ({ root: source.root }), document_composition_options(limits), (lib, at) => readPart(map, lib, at)), /limit/);
    const deep = parse_authored_document_library('<hson-part lib="parts" at="deep"/>');
    assert.throws(() => expand_document_composition('test', () => ({ root: deep.root }), document_composition_options({ maxDepth: 2 }), (lib, at) => readPart(map, lib, at)), /depth/);
    atomic(map, () => doc(map).document.flags.set({ kind: 'path', path: [0] }, 'part:optional'), /construction/);
    map.addLibraries({ emptyPage: { document: '<hson-part lib="parts" at="empty"/>' } });
    assert.throws(() => Hson.document.fromNode(doc(map, 'emptyPage').root()), /at least one/);
    atomic(map, () => map.addLibraries({ constrained: { document: '<hson-part lib="parts" at="empty"/>', schema: Hson.schema`<type "document" tag "section">` } }));
  });

  check("optional Parts: strict presence, OR semantics, static content and direct whole-value omission", () => {
    const template = '<section hson:part d:data="%{payload}" <p part:optional title="#{d.a}" "#{d.b}"/> <aside part:optional <h2 "Static"/> <i part:optional "#{d.a}"/> <b part:optional "#{d.b}"/>/> <footer part:optional "Never"/>/>';
    for (const data of [{}, { a: 'a' }, { b: 'b' }, { a: 'a', b: 'b' }]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part(template) } }, page: { document: Hson.document`<hson-part lib="parts" at="x" data:payload="${Hson.data.from(data)}"/>` } });
      const rendered = doc(map).render();
      assert.doesNotMatch(rendered, /part:optional|Never|undefined/);
      assert.equal(rendered.includes('<p'), Object.keys(data).length > 0);
      assert.equal(rendered.includes('<aside'), Object.keys(data).length > 0);
      assert.equal(rendered.includes('<i'), 'a' in data);
      assert.equal(rendered.includes('<b'), 'b' in data);
      if (!('a' in data)) assert.doesNotMatch(rendered, /title=/);
    }
    for (const value of [null, false, 0, -0, '', {}, []]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: {
        x: part('<section hson:part d:data="%{payload}" <aside part:optional "Static" <hson-part part:optional at="drop" data:payload="#{d.value}"/>/>/>'),
        drop: part('<b hson:part part:optional d:data="%{payload}" "Never"/>'),
      } }, page: { document: Hson.document`<hson-part lib="parts" at="x" data:payload="${Hson.data.from({ value })}"/>` } });
      assert.match(doc(map).render(), /<aside>Static<\/aside>/);
      assert.doesNotMatch(doc(map).render(), /Never|part:optional/);
      if (value === null || typeof value !== 'object') {
        map.addLibraries({ direct: { parts: { x: part('<p hson:part part:optional d:data="%{payload}" "#{d.value}"/>') } },
          scalar: { document: Hson.document`<hson-part lib="direct" at="x" data:payload="${Hson.data.from({ value })}"/>` } });
        assert.deepEqual(leaves(doc(map, 'scalar').root()), [String(value)]);
      }
    }
  });

  check("optional Parts: atomic zero-or-one roots and no-placeholder roots allocate nothing", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      x: part('<pre hson:part @:root part:optional code:data="%{payload}" <code @:code "#{code.source}"/>/>', ':scope{color:red}[hson\\:quad="code"]{color:blue}'),
      empty: part('<aside hson:part @:root part:optional "Static"/>', ':scope{color:pink}'),
      declaration: part('<aside hson:part part:optional d:data="%{payload}" "Static"/>'),
    } } });
    const a = owner(map), issued = a.identityEpoch().issued();
    let allocations = 0;
    allocator(a.identityEpoch().owner, () => { allocations++; throw Error('omission allocated identity'); });
    try {
      map.addLibraries({ page: { document: '<hson-part lib="parts" at="x" data:payload="<>"/><hson-part lib="parts" at="empty"/><hson-part lib="parts" at="declaration" data:payload="<>"/><hson-part lib="parts" at="declaration"/>' } });
    } finally { allocator(a.identityEpoch().owner, undefined); }
    assert.equal(allocations, 0); assert.deepEqual(enumerate_livemap_issued_quids(a.identityEpoch().issued()), enumerate_livemap_issued_quids(issued));
    assert.deepEqual(doc(map).root().$_content, []);
    const id = a.libraries()[1]!;
    assert.equal(a.documentScopes(id)?.occurrences.length, 0);
    assert.equal(doc(map).css.snapshot(), '');
    map.addLibraries({ live: { document: '<hson-part lib="parts" at="x" data:payload="<source 0>"/>' } });
    assert.deepEqual(leaves(doc(map, 'live').root()), ['0']);
    assert.equal(a.documentScopes(a.libraries()[2]!)?.occurrences.length, 1);
    assert.throws(() => compose(map, 'page', 'composed', { configuration: { q: 'required' } }), /exactly one/);
  });

  check("optional Parts: connectors, receiving roots and multilevel forwarding remain occurrence-local", () => {
    for (const optionalSender of [false, true]) for (const optionalReceiver of [false, true]) {
      if (!optionalSender && !optionalReceiver) continue;
      const map = hsonLiveMap.fromLibraries({ parts: { parts: {
        outer: part(`<section hson:part d:data="%{payload}" <hson-part at="middle" data:payload="#{d}"/> <hson-part at="leaf" ${optionalSender ? 'part:optional' : ''} data:payload="#{d.absent}"/>/>`),
        middle: part('<article hson:part d:data="%{payload}" <hson-part at="leaf" data:payload="#{d.first}"/> <hson-part at="leaf" data:payload="#{d.second}"/>/>'),
        leaf: part(`<p hson:part ${optionalReceiver ? 'part:optional' : ''} d:data="%{payload}" "#{d.label}"/>`),
      } }, page: { document: Hson.document`<hson-part lib="parts" at="outer" data:payload="${Hson.data.from({ first: { label: 'one' }, second: { label: 'two' } })}"/>` } });
      assert.deepEqual(leaves(doc(map).root()), ['one', 'two']);
      assert.equal(owner(map).documentScopes(owner(map).libraries()[1]!)?.occurrences.length, 4);
    }
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      outer: part('<main hson:part d:data="%{payload}" <hson-part at="middle" data:payload="#{d.missing}"/>/>'),
      middle: part('<article hson:part part:optional d:data="%{payload}" <hson-part at="leaf" data:payload="#{d.next}"/>/>'),
      leaf: part('<b hson:part d:data="%{payload}" "#{d.value}"/>'),
    } }, page: { document: '<hson-part lib="parts" at="outer" data:payload="<>"/>' } });
    assert.deepEqual(leaves(doc(map).root()), []);
    assert.equal(owner(map).documentScopes(owner(map).libraries()[1]!)?.occurrences.length, 1);
  });

  check("optional Parts: malformed, unknown and incompatible references cannot disappear", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const invalid = [
      '<p part:optional d:data="%{payload}" "#{d[-1]}"/>',
      '<p part:optional d:data="%{payload}" "#{d[01]}"/>',
      '<p part:optional d:data="%{payload}" "%{unknown.x}"/>',
      '<p part:optional d:data="%{payload}" "%{payload}"/>',
      '<p part:optional d:data="%{payload}" "#{d.null.x}"/>',
      '<p part:optional d:data="%{payload}" "#{d.array.name}"/>',
      '<p part:optional d:data="%{payload}" "#{d.obj[0]}"/>',
      '<p part:optional d:data="%{payload}" "#{d.missing}" <script "#{d.missing}"/>/>',
      '<p part:optional d:data="%{payload}" onclick="#{d.missing}"/>',
      '<p part:optional d:data="%{payload}" <b d:data="%{payload}"/>/>',
      '<p part:optional d:data="%{payload}" <hson-part part:optional at="leaf" data:payload="bad"/>/>',
      '<p part:optional d:data="%{payload}" <hson-part part:optional at="leaf" data:payload="#{d.missing}" data:extra="#{d.missing}"/>/>',
      '<p part:optional d:data="%{payload}" <hson-part part:optional at="leaf" data:payload="#{d.missing}" payload="x"/>/>',
      '<p d:data="%{payload}" <hson-part part:optional at="leaf" data:payload="#{d.null}" extra="#{d.missing}"/>/>',
    ];
    for (const template of invalid) atomic(map, () => map.addLibraries({ parts: { parts: { x: part(template), leaf: part('<i hson:part d:data="%{payload}" "#{d}"/>') } },
      bad: { document: Hson.document`<hson-part lib="parts" at="x" data:payload="${Hson.data.from({ null: null, array: [], obj: {} })}"/>` } }));
    for (const template of ['<p hson:part part:optional="false"/>', '<p hson:part <b part:optional=""/>/>']) {
      atomic(map, () => map.addLibraries({ parts: { parts: { x: part(template) } } }), /part:optional/);
    }
    for (const document of ['<p part:optional/>', '<hson-part lib="parts" at="x" part:optional/>']) {
      atomic(map, () => map.addLibraries({ bad: { document } }), /part:optional/);
    }
    atomic(map, () => map.addLibraries({ parts: { parts: { x: part('<p hson:part part:optional d:data="%{payload}" "#{d.title}"/>') } },
      bad: { document: '<hson-part lib="parts" at="x"/>' } }), /Missing Part parameter/);
  });

  check("optional Parts: included structures keep strict descendants, partial strings and required inputs", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    for (const template of [
      '<p hson:part part:optional d:data="%{payload}" title="#{d.yes}" "prefix#{d.missing}"/>',
      '<p hson:part part:optional d:data="%{payload}" title="#{d.yes}" <b "#{d.missing}"/>/>',
      '<p hson:part part:optional d:data="%{payload}" "#{d.obj}"/>',
      '<p hson:part d:data="%{payload}" <hson-part part:optional at="leaf" data:a="#{d.yes}" data:b="#{d.missing}"/>/>',
      '<p hson:part d:data="%{payload}" <hson-part part:optional at="leaf" data:a="#{d.yes}"/>/>',
    ]) atomic(map, () => map.addLibraries({ parts: { parts: { x: part(template), leaf: part('<b hson:part part:optional a:data="%{a}" b:data="%{b}" title="#{a}" "#{b}"/>') } },
      bad: { document: Hson.document`<hson-part lib="parts" at="x" data:payload="${Hson.data.from({ yes: true, obj: {} })}"/>` } }));
  });

  check("optional Parts: exact selectors, opaque data and replacement output are not reinterpreted", () => {
    const reference = '#{d["odd}key"][0]["a.b"]}';
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      x: part('<section hson:part d:data="%{payload}" <p part:optional ' + JSON.stringify(reference) + '/> <aside part:optional <hson-part at="leaf" data:payload="\\\"%{unknown}\\\""/>/>/>'),
      leaf: part('<b hson:part d:data="%{payload}" "#{d}"/>'),
    } }, page: { document: Hson.document`<hson-part lib="parts" at="x" data:payload="${Hson.data.from({ 'odd}key': [{ 'a.b': '%{unknown}' }] })}"/>` } });
    assert.deepEqual(leaves(doc(map).root()), ['%{unknown}']);
    assert.doesNotMatch(doc(map).render(), /aside/);
    const canonical = Hson.document.fromNode(doc(map).root());
    const transform = hsonTransform.fromHson(canonical);
    assert.equal(Hson.document.fromNode(hsonTransform.fromJson(transform.toJson().value()).toNode()), canonical);
    assert.equal(Hson.document.fromNode(hsonTransform.fromBinary(transform.toBinary().serialize()).toNode()), canonical);
    assert.doesNotMatch(canonical, /part:optional|:data|hson-part/);
  });

  check("optional Parts: omitted QUAD subjects never acquire identity or CSS correspondence", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      x: part('<section hson:part @:root d:data="%{payload}" <b @:gone part:optional "#{d.missing}"/> <hson-part @:child at="empty"/> <i @:kept "Keep"/>/>', '[hson\\:quad="gone"]{color:red}:not([hson\\:quad="gone"]){color:blue}[hson\\:quad="child"]{color:pink}[hson\\:quad="kept"]{color:green}'),
      empty: part('<span hson:part part:optional/>', ':scope{color:orange}'),
    } }, page: { document: '<hson-part lib="parts" at="x" data:payload="<>"/>' } });
    const a = owner(map), id = a.libraries()[1]!, state = a.scopedDocumentState(id);
    assert.equal(state.scopes.occurrences.length, 1);
    assert.deepEqual(state.scopes.occurrences[0]!.bindings.map(binding => binding.name), ['kept', 'root']);
    assert.equal(state.scopes.subjects.length, 2);
    assert.equal(a.documentOverlay(id).size, 2);
    assert.equal(a.identityEpoch().issued().size, 2);
    assert.doesNotMatch(JSON.stringify([state.root, state.scopes]), /part:optional|gone|child/);
    assert.doesNotMatch(JSON.stringify(state.css), /gone|orange/);
    assert.match(doc(map).css.snapshot(), /:nth-child\(0\)/);
    assert.match(doc(map).css.snapshot(), /:not\(:nth-child\(0\)\)/);
  });

  check("optional Parts: dynamic same-batch insertion, omission, retirement and late failure are atomic", () => {
    for (const consumerFirst of [true, false]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part d:data="%{payload}" "#{d.title}"/>') } }, page: { document: '<main <i/>/>' }, other: { document: '<footer @:stable/>' } });
      const input = (data: object) => element(Hson.document`<hson-part lib="parts" at="x" data:payload="${Hson.data.from(data)}"/>`);
      const target = { kind: 'path' as const, path: validate_document_path([0, 0]) };
      map.batch(draft => {
        const edit = () => draft.parts.must('parts').at(['x', 'document']).set('<p hson:part @:root part:optional d:data="%{payload}" "#{d.title}"/>');
        const insert = () => draft.doc.must('page').content.insert(target, 1, input({}));
        if (consumerFirst) { insert(); edit(); } else { edit(); insert(); }
      });
      const page = doc(map), a = owner(map), id = a.libraries()[1]!;
      let commits = 0; const off = map.commits.observe(() => commits++);
      const root = a.root(id), issued = a.identityEpoch().issued();
      page.document.content.insert(target, 1, input({}));
      assert.equal(a.root(id), root); assert.equal(a.identityEpoch().issued(), issued); assert.equal(commits, 0);
      page.document.content.insert(target, 1, input({ title: 'left' }));
      page.document.content.insert(target, 2, input({ title: 'right' }));
      const right = a.documentOverlay(id).quidAtPath(validate_document_path([0, 0, 2]));
      page.document.content.replace(target, 1, input({}));
      assert.deepEqual(leaves(page.root()), ['right']);
      assert.equal(a.documentOverlay(id).quidAtPath(validate_document_path([0, 0, 1])), right);
      const stable = a.root(a.libraries()[2]!);
      atomic(map, () => map.batch(draft => {
        draft.doc.must('page').content.insert(target, 1, input({ title: 'early' }));
        draft.doc.must('page').content.insert(target, 2, input({ title: {} }));
      }), /primitive/);
      assert.equal(a.root(a.libraries()[2]!), stable);
      page.document.content.replace(target, 1, input({ title: 'recovered' }));
      assert.deepEqual(leaves(page.root()), ['recovered']);
      page.document.content.remove(target, 1);
      assert.equal(a.documentOverlay(id).quidAtPath(validate_document_path([0, 0, 1])), undefined);
      off();
    }
  });

  check("structured Part receiving interface: aliases, root-only declarations and atomic rejection", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      parent: part('<nav hson:part title="#{slide.title}" slide:data="%{payload}" tally:data="%{count}" <strong "#{slide.title}:#{tally}"/> <hson-part at="child" data:data="#{slide.details}" label="%{label}"/>/>'),
      child: part('<span hson:part slide:data="%{data}" "#{slide.title}:%{label}"/>'),
    } }, page: { document: '<main/>' } });
    const data = Hson.data`<title "parent" details <title "child">>`;
    const invocation = Hson.document`<hson-part lib="parts" at="parent" data:payload="${data}" data:count="0" label="scalar"/>`;
    map.addLibraries({ good: { document: invocation } });
    assert.deepEqual(leaves(doc(map, 'good').root()), ['parent:0', 'child:scalar']);
    const realized = Hson.document.fromNode(doc(map, 'good').root());
    assert.doesNotMatch(realized, /:data|data:|%\{|hson-part/);
    assert.deepEqual(leaves(hsonTransform.fromHson(realized).toNode()), ['parent:0', 'child:scalar']);
    const failures = [
      ['<p "%{payload.title}"/>', 'data:payload="<title \\"x\\">"'], // No implicit route.
      ['<p slide:data="%{payload}" "%{payload.title}"/>', 'data:payload="null"'],
      ['<p slide:data="%{payload}" "#{slide}"/>', ''],
      ['<p slide:data="%{payload}" "#{slide}"/>', 'payload="scalar"'],
      ['<p slide:data="%{payload}" "#{slide}"/>', 'data:payload="null" data:extra="false"'],
      ['<p slide:data="%{payload}" "#{slide}"/>', 'data:payload="null" slide="scalar"'],
      ['<p slide:data="%{payload}"/>', 'data:payload="null"'], // Declaration alone is not use.
      ['<p <b slide:data="%{payload}" "#{slide}"/>/>', 'data:payload="null"'],
      ['<p <hson-part at="child" slide:data="%{payload}"/>/>', 'data:payload="null"'],
      ['<p slide:data="%{payload.title}" "%{slide}"/>', 'data:payload="null"'],
      ['<p slide:data="prefix%{payload}" "%{slide}"/>', 'data:payload="null"'],
      ['<p slide:data="%{payload}%{payload}" "#{slide}"/>', 'data:payload="null"'],
      ['<p slide:data="null" "%{slide}"/>', 'data:payload="null"'],
      ['<p slide:data="%{payload}" slide:data="%{other}" "#{slide}"/>', 'data:payload="null" data:other="0"'],
      ['<p 1bad:data="%{payload}"/>', 'data:payload="null"'],
      ['<p lib:data="%{payload}"/>', 'data:payload="null"'],
    ];
    for (const [definition, attrs] of failures) atomic(map, () => map.addLibraries({
      earlier: { document: invocation },
      rejectedParts: { parts: { x: part(definition!) } },
      rejected: { document: `<hson-part lib="rejectedParts" at="x" ${attrs}/>` },
    }));
    // An ordinary scalar reference still binds directly without a declaration.
    map.addLibraries({ legacyParts: { parts: { x: part('<p hson:part title="%{x}" "%{x}"/>') } },
      legacy: { document: '<hson-part lib="legacyParts" at="x" x="scalar"/>' } });
    assert.deepEqual(leaves(doc(map, 'legacy').root()), ['scalar']);
  });
  check("structured Part arguments: multiple roots, exact selectors, primitive attributes and canonical closure", () => {
    const odd = ['odd.key', '', '0', '雪', 'brace}key', 'key%{inside}', 'line\nkey', 'quote"key', 'slash\\key', '__proto__', 'constructor'];
    const data = Hson.data`<title "Hello" no -0 items «<label "first">,<label "second">» yes true absent null zero 0 empty "">`;
    const keyed = Hson.data.from(Object.fromEntries(odd.map((key, index) => [key, `v${index}`])));
    const paths = ['slide.title', 'slide.no', 'slide.items[0].label', 'slide.items[1].label', 'slide.yes', 'slide.absent', 'slide.zero', 'slide.empty',
      ...odd.map(key => `keys[${JSON.stringify(key)}]`)];
    const template = '<section hson:part slide:data="%{slide}" keys:data="%{keys}" ' + paths.map((path, index) => `<b title=${JSON.stringify(`#{${path}}`)} ${JSON.stringify(`#{${path}}`)}/>`).join(' ') + ' <i "%{legacy}"/>/>';
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part(template) } }, page: { document: Hson.document`<hson-part lib="parts" at="x" data:slide="${data}" data:keys="${keyed}" legacy="scalar"/>` } });
    const root = doc(map).root();
    assert.deepEqual(leaves(root), ['Hello', '0', 'first', 'second', 'true', 'null', '0', '', ...odd.map((_, i) => `v${i}`), 'scalar']);
    const visit = (node: HsonNode) => { for (const value of Object.values(node.$_attrs ?? {})) assert.equal(typeof value, 'string'); for (const child of node.$_content) if (is_Node(child)) visit(child); };
    visit(root);
    const portable = Hson.document.fromNode(root), transform = hsonTransform.fromHson(portable);
    assert.equal(Hson.document.fromNode(hsonTransform.fromHson(transform.toHson().serialize()).toNode()), portable);
    assert.equal(Hson.document.fromNode(hsonTransform.fromJson(transform.toJson().value()).toNode()), portable);
    assert.equal(Hson.document.fromNode(hsonTransform.fromBinary(transform.toBinary().serialize()).toNode()), portable);
    assert.doesNotMatch(portable, /hson-part|data:slide/);
    for (const value of ['string', '<broken', '', 0, -0, 3.5, true, false, null]) {
      const rootData = Hson.data.from(value);
      const one = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part x:data="%{x}" title="#{x}" "#{x}"/>') } },
        page: { document: Hson.document`<hson-part lib="parts" at="x" data:x="${rootData}"/>` } });
      const output = doc(one).root().$_content[0]; assert.ok(is_Node(output));
      assert.equal(output.$_attrs?.title, String(value)); assert.deepEqual(leaves(output), [String(value)]);
    }
  });
  check("structured Part arguments: immutable forwarding, opacity, isolation and shadowing", () => {
    const source = Hson.data`<details <'10' "ten" '2' "two" '1' "one" n -0 text "%{other}" items «false,null,0»> ignored "private">`;
    const definitions = {
      outer: part('<section hson:part slide:data="%{slide}" <hson-part at="middle" data:payload="#{slide.details}"/> <hson-part at="middle" data:payload="#{slide.details}"/>/>'),
      middle: part('<article hson:part payload:data="%{payload}" <hson-part at="leaf" data:slide="#{payload}"/> <hson-part at="primitive" data:x="#{payload.items[0]}"/>/>'),
      leaf: part(String.raw`<b hson:part slide:data="%{slide}" title="#{slide.text}" "#{slide[\"10\"]}:#{slide[\"2\"]}:#{slide[\"1\"]}:#{slide.n}:#{slide.text}"/>`),
      primitive: part('<i hson:part x:data="%{x}" "#{x}"/>'),
      scalarLeaf: part('<i hson:part "%{x}"/>'),
      literal: part(Hson.document`<p hson:part <hson-part at="primitive" data:x="${Hson.data.from('%{unknown}')}"/>/>`),
      scalar: part('<p hson:part <hson-part at="primitive" data:x="%{x}"/>/>'),
      ordinary: part('<p hson:part x:data="%{x}" <hson-part at="scalarLeaf" x="#{x}"/>/>'),
      array: part('<p hson:part items:data="%{items}" <hson-part at="arrayLeaf" data:items="#{items}"/>/>'),
      arrayLeaf: part('<i hson:part items:data="%{items}" "#{items[0]}:#{items[1]}:#{items[2]}:#{items[3]}"/>'),
      mixed: part('<p hson:part <hson-part at="primitive" data:x="<a %{x}>"/>/>'),
    };
    const map = hsonLiveMap.fromLibraries({ parts: { parts: definitions }, page: { document: Hson.document`<hson-part lib="parts" at="outer" data:slide="${source}"/>` } });
    assert.deepEqual(leaves(doc(map).root()), ['ten:two:one:0:%{other}', 'false', 'ten:two:one:0:%{other}', 'false']);
    const add = (name: string, document: string) => { map.addLibraries({ [name]: { document } }); return leaves(doc(map, name).root()); };
    assert.deepEqual(add('literal', '<hson-part lib="parts" at="literal"/>'), ['%{unknown}']);
    atomic(map, () => add('scalar', Hson.document`<hson-part lib="parts" at="scalar" x="${'<a 1>'}"/>`), /Typed Part forwarding/);
    assert.deepEqual(add('ordinary', '<hson-part lib="parts" at="ordinary" data:x="false"/>'), ['false']);
    atomic(map, () => add('container', '<hson-part lib="parts" at="ordinary" data:x="<>"/>'), /primitive/);
    assert.deepEqual(add('array', Hson.document`<hson-part lib="parts" at="array" data:items="${Hson.data`«false,false,null,-0»`}"/>`), ['false:false:null:0']);
    atomic(map, () => add('mixed', '<hson-part lib="parts" at="mixed" x="1"/>'), /Unknown Part parameter|Invalid Part data/);
    map.parts.must('parts').at(['leaf', 'document']).set('<b hson:part "later"/>');
    assert.deepEqual(leaves(doc(map).root()), ['ten:two:one:0:%{other}', 'false', 'ten:two:one:0:%{other}', 'false']);
  });
  check("structured Part arguments: all invalid inputs reject atomically and recover", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part x:data="%{x}" "#{x}"/>'), path: part('<p hson:part x:data="%{x}" "#{x.a}"/>'),
      nested: part('<section hson:part x:data="%{x}" <hson-part at="x" data:x="#{x.missing}"/>/>'),
      unused: part('<p hson:part/>'), inherited: part('<p hson:part <hson-part at="x"/>/>') } }, page: { document: '<main/>' } });
    const invoke = (source: string, member = 'x') => Hson.document`<hson-part lib="parts" at="${member}" data:x="${source}"/>`;
    for (const source of ['', ' ', 'bare', '<broken', '<a 1 a 2>', '<a 1> <b 2>', '<p/>', '<a title="bad" 1>', 'NaN', 'Infinity', '%{x} trailing', '%{missing}', '<a #123456789 1>']) {
      atomic(map, () => map.addLibraries({ bad: { document: invoke(source) } }), /Part|Hson|hson/);
    }
    for (const source of ['<>', '«»', '<a 1>', '«1,2»']) atomic(map, () => map.addLibraries({ bad: { document: invoke(source) } }), /primitive/);
    for (const [source, member] of [['null', 'path'], ['<a null>', 'nested'], ['false', 'unused'], ['0', 'inherited']]) {
      atomic(map, () => map.addLibraries({ bad: { document: invoke(source!, member) } }));
    }
    for (const name of ['data:', 'data:lib', 'data:at', 'data:1bad', 'data:x.y', 'Data:x', 'json:x']) {
      atomic(map, () => map.addLibraries({ bad: { document: `<hson-part lib="parts" at="x" ${name}="null"/>` } }));
    }
    for (const attrs of ['x="a" data:x="null"', 'data:x="null" x="a"']) atomic(map, () => map.addLibraries({ bad: { document: `<hson-part lib="parts" at="x" ${attrs}/>` } }), /Conflicting/);
    for (const value of [false, null, 1]) {
      const raw: HsonNode = { $_tag: ROOT_TAG, $_content: [{ $_tag: 'hson-part', $_attrs: { lib: 'parts', at: 'x', 'data:x': value }, $_content: [] }] };
      atomic(map, () => map.addLibraries({ bad: { document: raw } }), /serialized HsonData/);
    }
    // A valid earlier occurrence must not publish when a later nested argument fails.
    atomic(map, () => map.addLibraries({ first: { document: invoke('0') }, bad: { document: invoke('<a 1>', 'nested') } }));
    map.addLibraries({ bad: { document: invoke('null') } }); assert.deepEqual(leaves(doc(map, 'bad').root()), ['null']);
  });
  check("structured Part arguments: selector grammar, missing values and placement remain strict", () => {
    const invalid = ['x[-1]', 'x[1.5]', 'x[1e2]', 'x[01]', 'x[9007199254740992]', 'x[*]', 'x()', 'x..a', 'x.', 'x["unterminated]', 'x[ 0]', 'x.a + 1'];
    const wrong = ['x.nope', 'x.a.b', 'x.items["0"]', 'x[0]', 'x.items[2]'];
    for (const ref of [...invalid, ...wrong]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part(`<p hson:part x:data="%{x}" ${JSON.stringify(`#{${ref}}`)}/>` ) } } });
      atomic(map, () => map.addLibraries({ bad: { document: Hson.document`<hson-part lib="parts" at="x" data:x="${Hson.data`<a null items «0>>`}"/>` } }));
    }
    for (const template of ['<p title="%{x}"/>', '<p title="prefix:%{x}"/>', '<p "prefix:%{x}"/>', '<script "%{x.a}"/>', '<style "%{x.a}"/>', '<p onclick="%{x.a}"/>']) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part(template.replace(/^(<[^ ]+)/, '$1 hson:part x:data="%{x}"')) } } });
      atomic(map, () => map.addLibraries({ bad: { document: Hson.document`<hson-part lib="parts" at="x" data:x="${Hson.data`<a 1>`}"/>` } }));
    }
    const dangerous = '"</p><script>alert(1)</script> & \\ %{unbound}';
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part x:data="%{x}" title="#{x}" "#{x}"/>') } },
      page: { document: Hson.document`<hson-part lib="parts" at="x" data:x="${Hson.data.from(dangerous)}"/>` } });
    assert.deepEqual(leaves(doc(map).root()), [dangerous]); assert.match(doc(map).render(), /&lt;script>/);
  });
  check("structured Part arguments: many named inputs and ordinary data-prefixed attributes", () => {
    const entries = Array.from({length:64}, (_, index) => [`data:arg${index}`, Hson.data.from(index)] as const);
    const template = '<p hson:part ' + entries.map((_, index) => `arg${index}:data="%{arg${index}}"`).join(' ') + ' data:ordinary="#{arg0}" ' + JSON.stringify(entries.map((_, index) => `#{arg${index}}`).join(':')) + '/>';
    const map = hsonLiveMap.fromLibraries({parts:{parts:{x:part(template)}}});
    const invocation = map.parts.must('parts').at(['x']).write(Object.fromEntries(entries.map(([name, value]) => [name.slice(5), value])));
    map.addLibraries({page:{document:invocation}});
    assert.deepEqual(leaves(doc(map).root()), [Array.from({length:64}, (_,index) => String(index)).join(':')]);
    const output = doc(map).root().$_content[0]; assert.ok(is_Node(output)); assert.equal(output.$_attrs?.['data:ordinary'], '0');
  });
  check("structured Part arguments: input budget, direct forwarding and original-template checks", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      x: part('<section hson:part x:data="%{x}" <hson-part at="y" data:x="#{x}"/>/>'), y: part('<article hson:part x:data="%{x}" <hson-part at="z" data:x="#{x}"/>/>'), z: part('<p hson:part x:data="%{x}" "#{x.title}"/>'),
    } } });
    const data = Hson.data.from({ title: 'ok', ignored: 'z'.repeat(2000) });
    const source = parse_authored_document_library(Hson.document`<hson-part lib="parts" at="x" data:x="${data}"/>`);
    const expand = (options: DocumentCompositionOptions) => expand_document_composition('shell', () => ({ root: source.root }), document_composition_options(options), (lib, at) => readPart(map, lib, at));
    assert.deepEqual(leaves(expand({ maxCharacters: data.length + 150 }).root), ['ok'], 'forwarded values do not reparse or recharge literal source');
    assert.throws(() => expand({ maxCharacters: data.length - 1 }), /character limit/);
    assert.throws(() => expand({ maxDepth: 2 }), /depth limit/);
    const repeated = parse_authored_document_library('<hson-part lib="parts" at="z" data:x="&lt;not-data"/>');
    assert.throws(() => expand_document_composition('shell', () => ({root:repeated.root}), document_composition_options(undefined), (lib, at) => readPart(map, lib, at)), error => {
      assert.ok(error instanceof Error && error.cause instanceof Error);
      assert.ok(error.cause.cause instanceof Error); return true;
    });
    for (const source of ['«'.repeat(260) + '0' + '»'.repeat(260), '<x 1>']) {
      const member = source.startsWith('«') ? 'z' : 'huge';
      const authored = parse_authored_document_library(Hson.document`<hson-part lib="parts" at="${member}" data:x="${source}"/>`);
      assert.throws(() => expand_document_composition('shell', () => ({root:authored.root}), document_composition_options({maxCharacters:3000}),
        (lib, at) => at === 'huge' ? {root:parse_authored_document_library('<p x:data="%{x}" ' + JSON.stringify('#{x.' + 'a'.repeat(5000) + '}') + '/>').root} : readPart(map, lib, at)));
    }
    const amplified = parse_authored_document_library(Hson.document`<hson-part lib="parts" at="amplify" data:x="${Hson.data.from('a'.repeat(300))}"/>`);
    assert.throws(() => expand_document_composition('shell', () => ({root:amplified.root}), document_composition_options({maxCharacters:2000}),
      () => ({root:parse_authored_document_library('<p x:data="%{x}" ' + JSON.stringify('#{x}'.repeat(10)) + '/>').root})), /character limit/);
    const invalid = parse_authored_document_library('<hson-part @:slot lib="parts" at="z" data:x="null"/>');
    assert.throws(() => expand_document_composition('shell', () => ({ root: invalid.root, quads: invalid.declarations }),
      document_composition_options({ configuration: { at: { slot: { text: 'override' } } } }), (lib, at) => readPart(map, lib, at)), /path/);
  });
  check("structured Part arguments: dynamic and same-batch edits preserve occurrence lifetimes", () => {
    for (const consumerFirst of [true, false]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part x:data="%{x}" @:root "#{x.title}"/>') } }, page: { document: '<main <i/>/>' } });
      const input = (title: string) => element(Hson.document`<hson-part lib="parts" at="x" data:x="${Hson.data.from({ title })}"/>`);
      map.batch(draft => {
        const consumer = () => draft.doc.must('page').content.insert({ kind: 'path', path: validate_document_path([0, 0]) }, 1, input('first'));
        const definition = () => draft.parts.must('parts').at(['x', 'document']).set('<p hson:part x:data="%{x}" @:root title="#{x.title}" "#{x.title}"/>');
        if (consumerFirst) { consumer(); definition(); } else { definition(); consumer(); }
      });
      const page = doc(map); assert.deepEqual(leaves(page.root()), ['first']);
      page.document.content.insert({ kind: 'path', path: [0, 0] }, 2, input('second'));
      const a = owner(map), id = a.libraries()[a.hostedRegistry().libraries.findIndex(entry => entry.name === 'page')]!;
      const second = a.documentOverlay(id).quidAtPath(validate_document_path([0, 0, 2]));
      page.document.content.replace({ kind: 'path', path: [0, 0] }, 1, input('replacement'));
      assert.deepEqual(leaves(page.root()), ['replacement', 'second']);
      assert.equal(a.documentOverlay(id).quidAtPath(validate_document_path([0, 0, 2])), second);
      page.document.content.remove({ kind: 'path', path: [0, 0] }, 1);
      assert.deepEqual(leaves(page.root()), ['second']);
      atomic(map, () => page.document.content.insert({ kind: 'path', path: [0, 0] }, 0,
        element('<hson-part lib="parts" at="x" data:x="null"/>')), /path/);
    }
  });

  for (const batch of [false, true]) check(`${batch ? "batch" : "direct"} equal Part replacement retires addressed identity and preserves unaddressed no-ops`, () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { plain: part('<button hson:part/>'), styled: part('<button hson:part/>', 'button{color:red}') } },
      page: { document: '<button @:keep/>' } });
    const page = doc(map), aggregate = owner(map), id = aggregate.libraries()[1]!, old = page.q("keep")!;
    const oldQuid = lookup(page, "keep")!.quid, graph = page.root();
    const replace = (member: string) => {
      const replacement = element(`<hson-part lib="parts" at="${member}"/>`), target = { kind: "path" as const, path: validate_document_path([]) };
      return batch ? map.batch(draft => draft.doc.must("page").graph({ domain: "graph", op: "replace-content", target, index: 0, replacement }))
        : page.document.content.replace(target, 0, replacement);
    };
    assert.equal(replace("plain").changed, true); assert.equal(old.active, false); assert.equal(page.q("keep"), undefined);
    assert.equal(aggregate.documentOverlay(id).pathForQuid(oldQuid), undefined); assert.deepEqual(page.root(), graph);
    assert.equal(replace("plain").changed, false); assert.equal(map.rev, 1);
    assert.equal(replace("styled").changed, true); assert.equal(map.rev, 2); assert.match(page.css.snapshot(), /color:red/);
    const styledQuid = aggregate.documentOverlay(id).quidAtPath(validate_document_path([0]))!;
    assert.ok(styledQuid); assert.notEqual(styledQuid, oldQuid); assert.deepEqual(page.root(), graph);
    assert.equal(replace("plain").changed, true); assert.equal(map.rev, 3); assert.equal(page.css.snapshot(), "");
    assert.equal(aggregate.documentOverlay(id).pathForQuid(styledQuid), undefined); assert.deepEqual(page.root(), graph);
    assert.ok(aggregate.identityEpoch().issued().has(oldQuid)); assert.ok(aggregate.identityEpoch().issued().has(styledQuid));
  });
  check("Part replacement retires its old QUAD while retaining independent ancestor CSS", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { styled: part('<button hson:part/>', 'button{color:red}') } },
      page: { document: '<main @:ancestor <button @:keep/>/>' } });
    const page = doc(map), ancestor = page.q("ancestor")!, old = page.q("keep")!, quid = lookup(page, "ancestor")!.quid;
    page.css.sel(`[hson\\:quid="${quid}"]`).setProp("border-top", "5px solid red");
    page.document.content.replace({ kind: "path", path: [0, 0] }, 0, element('<hson-part lib="parts" at="styled"/>'));
    assert.equal(old.active, false); assert.equal(ancestor.active, true); assert.match(page.css.snapshot(), /color:red/);
    assert.match(page.css.snapshot(), /border-top:5px solid red/);
    ancestor.at([0]).delete();
    assert.doesNotMatch(page.css.snapshot(), /color:red/); assert.match(page.css.snapshot(), /border-top:5px solid red/);
    atomic(map, () => ancestor.delete());
  });



  for (const batch of [false,true]) check(`${batch ? "batch graph" : "direct"} graph-equivalent Part effects fail atomically and retain reentrant inner work`, () => {
    const fixture=(extraCss='')=>hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<button hson:part/>',`button{color:red}${extraCss}`)} },state:{data:{n:0}},page:{document:'<button/>'}});
    const replace=(map:LiveMap)=>{
      const replacement=element('<hson-part lib="parts" at="x"/>');
      return batch?map.batch(draft=>{const selected=draft.doc.must("page");if(selected.mode!=="document")throw Error("document");return selected.graph({domain:"graph",op:"replace-content",target:{kind:"path",path:validate_document_path([])},index:0,replacement});})
        :doc(map).document.content.replace({kind:"path",path:[]},0,replacement);
    };
    const exhausted=fixture();allocator(owner(exhausted).identityEpoch().owner,()=>"invalid");
    try{atomic(exhausted,()=>replace(exhausted),/No available destination QUID for Part CSS subject/);}finally{allocator(owner(exhausted).identityEpoch().owner,undefined);}
    const conflict=fixture('@keyframes clash{from{opacity:0}}');doc(conflict).css.stylesheet('@keyframes clash{from{opacity:1}}');let calls=0;
    allocator(owner(conflict).identityEpoch().owner,()=>{calls++;return "123456789";});
    try{atomic(conflict,()=>replace(conflict),/Duplicate @keyframes/);}finally{allocator(owner(conflict).identityEpoch().owner,undefined);}assert.equal(calls,0);
    const managed=fixture(),manager={};owner(managed).claimManagement(manager);
    try{atomic(managed,()=>replace(managed),batch?/batch is unavailable while this map is managed/:/exclusive Locus authority/);}finally{owner(managed).releaseManagement(manager);}
    const reentrant=fixture(),beforeGraph=doc(reentrant).root();let entered=false,after:ReturnType<LiveMap["capture"]>|undefined,commits=0;
    const off=reentrant.commits.observe(()=>commits++);
    allocator(owner(reentrant).identityEpoch().owner,()=>{if(!entered){entered=true;reentrant.data.must("state").at(["n"]).set(1);after=reentrant.capture();}return "123456789";});
    try{assert.throws(()=>replace(reentrant),/changed during capture/);}finally{allocator(owner(reentrant).identityEpoch().owner,undefined);off();}
    assert.equal(entered,true);assert.deepEqual(reentrant.capture(),after);assert.deepEqual(doc(reentrant).root(),beforeGraph);assert.equal(doc(reentrant).css.snapshot(),"");
    assert.equal(reentrant.rev,1);assert.equal(commits,1);assert.equal(owner(reentrant).identityEpoch().issued().size,0);
  });

  check("Part collections are inert; authored documents eagerly realize nested exact coordinates", () => {
    const key = 'n/a "& 雪', lib = 'p/art 雪';
    const map = hsonLiveMap.fromLibraries({
      [lib]: { parts: { [key]: part('<nav hson:part @:local <hson-part at="leaf" value="%{value}"/>/>'), leaf: part('<button hson:part @:local "%{value}"/>'),
        missing: part('<p hson:part <hson-part lib="absent" at="x"/>/>') } },
      page: { document: `<main @:page <hson-part @:first lib=${JSON.stringify(lib)} at=${JSON.stringify(key)} value="one"/> <hson-part lib=${JSON.stringify(lib)} at=${JSON.stringify(key)} value="two"/>/>` },
    });
    const page = doc(map), first = page.q("first")!;
    assert.deepEqual(leaves(page.root()), ["one", "two"]); assert.equal(first.path().at(-1), 0);
    assert.doesNotMatch(JSON.stringify(page.root()), /hson-part/);
    assert.equal(page.q("local"), undefined); assert.ok(page.q("page")); assert.equal("source" in page, false);
    assert.equal("template" in map, false); assert.equal("compose" in map, false);
    const before = page.root(), ledger = owner(map).identityEpoch().issued();
    const parts = map.parts.must(lib);
    parts.at(["leaf", "document"]).set('<i hson:part "edited definition"/>');
    assert.deepEqual(page.root(), before); assert.equal(owner(map).identityEpoch().issued().size, ledger.size);
    const scoped = owner(map).scopedDocumentState(owner(map).libraries()[1]!);
    assert.deepEqual(leaves(scoped.root), ["one", "two"]);
    assert.equal(scoped.scopes.occurrences.length, 4);
    // Complete initial scopes cannot silently fall back to the flat public cut.
    assert.throws(() => map.cut({ documents: ["page"], data: [] }), /Echo\/checkpoint/);
  });
  check("native template remains an ordinary native template, separate from construction connectors", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main <template <p "Kept"/>/>/>' } });
    assert.match(doc(map).render(), /<template><p>Kept<\/p><\/template>/);
    assert.doesNotMatch(JSON.stringify(doc(map).root()), /hson-part/);
  });
  check("missing and unavailable Parts fail immediately and do not publish a delayed consumer", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part/>') } } });
    for (const connector of ['<hson-part lib="missing" at="x"/>', '<hson-part lib="parts" at="missing"/>', '<hson-part at="x"/>', '<hson-part lib="parts"/>']) {
      atomic(map, () => map.addLibraries({ bad: { document: connector } }).commit); assert.throws(() => map.doc.must("bad"));
    }
    map.addLibraries({ missing: { parts: { x: part('<i hson:part/>') } } }); assert.throws(() => map.doc.must("bad"));
    // One topology candidate resolves definitions regardless of entry order.
    map.addLibraries({ page: { document: '<hson-part lib="later" at="x"/>' }, later: { parts: { x: part('<aside hson:part/>') } } });
    const realized = doc(map).root().$_content[0]; assert.ok(is_Node(realized)); assert.equal(realized.$_tag, "aside");
  });
  check("parameters preserve whole scalar types, nested forwarding, partial strings and exact escaping", () => {
    for (const value of ['"<& 雪💚', "", 7, true, false, null]) {
      const connector: HsonNode = { $_tag: "hson-part", $_attrs: { lib: "parts", at: "outer", value }, $_content: [] };
      const map = hsonLiveMap.fromLibraries({ parts: { parts: {
        outer: part('<section hson:part title="%{value}" data-note="prefix:%{value}:end" <hson-part at="leaf" value="%{value}"/>/>'),
        leaf: part('<button hson:part title="%{value}" "%{value}"/>'),
      } }, page: { document: { $_tag: ROOT_TAG, $_content: [connector] } } });
      const root = doc(map).root(), outer = root.$_content[0]; if (!is_Node(outer)) throw Error("outer");
      assert.equal(outer.$_attrs?.title, value); assert.equal(outer.$_attrs?.["data-note"], `prefix:${value}:end`);
      assert.deepEqual(leaves(root), [String(value)]);
      const html = realize_document(root, ""); assert.doesNotMatch(html, /<雪|<script|hson-part/);
      assert.equal(doc(map).render(), html);
      if (typeof value === "string" && value) { assert.match(html, /&lt;/); assert.match(html, /&amp;/); assert.match(html, /&quot;/); }
    }
  });
  check("parameters reject missing, unknown, malformed, structural and invalid placement inputs atomically", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part title="%{required}" "%{required}"/>'),
      malformed: part('<p hson:part "%{bad..name}"/>'), script: part('<script hson:part "%{code}"/>'), handler: part('<p hson:part onclick="%{code}"/>') } } });
    for (const source of ['<hson-part lib="parts" at="x"/>', '<hson-part lib="parts" at="x" required="ok" extra="x"/>',
      '<hson-part lib="parts" at="malformed"/>',
      '<hson-part lib="parts" at="x" required="ok" "content"/>', '<hson-part lib="parts" at="script" code="bad"/>', '<hson-part lib="parts" at="handler" code="bad"/>']) atomic(map, () => map.addLibraries({ bad: { document: source } }).commit);
    assert.throws(() => collection({ style: part('<p hson:part style="color:%{color}"/>') }));
    const opaque: HsonNode = { $_tag: "hson-part", $_attrs: { lib: "parts", at: "x", style: { color: "red" } }, $_content: [] };
    atomic(map, () => map.addLibraries({ bad: { document: { $_tag: ROOT_TAG, $_content: [opaque] } } }).commit, /parameter/);
  });
  check("ordinary runtime insertion and replacement realize before the first publication", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<section hson:part <button "%{value}"/>/>') } }, page: { document: '<main <i/>/>' } });
    let seen = 0; const off = map.commits.observe(() => { seen++; assert.doesNotMatch(JSON.stringify(doc(map).root()), /hson-part/); });
    try {
      doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 1, element('<hson-part lib="parts" at="x" value="inserted"/>'));
      assert.deepEqual(leaves(doc(map).root()), ["inserted"]);
      doc(map).document.content.replace({ kind: "path", path: [0, 0] }, 1, element('<hson-part lib="parts" at="x" value="replaced"/>'));
      assert.deepEqual(leaves(doc(map).root()), ["replaced"]);
    } finally { off(); }
    assert.equal(seen, 2);
    atomic(map, () => doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 0, element('<hson-part lib="parts" at="absent"/>')));
  });


  check("reentrant connector input capture rejects the outer edit and preserves accepted inner data work", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part/>') } }, state: { data: { n: 0 } }, page: { document: '<main <i/>/>' } });
    const before = doc(map).root(); let entered = false;
    const connector = new Proxy(element('<hson-part lib="parts" at="x"/>'), { ownKeys(target) {
      if (!entered) { entered = true; map.data.must("state").at(["n"]).set(1); }
      return Reflect.ownKeys(target);
    } });
    assert.throws(() => doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 1, connector), /changed/);
    assert.equal(entered, true); assert.equal(map.data.must("state").at(["n"]).snap(), 1);
    assert.deepEqual(doc(map).root(), before); assert.equal(map.rev, 1);
  });
  check("batch construction reads coherent final Part definitions in either operation order", () => {
    for (const consumerFirst of [true, false]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part "old"/>') } }, page: { document: '<main <i/>/>' } });
      map.batch(draft => {
        const consumer = () => draft.doc.must("page").content.insert({ kind: "path", path: validate_document_path([0, 0]) }, 1, element('<hson-part lib="parts" at="x"/>'));
        const definition = () => draft.parts.must("parts").at(["x", "document"]).set('<p hson:part "new"/>');
        if (consumerFirst) { consumer(); definition(); } else { definition(); consumer(); }
      });
      assert.deepEqual(leaves(doc(map).root()), ["new"]);
    }
  });
  check("cycles, malformed Part roots, schemas and bounded traversal fail atomically", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<p hson:part <hson-part at="y"/>/>'), y: part('<i hson:part <hson-part at="x"/>/>') } } });
    atomic(map, () => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="x"/>' } }).commit, /cycle/);
    assert.throws(() => collection({ bad: part('<p hson:part/> <q/>') }), /one ordinary/);
    const shell = parse_authored_document_library('<main <hson-part lib="parts" at="x"/>/>');
    assert.throws(() => expand_document_composition("shell", () => ({ root: shell.root }), document_composition_options({ maxDepth: 2 }),
      () => ({ root: parse_authored_document_library('<section <b/>/>').root })), /depth/);
    for (const limits of [{ maxNodes: 1 }, { maxCharacters: 1 }]) assert.throws(() => expand_document_composition("shell", () => ({ root: shell.root }), document_composition_options(limits),
      () => ({ root: parse_authored_document_library('<p/>').root })), /limit/);
    assert.throws(() => document_composition_options({ configuration: { as: "old" } }), /Unknown/);
    assert.equal(document_composition_options({ configuration: { q: "new" } }).configuration?.q, "new");
  });
  check("private structural q promotion remains explicit and the former control fails at every depth", () => {
    const parts = hsonLiveMap.fromLibraries({ parts: { parts: { x: part('<section hson:part @:body as="authored" <b @:label "Text"/>/>') } } });
    const shell = parse_authored_document_library('<main @:shell <hson-part @:slot lib="parts" at="x"/>/>');
    const result = expand_document_composition("shell", () => ({ root: shell.root, quads: shell.declarations }),
      document_composition_options({ configuration: { at: { slot: { at: { label: { q: "caption" } } } } } }), (lib, at) => readPart(parts, lib, at));
    assert.deepEqual(result.quads?.map(entry => entry.name), ["caption", "shell", "slot"]);
    assert.match(JSON.stringify(result.root), /"as":"authored"/);
    for (const configuration of [{ as: "old" }, { at: { slot: { as: "old" } } }, { at: { slot: { at: { label: { as: "old" } } } } }])
      assert.throws(() => document_composition_options({ configuration }), /Unknown/);
  });
  check("canonical restore is source-free and rejects residual construction instructions", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const snapshot = structuredClone(map.capture());
    const forged = { ...snapshot, libraries: snapshot.libraries.map(entry => ({ ...entry, root: { ...entry.root, payload: entry.root.payload.replace('main', 'hson-part') } })) };
    assert.throws(() => install_libraries_snapshot(forged));
    assert.equal("source" in snapshot.libraries[0]!, false);
    assert.equal(ELEM_TAG, "_hson_elem");
  });
  styled_composition_cases(check);
  retained_composition_cases(check);
}

// The automatic-admission cut superseded inert-shell fixtures. Keep their
// distinct structural/configuration proofs at the existing private traversal,
// and their authority/Schema proofs at ordinary admission, without a source store.
function retained_composition_cases(check: (name: string, run: () => void) => void) {
  const source = (text: string) => {
    const parsed = text === "" ? { root: { $_tag: ROOT_TAG, $_content: [] }, declarations: [] } : parse_authored_document_library(text);
    return { root: parsed.root, quads: parsed.declarations };
  };
  const definitions = {
    panel: '<section @:panel title="Panel" <h2 @:heading "Default"/> <div @:body <hson-part @:action at="primary"/>/>/>',
    primary: '<button @:button title="Primary" "Go"/>', secondary: '<a @:button title="Secondary" "Alternate"/>',
  };
  const shell = '<main @:page <hson-part @:first lib="parts" at="panel"/> <hson-part @:second lib="parts" at="panel"/> <footer @:tail/>/>';
  const traverse = (text = shell, configuration?: DocumentCompositionOptions["configuration"]) => expand_document_composition("shell", () => source(text),
    document_composition_options(configuration === undefined ? undefined : { configuration }), (lib, at) => {
      const selected = lib === "other" && at === "secondary" ? '<aside @:button title="Other" "Other"/>' : lib === "parts" ? Reflect.get(definitions, at) : undefined;
      if (typeof selected !== "string") throw Error("Unknown Part"); return source(selected);
    });
  check("retained structural coverage: forest coordinates exact cross-collection context and one read per pair", () => {
    const selected = source('<button/>'); let reads = 0;
    const result = expand_document_composition("shell", () => source('"before" <i @:before/> <main @:page <hson-part @:one lib="a/b" at=""/> <hson-part @:two lib="a/b" at=""/> <footer @:tail/>/> <b @:after/> "after"'), document_composition_options(undefined),
      (lib, at) => { assert.equal(lib, "a/b"); assert.equal(at, ""); reads++; return selected; });
    assert.equal(reads, 1);
    assert.deepEqual(result.quads, [{name:"after",path:[3]}, {name:"before",path:[1]}, {name:"one",path:[2,0,0]}, {name:"page",path:[2]}, {name:"tail",path:[2,0,2]}, {name:"two",path:[2,0,1]}]);
    assert.deepEqual(leaves(result.root), ["before", "after"]);
    for (const text of ['', '"" <i/> "text" <b/>', '"left" "right"', '<template <p/>/>']) assert.deepEqual(traverse(text).root, structuredClone(source(text).root));
  });
  check("retained structural coverage: reusable JS HsonData Transform and governed configurations are equivalent", () => {
    const first = { attrs: {title:"First"}, at: { heading: {q:"caption",text:"One"}, body:{at:{action:{use:{at:"secondary"},text:""}}} } };
    const configuration = {at:{first,second:{at:{action:{use:{lib:"other",at:"secondary"},text:"Cross"}}}}};
    const map = hsonLiveMap.fromLibraries({config:{data:configuration}});
    const expected = traverse(shell, configuration), before = JSON.stringify(configuration);
    for (const input of [Hson.data.from(configuration), Hson.data.from(hsonTransform.fromJson(configuration).toJson().value()),
      Hson.data.from(map.data.must("config").snap()), JSON.parse(before)]) assert.deepEqual(traverse(shell, input), expected);
    assert.equal(JSON.stringify(configuration), before); assert.deepEqual(leaves(expected.root), ["One", "", "Default", "Cross"]);
    assert.deepEqual(expected.quads?.find(entry => entry.name === "caption")?.path, [0,0,0,0,0]);
    const shared = {at:{heading:{text:"Shared"}}};
    assert.deepEqual(leaves(traverse(shell,{at:{first:shared,second:shared}}).root), ["Shared","Go","Shared","Go"]);
    const hostile = traverse('<main <p @:constructor "First"/> <p @:__proto__ "Second"/>/>', JSON.parse('{"at":{"constructor":{"text":"One"},"__proto__":{"text":"Two"}}}'));
    assert.deepEqual(leaves(hostile.root), ["One","Two"]);
    assert.equal(is_Node(expected.root.$_content[0]) && is_Node(expected.root.$_content[0].$_content[0]) && is_Node(expected.root.$_content[0].$_content[0].$_content[0])
      ? expected.root.$_content[0].$_content[0].$_content[0].$_attrs?.title : undefined,"First");
    assert.equal(traverse(shell,{q:"page",at:{first:{q:"first"}}}).quads?.length,4);
  });
  check("retained structural coverage: exact configuration descriptors recursive scope cardinality and resource limits", () => {
    const cyclic: Record<string,unknown> = {}; cyclic.at = {first:cyclic};
    const accessor = {}; Object.defineProperty(accessor,"q",{enumerable:true,get(){throw Error("getter ran");}});
    const hidden = {}; Object.defineProperty(hidden,"text",{value:""});
    for (const configuration of [null, [], cyclic, accessor, hidden, {text:undefined}, {as:"legacy"},
      {at:{first:{use:{quad:"panel"}}}}, {at:{first:{use:{at:"panel",quad:"panel"}}}}, {at:{first:{use:{lib:"parts"}}}},
      {at:{first:{use:{at:"panel",lib:undefined}}}}, {at:{first:{attrs:{title:false}}}}, {at:{first:{q:false}}},
      {at:{first:{at:{"invalid name":{}}}}}, {at:{first:{at:{heading:{use:{at:"primary"}}}}}},
      {at:{heading:{}}}, {at:{first:{at:{tail:{}}}}}, {at:{first:{at:{body:{at:{heading:{}}}}}}},
      {at:{first:{at:{panel:{at:{panel:{}}}}}}}, {at:{first:{q:"renamed"}}}, {at:{first:{q:"page"}}},
      {q:"bad name"}, {q:""},
      {at:{first:{at:{heading:{q:"duplicate"}}},second:{at:{heading:{q:"duplicate"}}}}}]) {
      assert.throws(() => Reflect.apply(traverse,undefined,[shell,configuration]));
    }
    assert.equal(leaves(traverse(shell,Object.assign(Object.create(null),{at:{first:{at:{heading:{text:"Allowed"}}}}})).root)[0],"Allowed");
    for (const value of ['<p/>', 'garbage', Hson.data.from(null), Hson.data.from([]), Hson.data.from("text")]) assert.throws(() => Reflect.apply(traverse,undefined,[shell,value]));
    for (const key of ["maxDepth","maxNodes","maxCharacters"]) for (const value of [0,-1,1.5,NaN,Infinity,4_000_001]) assert.throws(() => document_composition_options({[key]:value}));
    const excessive: Record<string,unknown> = {}; let current = excessive;
    for (let i=0;i<130;i++) {const child={};current.at={target:child};current=child;}
    assert.throws(() => document_composition_options({configuration:excessive}), /depth/);
    assert.throws(() => document_composition_options({configuration:{text:"x".repeat(4_000_001)}}), /limit/);
    for (const text of ['', '"text"', '<i/> <b/>', '"before" <i/>']) assert.throws(() => traverse(text,{q:"received"}), /exactly one/);
    for(const q of ["constructor","__proto__","Pascal_Name"])assert.deepEqual(traverse('<p/>',{q}).quads,[{name:q,path:[0]}]);
  });
  check("retained structural coverage: root string customization empty text exact HTML SVG and identity stripping", () => {
    for (const configuration of [{}, {attrs:{title:"Changed"}}, {text:""}, {attrs:{title:""},text:"Read"}]) {
      const result = traverse('<p title="Default" "Text"/>',configuration);
      assert.equal(result.root.$_content[0] && is_Node(result.root.$_content[0]) ? result.root.$_content[0].$_attrs?.title : undefined, configuration.attrs?.title ?? "Default");
      assert.deepEqual(leaves(result.root), [configuration.text ?? "Text"]);
    }
    for (const text of ['<p/>','<p <b/>/>','<p "one" "two"/>']) assert.throws(() => traverse(text,{text:""}), /sole immediate/);
    for (const configuration of [{attrs:{missing:"x"}}, {attrs:{style:"color:red"}}]) assert.throws(() => traverse('<p title="Default" "Text"/>',configuration));
    const html = {root:doc(hsonLiveMap.fromLibraries({page:{document:hsonTransform.fromTrustedHtml('<p title="Default">Text</p>').toNode()}})).root()};
    const result = expand_document_composition("html",()=>html,document_composition_options({configuration:{attrs:{title:""},text:""}}),()=>{throw Error("unused");});
    assert.deepEqual(result.root,traverse('<p title="Default" "Text"/>',{attrs:{title:""},text:""}).root);
    const svg = traverse('<svg viewBox="0 0 1 1"/>',{attrs:{viewBox:"0 0 2 2"}});
    assert.match(JSON.stringify(svg.root),/0 0 2 2/);
    const exact = parse_hson_exact_runtime('<main @000009001 <p @000009002 "Text"/>/>',{allowTopLevelDocumentText:true});
    const stripped = expand_document_composition("exact",()=>({root:exact}),document_composition_options(undefined),()=>{throw Error("unused");});
    assert.doesNotMatch(JSON.stringify(stripped.root),/quid|00000900/);
  });
  check("retained admission coverage: direct indirect and cross-collection cycles exact controls and ungoverned sources", () => {
    for (const [a,b] of [['<section hson:part <hson-part at="a"/>/>','<aside hson:part/>'], ['<section hson:part <hson-part at="b"/>/>','<aside hson:part <hson-part at="a"/>/>'],
      ['<section hson:part <hson-part lib="other" at="b"/>/>','<aside hson:part <hson-part lib="parts" at="a"/>/>']]) {
      const map=hsonLiveMap.fromLibraries({parts:{ parts: {a:part(a),b:part(b)} },other:{ parts: {b:part(b)} }});
      atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="a"/>'}}).commit,/cycle/);
    }
    const map=hsonLiveMap.fromLibraries({parts:{ parts: {one:part('<p hson:part/>')} },ordinary:{data:{one:part('<p hson:part/>')}},other:{document:'<p/>'}});
    for(const controls of ['lib="ordinary" at="one"','lib="other" at="one"','LIB="parts" AT="one"','lib="parts" at="One"','lib="parts" quad="one"','lib="" at="one"']) atomic(map,()=>map.addLibraries({bad:{document:`<hson-part ${controls}/>`}}).commit);
    assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" lib="other" at="one"/>'}}));
    const privateCycle=source('<section <hson-part @:loop at="safe"/>/>');
    assert.throws(()=>expand_document_composition("shell",()=>source('<hson-part @:slot lib="parts" at="outer"/>'),
      document_composition_options({configuration:{at:{slot:{at:{loop:{use:{at:"outer"}}}}}}}),(_lib,at)=>at==="outer"?privateCycle:source('<p/>')),/cycle/);
  });
  check("retained admission coverage: unselected collection corruption fails before publication and valid Schema remains governing", () => {
    const map=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<p hson:part/>')} },page:{document:'<main/>'}}),aggregate=owner(map);
    const raw=aggregate.root(aggregate.libraries()[0]!), original=map.parts.must("parts").root();
    const before=map.capture(),ledger=aggregate.identityEpoch().issued(),position=aggregate.hostedPosition();let published=0;
    const stop=map.commits.observe(()=>published++);
    overwrite_hson_node(raw,hsonTransform.fromJson({x:part('<p hson:part/>'),late:part('<p')}).toNode());
    try {assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}));}
    finally {overwrite_hson_node(raw,original);stop();}
    assert.deepEqual(map.capture(),before);assert.equal(aggregate.identityEpoch().issued(),ledger);assert.deepEqual(aggregate.hostedPosition(),position);assert.equal(published,0);
    const schema=Hson.schema`<type "document" tag "p" content "empty">`;
    map.addLibraries({valid:{document:'<hson-part lib="parts" at="x"/>',schema}});
    assert.equal(doc(map,"valid").schema.get(),schema);
    atomic(map,()=>doc(map,"valid").document.content.replace({kind:"path",path:[]},0,element('<i/>')));
    map.parts.must("parts").at(["x","document"]).set('<i hson:part/>');
    atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>',schema}}).commit);
  });
  check("retained authority coverage: prepared discard stale reuse exclusive management and both incomplete identity phases", () => {
    const map=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<p hson:part/>')} },page:{document:'<main/>'}}),aggregate=owner(map),manager={};
    aggregate.claimManagement(manager);
    try {
      atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}).commit,/exclusive/);
      const discarded=hostedAdd(map,manager,{discarded:{document:'<aside/>'}});aggregate.discard(discarded.transition);
      atomic(map,()=>aggregate.accept(discarded.transition,"isolate",discarded.afterInstall),/discarded/);
      const stale=hostedAdd(map,manager,{stale:{document:'<i/>'}}),accepted=hostedAdd(map,manager,{accepted:{document:'<footer/>'}});
      aggregate.accept(accepted.transition,"isolate",accepted.afterInstall);
      atomic(map,()=>aggregate.accept(accepted.transition,"isolate",accepted.afterInstall),/already accepted/);
      atomic(map,()=>aggregate.accept(stale.transition,"isolate",stale.afterInstall),/stale/);
    } finally {aggregate.releaseManagement(manager);}
    for(const phase of ["preflight","realize"]) {
      let entered=false;const attempt=()=>{entered=true;map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}});};
      atomic(map,()=>aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[1]!,validate_document_path([0]),mint_hson_node_quid(),{
        preflight(){if(phase==="preflight")attempt();return{apply(){},rollback(){},release(){}};},realize(){if(phase==="realize")attempt();},rollbackRealization(){},
      }),/incomplete identity/);assert.equal(entered,true);
    }
    atomic(map,()=>map.batch(()=>{map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}});}),/batch|staged/i);
  });
  check("retained private traversal coverage: current shell landmarks survive moves and retired addresses reject", () => {
    const map=hsonLiveMap.fromLibraries({layout:{document:'<main <p @:heading "Before"/> <aside/>/>'}}),layout=doc(map,"layout");
    layout.document.content.move({kind:"path",path:[0,0]},0,1);
    const result=compose(map,"layout","page",{configuration:{at:{heading:{text:"Moved"}}}});
    assert.deepEqual(lookup(result,"heading")?.path,[0,0,1]);assert.deepEqual(leaves(result.root()),["Moved"]);
    assert.notEqual(lookup(result,"heading")!.quid,lookup(layout,"heading")!.quid);
    const derived=compose(map,"page","derived");assert.deepEqual(derived.root(),result.root());assert.notEqual(lookup(derived,"heading")!.quid,lookup(result,"heading")!.quid);
    layout.document.content.replace({kind:"path",path:[0,0]},1,element('<p/>'));
    atomic(map,()=>compose(map,"layout","bad",{configuration:{at:{heading:{}}}}),/Unknown composition QUAD/);
    layout.css.sel('main').setProp('color','red');atomic(map,()=>compose(map,"layout","bad"),/managed stylesheet/);
  });
  check("retained admission coverage: one complete addition independent inline storage and selected empty/ordering/global CSS", () => {
    for(const css of [undefined,'','@layer first{}@layer second{}','@property --tone{syntax:"*";inherits:false}','@keyframes once{from{opacity:0}}']) {
      const map=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<a hson:part style="color:blue" "Text"/>',css),unused:part('<p hson:part/>','p{--unvisited:yes}')} }}),aggregate=owner(map);
      const before=map.capture(),root=aggregate.root(aggregate.libraries()[0]!);let commits=0;
      const off=map.commits.observe(()=>{commits++;assert.doesNotMatch(JSON.stringify(doc(map).root()),/hson-part/);});
      try{map.addLibraries({page:{document:'<main <hson-part lib="parts" at="x"/> <hson-part lib="parts" at="x"/>/>'}});}
      catch(error){
        // Global definitions intentionally conflict across occurrences.
        if(css?.startsWith('@property')||css?.startsWith('@keyframes')){assert.match(String(error),/Duplicate @/);assert.equal(commits,0);assert.deepEqual(map.capture(),before);continue;}
        throw error;
      }finally{off();}
      assert.equal(commits,1);assert.equal(map.rev,1);assert.equal(aggregate.root(aggregate.libraries()[0]!),root);
      assert.equal(JSON.stringify(aggregate.captureSemanticCheckpoint().libraries[0]!.root),JSON.stringify(root));assert.doesNotMatch(doc(map).css.snapshot(),/unvisited/);
      const graph=aggregate.root(aggregate.libraries()[1]!);
      const main=graph.$_content[0];if(!is_Node(main)||!is_Node(main.$_content[0]))throw Error("main");
      const [a,b]=main.$_content[0].$_content;if(!is_Node(a)||!is_Node(b))throw Error("links");
      assert.notEqual(a,b);assert.notEqual(a.$_attrs,b.$_attrs);assert.notEqual(a.$_attrs?.style,b.$_attrs?.style);assert.notEqual(a.$_content,b.$_content);
      assert.throws(()=>doc(map).document.attrs.set({kind:"path",path:[0,0,0]},'title','Edited'),/complete scoped effects/);
      assert.equal(doc(map).document.attrs.get({kind:"path",path:[0,0,1]},'title'),undefined);
      if(!css){assert.equal(doc(map).render(),realize_document(doc(map).root(),""));assert.match(doc(map).render(),/color.*blue/);}
      else assert.match(doc(map).css.snapshot(),/@layer first/);
      assert.equal(aggregate.documentOverlay(aggregate.libraries()[1]!).size,2);
    }
    const structural=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<section hson:part <style "p{color:red}"/>/>')} },page:{document:'<hson-part lib="parts" at="x"/>'}});
    assert.deepEqual(leaves(doc(structural).root()),['p{color:red}']);assert.equal(doc(structural).css.snapshot(),'');
  });
  check("retained authority coverage: configuration reflection and source reads fence every independently accepted inner change", () => {
    for(const phase of ["configuration","source"]) for(const change of ["data","identity","authority","topology"]) {
      const map=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<p hson:part/>')} },page:{document:'<main/>'}}),aggregate=owner(map);
      let entered=false,after:ReturnType<LiveMap["capture"]>|undefined;
      const inner=()=>{entered=true;
        if(change==="data")map.parts.must("parts").at(["x","document"]).set('<i hson:part/>');
        else if(change==="identity")aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[1]!,validate_document_path([0]),mint_hson_node_quid());
        else if(change==="authority")aggregate.setInitialHostedAuthority({...aggregate.hostedPosition().authority});
        else map.addLibraries({inner:{document:'<aside/>'}});
        after=map.capture();
      };
      if(phase==="configuration") {
        const configuration=new Proxy({}, {ownKeys(target){if(!entered)inner();return Reflect.ownKeys(target);}});
        assert.throws(()=>compose(map,"page","bad",{configuration}),/changed during capture/);
      } else {
        const raw=aggregate.root(aggregate.libraries()[0]!),descriptor=Object.getOwnPropertyDescriptor(Reflect,"getOwnPropertyDescriptor")!,original=Reflect.getOwnPropertyDescriptor;
        Object.defineProperty(Reflect,"getOwnPropertyDescriptor",{...descriptor,value(input:object,key:PropertyKey){
          if(!entered&&input===raw&&key==="$_tag")inner();return original(input,key);
        }});
        try{assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/changed during capture/);}
        finally{Object.defineProperty(Reflect,"getOwnPropertyDescriptor",descriptor);}
      }
      assert.equal(entered,true);assert.deepEqual(map.capture(),after);assert.throws(()=>map.doc.must("bad"));
    }
  });
  check("retained authority coverage: detached private candidates keep coherent values and late management/staleness retains inner work", () => {
    const map=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<p hson:part/>')} },page:{document:'<main "Before"/>'}});
    const descriptor=Object.getOwnPropertyDescriptor(Object,"freeze")!,freeze=Object.freeze;let entered=false;
    Object.defineProperty(Object,"freeze",{...descriptor,value<T>(value:T):Readonly<T>{
      if(!entered&&typeof value==="object"&&value!==null&&Reflect.get(value,"name")==="derived"&&Object.hasOwn(value,"hsonSchema")){
        entered=true;map.parts.must("parts").at(["x","document"]).set('<i hson:part/>');
      }return freeze(value);
    }});
    try{assert.deepEqual(leaves(compose(map,"page","derived").root()),["Before"]);}
    finally{Object.defineProperty(Object,"freeze",descriptor);}
    assert.equal(entered,true);assert.equal(map.rev,2);
    for(const management of [true,false]) {
      const m=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<p hson:part/>')} }}),aggregate=owner(m),manager={};
      const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,"toJSON");let entered=false;
      Object.defineProperty(Object.prototype,"toJSON",{configurable:true,value(this:unknown){
        if(!entered&&typeof this==="object"&&this!==null&&Reflect.get(this,"kind")==="library-add"){
          entered=true;if(management)aggregate.claimManagement(manager);else m.parts.must("parts").at(["x","document"]).set('<i hson:part/>');
        }return this;
      }});
      try{assert.throws(()=>m.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/exclusive|changed|stale|revisions/);}
      finally{if(descriptor===undefined)Reflect.deleteProperty(Object.prototype,"toJSON");else Object.defineProperty(Object.prototype,"toJSON",descriptor);if(management)aggregate.releaseManagement(manager);}
      assert.equal(entered,true);assert.throws(()=>m.doc.must("bad"));
      assert.equal(m.rev,management?0:1);if(!management)assert.equal(m.parts.must("parts").at(["x","document"]).snap(),'<i hson:part/>');
    }
  });
  check("retained authority coverage: a completed inner styled admission survives outer allocation rejection", () => {
    const map=hsonLiveMap.fromLibraries({parts:{ parts: {x:part('<p hson:part/>','p{color:red}')} }}),aggregate=owner(map);
    let entered=false,after:ReturnType<typeof aggregate.captureSemanticCheckpoint>|undefined;
    allocator(aggregate.identityEpoch().owner,()=>{
      if(!entered){entered=true;map.addLibraries({inner:{document:'<hson-part lib="parts" at="x"/>'}});after=aggregate.captureSemanticCheckpoint();}
      return mint_hson_node_quid();
    });
    try{assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/changed|stale/);}
    finally{allocator(aggregate.identityEpoch().owner,undefined);}
    assert.equal(entered,true);assert.deepEqual(aggregate.captureSemanticCheckpoint(),after);assert.equal(map.rev,1);assert.equal(aggregate.identityEpoch().issued().size,1);
    assert.match(doc(map,"inner").css.snapshot(),/color:red/);assert.throws(()=>map.doc.must("bad"));
  });
}

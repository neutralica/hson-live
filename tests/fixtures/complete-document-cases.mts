import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { complete_document, assert_complete_document } from "../../src/internal/complete-document.ts";
import { normalize_document_root } from "../../src/api/livemap/livemap.document.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { prepare_document_install } from "../../src/api/livemap/livemap.document.install.ts";
import { make_livemap_mirror_from_semantic_checkpoint_internal as restore, prepare_hosted_livemap_library_add_internal as hostedAdd } from "../../src/api/livemap/livemap.libraries.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { encode_hosted_root, encode_scoped_effect_graph_operation, type PortableAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { atomic, doc, part, element } from "./livemap-document-composition-cases.mts";

const graph = (source: string) => normalize_document_root(hsonTransform.fromHson(source).toNode());
export function complete_document_cases(check: (name: string, run: () => void) => void) {
  check("complete Document: conservative single-root completion is pure and idempotent", () => {
    for (const source of ['<html <head/> <body/>/>', '<html <body/>/>', '<html <head/>/>', '<html/>', '<body/>', '<head <title "Welcome"/>/>', '<main <h1 "Welcome"/>/>', '<html <main/>/>', '<html <head/> <main/> <aside/>/>']) {
      const input = graph(source), before = JSON.stringify(input), completed = complete_document(input);
      assert.equal(JSON.stringify(input), before); assert.equal(complete_document(completed), completed);
      const map = hsonLiveMap.fromLibraries({ page: { document: source } });
      assert_complete_document(doc(map).root());
      assert.match(doc(map).render(), /^<!doctype html><html><head>/);
      assert.equal(owner(map).documentOverlay(owner(map).libraries()[0]!).size, 0);
    }
    const input = graph('<html <head/> <body <main/>/>/>');
    assert.equal(complete_document(input), input);
    for (const source of ['"text"', '""', '<main/><aside/>', '<head/><main/>', '<html <head/><head/>/>', '<html <body/><body/>/>', '<html <body/><main/>/>', '<html <main/><head/>/>', '<html <title "No guessing"/>/>', '<main <body/>/>', '<html <html/>/>', '<p <div/>/>', '<button <button/>/>', '<table <div/>/>', '<select <div/>/>', '<img <span/>/>', '<svg <div/>/>']) {
      assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: source } }), source);
    }
  });
  check("complete Document: root Parts and receiving coordinates belong to authored subjects", () => {
    for (const source of ['<html hson:part @:root/>', '<head hson:part @:root/>', '<body hson:part @:root/>', '<main hson:part @:root/>']) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { page: part(source) } }, page: { document: '<hson-part @:received lib="parts" at="page"/>' } });
      const rootPath = source.startsWith('<html') ? [0] : source.startsWith('<head') ? [0,0,0] : source.startsWith('<body') ? [0,0,1] : [0,0,1,0,0];
      assert.deepEqual(lookup(doc(map), 'received')!.path, rootPath);
      const authority = owner(map), state = authority.scopedDocumentState(authority.libraries()[1]!);
      assert.deepEqual(state.scopes.occurrences[0]!.root, rootPath);
      assert.equal(authority.documentOverlay(authority.libraries()[1]!).size, 1);
    }
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      page: { ...part('<main hson:part @:root <hson-part @:nested at="child" label="%{label}"/>/>'), css: { color: 'red' } },
      child: { ...part('<button hson:part @:button "%{label}"/>'), css: { color: 'blue' } },
    } }, page: { document: '<hson-part @:page lib="parts" at="page" label="Save"/>' } });
    const authority = owner(map), id = authority.libraries()[1]!, state = authority.scopedDocumentState(id);
    assert.deepEqual(state.scopes.occurrences.map(scope => [scope.root, scope.parent]), [
      [[0,0,1,0,0], null], [[0,0,1,0,0,0,0], [0,0,1,0,0]],
    ]);
    assert.equal(authority.documentOverlay(id).size, 2);
    assert.equal(authority.documentOverlay(id).quidAtPath(validate_document_path([0])), undefined);
    assert.match(doc(map).render(), /<head><style data-hson-managed-document-css="managed">/);
    assert.match(doc(map).render(), /<button[^>]*>Save<\/button>/);
    atomic(map, () => map.addLibraries({ bad: { document: '<html <body/><body/>/>' } }));
    atomic(map, () => map.addLibraries({ optional: { parts: { absent: part('<main hson:part part:optional/>') } }, absent: { document: '<hson-part lib="optional" at="absent"/>' } }));
  });
  check("complete Document: local and hosted additions complete before installation", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    map.addLibraries({ local: { document: '<body <p "Local"/>/>' } });
    assert_complete_document(doc(map, 'local').root());
    const authority = owner(map), manager = {};
    authority.claimManagement(manager);
    try {
      const prepared = hostedAdd(map, manager, { hosted: { document: '<head <title "Hosted"/>/>' } });
      authority.accept(prepared.transition, 'isolate', prepared.afterInstall);
      assert_complete_document(doc(map, 'hosted').root());
    } finally { authority.releaseManagement(manager); }
  });
  check("complete Document: atomic graph and CSS failures preserve canonical state and ledgers", () => {
    for (const scoped of [false, true]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { main: part('<main hson:part/>') } }, page: { document: scoped ? '<hson-part lib="parts" at="main"/>' : '<main/>' } });
      const page = doc(map), children = { kind: 'path' as const, path: [0,0] };
      atomic(map, () => page.document.content.remove(children, 0));
      atomic(map, () => page.document.content.remove(children, 1));
      atomic(map, () => page.document.content.replace({ kind: 'path', path: [] }, 0, element('<main/>')));
      atomic(map, () => page.document.content.insert(children, 0, element('<head/>')));
      map.batch(stage => {
        stage.doc.page.content.remove(children, 0);
        stage.doc.page.content.insert(children, 0, element('<head <title "Changed"/>/>'));
      });
      assert.match(page.render(), /<title>Changed<\/title>/);
      page.document.attrs.set({ kind: 'path', path: [0,0,1] }, 'data-hson-managed-document-css', 'authored');
      atomic(map, () => page.css.sel('main').setProp('color', 'red'));
    }
  });
  check("complete Document: authored whole-root replacement completes before publishing", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    map.batch(stage => stage.doc.page.graph({ domain: 'graph', op: 'replace-root', mode: 'document', root: graph('<article "New"/>') }));
    assert.match(doc(map).render(), /<body><article>New<\/article><\/body>/);
    assert_complete_document(doc(map).root());
    atomic(map, () => map.batch(stage => stage.doc.page.graph({ domain: 'graph', op: 'replace-root', mode: 'document', root: graph('<main/><aside/>') })));
  });
  check("complete Document: exact snapshots and checkpoints reject historical incomplete roots", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const incomplete = graph('<main/>');
    atomic(map, () => prepare_document_install({ kind: 'hson-document', mode: 'document', rev: 0, root: incomplete }, 'document'), /complete/);
    const checkpoint = owner(map).captureSemanticCheckpoint();
    const invalid = { ...checkpoint, libraries: checkpoint.libraries.map(library => ({ ...library, root: incomplete })) };
    assert.throws(() => restore(invalid), /complete/);
    atomic(map, () => owner(map).installSemanticCheckpoint(invalid), /complete/);
    const snapshot = map.capture();
    atomic(map, () => map.restore({ ...snapshot, libraries: snapshot.libraries.map(library => ({ ...library, root: encode_hosted_root(incomplete) })) }), /complete/);
    const scoped = owner(map).prepareScopedDocument(owner(map).libraries()[0]!, { root: graph('<main/>') });
    const capturedScoped = owner(map).captureScopedDocument(scoped);
    atomic(map, () => owner(map).prepareScopedDocumentRestoration(owner(map).libraries()[0]!, { ...capturedScoped, root: incomplete }), /complete/);
    const position = owner(map).hostedPosition();
    const replay: PortableAggregateCommit = {
      format: 'hson-portable-aggregate-commit', authority: position.authority, registryDigest: position.registryDigest,
      prevRev: map.rev, rev: map.rev + 1, operations: [{ library: 'page', domain: 'graph', kind: 'remove-content',
        format: 'hson-hosted-client-graph-op', payload: encode_scoped_effect_graph_operation({ domain: 'graph', op: 'remove-content',
          target: { kind: 'path', path: validate_document_path([0,0]) }, index: 0 }) }],
    };
    atomic(map, () => owner(map).replayClientHosted(replay), /head|body|complete/);
    atomic(map, () => owner(map).replayDurableHosted(replay), /head|body|complete/);
    const valid = restore(checkpoint);
    assert_complete_document(valid.doc.must('page').root());
    const captured = doc(map).root(), html = captured.$_content[0];
    assert.ok(is_Node(html)); assert.equal(html.$_tag, 'html');
  });
}

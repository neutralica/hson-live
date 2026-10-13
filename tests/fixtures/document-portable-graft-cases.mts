import assert from "node:assert/strict";
import type { LiveMapSnapshot } from "../../src/types/livemap.types.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { ssr_subject_fixture } from "./document-ssr-subjects-cases.mts";
import { cut_document_ssr_internal, restore_portable_document_receiver_internal, make_livemap_from_authored_libraries_internal, compose_livemap_document_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { hsonTransform } from "../../src/index.ts";

function fixture() {
  const source = ssr_subject_fixture(), cut = cut_document_ssr_internal(source.map, { html: "page" }, source.demanded);
  const receiver = restore_portable_document_receiver_internal(JSON.parse(JSON.stringify(cut.libs)));
  const aggregate = owner(receiver.map), library = aggregate.libraries()[0]!;
  const document = receiver.map.lib("page");
  if (document.mode !== "document") throw Error("Expected document");
  return { source, cut, ...receiver, aggregate, library, document };
}
export function document_portable_graft_cases(check: (name: string, run: () => void) => void) {
  check("final-only receiver binds coherent CSS to fresh sparse issued identities without source mutation", () => {
    const f = fixture(), before = f.source.map.capture(), ledger = f.aggregate.identityEpoch().issued();
    const issued = enumerate_livemap_issued_quids(ledger), sourceIssued = enumerate_livemap_issued_quids(f.source.aggregate.identityEpoch().issued());
    assert.equal(issued.length, 7);
    for (const quid of issued) assert.equal(sourceIssued.includes(quid), false);
    const candidate = f.aggregate.preparePortableDocumentHandoff(f.library, f.correspondence);
    assert.equal(f.aggregate.identityEpoch().issued(), ledger);
    assert.match(candidate.portableCss, /hson\\:quad/); assert.match(candidate.receivingCss, /hson\\:quid/);
    candidate.acceptCss(); candidate.assertCurrent(); candidate.acceptCss();
    assert.equal(f.document.css.snapshot(), candidate.receivingCss);
    assert.equal(f.aggregate.identityEpoch().issued(), ledger);
    assert.deepEqual(f.source.map.capture(), before);
    assert.throws(f.correspondence.assertCurrent, /changed/);
  });
  check("explicit authored and disposable dispositions survive receiving identity binding", () => {
    const f = fixture(), candidate = f.aggregate.preparePortableDocumentHandoff(f.library, f.correspondence);
    candidate.acceptCss();
    assert.ok(lookup(f.document, "_987654321"));
    for (const name of ["_012345678", "_123456789"]) assert.equal(lookup(f.document, name), undefined);
    assert.equal(f.map.capture().libraries[0]!.quads!.some(entry => entry.disposition === "disposable"), false);
    for (const entry of f.correspondence.associations) {
      assert.equal(f.aggregate.documentOverlay(f.library).quidAtPath(entry.path), entry.quid);
      assert.deepEqual(f.aggregate.documentOverlay(f.library).pathForQuid(entry.quid), entry.path);
    }
  });
  check("stale correspondence and prepared handoffs reject on graph and identity epoch changes", () => {
    const f = fixture(), candidate = f.aggregate.preparePortableDocumentHandoff(f.library, f.correspondence);
    f.document.at([0]).asElement()!.attrs.set("title", "changed");
    assert.throws(() => f.aggregate.preparePortableDocumentHandoff(f.library, f.correspondence));
    assert.throws(candidate.acceptCss); assert.throws(candidate.assertCurrent);
    const next = fixture(), prepared = next.aggregate.preparePortableDocumentHandoff(next.library, next.correspondence);
    next.aggregate.restorePortableLibrariesWithCorrespondence(next.cut.libs);
    assert.throws(prepared.acceptCss);
  });
  check("wrong authority, forged candidate and altered subject path reject without publication", () => {
    const f = fixture(), other = fixture(), before = f.map.capture();
    let events = 0; const stop = f.map.commits.observe(() => events++);
    try {
      assert.throws(() => f.aggregate.preparePortableDocumentHandoff(f.library, other.correspondence));
      assert.throws(() => f.aggregate.preparePortableDocumentHandoff(f.library, { ...f.correspondence,
        associations: f.correspondence.associations.map(entry => ({ ...entry, path: validate_document_path([0]) })) }));
      const candidate = f.aggregate.preparePortableDocumentHandoff(f.library, f.correspondence);
      assert.throws(() => f.aggregate.assertPortableDocumentHandoff({ ...candidate }));
      assert.throws(() => other.aggregate.assertPortableDocumentHandoff(candidate));
    } finally { stop(); }
    assert.deepEqual(f.map.capture(), before); assert.equal(events, 0);
  });
  check("unsupported unresolved opaque and mixed CSS reject before authoritative translation", () => {
    for (const selector of ['[hson\\:quad="absent"]', '[hson\\:quad^="first"]', '[hson\\:quid="012345678"]', ':future([hson\\:quad="first"])']) {
      const f = fixture();
      const snapshot: LiveMapSnapshot = { ...f.cut.libs, libraries: f.cut.libs.libraries.map(entry => ({ ...entry, css: {
        rules: [{ ruleKey: "test", selector, scopes: [], declarations: [["color", "red"]] }],
        properties: [], keyframes: [], order: [{ kind: "rule", ruleKey: "test", scopes: [] }],
      } })) };
      const restored = f.aggregate.restorePortableLibrariesWithCorrespondence(snapshot);
      const before = f.map.capture();
      assert.throws(() => f.aggregate.preparePortableDocumentHandoff(f.library, restored));
      assert.deepEqual(f.map.capture(), before);
    }
  });
  check("CSS acceptance does not renew a fence across reentrant authoritative changes", () => {
    const f = fixture(), candidate = f.aggregate.preparePortableDocumentHandoff(f.library, f.correspondence);
    let once = false;
    const stop = f.map.commits.observe(() => { if (!once) { once = true; f.document.at([0]).asElement()!.attrs.set("title", "accepted"); } });
    try { assert.throws(candidate.acceptCss, /changed/); } finally { stop(); }
    assert.equal(f.document.at([0]).asElement()!.attrs.get("title"), "accepted");
    assert.equal(f.document.css.snapshot(), candidate.receivingCss);
    assert.throws(candidate.assertCurrent);
  });
  check("repeated independent receiving instances have separate correspondence", () => {
    const one = fixture(), two = restore_portable_document_receiver_internal(one.cut.libs), aggregate = owner(two.map);
    const ids = new Set(one.correspondence.associations.map(entry => entry.quid));
    for (const entry of two.correspondence.associations) assert.equal(ids.has(entry.quid), false);
    const candidate = aggregate.preparePortableDocumentHandoff(aggregate.libraries()[0]!, two.correspondence);
    candidate.acceptCss(); assert.equal(one.document.css.snapshot().includes('hson\\:quad'), true);
  });
  check("final-only composed receiver binds two independently owned component subjects", () => {
    const map = make_livemap_from_authored_libraries_internal({ layout: { document:'<html <head/> <body <hson-template lib="component"/> <hson-template lib="component"/>/>/>' }, component:{ document:'<button @:source/>' } });
    const page = compose_livemap_document_internal(map, "layout", "final"), aggregate = owner(map), library = aggregate.libraries().at(-1)!;
    const demanded = ["345678901", "456789012"];
    aggregate.acquireLocalDocumentIdentity(library, validate_document_path([0,0,1,0,0]), demanded[0]!);
    aggregate.acquireLocalDocumentIdentity(library, validate_document_path([0,0,1,0,1]), demanded[1]!);
    page.css.stylesheet('[hson\\:quid="345678901"]{color:red}[hson\\:quid="456789012"]{color:blue}');
    const cut = cut_document_ssr_internal(map, {html:"final",documents:["final"],data:[]}, demanded);
    const receiver = restore_portable_document_receiver_internal(cut.libs), owning = owner(receiver.map);
    assert.equal(receiver.correspondence.associations.length, 2);
    assert.throws(() => receiver.map.lib("component")); assert.throws(() => receiver.map.lib("layout"));
    const candidate = owning.preparePortableDocumentHandoff(owning.libraries()[0]!, receiver.correspondence);
    candidate.acceptCss();
    assert.notEqual(receiver.correspondence.associations[0]!.quid, receiver.correspondence.associations[1]!.quid);
    for (const entry of receiver.correspondence.associations) {
      assert.equal(entry.disposition, "disposable"); assert.equal(lookup(receiver.map.lib("final"), entry.name), undefined);
      assert.ok(candidate.receivingCss.includes(entry.quid)); assert.equal(demanded.includes(entry.quid), false);
    }
  });
  check("malformed collision and wrong-subject portable admissions are atomic", () => {
    const f = fixture(), before = f.map.capture(), ledger = f.aggregate.identityEpoch().issued();
    const entries = f.cut.libs.libraries[0]!.quads!;
    for (const quads of [
      entries.map((entry, index) => index === 1 ? {...entry, name:entries[0]!.name} : entry),
      entries.map((entry, index) => index === 1 ? {...entry, path:entries[0]!.path} : entry),
      entries.map((entry, index) => index === 0 ? {...entry, path:validate_document_path([0,0])} : entry),
    ]) {
      const snapshot: LiveMapSnapshot = {...f.cut.libs, libraries:f.cut.libs.libraries.map(entry => ({...entry,quads}))};
      assert.throws(() => f.aggregate.restorePortableLibrariesWithCorrespondence(snapshot));
      assert.deepEqual(f.map.capture(), before); assert.equal(f.aggregate.identityEpoch().issued(), ledger);
    }
  });
  check("portable carriers remain forbidden in normal HTML ingress", () => {
    for (const attr of ['hson:quad="first"', 'hson:quid="012345678"', 'hson:quad="first" hson:quid="012345678"']) {
      assert.throws(() => hsonTransform.fromTrustedHtml(`<main ${attr}></main>`));
    }
  });
}

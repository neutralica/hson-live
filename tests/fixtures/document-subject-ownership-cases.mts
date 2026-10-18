import assert from "node:assert/strict";
import { hsonLiveMap } from "../../src/index.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { compose_livemap_document_internal as compose } from "../../src/api/livemap/livemap.libraries.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import type { DocumentQuadOccurrenceScope } from "../../src/api/livemap/livemap.document.scoped-quad.ts";

const components = { parts: { button: { kind: "document", document: '<button @:source/>' } } } as const;
const layout = { document: '<html <head/> <body <hson-part lib="components" at="button"/> <hson-part lib="components" at="button"/>/>/>' };
const first = path([0,0,1,0,0]), second = path([0,0,1,0,1]);

function observe(map: LiveMap) {
  const a = owner(map);
  return { graph: a.inspect(), checkpoint: a.captureSemanticCheckpoint(), revision: map.rev,
    registry: a.hostedRegistry(), position: a.hostedPosition(),
    epoch: a.identityEpoch().current(), ledger: a.identityEpoch().issued(),
    libraries: a.inspect().libraries.map(entry => ({ root: a.root(entry.identity),
      ...(entry.mode !== "document" ? {} : { overlay: a.documentOverlay(entry.identity),
        scopes: a.documentScopes(entry.identity), css: a.stylesheet(entry.identity) }) })),
  };
}

function rejects_unchanged(map: LiveMap, run: () => unknown, message: RegExp) {
  const a = owner(map), before = observe(map), fence = a.captureFence();
  let observations = 0;
  const stops = [map.commits.observe(() => observations++), a.observeAuthorityPosition(() => observations++),
    a.observeAuthorityPosition(() => observations++, "installed")];
  try { assert.throws(run, { message }); } finally { stops.forEach(stop => stop()); }
  const after = observe(map);
  assert.deepEqual(after, before); assert.equal(observations, 0); fence();
  assert.equal(after.registry, before.registry); assert.equal(after.epoch, before.epoch); assert.equal(after.ledger, before.ledger);
  after.libraries.forEach((entry, index) => {
    const previous = before.libraries[index]!;
    assert.equal(entry.root, previous.root); assert.equal(entry.overlay, previous.overlay);
    assert.equal(entry.scopes, previous.scopes); assert.equal(entry.css, previous.css);
  });
}

export function document_subject_ownership_cases(check: (name: string, run: () => void) => void) {
  check("initial dynamic and recomposed Part subjects already have exact local owners", () => {
    for (const admission of ["initial", "dynamic", "composed"] as const) {
      const map = hsonLiveMap.fromLibraries(admission === "dynamic" ? { components } : { layout, components });
      if (admission === "dynamic") map.addLibraries({ layout });
      const a = owner(map), source = a.libraries()[a.hostedRegistry().libraries.findIndex(entry => entry.name === "layout")]!;
      const sourceScopes = a.documentScopes(source), sourceOverlay = a.documentOverlay(source);
      assert.ok(sourceScopes, `${admission} admission installs occurrence scopes`);
      const sourceRoot = a.root(source), ledger = a.identityEpoch().issued(), epoch = a.identityEpoch().current();
      const page = admission === "composed" ? compose(map, "layout", "final") : map.lib("layout");
      if (page.mode !== "document") throw Error("document");
      const library = admission === "composed" ? a.libraries().at(-1)! : source;
      const scopes = a.documentScopes(library), overlay = a.documentOverlay(library);
      assert.ok(scopes, "The receiving Library retains complete occurrence scopes");
      assert.ok(canonical_hson_graph_equal(a.root(library), sourceRoot));
      assert.equal(scopes.owner, library); assert.equal(scopes.occurrences.length, 2);
      for (const [index, coordinate] of [first, second].entries()) {
        const quid = overlay.quidAtPath(coordinate)!;
        const occurrence: DocumentQuadOccurrenceScope = scopes.occurrences[index]!;
        assert.equal(occurrence.rootQuid, quid); assert.equal(occurrence.bindings[0]!.quid, quid);
        assert.equal(occurrence.bindings[0]!.name, "source"); assert.ok(a.identityEpoch().issued().has(quid));
        assert.deepEqual(overlay.pathForQuid(quid), coordinate);
        if (admission === "composed") {
          assert.notEqual(quid, sourceScopes.occurrences[index]!.rootQuid);
          assert.notEqual(occurrence.lifetime, sourceScopes.occurrences[index]!.lifetime);
        }
        let preflight = false;
        rejects_unchanged(map, () => a.acquireLocalDocumentIdentity(library, coordinate, "345678901", {
          preflight() { preflight = true; throw Error("duplicate claim reached participant"); },
          realize() {}, rollbackRealization() {},
        }), /^Local document identity target is already claimed\.$/);
        assert.equal(preflight, false); assert.equal(a.identityEpoch().issued().has("345678901"), false);
      }
      // Fresh dynamic scoped admission retains every existing subject and lifetime.
      const retained = observe(map);
      map.addLibraries({ later: layout });
      const after = observe(map);
      assert.deepEqual(after.libraries.slice(0, retained.libraries.length), retained.libraries);
      retained.libraries.forEach((entry, index) => {
        assert.equal(after.libraries[index]!.root, entry.root); assert.equal(after.libraries[index]!.overlay, entry.overlay);
        assert.equal(after.libraries[index]!.scopes, entry.scopes); assert.equal(after.libraries[index]!.css, entry.css);
      });
      assert.equal(a.identityEpoch().current(), epoch);
      assert.equal(a.documentScopes(source), sourceScopes); assert.equal(a.documentOverlay(source), sourceOverlay); assert.equal(a.root(source), sourceRoot);
      for (const scope of sourceScopes.occurrences) assert.ok(ledger.has(scope.rootQuid) && a.identityEpoch().issued().has(scope.rootQuid));
      rejects_unchanged(map, () => a.captureDocumentSsr(library, []), /Scoped document SSR/);
      rejects_unchanged(map, () => page.render(), /Scoped document capture/);
    }
  });
  check("sparse acquisition succeeds while live duplicates and retired Part subjects reject atomically", () => {
    const map = hsonLiveMap.fromLibraries({ layout, components }), a = owner(map), library = a.libraries()[0]!;
    const head = path([0,0,0]), html = path([0]), scopes = a.documentScopes(library)!;
    const retired = scopes.occurrences[0]!, survivor = scopes.occurrences[1]!;
    const before = observe(map); let observations = 0;
    const off = map.commits.observe(() => observations++);
    try { a.acquireLocalDocumentIdentity(library, head, "345678901"); } finally { off(); }
    assert.equal(observations, 0); assert.equal(map.rev, before.revision);
    assert.equal(a.root(library), before.libraries[0]!.root); assert.equal(a.documentScopes(library), scopes);
    assert.equal(a.stylesheet(library), before.libraries[0]!.css); assert.equal(a.identityEpoch().current(), before.epoch);
    assert.equal(a.documentOverlay(library).quidAtPath(head), "345678901");
    assert.ok(a.identityEpoch().issued().has("345678901"));
    rejects_unchanged(map, () => a.acquireLocalDocumentIdentity(library, head, "456789012"), /already claimed/);
    rejects_unchanged(map, () => a.acquireLocalDocumentIdentity(library, html, "345678901"), /already active at canonical path/);
    const manager = {}; a.claimManagement(manager);
    try {
      a.accept(a.prepareManaged(manager, [{ kind: "graph", target: a.target(library, [0,0,1,0]),
        operation: { domain: "graph", op: "remove-content", target: { kind: "path", path: path([0,0,1,0]) }, index: 0 } }], true));
    } finally { a.releaseManagement(manager); }
    assert.equal(a.documentOverlay(library).pathForQuid(retired.rootQuid), undefined);
    assert.ok(a.identityEpoch().issued().has(retired.rootQuid));
    assert.equal(a.documentScopes(library)!.occurrences.length, 1);
    assert.equal(a.documentScopes(library)!.occurrences[0]!.lifetime, survivor.lifetime);
    assert.deepEqual(a.documentOverlay(library).pathForQuid(survivor.rootQuid), first);
    rejects_unchanged(map, () => a.acquireLocalDocumentIdentity(library, html, retired.rootQuid), /already issued/);
    rejects_unchanged(map, () => a.acquireLocalDocumentIdentity(library, first, retired.rootQuid), /already claimed/);
    a.acquireLocalDocumentIdentity(library, html, "456789012");
    assert.equal(a.documentOverlay(library).quidAtPath(html), "456789012");
    assert.ok(a.identityEpoch().issued().has(retired.rootQuid));
  });
}

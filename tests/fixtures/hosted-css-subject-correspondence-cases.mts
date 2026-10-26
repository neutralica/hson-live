import assert from "node:assert/strict";
import { bind_locus_http, continue_hosted_document, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { admit_hson_data_input } from "../../src/api/data/hson-data.ts";
import { create_registry_locus_internal } from "../../src/api/locus/locus.registry.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { document_css_subjects_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { lookup_document_quad_internal } from "../../src/api/livemap/livemap.document.quad.ts";
import { make_livemap_document_css } from "../../src/api/livemap/livemap.css.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { echo_map_internal, locus_map_internal } from "../../src/internal/governor-maps.ts";
import { empty_portable_document_stylesheet, encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { document_css_state_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { deferred, hosted_css_authority_fixture } from "../helpers/hosted-css-authority-fixture.mts";
import type { LiveMap, LiveMapCssOp } from "../../src/types/livemap.types.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { document_scoped_libraries_semantically_equal, type PortableDocumentScopedLibrary } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { FakeElement, install_fake_document } from "../helpers/fake-document.mts";

async function eventually(check: () => boolean) {
  for (let i = 0; i < 200; i++) { try { if (check()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 2)); }
  throw Error("Replica did not reach expected position");
}
async function caught_up(echo: { sync: { appliedRev: number | undefined; status: string } }, revision: number) {
  await eventually(() => echo.sync.appliedRev === revision && echo.sync.status === "caught_up");
}

function wire_payload(request: any): any { return admit_hson_data_input(request.payload).materialize(); }

export async function hosted_css_subject_rejection_cases() {
  const f = await hosted_css_authority_fixture();
  try {
    await f.continuation.tree.async.css.global.sel(".seed").setMany({ "@:label": { color: "red" } });
    const template = wire_payload(f.actions.at(-1));
    const mutations: [string, (p: any) => void][] = [
      ["missing envelope", p => { delete p.subjectContext; }],
      ["missing mapping", p => { p.subjectContext.subjects = []; }],
      ["duplicate mapping", p => { p.subjectContext.subjects.push(p.subjectContext.subjects[0]); }],
      ["conflicting mapping", p => { p.subjectContext.subjects.push({ ...p.subjectContext.subjects[0], path: [1, 1] }); }],
      ["extra mapping", p => { p.subjectContext.subjects.push({ name: "_123456789", path: [1, 1], disposition: "disposable" }); }],
      ["forged label", p => { p.subjectContext.subjects[0].name = "label"; }],
      ["unresolved label", p => { p.subjectContext.subjects[0].name = "_123456789"; }],
      ["authored claim", p => { delete p.subjectContext.subjects[0].disposition; }],
      ["occurrence claim", p => { p.subjectContext.subjects[0].occurrence = [1, 0]; }],
      ["missing path", p => { p.subjectContext.subjects[0].path = [99]; }],
      ["negative path", p => { p.subjectContext.subjects[0].path = [-1]; }],
      ["noncanonical path", p => { p.subjectContext.subjects[0].path = [-0]; }],
      ["fractional path", p => { p.subjectContext.subjects[0].path = [1.5]; }],
      ["extended path", p => { p.subjectContext.subjects[0].path = Array(257).fill(0); }],
      ["unissued subject", p => { p.subjectContext.subjects[0].path = [0]; }],
      ["wrong map", p => { p.subjectContext.at.logicalMapId = "other"; }],
      ["wrong incarnation", p => { p.subjectContext.at.incarnationId = "other"; }],
      ["wrong session", p => { p.subjectContext.at.sessionId = "other"; }],
      ["wrong revision", p => { p.subjectContext.at.revision++; }],
      ["wrong projection sequence", p => { p.subjectContext.at.projectionSequence++; }],
      ["private Library", p => { p.library = "privatePage"; }],
      ["unprojected Library", p => { p.library = "unprojected"; }],
    ];
    for (const [name, mutate] of mutations) {
      const payload = structuredClone(template);
      payload.subjectContext.at.revision = f.locus.rev;
      payload.operation.rule.declarations = [["color", "green"]];
      mutate(payload);
      const before = f.state(), native = f.native();
      const result = await f.continuation.echo.action("document.css", payload);
      assert.equal(result.type, "error", name);
      f.unchanged(before); assert.deepEqual(f.native(), native, name);
    }
    // One late bad reference rejects an otherwise valid multi-rule batch.
    const payload = structuredClone(template);
    payload.subjectContext.at.revision = f.locus.rev;
    const bad = structuredClone(payload.operation);
    bad.ruleKey = bad.rule.ruleKey = "late-bad";
    bad.rule.selector = '[hson\\:quad="_123456789"]';
    payload.operation = { domain: "css", kind: "batch", operations: [payload.operation, bad] };
    const before = f.state(), native = f.native();
    assert.equal((await f.continuation.echo.action("document.css", payload)).type, "error");
    f.unchanged(before); assert.deepEqual(f.native(), native);
    // A lexical collision is still only a label; no same-runtime admission is enabled.
    const collision = structuredClone(template);
    const quid = lookup_document_quad_internal(f.owner.doc.must("page"), "label")!.quid;
    collision.subjectContext.at.revision = f.locus.rev;
    collision.operation.ruleKey = collision.operation.rule.ruleKey = "collision";
    collision.operation.rule.selector = `[hson\\:quad="_${quid}"]`;
    collision.subjectContext.subjects[0].name = `_${quid}`;
    assert.equal((await f.continuation.echo.action("document.css", collision)).type, "ack");
  } finally { f.close(); }
  console.log("Hosted malformed, unauthorized and incomplete CSS correspondence rejects without publication.");
}

export async function hosted_css_dispatched_subject_cases() {
  const f = await hosted_css_authority_fixture(), entered = deferred(), release = deferred();
  try {
    f.beforeAction(async () => { entered.resolve(); await release.promise; });
    const pending = f.continuation.tree.async.css.global.sel(".dispatched-subject").setMany({ "@:label": { color: "green" } });
    await entered.promise;
    const stale = f.continuation.tree.async.css.global.sel(".pending-subject").setMany({ "@:label": { color: "red" } });
    const rejected = assert.rejects(stale, /disposed|active bound/);
    f.continuation.dispose();
    const native = f.native();
    release.resolve(); await pending; await rejected;
    assert.equal(f.actions.length, 1); assert.equal(f.locus.rev, 1);
    assert.match(f.owner.doc.must("page").css.snapshot(), /color:green/);
    assert.deepEqual(f.native(), native);
  } finally { release.resolve(); f.close(); }
  console.log("Disposal fences pending contextual CSS without cancelling dispatched authority work.");
}

export async function queued_fixture(scoped = false, subjects = 1, native = false) {
  const map: LiveMap = hsonLiveMap.fromLibraries({
    parts: { parts: { panel: { kind: "document", document: '<section @:root <span @:label/>/>' } } },
    page: { document: scoped ? '<html <head/> <body <hson-part @:left lib="parts" at="panel"/> <hson-part @:right lib="parts" at="panel"/>/>/>'
      : `<html <head/> <body ${Array.from({ length: subjects }, (_, index) => `<p @:${index === 0 ? "label" : `subject${index}`}/>`).join(" ")}/>/>` },
    state: { data: { n: 0 } },
  });
  let onAuthorize = () => {};
  let writable = true;
  const control = create_registry_locus_internal({ map, libraries: [
    { name: "parts", ownership: "private" }, { name: "page", ownership: "shared" }, { name: "state", ownership: "shared" },
  ], authorizeAction: () => { onAuthorize(); return true; }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: writable ? ["page"] : [] }) }, { scopedDocuments: "auto" });
  const locus = control.locus, session = await locus.session.create({ libraries: ["page", "state"] });
  const binding = bind_locus_http(locus, { endpoint: "/subjects" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://subjects.test/subjects",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  const root = native ? new FakeElement("html") : undefined;
  if (root !== undefined) {
    install_fake_document();
    const body = new FakeElement("body");
    root.appendChild(new FakeElement("head")); root.appendChild(body); body.appendChild(new FakeElement("p"));
  }
  const continuation = root === undefined ? undefined : await continue_hosted_document({
    now: session.now({ html: "page" }), credential: session.credential!, transport, root: root as unknown as Element });
  const echo = continuation?.echo ?? await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
  const receiver = echo_map_internal(echo), page = echo.doc.must("page");
  if (page.mode !== "document" || page.source !== "authority-projected") throw Error("Expected document");
  const state = () => {
    const a = authority(map), b = authority(receiver), id = document_css_subjects_internal(map.doc.must("page")).owner;
    const rid = document_css_subjects_internal(receiver.doc.must("page")).owner;
    return { revision: locus.rev, root: map.doc.must("page").root(), css: map.doc.must("page").css.snapshot(),
      receiving: receiver.doc.must("page").root(), receivingCss: receiver.doc.must("page").css.snapshot(),
      scopes: a.documentScopes(id), receivingScopes: b.documentScopes(rid),
      issued: enumerate_livemap_issued_quids(a.identityEpoch().issued()), receivingIssued: enumerate_livemap_issued_quids(b.identityEpoch().issued()) };
  };
  return { ...control, map, receiver, page, echo, session, state,
    native() {
      const snapshot = (element: FakeElement): unknown => ({ tag: element.localName, attrs: [...element.attrs],
        text: Reflect.get(element, "textContent"), children: element.childNodes.map(child => child instanceof FakeElement ? snapshot(child) : Reflect.get(child, "data")) });
      return root === undefined ? undefined : snapshot(root);
    },
    writable(value: boolean) { writable = value; },
    onAuthorize(callback: () => void) { onAuthorize = callback; },
    close() { continuation?.dispose(); echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); } };
}

function subject_operation(quid: string, color: string, key = "subject"): LiveMapCssOp {
  return { domain: "css", kind: "rule", ruleKey: key, scopes: [],
    rule: { ruleKey: key, selector: `[hson\\:quid="${quid}"]`, scopes: [], declarations: [["color", color]] } };
}

export async function hosted_css_subject_ordering_cases() {
  const f = await queued_fixture();
  try {
    const r = document_css_subjects_internal(f.receiver.doc.must("page"));
    const quid = authority(f.receiver).documentQuad(r.owner, "label", undefined)!.quid;
    // A real authority stage commits ahead of an already received CSS request.
    const entered = deferred(), release = deferred();
    const barrier = f.run_exclusive(async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const earlier = f.locus.stage(w => w.data.must("state").at(["n"]).set(1));
    const received = deferred(); f.onAuthorize(received.resolve);
    const pending = f.page.css(subject_operation(quid, "red"));
    const settled = assert.rejects(pending, /stale|position/);
    await received.promise; f.onAuthorize(() => {});
    release.resolve(); await barrier; await earlier; await settled;
    assert.equal(f.locus.rev, 1); assert.equal(f.map.doc.must("page").css.snapshot(), "");
    await caught_up(f.echo, f.locus.rev);
    await f.page.css(subject_operation(quid, "green"));
    assert.equal(f.locus.rev, 2, "A fresh request after synchronization succeeds");
    // Retained request recovery bypasses freshness without republishing.
    const portable = { library: "page", operation: { domain: "css", kind: "rule", ruleKey: "retry", scopes: [],
      rule: { ruleKey: "retry", selector: '[hson\\:quad="_123456789"]', scopes: [], declarations: [["color", "blue"]] } },
      subjectContext: { at: { logicalMapId: f.locus.logicalMapId, incarnationId: f.locus.incarnationId,
        sessionId: f.echo.session.sessionId!, revision: f.locus.rev, projectionSequence: 0 },
        subjects: [{ name: "_123456789", path: [...r.overlay.pathForQuid(quid)!], disposition: "disposable" }] } };
    const held = deferred(), unhold = deferred(), admitted = deferred();
    const blocked = f.run_exclusive(async () => { held.resolve(); await unhold.promise; });
    await held.promise;
    f.onAuthorize(admitted.resolve);
    const request = f.echo.action("document.css", portable);
    await admitted.promise;
    const joinedAdmission = deferred(); f.onAuthorize(joinedAdmission.resolve);
    const joined = f.echo.retryAction(request.request);
    await joinedAdmission.promise;
    f.onAuthorize(() => {}); unhold.resolve(); await blocked;
    const accepted = await request; assert.equal(accepted.type, "ack", JSON.stringify(accepted));
    const duplicate = await joined; assert.equal(duplicate.type, "ack"); assert.equal(duplicate.delivery, "joined");
    assert.equal(f.locus.rev, 3, "Joined duplicate publishes once");
    await f.locus.stage(w => w.data.must("state").at(["n"]).set(2));
    const before = f.locus.rev;
    const retry = await f.echo.retryAction(request.request);
    assert.equal(retry.type, "ack"); assert.equal(retry.delivery, "cached"); assert.equal(f.locus.rev, before);
    // The same semantic grant can return with a newer sequence and no revision.
    await f.session.update({ libraries: ["state"] });
    await f.session.update({ libraries: ["page", "state"] });
    portable.subjectContext.at.revision = f.locus.rev;
    const state = f.state();
    assert.equal((await f.echo.action("document.css", portable)).type, "error");
    assert.deepEqual(f.state(), state);
    await caught_up(f.echo, f.locus.rev);
    await eventually(() => f.echo.doc.must("page") !== f.page);
    const currentPage = f.echo.doc.must("page");
    if (currentPage.mode !== "document" || currentPage.source !== "authority-projected") throw Error("Expected document");
    const current = document_css_subjects_internal(f.receiver.doc.must("page"));
    const currentQuid = authority(f.receiver).documentQuad(current.owner, "label", undefined)!.quid;
    await assert.rejects(f.page.css(subject_operation(currentQuid, "purple", "stale-handle")));
    await currentPage.css(subject_operation(currentQuid, "purple", "reauthorized"));
    // Replace the selected subject at the same path, then submit old correspondence.
    portable.subjectContext.at.projectionSequence = 2;
    const oldRevision = f.locus.rev;
    await f.locus.stage(w => { const p = w.doc.must("page"); p.css.clearAll(); p.at([1, 0]).replace(hsonTransform.fromHson('<i/>').toNode().$_content[0]!); });
    portable.subjectContext.at.revision = oldRevision;
    const replaced = f.state();
    assert.equal((await f.echo.action("document.css", portable)).type, "error");
    assert.deepEqual(f.state(), replaced);
    portable.subjectContext.at.revision = f.locus.rev;
    assert.equal((await f.echo.action("document.css", portable)).type, "error", "A replacement at the same path cannot inherit retired correspondence");
    assert.deepEqual(f.state(), replaced);
  } finally { f.close(); }
  console.log("Hosted CSS stage ordering, fresh resubmission, retained retries and projection retirement passed.");
}

export async function hosted_css_subject_revocation_race_cases() {
  for (const subject of [false, true]) {
    const f = await queued_fixture(), entered = deferred(), release = deferred(), admitted = deferred();
    try {
      const document = document_css_subjects_internal(f.receiver.doc.must("page"));
      const quid = authority(f.receiver).documentQuad(document.owner, "label", undefined)!.quid;
      const barrier = f.run_exclusive(async () => { entered.resolve(); await release.promise; });
      await entered.promise; f.onAuthorize(admitted.resolve);
      const before = f.state();
      const pending = f.page.css(subject ? subject_operation(quid, "red") : { domain: "css", kind: "rule",
        ruleKey: "ordinary", scopes: [], rule: { ruleKey: "ordinary", selector: ".ordinary", scopes: [], declarations: [["color", "red"]] } });
      const denied = assert.rejects(pending);
      await admitted.promise;
      assert.equal(f.session.revoke(), true);
      release.resolve(); await barrier;
      await f.run_exclusive(() => {}); // Drain the authority work after its session was revoked.
      assert.deepEqual(f.state(), before, "Session revocation before serialized preparation publishes no CSS");
      // A fenced transport cannot deliver the terminal result. Explicit teardown
      // settles the caller's existing uncertainty/readiness wait without a new protocol rule.
      f.echo.dispose(); await denied;
    } finally { release.resolve(); f.close(); }
  }
  console.log("Hosted ordinary and subject CSS cannot outlive session revocation while waiting for Locus stage.");
}

export async function hosted_css_scoped_subject_cases() {
  const f = await queued_fixture(true);
  try {
    const document = document_css_subjects_internal(f.receiver.doc.must("page"));
    const scopes = document.scopes!.occurrences;
    const labels = scopes.map(scope => scope.bindings.find(binding => binding.name === "label")!.quid);
    assert.equal(labels.length, 2); assert.notEqual(labels[0], labels[1]);
    const before = f.state();
    for (const [index, color] of ["red", "blue"].entries()) {
      let operation: LiveMapCssOp | undefined;
      const css = make_livemap_document_css(empty_portable_document_stylesheet, op => { operation = op; },
        name => name === "label" ? `[hson\\:quid="${labels[index]}"]` : undefined);
      css.sel(".part").setMany({ "@:label": { _hover: { "& > i": { color } } }, $media: { screen: { "@:label": { opacity: .5 } } } });
      assert.ok(operation); await f.page.css(operation);
    }
    const owner = document_css_subjects_internal(f.map.doc.must("page"));
    const ownerLabels = owner.scopes!.occurrences.map(scope => scope.bindings.find(binding => binding.name === "label")!.quid);
    const css = f.map.doc.must("page").css.snapshot();
    assert.ok(css.includes(`[hson\\:quid="${ownerLabels[0]}"]:hover>i{color:red;}`), css);
    assert.ok(css.includes(`[hson\\:quid="${ownerLabels[1]}"]:hover>i{color:blue;}`), css);
    assert.deepEqual(f.state().issued, before.issued); assert.deepEqual(f.state().receivingIssued, before.receivingIssued);
    assert.equal(f.locus.rev, 2);
    const scope = `@scope ([hson\\:quid="${labels[0]}"])`;
    await f.page.css({ domain: "css", kind: "rule", ruleKey: "group-demand", scopes: [scope],
      rule: { ruleKey: "group-demand", selector: "i", scopes: [scope], declarations: [["color", "green"]] } });
    await f.page.css({ domain: "css", kind: "rule", ruleKey: "group-demand", scopes: [scope] });
    assert.equal(f.locus.rev, 4, "Deletion translates subject-bearing scopes without a rule body");
    const stylesheet = encode_portable_document_stylesheet(document_css_state_internal(f.receiver.doc.must("page")));
    await f.page.css({ domain: "css", kind: "replace", stylesheet });
    assert.equal(f.locus.rev, 4, "Complete translated stylesheet replacement preserves no-op semantics");
    const addedRule = { ruleKey: "append-demand", selector: `[hson\\:quid="${labels[1]}"]`, scopes: [], declarations: [["--append", "yes"] as const] };
    await f.page.css({ domain: "css", kind: "append", stylesheet: { rules: [addedRule], properties: [], keyframes: [],
      order: [{ kind: "rule", ruleKey: addedRule.ruleKey, scopes: [] }] } });
    assert.equal(f.locus.rev, 5); assert.match(f.map.doc.must("page").css.snapshot(), /--append:yes/);
    assert.equal(JSON.stringify(f.session.now()).includes("subjectContext"), false);
  } finally { f.close(); }
  console.log("Hosted same-named Part subjects retain occurrence-local coordinate correspondence.");
}

export async function hosted_css_subject_durability_cases() {
  const definitions = { parts: { parts: { panel: { kind: "document", document: '<section @:root <span @:label/>/>' } }, access: "private" },
    page: { document: '<html <head/> <body <hson-part lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/>/>/>', access: "shared" } } as const;
  const persistence = new MemoryCheckpointAdapter();
  const configuration = { logicalMapId: "css-subject-durability", persistence,
    authorizeProjection: () => ({ libraries: ["page"], writableDocuments: ["page"] }) };
  let locus = await hsonLiveMap.locus.resume(definitions, configuration);
  let expected: PortableDocumentScopedLibrary | undefined;
  let previousIssued: readonly string[] = [];
  try {
    for (const restored of [false, true]) {
      const session = await locus.session.create({ libraries: ["page"] });
      const binding = bind_locus_http(locus, { endpoint: "/durable-css" });
      const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://subjects.test/durable-css",
        fetch: (input, init) => binding.handle(new Request(input, init), {}) });
      const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
      try {
        const map: LiveMap = locus_map_internal(locus), a = authority(map), receiver = echo_map_internal(echo);
        const owner = document_css_subjects_internal(map.doc.must("page"));
        if (restored) {
          assert.ok(expected);
          assert.ok(document_scoped_libraries_semantically_equal(expected, a.scopedDocumentState(owner.owner)));
          assert.ok(enumerate_livemap_issued_quids(a.identityEpoch().issued()).every(quid => !previousIssued.includes(quid)));
        }
        const receiving = document_css_subjects_internal(receiver.doc.must("page"));
        const label = receiving.scopes!.occurrences[0]!.bindings.find(binding => binding.name === "label")!.quid;
        const page = echo.doc.must("page");
        if (page.mode !== "document" || page.source !== "authority-projected") throw Error("Expected projected document");
        await page.css(subject_operation(label, restored ? "green" : "red", "durable-subject"));
        if (!restored) {
          await hsonLiveMap.locus.checkpoint(locus);
          await page.css(subject_operation(label, "blue", "durable-subject"));
          expected = a.scopedDocumentState(owner.owner);
          previousIssued = enumerate_livemap_issued_quids(a.identityEpoch().issued());
          assert.equal(persistence.state(locus.logicalMapId)!.commits.length, 1, "Restore includes a post-checkpoint action tail");
        }
        assert.equal(JSON.stringify(persistence.state(locus.logicalMapId)).includes("subjectContext"), false);
        const now = session.now({ html: "page" });
        assert.match(now.html, /hson:quad/); assert.match(now.html, restored ? /color:green/ : /color:blue/);
      } finally { echo.dispose(); transport.dispose(); binding.dispose(); }
      if (!restored) { locus.dispose(); locus = await hsonLiveMap.locus.resume(definitions, configuration); }
    }
  } finally { locus.dispose(); }
  console.log("Hosted subject actions survive scoped checkpoint/tail restoration and fresh receiving admission without correspondence metadata.");
}

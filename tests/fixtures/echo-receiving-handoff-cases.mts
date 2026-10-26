import assert from "node:assert/strict";
import { bind_locus_http, hsonLiveMap } from "../../src/index.ts";
import type { LocusSession } from "../../src/types/locus.types.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";
import type { EchoAttachmentEvent, EchoReplicaTransport } from "../../src/types/echo.transport.types.ts";
import { echo_map_internal, locus_map_internal } from "../../src/internal/governor-maps.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { echo_receiving_document_handoff_internal as handoff } from "../../src/api/echo/echo.replica-preparation.ts";
import { compose_client_projection_internal } from "../../src/api/echo/echo.projection.ts";
import { client_projection_identity_internal } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { acquire_echo_map_management_internal } from "../../src/internal/echo-map-capability.ts";
import { create_echo_aggregate_replica_capability_internal } from "../../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { definition, page, node } from "./locus-scoped-ssr-cases.mts";
import { ssr_subject_fixture } from "./document-ssr-subjects-cases.mts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { capture_selected_authority_projection_snapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { hosted_flat_subject_fixture } from "./hosted-styled-part-ssr-cases.mts";

export async function receiving_handoff_fixture() {
  const locus = hsonLiveMap.locus.create({ ...definition[0], page: {
    ...definition[0].page, document: page.document.replace('<p @:outside', '<hson-part @:bare lib="parts" at="bare"/> <p @:outside'),
  } }, definition[1]);
  const session = await locus.session.create({ libraries: ["page", "flat", "bare", "data"] });
  return { locus, session, cut: session.now({ html: "page" }) };
}
async function receiving_handoff_echo(f: { locus: Parameters<typeof bind_locus_http>[0]; session: LocusSession }, session = f.session,
  intercept: (transport: EchoReplicaTransport) => EchoReplicaTransport = transport => transport) {
  const binding = bind_locus_http(f.locus, { endpoint: "/handoff" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://handoff.test/handoff",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  try {
    const cut = session.now({ html: "page" });
    const echo = await hsonLiveMap.echo.create({ now: structuredClone(cut), credential: session.credential!, transport: intercept(transport) });
    const map = echo_map_internal(echo), a = authority(map), cap = handoff(echo);
    const document = echo.doc.must("page"); if (document.mode !== "document") throw Error("Expected document");
    const id = a.libraries()[a.hostedRegistry().libraries.filter(e => e.scope === undefined).findIndex(e => e.name === "page")]!;
    return { echo, map, a, cap, id, cut, document, close() { echo.dispose(); transport.dispose(); binding.dispose(); } };
  } catch (cause) { transport.dispose(); binding.dispose(); throw cause; }
}
/** Preparation/rejection may not mutate any installed owner state or publish observations. */
function unchanged(map: LiveMap, run: () => void) {
  const a = authority(map), states = a.inspect().libraries.map(entry => ({ ...entry,
    root: a.root(entry.identity), scopes: a.documentScopes(entry.identity),
    css: entry.mode === "document" ? a.stylesheet(entry.identity) : undefined,
    overlay: entry.mode === "document" ? a.documentOverlay(entry.identity) : undefined }));
  const revision = map.rev, projection = a.clientProjection(), registry = a.hostedRegistry();
  const epoch = a.identityEpoch().current(), ledger = a.identityEpoch().issued(), quids = enumerate_livemap_issued_quids(ledger);
  let observations = 0;
  const stops = [map.commits.observe(() => observations++), a.observeAuthorityPosition(() => observations++),
    a.observeAuthorityPosition(() => observations++, "installed")];
  allocator(a.identityEpoch().owner, () => { throw Error("Handoff must never request identity issuance"); });
  try { run(); } finally { allocator(a.identityEpoch().owner, undefined); stops.forEach(stop => stop()); }
  assert.equal(map.rev, revision); assert.deepEqual(a.clientProjection(), projection); assert.equal(a.hostedRegistry(), registry);
  assert.equal(a.identityEpoch().current(), epoch); assert.equal(a.identityEpoch().issued(), ledger);
  assert.deepEqual(enumerate_livemap_issued_quids(ledger), quids); assert.equal(observations, 0);
  for (const state of states) {
    assert.equal(a.root(state.identity), state.root); assert.equal(a.documentScopes(state.identity), state.scopes);
    if (state.mode === "document") { assert.equal(a.stylesheet(state.identity), state.css); assert.equal(a.documentOverlay(state.identity), state.overlay); }
  }
}
async function until(test: () => boolean) {
  for (let i = 0; i < 400 && !test(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(test(), "Expected receiving transition");
}
export async function receiving_handoff_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const throws of [false, true]) await check(`transport loss expires handoff before reentrant ${throws ? "throwing" : "normal"} cancellation and never revives it`, async () => {
    const f = await receiving_handoff_fixture(), second = await f.locus.session.create({ libraries: ["page"] });
    let notify: (event: EchoAttachmentEvent) => void = () => { throw Error("Attachment observer not installed"); };
    let onCancel = () => {}, cancellations = 0;
    const r = await receiving_handoff_echo(f, f.session, transport => ({
      operations: transport.operations,
      attachment: { observe(listener) { notify = listener; return transport.attachment.observe(listener); } },
      synchronization: { async open(request, observer, options) {
        const subscription = await transport.synchronization.open(request, observer, options);
        return { cancel() { try { onCancel(); } finally { subscription.cancel(); } } };
      } },
    }));
    const other = await receiving_handoff_echo(f, second);
    try {
      const evidence = r.cap.prepare("page"), independent = other.cap.prepare("page"), failure = Error("Cancellation failed");
      const expired = () => {
        assert.throws(() => r.cap.assert(evidence, "page"), /Receiving handoff has expired/);
        assert.throws(() => r.cap.prepare("page"), /Receiving handoff has expired/);
        assert.throws(evidence.assertCurrent, /Receiving handoff has expired/);
        other.cap.assert(independent, "page");
      };
      r.cap.assert(evidence, "page");
      onCancel = () => {
        cancellations++;
        assert.equal(r.echo.session.status, "detached");
        expired();
        if (throws) throw failure;
      };
      unchanged(r.map, () => {
        const interrupt = () => notify({ kind: "observation-interrupted" });
        if (throws) assert.throws(interrupt, error => error === failure);
        else interrupt();
        assert.equal(cancellations, 1); expired();
        interrupt(); interrupt(); expired();
        assert.equal(cancellations, 1);
      });
      onCancel = () => {};
      notify({ kind: "available" });
      await until(() => r.echo.session.status === "attached" && r.echo.sync.status === "caught_up");
      unchanged(r.map, expired);
      assert.equal(other.echo.session.status, "attached");
      const freshSession = await f.locus.session.create({ libraries: ["page"] });
      const fresh = await receiving_handoff_echo(f, freshSession);
      try {
        const current = fresh.cap.prepare("page"); fresh.cap.assert(current, "page");
        assert.throws(() => fresh.cap.assert(evidence, "page"), /another owner or Library/);
        assert.throws(() => r.cap.assert(current, "page"), /another owner or Library/);
        assert.ok(current.subjects.every(subject => !evidence.subjects.some(old => old.quid === subject.quid)));
        expired();
      } finally { fresh.close(); }
    } finally { onCancel = () => {}; r.close(); other.close(); f.locus.dispose(); }
  });
  await check("original SSR labels, scoped namespaces and unmarked subjects authenticate to two independent public Echoes", async () => {
    const f = await receiving_handoff_fixture(), second = await f.locus.session.create({ libraries: ["page", "bare", "flat", "data"] });
    const first = await receiving_handoff_echo(f), other = await receiving_handoff_echo(f, second);
    try {
      const server = authority(locus_map_internal(f.locus));
      const serverIds = new Set(enumerate_livemap_issued_quids(server.identityEpoch().issued()));
      const original = f.cut.libs.libraries.find(e => e.name === "page")!.scopes!;
      const seen = new Set<string>();
      for (const r of [first, other]) unchanged(r.map, () => {
        const evidence = r.cap.prepare("page"); r.cap.assert(evidence, "page"); evidence.assertCurrent();
        assert.deepEqual(evidence.scopes, original); assert.deepEqual(evidence.authority, f.cut.libs.authority);
        assert.equal(evidence.revision, f.cut.libs.revision); assert.equal(evidence.projectionDigest, r.cut.libs.projectionDigest);
        assert.equal(evidence.registryDigest, r.a.clientProjection()!.registry.digest);
        assert.equal("acceptCss" in evidence, false); assert.equal("owner" in evidence, false);
        assert.equal(Object.isFrozen(evidence), true); assert.equal(Object.isFrozen(evidence.subjects), true);
        assert.equal(evidence.subjects.length, original.subjects.length);
        for (const subject of evidence.subjects) {
          assert.ok(Object.isFrozen(subject) && Object.isFrozen(subject.path));
          assert.deepEqual(subject.path, original.subjects.find(s => s.name === subject.name)!.path);
          assert.equal(r.a.documentOverlay(r.id).quidAtPath(subject.path), subject.quid);
          assert.ok(r.a.identityEpoch().issued().has(subject.quid));
          assert.equal(serverIds.has(subject.quid), false); assert.notEqual(subject.quid, subject.name.slice(1));
          assert.equal(seen.has(subject.quid), false); seen.add(subject.quid);
          assert.ok(f.cut.html.includes(`hson:quad="${subject.name}"`));
          assert.ok(JSON.stringify(r.cut.libs.libraries.find(e => e.name === "page")!.css).includes(subject.name));
          assert.ok(JSON.stringify(r.a.stylesheet(r.id)).includes(subject.quid));
        }
        assert.equal(evidence.receivingCss.join("\n\n"), r.document.css.snapshot());
        assert.notEqual(evidence.portableCss.join("\n\n"), evidence.receivingCss.join("\n\n"));
        const installed = r.a.documentScopes(r.id)!;
        assert.equal(installed.occurrences.length, 6); assert.equal(new Set(installed.occurrences.map(e => e.lifetime)).size, 6);
        for (const binding of original.document) {
          const received = evidence.identities.find(e => JSON.stringify(e.path) === JSON.stringify(binding.path))!;
          assert.equal(r.a.documentQuad(r.id, binding.name, undefined)!.quid, received.quid);
          assert.ok(r.document.q(binding.name)?.active);
        }
        for (const occurrence of original.occurrences) {
          const root = evidence.identities.find(e => JSON.stringify(e.path) === JSON.stringify(occurrence.root))!;
          const scope = installed.occurrences.find(e => e.rootQuid === root.quid)!;
          assert.ok(scope);
          if (occurrence.parent === null) assert.equal(scope.parent, null);
          else {
            const parent = evidence.identities.find(e => JSON.stringify(e.path) === JSON.stringify(occurrence.parent))!;
            assert.equal(scope.parent, installed.occurrences.find(e => e.rootQuid === parent.quid)!.lifetime);
          }
          for (const binding of occurrence.bindings) {
            const received = evidence.identities.find(e => JSON.stringify(e.path) === JSON.stringify(binding.path))!;
            assert.equal(scope.bindings.find(b => b.name === binding.name && b.kind === binding.kind)!.quid, received.quid);
          }
        }
        assert.ok(evidence.identities.length > evidence.subjects.length, "Unmarked authored subjects and bare occurrence survive");
        assert.notDeepEqual(r.a.scopedDocumentState(r.id).scopes.subjects, original.subjects, "Recapture must not substitute original labels");
        assert.deepEqual(r.cap.prepare("page"), evidence, "Repeated preparation issues evidence without changing authority");
        const bare = r.cap.prepare("bare"); assert.equal(bare.quads, undefined); assert.equal(bare.subjects.length, 0);
        assert.equal(bare.scopes!.occurrences.length, 1); assert.equal(bare.identities.length, 1);
      });
      const a = first.cap.prepare("page"), b = other.cap.prepare("page");
      unchanged(first.map, () => assert.throws(() => first.cap.assert(b, "page")));
      unchanged(other.map, () => assert.throws(() => other.cap.assert(a, "page")));
      const before = first.cap.prepare("page");
      f.session.now({ html: "page" }); await Promise.resolve(); first.echo.sync.debug();
      before.assertCurrent(); // Reads and the independent session do not consume the handoff.
    } finally { first.close(); other.close(); f.locus.dispose(); }
  });
  await check("forged, duplicate, missing and wrong-owner evidence reject without reflection or partial authority", async () => {
    const f = await receiving_handoff_fixture(), r = await receiving_handoff_echo(f);
    try { unchanged(r.map, () => {
      const e = r.cap.prepare("page");
      const forged = [undefined, null, {}, { ...e }, { ...e, libraryName: "flat" }, { ...e, portableCss: "wrong{}" },
        { ...e, receivingCss: "wrong{}" }, { ...e, subjects: [] }, { ...e, scopes: { ...e.scopes, document: [] } },
        { ...e, subjects: [...e.subjects, e.subjects[0]] },
        { ...e, subjects: [{ ...e.subjects[0], name: "forged" }] },
        { ...e, subjects: [{ ...e.subjects[0], path: [999] }] },
        { ...e, subjects: [{ ...e.subjects[0], quid: e.subjects[1]!.quid }] },
        new Proxy(e, { get() { throw Error("Must reject before inspecting foreign evidence"); } })];
      for (const candidate of forged) assert.throws(() => r.cap.assert(candidate, "page"), /another owner or Library/);
      assert.throws(() => r.cap.assert(e, "flat"));
      for (const name of ["missing", "parts", "data"]) assert.throws(() => r.cap.prepare(name));
      assert.throws(() => handoff({})); assert.throws(() => handoff(f.locus));
      assert.throws(() => r.a.claimClientDocumentHandoff({}, { digest: e.projectionDigest, assertCurrent() {} }));
      e.assertCurrent(); r.cap.assert(e, "page");
    }); } finally { r.close(); f.locus.dispose(); }
  });
  await check("malformed original correspondence rejects public admission before issuing a receiving handoff", async () => {
    const f = await receiving_handoff_fixture();
    const binding = bind_locus_http(f.locus, { endpoint: "/invalid" });
    const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://handoff.test/invalid",
      fetch: (input, init) => binding.handle(new Request(input, init), {}) });
    try {
      const page = f.cut.libs.libraries.find(e => e.name === "page")!, scopes = page.scopes!, first = scopes.subjects[0]!;
      const bad = [
        { ...page, scopes: { ...scopes, subjects: [first, ...scopes.subjects] } },
        { ...page, scopes: { ...scopes, subjects: scopes.subjects.map((e, i) => i === 1 ? { ...e, path: first.path } : e) } },
        { ...page, scopes: { ...scopes, subjects: scopes.subjects.map((e, i) => i === 0 ? { ...e, path: [999] } : e) } },
        { ...page, scopes: { ...scopes, subjects: scopes.subjects.map((e, i) => i === 0 ? { ...e, name: "_000000000" } : e) } },
        { ...page, scopes: { ...scopes, subjects: scopes.subjects.slice(1) } },
        { ...page, scopes: { ...scopes, occurrences: scopes.occurrences.map(e => ({ ...e, bindings: undefined })) } },
        { ...page, css: { order: [] } },
      ];
      const before = f.session.now();
      for (const invalid of bad) {
        const now = { ...f.cut, libs: { ...f.cut.libs, libraries: f.cut.libs.libraries.map(e => e.name === "page" ? invalid : e) } };
        await assert.rejects(async () => Reflect.apply(hsonLiveMap.echo.create, undefined, [{ now, credential: f.session.credential, transport }]));
      }
      assert.deepEqual(f.session.now(), before);
    } finally { transport.dispose(); binding.dispose(); f.locus.dispose(); }
  });
  for (const change of ["graph", "css", "topology", "retirement", "projection", "revocation", "dispose", "session-dispose", "disconnect", "progress", "identity-authority", "release"] as const) {
    await check(`${change} invalidates original admission and previously issued evidence`, async () => {
      const f = await receiving_handoff_fixture(), r = await receiving_handoff_echo(f);
      try {
        const evidence = r.cap.prepare("page"), handle = r.document.q("left");
        if (change === "graph") await f.locus.stage(w => w.doc.must("page").at([1, 0]).asElement().attrs.set("title", "changed"));
        if (change === "css") await f.locus.stage(w => w.doc.must("page").css.sel("#left").setProp("color", "orange"));
        if (change === "topology") await f.locus.stage(w => w.doc.must("page").at([1, 0]).replace(node('<hson-part lib="parts" at="panel" id="left"/>')));
        if (change === "retirement") await f.locus.stage(w => w.doc.must("page").at([1, 0]).delete());
        if (change === "progress") await f.locus.stage(w => w.data.must("data").at(["n"]).set(2));
        if (change === "projection") { await f.session.update({ libraries: ["data"] }); await until(() => !r.a.clientProjection()!.libraries.includes("page")); }
        if (change === "revocation") { f.session.revoke(); await until(() => r.echo.session.status !== "attached"); }
        if (change === "dispose") r.echo.dispose();
        if (change === "session-dispose") r.echo.session.dispose();
        if (change === "disconnect") r.echo.disconnect();
        if (change === "release") unchanged(r.map, () => { r.cap.release(); r.cap.release(); });
        if (change === "identity-authority") r.a.identityEpoch().replace(enumerate_livemap_issued_quids(r.a.identityEpoch().issued()));
        if (["graph", "css", "topology", "retirement", "progress"].includes(change)) await until(() => r.echo.sync.appliedRev === f.locus.rev);
        if (change === "retirement") {
          assert.equal(handle?.active, false);
          const removed = evidence.subjects.filter(e => e.path[4] === 0);
          assert.ok(removed.length > 0);
          for (const subject of removed) {
            assert.equal(r.a.documentOverlay(r.id).pathForQuid(subject.quid), undefined);
            assert.equal(r.document.css.snapshot().includes(subject.quid), false);
          }
        }
        unchanged(r.map, () => {
          assert.throws(evidence.assertCurrent); assert.throws(() => r.cap.assert(evidence, "page"));
          assert.throws(() => r.cap.prepare("page"));
        });
      } finally { r.close(); f.locus.dispose(); }
    });
  }
  await check("structurally equal full reconciliation retires the handoff under the same revision; management cannot reclaim it", async () => {
    const f = await receiving_handoff_fixture();
    const map = compose_client_projection_internal(f.cut.libs, f.cut.local, true), a = authority(map);
    const management = acquire_echo_map_management_internal(map), digest = client_projection_identity_internal(map)!;
    const cap = a.claimClientDocumentHandoff(management.owner, { digest, assertCurrent() { assert.equal(client_projection_identity_internal(map), digest); } });
    const replica = create_echo_aggregate_replica_capability_internal(map, management);
    try {
      const e = cap.prepare("page"), id = a.libraries()[a.hostedRegistry().libraries.filter(e => e.scope === undefined).findIndex(e => e.name === "page")]!, root = JSON.stringify(a.root(id));
      const scopes = a.documentScopes(id), overlay = a.documentOverlay(id), revision = a.clientProjection()!.revision;
      replica.restoreScopedProjection(f.cut.libs);
      assert.equal(JSON.stringify(a.root(id)), root); assert.equal(a.clientProjection()!.revision, revision);
      assert.notEqual(a.documentScopes(id), scopes); assert.notEqual(a.documentOverlay(id), overlay);
      for (const subject of e.subjects) assert.notEqual(a.documentOverlay(id).quidAtPath(subject.path), subject.quid);
      unchanged(map, () => { assert.throws(e.assertCurrent); assert.throws(() => cap.prepare("page")); });
      management.release(); a.claimManagement(management.owner);
      assert.throws(() => a.claimClientDocumentHandoff(management.owner, { digest, assertCurrent() {} }));
    } finally { replica.dispose(); management.release(); f.locus.dispose(); }
  });
  await check("management release and reentrant preparation invalidation never return evidence for a replaced installation", async () => {
    const f = await receiving_handoff_fixture();
    const map = compose_client_projection_internal(f.cut.libs, [], true), a = authority(map), management = acquire_echo_map_management_internal(map);
    let calls = 0, intervene = false;
    const cap = a.claimClientDocumentHandoff(management.owner, { digest: f.cut.libs.projectionDigest, assertCurrent() {
      if (intervene && ++calls === 2) management.release();
    } });
    try {
      const e = cap.prepare("page"); intervene = true;
      unchanged(map, () => assert.throws(() => cap.prepare("page")));
      assert.equal(calls, 2); assert.throws(e.assertCurrent);
    } finally { management.release(); f.locus.dispose(); }
  });
  await check("flat disposable CSS subjects and authored underscore names retain separate receiving meanings", async () => {
    const source = ssr_subject_fixture(), a = source.aggregate;
    const policy = make_locus_hosted_projection_policy(a.hostedRegistry(), a.hostedPosition().authority,
      [{ name: "page", ownership: "shared" }], undefined, () => ({ libraries: ["page"] }));
    const effective = await normalize_locus_effective_projection(policy, { libraries: ["page"] });
    const original = capture_selected_authority_projection_snapshot(source.map, effective);
    const map = compose_client_projection_internal(original, []), aggregate = authority(map), management = acquire_echo_map_management_internal(map);
    const cap = aggregate.claimClientDocumentHandoff(management.owner, { digest: original.projectionDigest, assertCurrent() {} });
    try { unchanged(map, () => {
      const evidence = cap.prepare("page"), library = aggregate.libraries()[0]!;
      for (const name of ["_012345678", "_123456789"]) {
        const subject = evidence.subjects.find(s => s.name === name)!;
        assert.equal(subject.disposition, "disposable"); assert.notEqual(subject.quid, name.slice(1));
        assert.equal(aggregate.documentQuad(library, name, undefined), undefined);
        assert.ok(evidence.receivingCss.join("\n\n").includes(subject.quid));
      }
      assert.equal(evidence.subjects.find(s => s.name === "_987654321")!.disposition, "authored");
      assert.ok(aggregate.documentQuad(library, "_987654321", undefined));
      assert.deepEqual(evidence.quads, original.libraries[0]!.quads); cap.assert(evidence, "page");
    }); } finally { management.release(); }
  });
  await check("flat hosted subject CSS authenticates original markers against already-installed receiving selectors", async () => {
    const f = await hosted_flat_subject_fixture(), r = await receiving_handoff_echo(f);
    try { unchanged(r.map, () => {
      const e = r.cap.prepare("page"); assert.equal(e.scopes, undefined);
      assert.deepEqual(e.quads, f.cut.libs.libraries[0]!.quads);
      assert.ok(e.subjects.some(s => s.name === "a" && s.disposition === "authored"));
      assert.notEqual(e.portableCss.join("\n\n"), e.receivingCss.join("\n\n")); assert.equal(e.receivingCss.join("\n\n"), r.document.css.snapshot());
      for (const subject of e.subjects) {
        assert.ok(f.cut.html.includes(`hson:quad="${subject.name}"`));
        assert.equal(r.a.documentOverlay(r.id).quidAtPath(subject.path), subject.quid);
        assert.equal(r.a.documentQuad(r.id, subject.name, undefined)!.quid, subject.quid);
      }
      r.cap.assert(e, "page");
    }); } finally { r.close(); f.locus.dispose(); }
  });
}

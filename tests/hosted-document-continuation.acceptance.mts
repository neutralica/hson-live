import { CssRuntimeManager } from "../src/api/livetree/managers/css-manager.ts";
import { authority_groups_from_map_fixture } from "./helpers/locus-definition-fixture.mts";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
// @hson-live-external-test
import { test_application_catalog } from "./helpers/hosted-catalog.mts";
import assert from "node:assert/strict";
import { DocumentContinuationError, Hson, HsonData, add_interaction, continue_document, continue_hosted_document, enable_interactions, hsonLiveMap, type HsonSchema, type InteractionDescriptor, type InteractionLocalBehaviors, type LocusWebSocketLike } from "../src/index.ts";
import type { LocusRequestedProjection } from "../src/types/locus.projection.types.ts";
import { get_node_for_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { parse_style_string } from "../src/api/transform/utils/attrs-utils/parse-style.ts";
import { runtime_for_tree, subject_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { prepare_hosted_document_internal } from "../src/api/continuation/continue-hosted-document.ts";
import { set_document_adoption_fault_hook_for_tests } from "../src/api/continuation/continuation.adopt.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import { make_livemap_from_authored_libraries_internal } from "../src/api/livemap/livemap.libraries.ts";
import { lookup_document_quad_internal } from "../src/api/livemap/livemap.document.quad.ts";
import type { DocumentQuadSubject } from "../src/api/livemap/livemap.document.quad.ts";
import { create_locus_hosted_aggregate_authority_internal } from "../src/api/locus/locus.aggregate.authority.ts";
import { capture_selected_authority_projection_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { cut_hosted_projection } from "../src/internal/document-cut.ts";
import { locus_local_initializer_digest } from "../src/api/locus/locus.local-initializer.ts";
import { echo_map_internal } from "../src/internal/governor-maps.ts";
import { validate_document_path, resolve_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { create_linked_livetree_in_runtime } from "../src/api/livetree/creation/create-livetree.ts";
import { continuation_runtime_for_document } from "../src/api/livetree/runtime/livetree-runtime.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import { client_projection_map } from "./helpers/client-projection.mts";
import { reconcile_client_projection_snapshot_internal } from "../src/api/livemap/livemap.libraries.ts";
import type { LiveMapDocumentLibrary } from "../src/types/livemap.types.ts";
import { livemap_document_observation_evidence, register_livemap_document_observation_evidence, type LiveMapDocumentObservationEvidence } from "../src/api/livemap/livemap.document.capture.ts";
import { adopt_exact_existing_document } from "../src/api/continuation/continuation.adopt.ts";
import { capture_continuation_document_root } from "../src/api/continuation/continuation.common.ts";
import { reflect_existing_document_in_runtime } from "../src/api/mirror/mirror.document.ts";
import { authority_projection_as_client_composition_internal } from "../src/api/locus/locus.authority-projection-snapshot.ts";

install_fake_document();

// State-only scoped admission must stop before any DOM graft or identity handoff.
{
  const locus = hsonLiveMap.locus.create({
    private: [{ name: "parts", definition: { parts: { item: { kind: "document", document: '<b @:root/>' } } } }],
    shared: [{ name: "page", definition: { document: '<main <hson-part lib="parts" at="item"/>/>' } }],
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://guard.invalid/locus", fetch: async () => {
    throw Error("Scoped continuation must reject before connecting");
  } });
  try {
    const session = await locus.session.create({ libraries: ["page"] });
    const root = new FakeElement("main"), before = root.replaceWrites;
    await assert.rejects(continue_hosted_document({ now: session.now(), credential: session.credential!,
      transport, document: "page", root: root as unknown as Element }), /projection snapshot/);
    assert.equal(root.replaceWrites, before); assert.equal(root.childNodes.length, 0);
    assert.equal(root.listeners.size, 0);
    assert.throws(() => session.now({ html: "page" }), /projection snapshot/);
  } finally { transport.dispose(); locus.dispose(); }
}

// Receiving QUAD identities are issued by the projected LiveMap before grafting.
for (const addressedRoot of [false, true]) {
  const map = make_livemap_from_authored_libraries_internal({ page: { document: `<main ${addressedRoot ? '@:root ' : ''}<button @:confirm/>/>` } });
  const locus = create_locus_hosted_aggregate_authority_internal({ map,
    libraries: [{ name: "page", ownership: "shared" }], defaultProjection: { libraries: ["page"] },
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: ["page"] }) });
  const sessionId = await locus.create_session({ libraries: ["page"] });
  const effective = locus.sessions.projection(sessionId)!;
  const now = Object.freeze({ ...cut_hosted_projection(capture_selected_authority_projection_snapshot(map, effective), "page"),
    format: "hson-locus-session-now", sessionBinding: locus.sessions.binding(sessionId)!,
    local: [], initializerDigest: locus_local_initializer_digest([]) });
  assert.doesNotMatch(now.html, /hson:quid/);
  await locus.stage(draft => { const page = draft.lib("page"); if (page.mode !== "document") throw Error("Document");
    page.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", "recovered"); });
  const pair = socketPair(), detach = bind_locus_websocket(locus, pair.server), transport = test_echo_transport(pair.client);
  const root = new FakeElement("main"), button = new FakeElement("button"); root.appendChild(button);
  let obsolete: LiveTree | undefined, obsoleteQuid: string | undefined;
  set_document_adoption_fault_hook_for_tests(point => {
    if (point === "after-tree") {
      const node = get_node_for_el(root as unknown as Element)!;
      obsoleteQuid = node.$_meta?.quid;
      obsolete = create_linked_livetree_in_runtime(node, continuation_runtime_for_document(root.ownerDocument as unknown as Document));
    }
  });
  try {
    const continuation = await continue_hosted_document({ now, credential: locus.sessions.credential(sessionId)!,
      transport, document: "page", root: root as unknown as Element });
    const page = echo_map_internal(continuation.echo).lib("page"), runtime = runtime_for_tree(continuation.tree);
    set_document_adoption_fault_hook_for_tests(undefined);
    assert.equal(root.getAttribute("title"), "recovered");
    assert.equal(continuation.tree.dom.el(), root as unknown as Element);
    if (addressedRoot) {
      assert.ok(obsolete?.isDisposed);
      assert.throws(() => obsolete!.quid, /disposed/i);
      assert.equal(runtime.quidToNode.has(obsoleteQuid!), false);
      assert.equal(page.mode === "document" ? page.document.byQuid(obsoleteQuid!) : undefined, undefined);
    }
    for (const name of addressedRoot ? ["root", "confirm"] : ["confirm"]) {
      const address = lookup_document_quad_internal(page, name)!;
      assert.notEqual(address.quid, lookup_document_quad_internal(map.lib("page"), name)!.quid);
      if (name === "root") assert.equal(continuation.tree.find.byQuid(address.quid)!.dom.el(), root as unknown as Element);
      assert.ok(runtime.quidToNode.has(address.quid));
    }
    await locus.stage(draft => {
      const page = draft.lib("page"); if (page.mode !== "document") throw new Error("Expected document.");
      page.attrs.set({ kind: "path", path: validate_document_path([0, 0, 0]) }, "title", "hosted");
    });
    assert.equal(continuation.mirror.status, "active");
    const liveButton = root.childNodes[0];
    assert.ok(liveButton instanceof FakeElement);
    assert.equal(liveButton.getAttribute("title"), "hosted");
    continuation.dispose(); continuation.echo.dispose();
  } finally { set_document_adoption_fault_hook_for_tests(undefined); transport.dispose(); detach(); locus.dispose(); }
}

const ButtonSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;

// Isolate repeated owner-proven recovery and transaction failure from transport.
for (const failure of ["none", "native", "incompatible"] as const) {
  const source = make_livemap_from_authored_libraries_internal({ page: { document: '<main @:root <button @:child/>/>' } });
  const locus = create_locus_hosted_aggregate_authority_internal({ map: source,
    libraries: [{ name: "page", ownership: "shared" }], defaultProjection: { libraries: ["page"] },
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
  const sessionId = await locus.create_session({ libraries: ["page"] }), projection = locus.sessions.projection(sessionId)!;
  const capture = () => capture_selected_authority_projection_snapshot(source, projection);
  const client = client_projection_map({ authority: capture(), local: {} }), page = client.lib("page");
  if (page.mode !== "document") throw Error("Document");
  const root = new FakeElement("main"), child = new FakeElement("button"); root.appendChild(child);
  let grafted = continue_document({ map: client, document: page, root: root as unknown as Element });
  const owner = internal_livemap_aggregate_authority(client), manager = {};
  owner.claimManagement(manager);
  try {
    for (let round = 0; round < (failure === "none" ? 2 : 1); round++) {
      const oldTree = grafted.tree;
      const oldQuid: string = lookup_document_quad_internal(page, "root")!.quid;
      await locus.stage(draft => {
        const document = draft.lib("page"); if (document.mode !== "document") throw Error("Document");
        if (failure === "incompatible") document.content.replace({ kind: "path", path: validate_document_path([]) }, 0, { $_tag: "aside", $_content: [] });
        else document.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", `round-${round}`);
      });
      const nativeSet = root.setAttribute;
      if (failure === "native") root.setAttribute = function(name, value) {
        if (name === "hson:quid") throw Error("native root rebase failure");
        nativeSet.call(this, name, value);
      };
      try { reconcile_client_projection_snapshot_internal(client, manager, authority_projection_as_client_composition_internal(capture())); }
      finally { root.setAttribute = nativeSet; }
      if (failure === "none") {
        assert.equal(grafted.mirror.status, "active");
        assert.equal(grafted.tree.dom.el(), root as unknown as Element);
        assert.ok(oldTree.isDisposed); assert.throws(() => oldTree.quid, /disposed/i);
        const address: DocumentQuadSubject = lookup_document_quad_internal(page, "root")!;
        assert.notEqual(address.quid, oldQuid);
        assert.equal(root.getAttribute("hson:quid"), address.quid);
        assert.equal(root.getAttribute("title"), `round-${round}`);
        assert.equal(page.document.byQuid(oldQuid), undefined);
        assert.equal(runtime_for_tree(grafted.tree).quidToNode.has(oldQuid), false);
        const current = grafted.tree;
        grafted.dispose();
        const candidate = capture_continuation_document_root(page);
        const candidateRoot = resolve_document_path(candidate, "document", validate_document_path([0]));
        if (typeof candidateRoot !== "object" || candidateRoot === null) throw Error("Root");
        candidateRoot.$_tag = "aside";
        assert.throws(() => adopt_exact_existing_document(candidate, root as unknown as Element));
        const reused = adopt_exact_existing_document(capture_continuation_document_root(page), root as unknown as Element);
        assert.throws(() => reused.commit(() => oldTree), /disposed/i);
        reused.abort();
        grafted = continue_document({ map: client, document: page, root: root as unknown as Element });
        assert.equal(grafted.tree, current);
        assert.equal(grafted.tree.dom.el(), root as unknown as Element);
      } else {
        assert.equal(grafted.mirror.status, "failed");
        assert.equal(root.getAttribute("title"), null); assert.equal(root.getAttribute("hson:quid"), null);
        assert.equal(root.childNodes[0], child);
        assert.equal(get_node_for_el(root as unknown as Element), subject_for_tree(oldTree));
        assert.equal(page.document.byQuid(oldQuid), undefined);
        // The accepted authority state is not undone by failed DOM realization.
        assert.equal(page.document.attrs.get({ kind: "path", path: [0] }, "title"), failure === "native" ? "round-0" : undefined);
        assert.throws(() => oldTree.attrs.set("wrong-owner", "reject"));
      }
    }
  } finally { owner.releaseManagement(manager); grafted.dispose(); locus.dispose(); }
}
// Inject invalid private evidence at the existing document-observation boundary.
// The authoritative snapshot remains accepted; Mirror must reject before native work.
for (const invalid of ["old", "new", "library", "replay"] as const) {
  const source = make_livemap_from_authored_libraries_internal({ page: { document: '<main @:root <button/>/>' } });
  const locus = create_locus_hosted_aggregate_authority_internal({ map: source,
    libraries: [{ name: "page", ownership: "shared" }], defaultProjection: { libraries: ["page"] },
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
  const session = await locus.create_session({ libraries: ["page"] }), projection = locus.sessions.projection(session)!;
  const capture = () => capture_selected_authority_projection_snapshot(source, projection);
  const client = client_projection_map({ authority: capture(), local: {} }), page = client.lib("page");
  if (page.mode !== "document") throw Error("Document");
  let saved: LiveMapDocumentObservationEvidence["rootRebase"];
  let round = 0;
  const watchedPage: LiveMapDocumentLibrary = {
    ...page, get rev() { return page.rev; },
    commits: { observe: listener => page.commits.observe(observation => {
      const evidence = livemap_document_observation_evidence(observation);
      if (observation.kind === "snapshot" && evidence?.rootRebase !== undefined) {
        const current = { ...evidence.rootRebase, library: watchedPage };
        let rootRebase = current;
        if (invalid === "old") rootRebase = { ...current, from: current.to };
        if (invalid === "new") rootRebase = { ...current, to: current.from };
        if (invalid === "library") rootRebase = { ...current, library: page };
        if (invalid === "replay" && round === 1) rootRebase = saved!;
        saved = current;
        register_livemap_document_observation_evidence(observation, { ...evidence, rootRebase });
      }
      listener(observation);
    }) },
  };
  const root = new FakeElement("main"), button = new FakeElement("button"); root.appendChild(button);
  const adoption = adopt_exact_existing_document(capture_continuation_document_root(page), root as unknown as Element);
  const mirror = reflect_existing_document_in_runtime(watchedPage, adoption.tree, runtime_for_tree(adoption.tree));
  adoption.commit(() => mirror.tree);
  const owner = internal_livemap_aggregate_authority(client), manager = {};
  owner.claimManagement(manager);
  try {
    for (; round < (invalid === "replay" ? 2 : 1); round++) {
      const prior = mirror.tree, runtime = runtime_for_tree(prior), claims = new Map(runtime.quidToNode);
      const priorAttrs = root.getAttributeNames().map(name => [name, root.getAttribute(name)]);
      await locus.stage(draft => {
        const document = draft.lib("page"); if (document.mode !== "document") throw Error("Document");
        document.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", `invalid-${invalid}-${round}`);
      });
      reconcile_client_projection_snapshot_internal(client, manager, authority_projection_as_client_composition_internal(capture()));
      if (invalid === "replay" && round === 0) {
        assert.equal(mirror.status, "active"); assert.ok(prior.isDisposed); continue;
      }
      assert.equal(mirror.status, "failed");
      assert.match(mirror.failure!.message, /rebase|overlay|correspondence/i);
      assert.equal(mirror.tree, prior); assert.equal(prior.isDisposed, false);
      assert.equal(get_node_for_el(root as unknown as Element), subject_for_tree(prior));
      assert.deepEqual(runtime.quidToNode, claims);
      assert.deepEqual(root.getAttributeNames().map(name => [name, root.getAttribute(name)]), priorAttrs);
      assert.equal(root.childNodes[0], button);
      assert.equal(runtime.quidToNode.has(lookup_document_quad_internal(page, "root")!.quid), false);
      assert.equal(page.document.attrs.get({ kind: "path", path: [0] }, "title"), `invalid-${invalid}-${round}`);
    }
  } finally { owner.releaseManagement(manager); mirror.dispose(); locus.dispose(); }
}
// Local continuation must also fail closed when its authority accepted a snapshot
// but Mirror retained the former tree after rolling back a native root transfer.
{
  const source = make_livemap_from_authored_libraries_internal({ page: { document: '<main @:root <button/>/>' } });
  enable_interactions(source);
  add_interaction(source, { id: "failed-root-click", subject: { library: "page", path: [0] }, kind: "browser", key: "run", args: null,
    listener: { event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } });
  const locus = create_locus_hosted_aggregate_authority_internal({ map: source,
    libraries: [{ name: "page", ownership: "shared" }], defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, systemFeatures: requested.systemFeatures }) });
  const session = await locus.create_session({ libraries: ["page"], systemFeatures: ["interactions"] }), projection = locus.sessions.projection(session)!;
  const capture = () => capture_selected_authority_projection_snapshot(source, projection);
  const client = client_projection_map({ authority: capture(), local: {} }), page = client.lib("page");
  if (page.mode !== "document") throw Error("Document");
  const root = new FakeElement("main"), button = new FakeElement("button"); root.appendChild(button);
  let calls = 0;
  const grafted = continue_document({ map: client, document: page, root: root as unknown as Element,
    interactions: { local: { run: () => { calls++; } } } });
  const prior = grafted.tree, oldQuid = lookup_document_quad_internal(page, "root")!.quid;
  const runtime = runtime_for_tree(prior), claims = new Map(runtime.quidToNode);
  const owner = internal_livemap_aggregate_authority(client), manager = {};
  owner.claimManagement(manager);
  try {
    root.dispatchEvent(new Event("click")); assert.equal(calls, 1);
    await locus.stage(draft => {
      const document = draft.lib("page"); if (document.mode !== "document") throw Error("Document");
      document.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", "accepted");
    });
    const nativeSet = root.setAttribute;
    root.setAttribute = function(name, value) {
      if (name === "hson:quid") throw Error("active interaction root-transfer fault");
      nativeSet.call(this, name, value);
    };
    try { reconcile_client_projection_snapshot_internal(client, manager, authority_projection_as_client_composition_internal(capture())); }
    finally { root.setAttribute = nativeSet; }
    assert.equal(grafted.mirror.status, "failed");
    assert.equal(grafted.tree, prior); assert.equal(prior.isDisposed, false);
    assert.equal(page.document.attrs.get({ kind: "path", path: [0] }, "title"), "accepted");
    const newQuid = lookup_document_quad_internal(page, "root")!.quid;
    assert.notEqual(newQuid, oldQuid); assert.equal(page.document.byQuid(oldQuid), undefined);
    assert.equal(runtime.quidToNode.has(newQuid), false); assert.deepEqual(runtime.quidToNode, claims);
    assert.equal(root.getAttribute("hson:quid"), null); assert.equal(root.getAttribute("title"), null);
    assert.equal(get_node_for_el(root as unknown as Element), subject_for_tree(prior));
    assert.equal(root.childNodes[0], button);
    root.dispatchEvent(new Event("click")); assert.equal(calls, 1);
    assert.throws(() => prior.attrs.set("stale-authority", "reject"));
    grafted.dispose(); grafted.dispose();
    root.dispatchEvent(new Event("click")); assert.equal(calls, 1);
  } finally { owner.releaseManagement(manager); grafted.dispose(); locus.dispose(); }
}
const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;

function socketPair(): Readonly<{
  client: LocusWebSocketLike;
  server: LocusWebSocketLike;
  delivered: readonly Readonly<{ type?: string; completionRev?: number }>[];
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientClose = new Set<() => void>();
  const serverClose = new Set<() => void>();
  const delivered: Readonly<{ type?: string; completionRev?: number }>[] = [];
  return Object.freeze({
    client: Object.freeze({
      send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
      close() { for (const listener of [...clientClose]) listener(); },
      onMessage(listener: (raw: string) => void) {
        clientMessages.add((raw) => {
          delivered.push(JSON.parse(raw) as Readonly<{ type?: string; completionRev?: number }>);
          listener(raw);
        });
        const registered = [...clientMessages].at(-1)!;
        return () => clientMessages.delete(registered);
      },
      onClose(listener: () => void) { clientClose.add(listener); return () => clientClose.delete(listener); },
    }),
    server: Object.freeze({
      send(raw: string) { for (const listener of [...clientMessages]) listener(raw); },
      close() { for (const listener of [...serverClose]) listener(); },
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverClose.add(listener); return () => serverClose.delete(listener); },
    }),
    delivered,
  });
}

{
  const makeMap = () => admit_exact_runtime_livemap_libraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: parse_hson_exact_runtime("<main <button/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  const descriptor: InteractionDescriptor = Object.freeze({
    id: "authoritative-click",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    kind: "locus",
    key: "save",
    payload: Hson.data.from({ exact: true }),
    listener: Object.freeze({
      event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
    }),
  });
  const authority = makeMap();
  enable_interactions(authority);
  add_interaction(authority, descriptor);
  let handled: HsonData | undefined;
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(authority, [...test_application_catalog(authority),
      { name: "ui", ownership: "local", initializer: { data: { value: 0 } } }]), defaultProjection: { libraries: ["page", "ui"], systemFeatures: ["interactions"] }, authorizeProjection: () => ({ libraries: ["page", "ui"], systemFeatures: ["interactions"] }), actions: { save: (_context, payload) => { handled = payload; } } });
  const complete = internal_livemap_aggregate_authority(authority).captureHosted();
  const requested: LocusRequestedProjection = { libraries: ["page"], systemFeatures: ["interactions"] };
  const policy = make_locus_hosted_projection_policy(complete.registry, complete.authority,
    test_application_catalog(authority), requested, () => requested);
  const effective = normalize_locus_effective_projection(policy, requested);
  if (effective instanceof Promise) throw new Error("Expected synchronous continuation projection.");
  const projected = project_authority_snapshot(complete, effective);
  const session = await locus.session.create({ libraries: ["page", "ui"], systemFeatures: ["interactions"] });
  const cut = session.now();
  assert.deepEqual(cut.local.map((entry) => entry.name), ["ui"]);
  const fresh = () => {
    const pair = socketPair();
    const detach = bind_locus_websocket(locus, pair.server);
    return { shared: { credential: session.credential!, transport: test_echo_transport(pair.client) }, detach };
  };
  let wire = fresh();
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  root.appendChild(button);
  await assert.rejects(continue_hosted_document({ ...wire.shared, now: cut, document: "state", root: root as unknown as Element }),
    /unknown|document/i);
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  wire.detach(); wire = fresh();
  await assert.rejects(
    continue_hosted_document({ ...wire.shared, now: { ...cut, libs: Object.freeze({ ...projected, revision: projected.revision + 1 }) },
      root: root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "recover",
  );
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  wire.detach(); wire = fresh();
  await assert.rejects(
    continue_hosted_document({
      ...wire.shared,
      now: cut,
      root: root as unknown as Element,
      interactions: { local: null as unknown as InteractionLocalBehaviors },
    }),
    (cause) => cause instanceof DocumentContinuationError
      && cause.phase === "interactions"
      && cause.cause !== undefined,
  );
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  wire.detach(); wire = fresh();
  const continuation = await continue_hosted_document({
    ...wire.shared,
    now: cut,
    root: root as unknown as Element,
    interactions: { local: {} },
  });
  assert.equal(continuation.map, continuation.echo.lib("page"));
  assert.equal(continuation.echo.lib("ui").mode, "data-object");
  button.dispatchEvent(new Event("click"));
  for (let attempt = 0; attempt < 30 && handled === undefined; attempt += 1) await Promise.resolve();
  assert.equal(handled === Hson.data.from({ exact: true }), true);
  continuation.dispose();
  handled = undefined;
  button.dispatchEvent(new Event("click"));
  for (let attempt = 0; attempt < 5; attempt += 1) await Promise.resolve();
  assert.equal(handled, undefined);
  assert.equal(continuation.echo.session.status, "attached");
  continuation.echo.dispose();
  wire.detach();
  locus.dispose();
}

// An admitted but altered initial document cut must reconcile through the
// already-bound Mirror after exact DOM adoption.
{
  const authority = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(authority);
  add_interaction(authority, {
    id: "save-click",
    subject: { library: "page", path: [0, 0, 0] },
    kind: "locus",
    key: "save",
    payload: Hson.data.from({ value: 1 }),
    listener: { event: "click", target: "element", capture: false, once: false,
      passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false,
      stopImmediatePropagation: false },
  });
  const empty = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(empty);
  const emptyLocus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(empty, test_application_catalog(empty)), authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const emptySession = await emptyLocus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(authority, [
    ...test_application_catalog(authority),
    { name: "ui", ownership: "local", initializer: { data: { value: 0 } } },
  ]), authorizeProjection: () => ({ libraries: ["page", "ui"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page", "ui"], systemFeatures: ["interactions"] });
  const cut = session.now();
  assert.deepEqual(cut.local.map((entry) => entry.name), ["ui"]);
  const mixed = { ...cut, libs: { ...cut.libs, system: emptySession.now().libs.system } };
  const pair = socketPair();
  const detach = bind_locus_websocket(locus, pair.server);
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  root.appendChild(button);
  const continuation = await continue_hosted_document({ now: mixed, credential: session.credential!,
    transport: test_echo_transport(pair.client), root: root as unknown as Element });
  assert.equal(continuation.echo.sync.strategy, "reconcile");
  const ui = continuation.echo.lib("ui");
  if (ui.mode === "document" || ui.source !== "client-local") throw new Error("Expected local data Library.");
  assert.equal(ui.snap(["value"]), 0);
  const authorityRev = locus.rev;
  ui.at(["value"]).set(12);
  assert.equal(locus.rev, authorityRev);
  assert.equal(ui.snap(["value"]), 12);
  assert.equal(continuation.map, continuation.echo.lib("page"));
  assert.equal(get_node_for_el(button as unknown as Element) !== undefined, true);
  assert.equal(continuation.mirror.status, "active");
  continuation.dispose(); continuation.echo.dispose(); detach(); locus.dispose(); emptyLocus.dispose();
}

// A future declarative marker can remain in the body through preparation and
// disappear before the first exact DOM admission. No matcher exception is used.
{
  const authority = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <button/>/>/>' } });
  enable_interactions(authority);
  add_interaction(authority, {
    id: "prepared-click",
    subject: { library: "page", path: [0, 0, 1, 0, 0] },
    kind: "browser",
    key: "clicker",
    args: Hson.data.from(null),
    listener: { event: "click", target: "element", capture: false, once: false,
      passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false,
      stopImmediatePropagation: false },
  });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(authority, test_application_catalog(authority)), authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const now = session.now({ html: "page" });
  const wire = () => {
    const pair = socketPair();
    return { detach: bind_locus_websocket(locus, pair.server), transport: test_echo_transport(pair.client) };
  };
  const fixture = () => {
    const root = new FakeElement("html");
    const head = new FakeElement("head");
    const body = new FakeElement("body");
    const button = new FakeElement("button");
    body.appendChild(button);
    root.appendChild(head);
    root.appendChild(body);
    return { root, head, body, button };
  };
  const page = fixture();
  const sentinel = new FakeElement("hson-scout");
  sentinel.setAttribute("hidden", "");
  page.body.appendChild(sentinel);
  const connection = wire();
  let clicks = 0;
  const options = { now, credential: session.credential!, transport: connection.transport,
    root: page.root as unknown as Element, interactions: { local: { clicker: () => { clicks += 1; } } } };

  const bodyChildren = page.body.childNodes;
  Object.defineProperty(page.body, "childNodes", { configurable: true, get() {
    throw new Error("Preparation inspected the application body.");
  } });
  const prepared = (() => {
    try { return prepare_hosted_document_internal(options); }
    finally { Object.defineProperty(page.body, "childNodes", { configurable: true, writable: true, value: bodyChildren }); }
  })();
  assert.equal(page.body.childNodes.at(-1), sentinel);
  assert.equal(get_node_for_el(page.root as unknown as Element), undefined);
  assert.equal(get_node_for_el(page.button as unknown as Element), undefined);
  const forbiddenTransport = Object.create(null);
  Object.defineProperty(forbiddenTransport, "operations", { get() {
    throw new Error("Duplicate claim reached Echo preparation.");
  } });
  assert.throws(() => prepare_hosted_document_internal({ ...options, transport: forbiddenTransport }),
    /already has an active document continuation/);
  await assert.rejects(continue_hosted_document({ ...options, transport: forbiddenTransport }),
    /already has an active document continuation/);
  page.body.removeChild(sentinel);
  let adoptionStarts = 0;
  set_document_adoption_fault_hook_for_tests((point) => {
    if (point === "after-first-link") adoptionStarts += 1;
  });
  const starting = prepared.start();
  await assert.rejects(prepared.start(), /starting state/);
  let continuation: Awaited<typeof starting>;
  try { continuation = await starting; }
  finally { set_document_adoption_fault_hook_for_tests(undefined); }
  assert.equal(adoptionStarts, 1);
  assert.equal(continuation.tree.dom.el(), page.root as unknown as Element);
  assert.equal(continuation.tree.find.byTag("button")?.dom.el(), page.button as unknown as Element);
  assert.equal(continuation.tree.find.byTag("hson-scout"), undefined);
  assert.equal(get_node_for_el(sentinel as unknown as Element), undefined);
  assert.equal(continuation.mirror.status, "active");
  page.button.dispatchEvent(new Event("click"));
  assert.equal(clicks, 1);
  await assert.rejects(prepared.start(), /started state/);
  assert.throws(() => prepared.dispose(), /started state/);
  await assert.rejects(continue_hosted_document(options), /already has an active document continuation/);
  continuation.dispose();
  assert.equal(continuation.echo.session.status, "attached");
  continuation.echo.dispose();
  connection.transport.dispose();
  connection.detach();

  const abandonedWire = wire();
  const abandoned = prepare_hosted_document_internal({ ...options, transport: abandonedWire.transport });
  abandoned.dispose();
  abandoned.dispose();
  await assert.rejects(abandoned.start(), /disposed state/);
  abandonedWire.transport.dispose();
  abandonedWire.detach();
  const releasedWire = wire();
  const released = prepare_hosted_document_internal({ ...options, transport: releasedWire.transport });
  released.dispose();
  releasedWire.transport.dispose();
  releasedWire.detach();

  const anotherRoot = fixture();
  const firstRootWire = wire();
  const secondRootWire = wire();
  const firstRoot = prepare_hosted_document_internal({ ...options, transport: firstRootWire.transport });
  const secondRoot = prepare_hosted_document_internal({ ...options,
    root: anotherRoot.root as unknown as Element, transport: secondRootWire.transport });
  firstRoot.dispose();
  secondRoot.dispose();
  firstRootWire.transport.dispose();
  secondRootWire.transport.dispose();
  firstRootWire.detach();
  secondRootWire.detach();

  const mismatch = fixture();
  mismatch.body.removeChild(mismatch.button);
  const mismatchWire = wire();
  const mismatchOptions = { ...options, root: mismatch.root as unknown as Element, transport: mismatchWire.transport };
  const mismatched = prepare_hosted_document_internal(mismatchOptions);
  await assert.rejects(mismatched.start(),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "adopt");
  assert.equal(get_node_for_el(mismatch.root as unknown as Element), undefined);
  mismatchWire.transport.dispose();
  mismatchWire.detach();
  const retryWire = wire();
  const retry = prepare_hosted_document_internal({ ...mismatchOptions, transport: retryWire.transport });
  retry.dispose();
  retryWire.transport.dispose();
  retryWire.detach();

  const fault = fixture();
  const faultWire = wire();
  const faultPrepared = prepare_hosted_document_internal({ ...options,
    root: fault.root as unknown as Element, transport: faultWire.transport });
  set_document_adoption_fault_hook_for_tests((point) => {
    if (point === "after-first-link") throw new Error("hosted adoption fault");
  });
  try {
    await assert.rejects(faultPrepared.start(),
      (cause) => cause instanceof DocumentContinuationError && cause.phase === "adopt");
  } finally { set_document_adoption_fault_hook_for_tests(undefined); }
  assert.equal(get_node_for_el(fault.root as unknown as Element), undefined);
  assert.equal(get_node_for_el(fault.body as unknown as Element), undefined);
  faultWire.transport.dispose();
  faultWire.detach();

  const stale = fixture();
  const staleWire = wire();
  const staleNow = { ...now, libs: { ...now.libs, revision: now.libs.revision + 1 } };
  const stalePrepared = prepare_hosted_document_internal({ ...options, now: staleNow,
    root: stale.root as unknown as Element, transport: staleWire.transport });
  await assert.rejects(stalePrepared.start(),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "recover");
  assert.equal(get_node_for_el(stale.root as unknown as Element), undefined);
  staleWire.transport.dispose();
  staleWire.detach();
  locus.dispose();
}

// Strict inline authoring rejects before hosted dispatch. Accepted batches
// project through the replica at one authority revision without CSS identity.
{
  const authority = hsonLiveMap.fromLibraries({ page: { document: '<main <button/>/>' } });
  const locus = hsonLiveMap.locus.create({
    ...authority_groups_from_map_fixture(authority, test_application_catalog(authority)),
    authorizeProjection: () => ({ libraries: ["page"], writableDocuments: ["page"] }),
  });
  const session = await locus.session.create({ libraries: ["page"] });
  const pair = socketPair();const detach = bind_locus_websocket(locus, pair.server);
  const root = new FakeElement("main"), button = new FakeElement("button");root.appendChild(button);
  const continuation = await continue_hosted_document({ now: session.now(), credential: session.credential!,
    transport: test_echo_transport(pair.client), root: root as unknown as Element });
  try {
    const tree = continuation.tree.find.must.byTag("button");
    const runtime = runtime_for_tree(tree), issued = runtime.issuedQuids.size;
    const rev = locus.rev, frames = pair.delivered.length;
    assert.throws(() => tree.style.setMany({ color: "red", width: "bogus" }), /invalid|Unsupported/);
    assert.equal(locus.rev, rev);assert.equal(pair.delivered.length, frames);
    assert.equal(button.getAttribute("style"), null);assert.equal(runtime.issuedQuids.size, issued);
    assert.throws(() => tree.style.set.color("red"), /tree.async/);
    assert.equal(locus.rev, rev);assert.equal(pair.delivered.length, frames);
    await tree.async.attrs.set("style", parse_style_string("color:red!important;width:2px"));
    assert.equal(locus.rev, rev + 1);assert.equal(continuation.map.rev, rev + 1);
    const acceptedStyle = tree.node.$_attrs?.style;
    assert.ok(acceptedStyle !== null && typeof acceptedStyle === "object");
    assert.equal(acceptedStyle.color, "red !important");
    assert.equal(button.getAttribute("style"), "color: red !important; width: 2px");
    assert.equal(runtime.issuedQuids.size, issued);assert.equal(tree.node.$_meta?.quid, undefined);
    assert.equal(continuation.mirror.status, "active");
  } finally { continuation.dispose();continuation.echo.dispose();detach();locus.dispose(); }
}

// Bound global capabilities retain hosted authority without subject identity demand.
{
  const authority = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <button/>/>/>' } });
  const locus = hsonLiveMap.locus.create({
    ...authority_groups_from_map_fixture(authority, test_application_catalog(authority)),
    authorizeProjection: () => ({ libraries: ["page"], writableDocuments: ["page"] }),
  });
  const session = await locus.session.create({ libraries: ["page"] });
  const pair = socketPair(), detach = bind_locus_websocket(locus, pair.server);
  const root = new FakeElement("html"), head = new FakeElement("head"), body = new FakeElement("body"), button = new FakeElement("button");
  root.appendChild(head); root.appendChild(body); body.appendChild(button);
  const continuation = await continue_hosted_document({ now: session.now({ html: "page" }), credential: session.credential!,
    transport: test_echo_transport(pair.client), root: root as unknown as Element });
  try {
    const tree = continuation.tree.find.must.byTag("button"), runtime = runtime_for_tree(tree);
    const issued = [...runtime.issuedQuids], rev = locus.rev, frames = pair.delivered.length;
    const css = tree.css, global = css.global, asyncGlobal = tree.async.css.global;
    assert.equal(tree.css, css); assert.equal(tree.css.global, global);
    assert.equal(css.snapshot(), "");
    assert.throws(() => global.stylesheet("button{color:red}"), /async authority/);
    await assert.rejects(asyncGlobal.stylesheet('@import url(forbidden.css);'), /@import/);
    assert.equal(locus.rev, rev); assert.equal(pair.delivered.length, frames);
    assert.equal(tree.node.$_meta?.quid, undefined); assert.deepEqual([...runtime.issuedQuids], issued);
    const source = "button{color:red}";
    const completed = await asyncGlobal.stylesheet(source);
    assert.equal(completed.sync, tree);
    assert.equal(locus.rev, rev + 1); assert.equal(continuation.map.rev, rev + 1);
    assert.equal(css.snapshot(), continuation.map.css.snapshot());
    assert.match(css.snapshot(), /button\{color:red;/);
    const style = head.childNodes.find(node => node instanceof FakeElement && node.tagName === "style");
    assert.ok(style instanceof FakeElement); assert.equal(Reflect.get(style, "textContent"), css.snapshot());
    assert.equal(tree.dom.el(), button as unknown as Element);
    assert.equal(tree.node.$_meta?.quid, undefined); assert.deepEqual([...runtime.issuedQuids], issued);
    await asyncGlobal.stylesheet(source);
    assert.equal(locus.rev, rev + 1);
    await asyncGlobal.stylesheet("button{color:blue}");
    assert.equal(locus.rev, rev + 2); assert.doesNotMatch(css.snapshot(), /color:red/);
    assert.equal(head.childNodes.includes(style), true);
    assert.deepEqual([...runtime.issuedQuids], issued);
    // Root façade remains global-unresolved until after disposal. Its binding
    // provenance must survive without borrowing the button's resolved handle.
    const delayed = continuation.tree.css;
    const rootBefore = continuation.tree.node;
    const activeClaims = [...runtime.quidToNode.keys()], pendingClaims = [...runtime.pendingQuidClaims.keys()];
    const pending = asyncGlobal.stylesheet("button{color:purple}");
    continuation.dispose();
    await pending;
    assert.equal(locus.rev, rev + 3);
    assert.deepEqual([...runtime.issuedQuids], issued);
    const replicaRev = continuation.map.rev, delivered = pair.delivered.length;
    const acceptedCss = continuation.map.css.snapshot();
    assert.equal(delayed.snapshot(), ""); // Committed HEAD: runtime-only read.
    assert.throws(() => delayed.global, /disposed/);
    assert.throws(() => delayed.global.stylesheet("button{color:red}"), /disposed/);
    assert.throws(() => delayed.global.sel("button").set.color("red"), /disposed/);
    assert.equal(CssRuntimeManager.forRuntime(runtime).renderCss(), "");
    assert.equal(continuation.map.css.snapshot(), acceptedCss);
    assert.equal(continuation.map.rev, replicaRev); assert.equal(pair.delivered.length, delivered);
    assert.deepEqual(continuation.tree.node, rootBefore);
    assert.deepEqual([...runtime.quidToNode.keys()], activeClaims);
    assert.deepEqual([...runtime.pendingQuidClaims.keys()], pendingClaims);
    assert.equal(tree.dom.el(), button as unknown as Element);
    assert.deepEqual([...runtime.issuedQuids], issued);
    assert.throws(() => global.clearAll(), /disposed/);
    await assert.rejects(asyncGlobal.stylesheet(source), /disposed|active bound/);
    assert.equal(locus.rev, rev + 3);
  } finally { continuation.dispose(); continuation.echo.dispose(); detach(); locus.dispose(); }
}

process.stdout.write("Hosted document continuation acceptance passed.\n");

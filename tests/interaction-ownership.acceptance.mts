import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import assert from "node:assert/strict";
import { Hson, activate_interactions, add_interaction, enable_interactions, hsonEcho, hsonLiveMap, hsonLocus, hsonMirror, replace_interaction,
  type HsonSchema, type InteractionDescriptor, type InteractionListener, type LiveMap } from "../src/index.ts";
import { compose_client_portable_aggregate_internal } from "../src/api/echo/echo.projection.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_portable_aggregate_commit, make_portable_aggregate_snapshot } from "../src/api/livemap/livemap.hosted.ts";
import { local_initializers } from "./helpers/client-projection.mts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { projected_value_from_hson_node } from "../src/core/projected-value-graph.ts";
import { is_ordered_projected_object } from "../src/core/ordered-projected-value.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { authority_projection_as_client_composition_internal, project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { test_public_projection } from "./helpers/hosted-catalog.mts";
import { install_client_local_initializers_internal } from "../src/api/locus/locus.local-initializer.ts";
import { create_recovery_test_driver } from "./helpers/replica-driver.mts";
import type { LocusWebSocketLike } from "../src/types/locus.types.ts";

install_fake_document();

function socket_pair(): Readonly<{ client: LocusWebSocketLike; server: LocusWebSocketLike }> {
  const toClient = new Set<(raw: string) => void>();
  const toServer = new Set<(raw: string) => void>();
  const client = Object.freeze({
    send: (raw: string) => { for (const listener of [...toServer]) listener(raw); },
    close: () => undefined,
    onMessage: (listener: (raw: string) => void) => { toClient.add(listener); return () => toClient.delete(listener); },
    onClose: (_listener: () => void) => () => undefined,
  });
  const server = Object.freeze({
    send: (raw: string) => { for (const listener of [...toClient]) listener(raw); },
    close: () => undefined,
    onMessage: (listener: (raw: string) => void) => { toServer.add(listener); return () => toServer.delete(listener); },
    onClose: (_listener: () => void) => () => undefined,
  });
  return Object.freeze({ client, server });
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Expected asynchronous Echo synchronization.");
}

const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const PanelSchema: HsonSchema = Hson.schema`<type "document" tag "aside" content <repeat <tag "button" content "empty">>>`;
const listener: InteractionListener = Object.freeze({ event: "click", target: "element", capture: false,
  once: false, passive: false, missingTarget: "throw", preventDefault: false,
  stopPropagation: false, stopImmediatePropagation: false });

function descriptor(id: string, library: "page" | "panel", key = "run", once = false): InteractionDescriptor {
  return Object.freeze({ id, subject: Object.freeze({ library, path: [0, 0, 0] }), listener: Object.freeze({ ...listener, once }),
    kind: "browser", key, args: null });
}

function locus_descriptor(id: string, library: "page" | "panel", key = "save"): InteractionDescriptor {
  return Object.freeze({ id, subject: Object.freeze({ library, path: [0, 0, 0] }), listener,
    kind: "locus", key, payload: null });
}

function setup(sharedFeature: boolean, panelRoot = "<aside <button/>/>", sharedInitial = false) {
  const authority = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>", schema: PageSchema } });
  if (sharedFeature) enable_interactions(authority);
  if (sharedInitial) add_interaction(authority, descriptor("shared", "page", "shared"));
  const snapshot = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(authority).captureHosted());
  const client = compose_client_portable_aggregate_internal(snapshot,
    local_initializers({ panel: { document: panelRoot, schema: PanelSchema } }));
  const replica = create_echo_aggregate_replica_capability_internal(client);
  return { authority, client, replica };
}

function mirror_document(map: LiveMap, name: string) {
  const library = map.lib(name);
  if (library.mode !== "document") throw new Error(`Expected document Library ${JSON.stringify(name)}.`);
  return hsonMirror(library);
}

function paths(map: ReturnType<typeof setup>["client"]): Record<string, readonly number[]> {
  const aggregate = internal_livemap_aggregate_authority(map);
  const system = aggregate.systemState("@hson/canonical-interactions");
  if (system === undefined) return {};
  const state = materialize_projected_value(projected_value_from_hson_node(aggregate.systemRoot(system)));
  if (typeof state !== "object" || state === null || Array.isArray(state) || !Array.isArray(state.descriptors)) {
    throw new Error("Malformed interaction state.");
  }
  return Object.fromEntries(state.descriptors.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)
      || typeof entry.id !== "string" || typeof entry.subject !== "object" || entry.subject === null
      || Array.isArray(entry.subject) || !Array.isArray(entry.subject.path)) throw new Error("Malformed descriptor.");
    return [entry.id, entry.subject.path.map((part) => {
      if (typeof part !== "number") throw new Error("Malformed descriptor path.");
      return part;
    })];
  }));
}

async function projected_snapshot(authority: ReturnType<typeof setup>["authority"], withFeature: boolean,
  libraries: readonly string[] = ["page"]) {
  const captured = internal_livemap_aggregate_authority(authority).captureHosted();
  const configured = test_public_projection(authority);
  const policy = make_locus_hosted_projection_policy(captured.registry, captured.authority,
    configured.libraries, configured.defaultProjection, configured.authorizeProjection);
  const effective = await normalize_locus_effective_projection(policy,
    { libraries, systemFeatures: withFeature ? ["interactions"] : [] });
  return authority_projection_as_client_composition_internal(project_authority_snapshot(captured, effective));
}

function ids(map: ReturnType<typeof setup>["client"]): string[] {
  const aggregate = internal_livemap_aggregate_authority(map);
  const system = aggregate.systemState("@hson/canonical-interactions");
  if (system === undefined) return [];
  const root = projected_value_from_hson_node(aggregate.systemRoot(system));
  if (!is_ordered_projected_object(root)) throw new Error("Malformed interaction root.");
  const descriptors = root.entries.find(([name]) => name === "descriptors")?.[1];
  if (!Array.isArray(descriptors)) throw new Error("Malformed interaction descriptors.");
  return descriptors.map((entry) => {
    if (!is_ordered_projected_object(entry)) throw new Error("Malformed descriptor.");
    const id = entry.entries.find(([name]) => name === "id")?.[1];
    if (typeof id !== "string") throw new Error("Malformed descriptor ID.");
    return id;
  });
}

for (const sharedFeature of [true, false]) {
  const { authority, client, replica } = setup(sharedFeature);
  const beforeCursor = replica.clientProjection()?.revision;
  const beforeDigest = replica.clientProjection()?.registry.digest;
  const beforeRev = client.rev;
  add_interaction(client, descriptor("local", "panel"));
  assert.deepEqual(ids(client), ["local"]);
  assert.equal(client.rev, beforeRev + 1);
  assert.equal(replica.clientProjection()?.revision, beforeCursor);
  assert.equal(replica.clientProjection()?.registry.digest, beforeDigest);
  assert.equal(authority.rev, 0);
  const beforeRejected = client.rev;
  assert.throws(() => add_interaction(client, descriptor("shared", "page")), /authority/i);
  assert.equal(client.rev, beforeRejected);
  assert.deepEqual(ids(client), ["local"]);
  const reflection = mirror_document(client, "panel");
  const subject = reflection.tree.find.must.byTag("button");
  const target = new EventTarget();
  link_node_to_el(subject.node, target as unknown as Element);
  let calls = 0;
  const dispose = activate_interactions({ map: client, tree: reflection.tree, document: "panel",
    local: { run: () => { calls += 1; } } });
  target.dispatchEvent(new Event("click"));
  assert.equal(calls, 1);
  dispose(); reflection.dispose(); replica.dispose();
  process.stdout.write(`ok - local authoring with shared feature ${sharedFeature ? "present" : "absent"}\n`);
}

{
  const { authority, client, replica } = setup(true, "<aside <button/>/>", true);
  add_interaction(client, descriptor("local", "panel", "local", true));
  const pageMirror = mirror_document(client, "page");
  const panelMirror = mirror_document(client, "panel");
  const pageTarget = new EventTarget();
  const panelTarget = new EventTarget();
  link_node_to_el(pageMirror.tree.find.must.byTag("button").node, pageTarget as unknown as Element);
  link_node_to_el(panelMirror.tree.find.must.byTag("button").node, panelTarget as unknown as Element);
  const calls: string[] = [];
  const local = { shared: () => { calls.push("shared"); }, next: () => { calls.push("next"); },
    local: () => { calls.push("local"); } };
  const disposePage = activate_interactions({ map: client, tree: pageMirror.tree, document: "page", local });
  const disposePanel = activate_interactions({ map: client, tree: panelMirror.tree, document: "panel", local });
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["shared", "local"]);
  const cursor = replica.clientProjection()?.revision;
  let commit: Parameters<typeof make_portable_aggregate_commit>[0] | undefined;
  const stop = internal_livemap_aggregate_authority(authority).observe((accepted) => { commit = accepted.hosted; });
  add_interaction(authority, descriptor("shared-next", "page", "next"));
  stop();
  if (commit === undefined) throw new Error("Missing authority interaction commit.");
  const portable = make_portable_aggregate_commit(commit);
  if (portable === undefined || cursor === undefined) throw new Error("Missing portable interaction commit.");
  replica.replayHosted(portable, cursor);
  assert.deepEqual(ids(client), ["shared", "shared-next", "local"]);
  assert.equal(replica.clientProjection()?.revision, cursor + 1);
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["shared", "local", "shared", "next"]);
  disposePanel(); disposePage(); panelMirror.dispose(); pageMirror.dispose(); replica.dispose();
  process.stdout.write("ok - shared replay merges S prime with retained L and preserves local once\n");
}

{
  const { authority, client, replica } = setup(true, "<aside <button/>/>", true);
  add_interaction(client, descriptor("collision", "panel"));
  assert.throws(() => add_interaction(client, descriptor("shared", "panel")), /already exists|duplicat/i);
  const beforeRev = client.rev;
  const beforeCursor = replica.clientProjection()?.revision;
  let commit: Parameters<typeof make_portable_aggregate_commit>[0] | undefined;
  const stop = internal_livemap_aggregate_authority(authority).observe((accepted) => { commit = accepted.hosted; });
  add_interaction(authority, descriptor("collision", "page"));
  stop();
  if (commit === undefined || beforeCursor === undefined) throw new Error("Missing authority collision commit.");
  const portable = make_portable_aggregate_commit(commit);
  if (portable === undefined) throw new Error("Missing portable collision commit.");
  assert.throws(() => replica.replayHosted(portable, beforeCursor), /duplicat|already exists/i);
  assert.equal(client.rev, beforeRev);
  assert.equal(replica.clientProjection()?.revision, beforeCursor);
  assert.deepEqual(ids(client), ["shared", "collision"]);
  const incoming = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(authority).captureHosted());
  assert.throws(() => replica.restoreHosted(incoming), /duplicat|already exists/i);
  assert.equal(client.rev, beforeRev);
  assert.equal(replica.clientProjection()?.revision, beforeCursor);
  assert.deepEqual(ids(client), ["shared", "collision"]);
  replica.dispose();
  process.stdout.write("ok - shared/local ID collisions reject replay and reconcile atomically\n");
}

{
  const { authority, client, replica } = setup(true, "<aside <button/>/>", true);
  add_interaction(client, descriptor("local", "panel", "local", true));
  const panel = client.lib("panel");
  if (panel.mode !== "document") throw new Error("Expected panel document.");
  panel.document.attrs.set({ kind: "path", path: [0] }, "title", "retained");
  panel.css.sel("aside").set.color("red");
  const css = panel.css.snapshot();
  const pageMirror = mirror_document(client, "page");
  const panelMirror = mirror_document(client, "panel");
  const pageTarget = new EventTarget();
  const panelTarget = new EventTarget();
  link_node_to_el(pageMirror.tree.find.must.byTag("button").node, pageTarget as unknown as Element);
  link_node_to_el(panelMirror.tree.find.must.byTag("button").node, panelTarget as unknown as Element);
  const calls: string[] = [];
  const local = { shared: () => { calls.push("shared"); }, next: () => { calls.push("next"); },
    local: () => { calls.push("local"); } };
  const disposePage = activate_interactions({ map: client, tree: pageMirror.tree, document: "page", local });
  const disposePanel = activate_interactions({ map: client, tree: panelMirror.tree, document: "panel", local });
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["local"]);
  replace_interaction(authority, descriptor("shared", "page", "next"));
  const incoming = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(authority).captureHosted());
  replica.restoreHosted(incoming);
  assert.deepEqual(ids(client), ["shared", "local"]);
  assert.equal(client.lib("panel"), panel);
  assert.equal(panel.document.attrs.get({ kind: "path", path: [0] }, "title"), "retained");
  assert.equal(panel.css.snapshot(), css);
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["local", "next"]);
  disposePanel(); disposePage(); panelMirror.dispose(); pageMirror.dispose(); replica.dispose();
  process.stdout.write("ok - reconcile replaces S and retains L, local CSS, identity and once\n");
}

{
  const { authority, client, replica } = setup(true, "<aside <button/>/>", true);
  add_interaction(client, descriptor("local", "panel", "local", true));
  const pageMirror = mirror_document(client, "page");
  const panelMirror = mirror_document(client, "panel");
  const pageTarget = new EventTarget();
  const panelTarget = new EventTarget();
  link_node_to_el(pageMirror.tree.find.must.byTag("button").node, pageTarget as unknown as Element);
  link_node_to_el(panelMirror.tree.find.must.byTag("button").node, panelTarget as unknown as Element);
  const calls: string[] = [];
  const local = { shared: () => { calls.push("shared"); }, next: () => { calls.push("next"); },
    local: () => { calls.push("local"); } };
  const disposePage = activate_interactions({ map: client, tree: pageMirror.tree, document: "page", local });
  const disposePanel = activate_interactions({ map: client, tree: panelMirror.tree, document: "panel", local });
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["shared", "local"]);
  replica.restoreHosted(await projected_snapshot(authority, false));
  assert.deepEqual(ids(client), ["local"]);
  assert.equal(replica.clientProjection()?.registry.libraries.some((entry) => entry.scope === "hson-internal"), false);
  assert.equal(internal_livemap_aggregate_authority(client).captureHosted().registry.libraries
    .some((entry) => entry.scope === "hson-internal"), true);
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["shared", "local"]);
  replace_interaction(authority, descriptor("shared", "page", "next"));
  replica.restoreHosted(await projected_snapshot(authority, true));
  assert.deepEqual(ids(client), ["shared", "local"]);
  assert.equal(replica.clientProjection()?.registry.libraries.some((entry) => entry.scope === "hson-internal"), true);
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["shared", "local", "next"]);
  disposePanel(); disposePage(); panelMirror.dispose(); pageMirror.dispose(); replica.dispose();
  process.stdout.write("ok - feature revocation and regrant retain local capability and listeners\n");
}

{
  const { authority, client, replica } = setup(true, "<aside <button/>/>", true);
  add_interaction(client, descriptor("local", "panel", "local"));
  const pageMirror = mirror_document(client, "page");
  const panel = client.lib("panel");
  const panelMirror = mirror_document(client, "panel");
  const pageTarget = new EventTarget();
  const panelTarget = new EventTarget();
  link_node_to_el(pageMirror.tree.find.must.byTag("button").node, pageTarget as unknown as Element);
  link_node_to_el(panelMirror.tree.find.must.byTag("button").node, panelTarget as unknown as Element);
  let shared = 0, localCalls = 0;
  const local = { shared: () => { shared += 1; }, local: () => { localCalls += 1; } };
  const disposePage = activate_interactions({ map: client, tree: pageMirror.tree, document: "page", local });
  const disposePanel = activate_interactions({ map: client, tree: panelMirror.tree, document: "panel", local });
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  replica.restoreHosted(await projected_snapshot(authority, false, []));
  assert.deepEqual(ids(client), ["local"]);
  assert.equal(client.lib("panel"), panel);
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual([shared, localCalls], [1, 2]);
  disposePanel(); disposePage(); panelMirror.dispose(); pageMirror.dispose(); replica.dispose();
  process.stdout.write("ok - shared scope removal retires shared listener but retains local descriptor\n");
}

{
  const authority = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>", schema: PageSchema } });
  const initial = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(authority).captureHosted());
  const client = compose_client_portable_aggregate_internal(initial, []);
  const replica = create_echo_aggregate_replica_capability_internal(client);
  assert.equal(internal_livemap_aggregate_authority(client).systemState("@hson/canonical-interactions"), undefined);
  const local = local_initializers({ panel: { document: "<aside <button/>/>", schema: PanelSchema } });
  install_client_local_initializers_internal(client, local);
  const panel = client.lib("panel");
  const cursor = replica.clientProjection()?.revision;
  const digest = replica.clientProjection()?.registry.digest;
  const beforeRejected = client.rev;
  assert.throws(() => add_interaction(client, descriptor("wrong-owner", "page")), /authority/i);
  assert.equal(client.rev, beforeRejected);
  assert.equal(internal_livemap_aggregate_authority(client).systemState("@hson/canonical-interactions"), undefined);
  add_interaction(client, descriptor("late-local", "panel"));
  assert.deepEqual(ids(client), ["late-local"]);
  assert.equal(replica.clientProjection()?.revision, cursor);
  assert.equal(replica.clientProjection()?.registry.digest, digest);
  const reflection = mirror_document(client, "panel");
  const target = new EventTarget();
  link_node_to_el(reflection.tree.find.must.byTag("button").node, target as unknown as Element);
  let calls = 0;
  const dispose = activate_interactions({ map: client, tree: reflection.tree, document: "panel",
    local: { run: () => { calls += 1; } } });
  target.dispatchEvent(new Event("click"));
  // A local initializer leaving scope does not remove its already installed Library.
  replica.restoreHosted(initial);
  install_client_local_initializers_internal(client, local);
  assert.equal(client.lib("panel"), panel);
  assert.deepEqual(ids(client), ["late-local"]);
  target.dispatchEvent(new Event("click"));
  assert.equal(calls, 2);
  dispose(); reflection.dispose(); replica.dispose();
  process.stdout.write("ok - late local initializer and repeated scope admission retain descriptor/listener\n");
}

{
  const authority = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>", schema: PageSchema } });
  const initial = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(authority).captureHosted());
  const client = compose_client_portable_aggregate_internal(initial, []);
  const replica = create_echo_aggregate_replica_capability_internal(client);
  install_client_local_initializers_internal(client,
    local_initializers({ panel: { document: "<aside <button/>/>", schema: PanelSchema } }));
  assert.equal(internal_livemap_aggregate_authority(client).systemState("@hson/canonical-interactions"), undefined);
  replica.restoreHosted(initial);
  assert.notEqual(internal_livemap_aggregate_authority(client).systemState("@hson/canonical-interactions"), undefined);
  assert.equal(replica.clientProjection()?.registry.libraries.some((entry) => entry.scope === "hson-internal"), false);
  assert.deepEqual(ids(client), []);
  replica.dispose();
  process.stdout.write("ok - reconcile after late local document retains local-only system topology\n");
}

{
  const authority = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>", schema: PageSchema } });
  enable_interactions(authority);
  add_interaction(authority, descriptor("shared-browser", "page", "shared-browser"));
  add_interaction(authority, locus_descriptor("shared-locus", "page"));
  const snapshot = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(authority).captureHosted());
  const client = compose_client_portable_aggregate_internal(snapshot,
    local_initializers({ panel: { document: "<aside <button/>/>", schema: PanelSchema } }));
  const replica = create_echo_aggregate_replica_capability_internal(client);
  add_interaction(client, descriptor("local-browser", "panel", "local-browser"));
  add_interaction(client, locus_descriptor("local-locus", "panel"));
  const pageMirror = mirror_document(client, "page");
  const panelMirror = mirror_document(client, "panel");
  const pageTarget = new EventTarget();
  const panelTarget = new EventTarget();
  link_node_to_el(pageMirror.tree.find.must.byTag("button").node, pageTarget as unknown as Element);
  link_node_to_el(panelMirror.tree.find.must.byTag("button").node, panelTarget as unknown as Element);
  const calls: string[] = [];
  const local = { "shared-browser": () => { calls.push("shared-browser"); },
    "local-browser": () => { calls.push("local-browser"); } };
  const dispatch = async (key: string) => { calls.push(key); };
  const disposePage = activate_interactions({ map: client, tree: pageMirror.tree, document: "page", local, dispatch });
  const disposePanel = activate_interactions({ map: client, tree: panelMirror.tree, document: "panel", local, dispatch });
  pageTarget.dispatchEvent(new Event("click"));
  panelTarget.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["shared-browser", "save", "local-browser", "save"]);
  replica.dispose();
  let executed = 0;
  const locus = hsonLocus.create({ map: authority, ...test_public_projection(authority),
    authorizeAction: () => false, actions: { save: () => { executed += 1; } } });
  const pair = socket_pair();
  bind_locus_websocket(locus, pair.server);
  const echo = create_recovery_test_driver({ transport: test_echo_transport(pair.client), map: client });
  echo.connect();
  await echo.session.create();
  await echo.completeRecovery();
  const denied = await echo.action("save");
  assert.equal(denied.type, "error");
  assert.equal(executed, 0);
  echo.dispose(); locus.dispose(); disposePanel(); disposePage(); panelMirror.dispose(); pageMirror.dispose();
  process.stdout.write("ok - all ownership/kind combinations dispatch and Locus authorization is independent\n");
}

{
  const authority = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>", schema: PageSchema } });
  const locus = hsonLocus.create({ map: authority,
    libraries: [
      { name: "page", ownership: "shared" },
      { name: "panel", ownership: "local", initializer: { document: "<aside <button/>/>", schema: PanelSchema } },
    ],
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: [] }),
  });
  const session = await locus.session.create({ libraries: ["page", "panel"] });
  const pair = socket_pair();
  let detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonEcho.init({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
  const beforeCursor = echo.sync.debug().lastAppliedRev;
  const beforeLocusRev = locus.rev;
  const beforeDigest = internal_livemap_aggregate_authority(echo.map).clientProjection()?.registry.digest;
  add_interaction(echo.map, descriptor("local-only", "panel"));
  assert.deepEqual(ids(echo.map), ["local-only"]);
  assert.equal(locus.rev, beforeLocusRev);
  assert.equal(echo.sync.debug().lastAppliedRev, beforeCursor);
  assert.equal(internal_livemap_aggregate_authority(echo.map).clientProjection()?.registry.digest, beforeDigest);
  assert.equal(internal_livemap_aggregate_authority(authority).systemState("@hson/canonical-interactions"), undefined);
  const panel = echo.map.lib("panel");
  const reflection = mirror_document(echo.map, "panel");
  const target = new EventTarget();
  link_node_to_el(reflection.tree.find.must.byTag("button").node, target as unknown as Element);
  let calls = 0;
  const dispose = activate_interactions({ map: echo.map, tree: reflection.tree, document: "panel",
    local: { run: () => { calls += 1; } } });
  target.dispatchEvent(new Event("click"));
  await session.update({ libraries: ["page"] });
  await session.update({ libraries: ["page", "panel"] });
  assert.equal(echo.map.lib("panel"), panel);
  assert.deepEqual(ids(echo.map), ["local-only"]);
  target.dispatchEvent(new Event("click"));
  assert.equal(calls, 2);
  echo.disconnect();
  detach();
  detach = bind_locus_websocket(locus, pair.server);
  echo.connect();
  await until(() => echo.sync.status === "caught_up");
  assert.equal(echo.sync.strategy, "current");
  assert.deepEqual(ids(echo.map), ["local-only"]);
  dispose(); reflection.dispose(); echo.dispose(); detach(); locus.dispose();
  process.stdout.write("ok - local interactions leave public Echo current sync and authority state unchanged\n");
}

{
  const { client, replica } = setup(false, "<aside <button id=\"one\"/> <button id=\"two\"/>/>");
  add_interaction(client, descriptor("moving", "panel"));
  const panel = client.lib("panel");
  if (panel.mode !== "document") throw new Error("Expected panel document.");
  const revision = client.rev;
  const seen: Record<string, readonly number[]>[] = [];
  const stop = internal_livemap_aggregate_authority(client).observe(() => seen.push(paths(client)));
  panel.document.content.move({ kind: "path", path: [0, 0] }, 0, 1);
  assert.equal(client.rev, revision + 1);
  assert.deepEqual(paths(client), { moving: [0, 0, 1] });
  assert.deepEqual(seen, [{ moving: [0, 0, 1] }]);
  panel.document.content.remove({ kind: "path", path: [0, 0] }, 1);
  assert.deepEqual(paths(client), {});
  stop(); replica.dispose();
  process.stdout.write("ok - local path move and removal are atomic\n");
}

{
  const { client, replica } = setup(false);
  add_interaction(client, descriptor("replaced", "panel"));
  const panel = client.lib("panel");
  if (panel.mode !== "document") throw new Error("Expected panel document.");
  const parsed = parse_hson_exact_runtime("<button id=\"replacement\"/>", { allowTopLevelDocumentText: true });
  const bucket = parsed.$_content[0];
  const replacement = is_Node(bucket) ? bucket.$_content[0] : undefined;
  if (!is_Node(replacement)) throw new Error("Expected replacement button.");
  const before = client.rev;
  panel.document.content.replace({ kind: "path", path: [0, 0] }, 0, replacement);
  assert.equal(client.rev, before + 1);
  assert.deepEqual(paths(client), {});
  replica.dispose();
  process.stdout.write("ok - local graph replacement retires established descriptor\n");
}

{
  const { client, replica } = setup(false);
  add_interaction(client, descriptor("root-replaced", "panel"));
  const panel = client.lib("panel");
  if (panel.mode !== "document") throw new Error("Expected panel document.");
  const parsed = parse_hson_exact_runtime("<aside <button id=\"replacement\"/>/>", { allowTopLevelDocumentText: true });
  const bucket = parsed.$_content[0];
  const replacement = is_Node(bucket) ? bucket.$_content[0] : undefined;
  if (!is_Node(replacement)) throw new Error("Expected replacement root element.");
  const beforeRev = client.rev;
  const beforeCursor = replica.clientProjection()?.revision;
  panel.document.content.replace({ kind: "path", path: [] }, 0, replacement);
  assert.equal(client.rev, beforeRev + 1);
  assert.equal(replica.clientProjection()?.revision, beforeCursor);
  assert.deepEqual(paths(client), {});
  replica.dispose();
  process.stdout.write("ok - local top-level root element replacement retires descriptor atomically\n");
}

import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonMirror, hsonEcho, hsonLocus, type HsonSchema } from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { test_public_exposure } from "./helpers/hosted-exposure.mts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_livemap_client_mirror_from_snapshot_internal } from "../src/api/livemap/livemap.libraries.ts";
import { encode_hosted_root, hosted_sha256, make_hosted_client_commit, make_hosted_client_snapshot } from "../src/api/livemap/livemap.hosted.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { acquire_livemap_document_identity } from "../src/api/livemap/livemap.document.identity-handle.ts";
import { validate_livemap_document_admission } from "../src/api/livemap/livemap.document.capture.ts";
import { link_livemap } from "../src/api/livemap/livemap.link.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";

const DataSchema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const LocalSchema: HsonSchema = Hson.schema`<type "document" tag "aside" content "empty">`;

function authority() {
  return hsonLiveMap.fromLibraries({
    state: { data: { value: 0 }, schema: DataSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

function setup() {
  const server = authority();
  const snapshot = make_hosted_client_snapshot(internal_livemap_aggregate_authority(server).captureHosted());
  const client = make_livemap_client_mirror_from_snapshot_internal(snapshot, {
    ui: { data: { value: 0 }, schema: DataSchema },
    panel: { document: "<aside/>", schema: LocalSchema },
  });
  const engine = internal_livemap_aggregate_authority(client);
  const replica = create_echo_aggregate_replica_capability_internal(client);
  return { server, snapshot, client, engine, replica };
}

function socket_pair(): Readonly<{ client: LocusSocketLike; server: LocusSocketLike; clientSent: string[]; drop: () => void }> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  const clientSent: string[] = [];
  return Object.freeze({
    client: Object.freeze({
      send(raw: string) { clientSent.push(raw); for (const listener of [...serverMessages]) listener(raw); },
      close() { for (const listener of [...serverCloses]) listener(); for (const listener of [...clientCloses]) listener(); },
      onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
      onClose(listener: () => void) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
    }),
    server: Object.freeze({
      send(raw: string) { for (const listener of [...clientMessages]) listener(raw); },
      close() { for (const listener of [...clientCloses]) listener(); for (const listener of [...serverCloses]) listener(); },
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
    }),
    clientSent,
    drop() { for (const listener of [...serverCloses]) listener(); },
  });
}

{
  const { snapshot, replica } = setup();
  assert.throws(() => make_livemap_client_mirror_from_snapshot_internal(snapshot, {
    state: { data: { value: 1 }, schema: DataSchema },
  }), /collides/i);
  replica.dispose();
}

{
  const { snapshot, client, engine, replica } = setup();
  const uiId = engine.libraries()[2]!;
  const prepared = engine.prepare([{ target: engine.target(uiId, ["value"]), kind: "set", value: 7 }]);
  replica.advanceHostedProgress({ ...snapshot.authority, registryDigest: snapshot.registryDigest, prevRev: 0, rev: 1 });
  engine.accept(prepared);
  assert.equal(client.rev, 1);
  assert.equal(client.lib("ui").mode, "data-object");
  replica.dispose();
}

{
  const { server, client, engine, replica } = setup();
  const uiId = engine.libraries()[2]!;
  const prepared = engine.prepare([{ target: engine.target(uiId, ["value"]), kind: "set", value: 7 }]);
  let hosted;
  const stop = internal_livemap_aggregate_authority(server).observe((commit) => { hosted = commit.hosted; });
  const state = server.lib("state");
  state.at(["value"]).set(1);
  stop();
  if (hosted === undefined) throw new Error("Missing authority effect.");
  const effect = make_hosted_client_commit(hosted);
  if (effect === undefined) throw new Error("Missing projected effect.");
  replica.replayHosted(effect, 0);
  assert.equal(client.rev, 1);
  assert.throws(() => engine.accept(prepared), /stale|revision|base/i);
  replica.dispose();
}

// A transport interruption leaves the same client-owned registry, revision, and local document alive.
{
  const server = authority();
  const initialState = server.lib("state");
  initialState.at(["value"]).set(1);
  const locus = hsonLocus.create({ map: server, exposure: test_public_exposure(server) });
  const pair = socket_pair();
  locus.connect(pair.server);
  const snapshot = make_hosted_client_snapshot(internal_livemap_aggregate_authority(server).captureHosted());
  const client = hsonLiveMap.fromClientSnapshot({
    authority: snapshot,
    localLibraries: {
      ui: { data: { value: 0 }, schema: DataSchema },
      panel: { document: "<aside/>", schema: LocalSchema },
    },
  });
  const ui = client.lib("ui");
  const panel = client.lib("panel");
  if (ui.mode === "document" || panel.mode !== "document") throw new Error("Wrong local library modes.");
  const localMirror = hsonMirror(panel);
  const localTree = localMirror.tree.node;
  assert.equal(client.rev, 0);
  const echo = hsonEcho.create({ socket: pair.client, map: client, recovery: { logicalMapId: locus.logicalMapId } });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const before = client.rev;
  const sentBefore = pair.clientSent.length;
  ui.at(["value"]).set(1);
  assert.equal(client.rev, before + 1);
  assert.equal(pair.clientSent.length, sentBefore);
  assert.equal(echo.recovery.lastAppliedRev, 1);
  echo.disconnect();
  pair.drop();
  ui.at(["value"]).set(2);
  panel.document.attrs.set({ kind: "path", path: [0] }, "title", "offline");
  assert.equal(client.rev, before + 3);
  assert.equal(pair.clientSent.length, sentBefore);
  assert.equal(echo.recovery.lastAppliedRev, 1);
  assert.equal(localMirror.tree.node, localTree);
  await locus.mutate((draft) => { draft.lib("state").at(["value"]).set(4); });
  locus.connect(pair.server);
  echo.connect();
  await echo.session.reattach(echo.session.credential!);
  const recovered = await echo.recovery.recover();
  assert.equal(recovered.strategy, "replay");
  assert.equal(echo.map, client);
  assert.equal(echo.recovery.lastAppliedRev, 2);
  assert.equal(client.rev, before + 4);
  assert.equal(ui.at(["value"]).snap(), 2);
  const projectedState = client.lib("state");
  if (projectedState.mode === "document") throw new Error("Expected projected data library.");
  assert.equal(projectedState.snap(["value"]), 4);
  assert.equal(panel.document.attrs.get({ kind: "path", path: [0] }, "title"), "offline");
  assert.equal(localMirror.tree.node, localTree);
  localMirror.dispose();
  echo.dispose();
  locus.dispose();
}

{
  const { server, snapshot, client, engine, replica } = setup();
  const ui = client.lib("ui");
  const state = client.lib("state");
  const page = client.lib("page");
  const panel = client.lib("panel");
  if (ui.mode === "document" || state.mode === "document" || page.mode !== "document" || panel.mode !== "document") throw new Error("Wrong library modes.");
  assert.equal(client.rev, 0);
  ui.at(["value"]).set(1);
  assert.equal(client.rev, 1);
  assert.throws(() => state.at(["value"]).set(1), /authority/i);
  assert.throws(() => page.document.attrs.set({ kind: "path", path: [0] }, "title", "blocked"), /authority/i);
  panel.document.attrs.set({ kind: "path", path: [0] }, "title", "local");
  assert.equal(client.rev, 2);
  assert.equal(panel.document.attrs.get({ kind: "path", path: [0] }, "title"), "local");

  const ids = engine.libraries();
  const stateId = ids[0]!;
  const uiId = ids[2]!;
  assert.throws(() => engine.commit([
    { target: engine.target(uiId, ["value"]), kind: "set", value: 2 },
    { target: engine.target(stateId, ["value"]), kind: "set", value: 2 },
  ]), /authority/i);
  assert.equal(ui.at(["value"]).snap(), 1);
  assert.equal(state.at(["value"]).snap(), 0);
  assert.throws(() => link_livemap(ui as never, state as never, { path: ["value"] }), /ownership/i);
  assert.throws(() => link_livemap(state as never, ui as never, { path: ["value"] }), /ownership/i);

  const projectedMirror = hsonMirror(page);
  const localMirror = hsonMirror(panel);
  const localTree = localMirror.tree.node;
  const localEpoch = livemap_identity_epoch_accounting(panel).epoch;
  const projectedHandle = acquire_livemap_document_identity(page.document, { kind: "path", path: [0] });
  const localHandle = acquire_livemap_document_identity(panel.document, { kind: "path", path: [0] });
  const issuedBeforeFallback = livemap_identity_epoch_accounting(panel).issued;
  const exact = page.capture({ identity: "same-epoch" });
  const localExact = panel.capture({ identity: "same-epoch" });
  let localRestoreEvents = 0;
  const stopLocal = panel.commits.observe((observation) => {
    if (observation.kind === "snapshot") localRestoreEvents += 1;
  });
  assert.equal(engine.documentCaptureContinuity(uiId), undefined);
  assert.equal(projectedHandle.active, true);
  assert.equal(localHandle.active, true);

  let hosted;
  const stop = internal_livemap_aggregate_authority(server).observe((commit) => { hosted = commit.hosted; });
  const serverState = server.lib("state");
  serverState.at(["value"]).set(1);
  stop();
  if (hosted === undefined) throw new Error("Missing hosted commit.");
  const portable = make_hosted_client_commit(hosted);
  if (portable === undefined) throw new Error("Missing client effect.");
  replica.replayHosted(portable, 0);
  assert.equal(client.rev, 3);
  assert.equal(state.at(["value"]).snap(), 1);
  assert.equal(ui.at(["value"]).snap(), 1);
  assert.equal(localHandle.active, true);
  assert.equal(projectedHandle.active, true);

  const serverPage = server.lib("page");
  if (serverPage.mode !== "document") throw new Error("Expected projected document.");
  let hostedPage;
  const stopPage = internal_livemap_aggregate_authority(server).observe((commit) => { hostedPage = commit.hosted; });
  serverPage.document.attrs.set({ kind: "path", path: [0] }, "title", "replayed");
  stopPage();
  if (hostedPage === undefined) throw new Error("Missing projected document effect.");
  const pageEffect = make_hosted_client_commit(hostedPage);
  if (pageEffect === undefined) throw new Error("Missing projected document replay.");
  replica.replayHosted(pageEffect, 1);
  assert.equal(client.rev, 4);
  assert.equal(projectedHandle.active, true);
  assert.equal(localHandle.active, true);
  assert.equal(projectedMirror.tree.find.must.byTag("main").attrs.get("title"), "replayed");
  assert.equal(localMirror.tree.node, localTree);

  const progress = { ...snapshot.authority, registryDigest: snapshot.registryDigest, prevRev: 2, rev: 3 };
  const projectedUpdates = projectedMirror.diagnostics().updatesApplied;
  const localUpdates = localMirror.diagnostics().updatesApplied;
  let graphEvents = 0;
  const stopGraph = client.commits.observe(() => { graphEvents += 1; });
  replica.advanceHostedProgress(progress);
  stopGraph();
  assert.equal(client.rev, 4);
  assert.equal(graphEvents, 0);
  assert.equal(projectedMirror.diagnostics().updatesApplied, projectedUpdates);
  assert.equal(localMirror.diagnostics().updatesApplied, localUpdates);
  ui.at(["value"]).set(3);
  assert.equal(client.rev, 5);

  serverPage.document.attrs.set({ kind: "path", path: [0] }, "title", "authority");
  const fallbackBase = make_hosted_client_snapshot(internal_livemap_aggregate_authority(server).captureHosted());
  const fallback = Object.freeze({ ...fallbackBase, revision: 4 });
  const malformed = Object.freeze({ ...fallback, libraries: Object.freeze([
    Object.freeze({ ...fallback.libraries[0]!, root: encode_hosted_root(hsonLiveMap.fromJson({ value: "wrong" }).root()) }),
    ...fallback.libraries.slice(1),
  ]) });
  assert.throws(() => replica.restoreHosted(malformed), /Schema|schema/);
  assert.equal(ui.at(["value"]).snap(), 3);
  assert.equal(page.document.attrs.get({ kind: "path", path: [0] }, "title"), "replayed");
  assert.equal(client.rev, 5);
  replica.restoreHosted(fallback);
  assert.equal(client.rev, 6);
  assert.equal(ui.at(["value"]).snap(), 3);
  assert.equal(localHandle.active, true);
  assert.equal(projectedHandle.active, false);
  assert.equal(livemap_identity_epoch_accounting(panel).epoch, localEpoch);
  assert.equal(livemap_identity_epoch_accounting(panel).issued, issuedBeforeFallback);
  assert.equal(localMirror.tree.node, localTree);
  assert.equal(localMirror.status, "active");
  assert.equal(projectedMirror.status, "active");
  assert.equal(projectedMirror.tree.find.must.byTag("main").attrs.get("title"), "authority");
  assert.equal(localRestoreEvents, 0);
  const pageId = ids[1]!;
  assert.throws(() => validate_livemap_document_admission(engine.identityEpoch(), exact, "same-epoch",
    () => engine.documentCaptureContinuity(pageId)), /earlier recovery continuity/i);
  assert.equal(validate_livemap_document_admission(engine.identityEpoch(), localExact, "same-epoch",
    () => engine.documentCaptureContinuity(ids[3]!)), "same-epoch");
  stopLocal();
  localMirror.dispose();
  projectedMirror.dispose();
  replica.dispose();
}

// An action-only session has no map; a local-only session uses a real local registry.
{
  const server = authority();
  const base = make_hosted_client_snapshot(internal_livemap_aggregate_authority(server).captureHosted());
  const registry = Object.freeze({ ...base.registry, libraries: Object.freeze([]),
    digest: hosted_sha256(JSON.stringify({ format: base.registry.format, libraries: [] })) });
  const snapshot = Object.freeze({ ...base, registry, registryDigest: registry.digest,
    libraries: Object.freeze([]) });
  const local = make_livemap_client_mirror_from_snapshot_internal(snapshot, {
    ui: { data: { value: 0 }, schema: DataSchema },
  });
  const replica = create_echo_aggregate_replica_capability_internal(local);
  const ui = local.lib("ui");
  if (ui.mode === "document") throw new Error("Expected local data library.");
  ui.at(["value"]).set(1);
  assert.equal(local.rev, 1);
  replica.advanceHostedProgress({ ...snapshot.authority, registryDigest: snapshot.registryDigest, prevRev: 0, rev: 1 });
  assert.equal(local.rev, 1);
  replica.restoreHosted(Object.freeze({ ...snapshot, revision: 1 }));
  assert.equal(local.rev, 1);
  assert.equal(ui.at(["value"]).snap(), 1);
  replica.dispose();
  assert.throws(() => make_livemap_client_mirror_from_snapshot_internal(snapshot, {}), /no LiveMap/i);
}

process.stdout.write("ok - client library composition 6A.5\n");

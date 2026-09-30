import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import { create_recovery_test_driver } from "./helpers/replica-driver.mts";
import { client_projection_map } from "./helpers/client-projection.mts";
import assert from "node:assert/strict";
import { hsonLiveMap, hsonLocus, hsonEcho, Hson, enable_interactions, type LocusWebSocketLike } from "../src/index.ts";
import { decode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.retained-session", title: "Retained session server-first cuts",
  category: "Locus", runtime: "node", tags: Object.freeze(["locus", "session", "ssr", "security", "recovery"]) });

function pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const frames: string[] = [];
  const client: LocusWebSocketLike = { send(raw) { for (const listener of [...toServer]) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; }, onClose() { return () => {}; } };
  const server: LocusWebSocketLike = { send(raw) { frames.push(raw); for (const listener of [...toClient]) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; }, onClose() { return () => {}; } };
  return { client, server, frames };
}
let expiry: (() => void) | undefined;
const requests: string[][] = [];
const map = hsonLiveMap.fromLibraries({
  page: { document: '<html <head/> <body <main <p "SSR_FIRST"/>/>/>/>' },
  state: { data: { value: "VISIBLE" } },
  extra: { data: { value: "UNREQUESTED" } },
  secret: { data: { value: "PRIVATE" } },
});
map.lib("page").css.stylesheet("p { color: red; }");
const locus = hsonLocus.create({ map,
  libraries: ["page", "state", "extra", "secret"].map(library => ({ name: library, ownership: library === "secret" ? "private" : "shared" })),
  authorizeProjection: ({ requested, connection }) => {
    assert.equal(connection?.principalId, "alice");
    assert.equal("htmlDocument" in requested, false);
    requests.push([...requested.libraries]);
    return { libraries: ["page", "state", "extra", "secret"], writableDocuments: ["page"] };
  },
  sessions: { credential: () => "server-first-credential-0001", schedule: (_delay, callback) => { expiry = callback; return () => { expiry = undefined; }; } },
});
assert.equal("sessions" in locus, false);
for (const retired of ["cut", "captureClient", "revokeSession"]) assert.equal(retired in locus, false);
assert.equal("updateProjection" in locus.session, false);
assert.equal(locus.session.debug().activeSessionCount, 0);
const session = await locus.session.create({ libraries: ["page", "state", "secret"] }, { connection: { principalId: "alice" } });
assert.equal(locus.session.debug().activeSessionCount, 1);
const state = session.now();
assert.deepEqual(Object.keys(state).sort(), ["format", "initializerDigest", "libs", "local", "sessionBinding"]);
assert.deepEqual(state.libs.libraries.map(entry => entry.name), ["page", "state"]);
const html = session.now({ html: "page" });
assert.deepEqual(Object.keys(html).sort(), ["document", "format", "html", "initializerDigest", "libs", "local", "sessionBinding"]);
assert.deepEqual(html.libs, state.libs);
assert.match(html.html, /SSR_FIRST/);
assert.match(html.html, /color:red/);
assert.equal(session.credential, "server-first-credential-0001");
for (const forbidden of ["PRIVATE", "UNREQUESTED", "htmlDocument", session.credential!]) assert.equal(JSON.stringify(html).includes(forbidden), false);
for (const name of ["unknown", "secret", "state", "extra"]) assert.throws(() => session.now({ html: name }), /unavailable/i);
assert.throws(() => session.now({ data: [] } as never), /only html/);
const wire = pair();
let detach = bind_locus_websocket(locus, wire.server, { principalId: "alice" });
const echo = await hsonEcho.create({ now: html, credential: session.credential!, transport: test_echo_transport(wire.client) });
assert.equal(echo.sync.strategy, "current");
const id = echo.session.sessionId;
assert.ok(id);
assert.equal(locus.session.get(id), session);
assert.deepEqual(session.now().libs, html.libs);
echo.disconnect(); detach();
assert.deepEqual(session.now().libs, html.libs);
const changed = await session.update({ libraries: ["state"] });
assert.equal(changed.changed, true);
assert.deepEqual(session.now().libs.libraries.map(entry => entry.name), ["state"]);
assert.throws(() => session.now({ html: "page" }), /unavailable/i);
await locus.mutate(draft => { const state = draft.lib("state"); if ("at" in state) state.at(["value"]).set("LATER"); });
detach = bind_locus_websocket(locus, wire.server, { principalId: "alice" });
echo.connect(); await echo.session.reattach();
assert.equal(echo.sync.strategy, "reconcile");
assert.equal(locus.session.get(id), session);
assert.equal(echo.sync.debug().lastAppliedRev, locus.rev);
assert.deepEqual(session.now().libs.libraries.map(entry => entry.name), ["state"]);
for (const raw of wire.frames) assert.equal(raw.includes("htmlDocument"), false);
const wrong = pair(); const wrongDetach = bind_locus_websocket(locus, wrong.server, { principalId: "mallory" });
wrong.client.send(JSON.stringify({ type: "session-attach", id: "wrong", credential: session.credential }));
await Promise.resolve();
assert.ok(wrong.frames.some(raw => JSON.parse(raw).type === "session-rejected"));
wrongDetach();
echo.disconnect(); detach();
assert.ok(expiry); expiry();
assert.equal(locus.session.get(id), undefined);
assert.throws(() => session.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
assert.throws(() => session.credential, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
await assert.rejects(session.update({ libraries: ["page"] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
echo.dispose(); locus.dispose();
assert.equal(requests.length, 2);

// Session HTML consumes the same legal aggregate root bound as captured state.
{
  const text = "x".repeat(4 * 1024 * 1024 + 256);
  const large = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main "${text}"/>` } });
  const host = hsonLocus.create({ map: large, libraries: [{ name: "page", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["page"] }) });
  const retained = await host.session.create({ libraries: ["page"] });
  const cut = retained.now({ html: "page" });
  assert.equal(cut.html, `<main>${text}</main>`);
  assert.throws(() => decode_hosted_root(cut.libs.libraries[0]!.root), /bound|limit/i);
  assert.equal(retained.revoke(), true);
  assert.throws(() => retained.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  await assert.rejects(retained.update({ libraries: ["page"] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  host.dispose();
}
{
  const host = hsonLocus.create({ map: hsonLiveMap.fromLibraries({ state: { data: {} } }),
    libraries: [{ name: "state", ownership: "shared" }], authorizeProjection: () => ({ libraries: ["state"] }) });
  const retained = await host.session.create({ libraries: ["state"] }, { resumable: false });
  assert.equal(retained.credential, undefined);
  host.session.dispose();
  assert.throws(() => retained.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  await assert.rejects(host.session.create({ libraries: ["state"] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  host.dispose();
}

// A retained server capability cannot update behind an attachment that arrived
// while its authorizer was suspended, even before that attachment recovers.
{
  let release: (() => void) | undefined;
  let authorizing: (() => void) | undefined;
  let updating = false;
  const started = new Promise<void>(resolve => { authorizing = resolve; });
  const host = hsonLocus.create({ map: hsonLiveMap.fromLibraries({ state: { data: {} }, other: { data: {} } }),
    libraries: ["state", "other"].map(library => ({ name: library, ownership: "shared" })),
    authorizeProjection: async ({ requested }) => {
      if (updating) { authorizing?.(); await new Promise<void>(resolve => { release = resolve; }); }
      return { libraries: requested.libraries };
    } });
  const retained = await host.session.create({ libraries: ["state"] });
  updating = true;
  const pending = retained.update({ libraries: ["state", "other"] });
  await started;
  const wire = pair();
  const stop = bind_locus_websocket(host, wire.server);
  wire.client.send(JSON.stringify({ type: "session-attach", id: "during-update", credential: retained.credential }));
  await Promise.resolve();
  assert.ok(wire.frames.some(raw => JSON.parse(raw).type === "session-attached"));
  release?.();
  await assert.rejects(pending, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  assert.deepEqual(retained.now().libs.libraries.map(entry => entry.name), ["state"]);
  stop(); host.dispose();
}


// Ephemeral release is terminal for an acquired capability even if an
// application later assigns the same routing ID to a new retained session.
{
  const { admit_locus_remote_action_internal } = await import("../src/api/locus/locus.remote-action.internal.ts");
  let recycledId: string | undefined;
  let released: import("../src/types/locus.types.ts").LocusSession | undefined;
  const sessionMap = hsonLiveMap.fromLibraries({ state: { data: {} } });
  const host: import("../src/types/locus.types.ts").Locus<typeof sessionMap> = hsonLocus.create({ map: sessionMap,
    libraries: [{ name: "state", ownership: "shared" }],
    sessionId: () => recycledId ?? "unused",
    authorizeProjection: () => ({ libraries: ["state"] }),
    actions: { remember: context => {
      if (context.origin.kind !== "session") throw new Error("Expected an operation session.");
      recycledId = context.origin.sessionId;
      released = host.session.get(recycledId);
      assert.ok(released);
      assert.deepEqual(released.now().libs.libraries, []);
    } } });
  const result = await admit_locus_remote_action_internal(host, { message: { type: "action", id: "remember", name: "remember" } });
  assert.equal(result.type, "ack");
  assert.ok(released && recycledId);
  const stale = released;
  assert.throws(() => stale.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  const replacement = await host.session.create({ libraries: ["state"] });
  assert.equal(host.session.get(recycledId), replacement);
  assert.notEqual(released, replacement);
  assert.throws(() => stale.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  assert.throws(() => stale.credential, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  await assert.rejects(stale.update({ libraries: [] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  assert.equal(stale.revoke(), false);
  assert.deepEqual(replacement.now().libs.libraries.map(entry => entry.name), ["state"]);
  host.dispose();
}

// Explicit update context, including opaque authorization metadata, is copied
// before queued/asynchronous authorization can observe caller mutation.
{
  let delayed = false;
  let entered: (() => void) | undefined;
  let release: (() => void) | undefined;
  const seen: Readonly<{ principal: unknown; role: unknown }>[] = [];
  const host = hsonLocus.create({ map: hsonLiveMap.fromLibraries({
    base: { data: { value: "base" } }, aliceOnly: { data: { value: "ALICE" } },
    malloryOnly: { data: { value: "MALLORY" } }, privateValue: { data: { value: "PRIVATE" } },
    unrequestedValue: { data: { value: "UNREQUESTED" } },
  }), libraries: ["base", "aliceOnly", "malloryOnly", "privateValue", "unrequestedValue"].map(library => ({
    name: library, ownership: library === "privateValue" ? "private" as const : "shared" as const,
  })), authorizeProjection: async ({ connection }) => {
    if (delayed) { entered?.(); await new Promise<void>(resolve => { release = resolve; }); }
    const attachment = connection?.attachment;
    const role = typeof attachment === "object" && attachment !== null && "role" in attachment
      ? attachment.role : undefined;
    seen.push({ principal: connection?.principalId, role });
    const permitted = connection?.principalId === "alice" && role === "reader" ? "aliceOnly" : "malloryOnly";
    return { libraries: ["base", permitted, "privateValue", "unrequestedValue"] };
  } });
  const retained = await host.session.create({ libraries: ["base"] },
    { connection: { principalId: "alice", attachment: { role: "reader" } } });
  const context = { principalId: "alice", attachment: { role: "reader" } };
  const requested = { libraries: ["base", "aliceOnly", "malloryOnly", "privateValue"] };
  const started = new Promise<void>(resolve => { entered = resolve; });
  delayed = true;
  const pending = retained.update(requested, context);
  await started;
  context.principalId = "mallory";
  context.attachment.role = "admin";
  requested.libraries.push("unrequestedValue");
  release?.();
  assert.equal((await pending).changed, true);
  assert.deepEqual(seen.at(-1), { principal: "alice", role: "reader" });
  assert.deepEqual(retained.now().libs.libraries.map(entry => entry.name), ["aliceOnly", "base"]);
  assert.equal(JSON.stringify(retained.now()).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(retained.now()).includes("UNREQUESTED"), false);

  delayed = false;
  const revoked = await host.session.create({ libraries: ["base"] },
    { connection: { principalId: "alice", attachment: { role: "reader" } } });
  const secondStarted = new Promise<void>(resolve => { entered = resolve; });
  delayed = true;
  const afterRevocation = revoked.update({ libraries: ["base", "aliceOnly"] });
  await secondStarted;
  assert.equal(revoked.revoke(), true);
  release?.();
  await assert.rejects(afterRevocation, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  host.dispose();
}

// CURRENT recovery must retain the admitted interaction-feature contract.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" },
    state: { data: { value: "STATE" } }, added: { data: { value: "ADDED" } } });
  enable_interactions(map);
  const host = hsonLocus.create({ map, libraries: ["page", "state", "added"].map(library => ({
    name: library, ownership: "shared" as const,
  })), authorizeProjection: ({ requested }) => ({ libraries: requested.libraries,
    systemFeatures: requested.systemFeatures }) });
  const retained = await host.session.create({ libraries: ["page", "state"], systemFeatures: ["interactions"] });
  const cut = retained.now({ html: "page" });
  const clientMap = client_projection_map({ authority: cut.libs, local: {} });
  const wire = pair(); const stop = bind_locus_websocket(host, wire.server);
  const echo = create_recovery_test_driver({ transport: test_echo_transport(wire.client), map: clientMap, session: { credential: retained.credential } });
  echo.connect(); await echo.awaitReconnect();
  assert.equal(echo.sync.strategy, "current");
  assert.equal((await retained.update({ libraries: ["page", "state", "added"],
    systemFeatures: ["interactions"] })).changed, true);
  assert.equal(echo.sync.status, "caught_up");
  assert.equal(clientMap.lib("added").mode, "data-object");
  const change = wire.frames.map(raw => JSON.parse(raw)).find(frame => frame.type === "projection-change");
  assert.ok(change);
  assert.deepEqual(change.systemFeatures, ["interactions"]);
  wire.server.send(JSON.stringify({ ...change, sequence: change.sequence + 1,
    previousDigest: change.projectionDigest, systemFeatures: [] }));
  const syncStatus = (): string => echo.sync.status;
  for (let turn = 0; turn < 20 && syncStatus() !== "failed"; turn++) await Promise.resolve();
  assert.equal(echo.sync.status, "failed");
  assert.ok(echo.sync.failure);
  assert.equal(echo.sync.debug().status, "failed");
  echo.dispose(); stop(); host.dispose();
}

// Reconciliation consumes the same legal >4 MiB hosted root as installation.
{
  const text = "x".repeat(4 * 1024 * 1024 + 256);
  const map = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main "${text}"/>` },
    extra: { data: { value: "REMOVE_ME" } } });
  const host = hsonLocus.create({ map, libraries: ["page", "extra"].map(library => ({
    name: library, ownership: "shared" as const,
  })), authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
  const retained = await host.session.create({ libraries: ["page", "extra"] });
  const cut = retained.now({ html: "page" });
  assert.equal(cut.html, `<main>${text}</main>`);
  assert.ok(cut.libs.libraries.find(entry => entry.name === "page")!.root.payload.length > 4 * 1024 * 1024);
  const clientMap = client_projection_map({ authority: cut.libs, local: {} });
  const wire = pair(); const stop = bind_locus_websocket(host, wire.server);
  const echo = create_recovery_test_driver({ transport: test_echo_transport(wire.client), map: clientMap, session: { credential: retained.credential } });
  echo.connect(); await echo.awaitReconnect();
  assert.equal(echo.sync.strategy, "current");
  assert.equal((await retained.update({ libraries: ["page"] })).changed, true);
  assert.ok(wire.frames.map(raw => JSON.parse(raw)).some(frame => frame.type === "projection-change"
    && frame.reconciliation !== undefined));
  assert.equal(echo.sync.status, "caught_up");
  assert.throws(() => clientMap.lib("extra"));
  assert.equal(clientMap.lib("page").mode, "document");

  assert.equal((await retained.update({ libraries: ["page", "extra"] })).changed, true);
  assert.equal(clientMap.lib("extra").mode, "data-object");
  echo.disconnect(); stop();
  assert.equal((await retained.update({ libraries: ["page"] })).changed, true);
  const reconnect = bind_locus_websocket(host, wire.server);
  echo.connect(); await echo.awaitReconnect();
  assert.equal(echo.sync.strategy, "reconcile");
  assert.equal(echo.sync.status, "caught_up");
  assert.throws(() => clientMap.lib("extra"));
  assert.equal(clientMap.lib("page").mode, "document");
  echo.dispose(); reconnect(); host.dispose();
}

console.log("Retained session checks passed.");

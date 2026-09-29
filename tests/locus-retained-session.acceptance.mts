import assert from "node:assert/strict";
import { hsonLiveMap, hsonLocus, hsonEcho, Hson, type LocusSocketLike } from "../src/index.ts";
import { decode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.retained-session", title: "Retained session server-first cuts",
  category: "Locus", runtime: "node", tags: Object.freeze(["locus", "session", "ssr", "security", "recovery"]) });

function pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const frames: string[] = [];
  const client: LocusSocketLike = { send(raw) { for (const listener of [...toServer]) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; }, onClose() { return () => {}; } };
  const server: LocusSocketLike = { send(raw) { frames.push(raw); for (const listener of [...toClient]) listener(raw); }, close() {},
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
  exposure: ["page", "state", "extra", "secret"].map(library => ({ library, exposure: library === "secret" ? "server-private" : "client-public" })),
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
const state = session.cut();
assert.deepEqual(Object.keys(state), ["libs"]);
assert.deepEqual(state.libs.libraries.map(entry => entry.name), ["page", "state"]);
const html = session.cut({ html: "page" });
assert.deepEqual(Object.keys(html).sort(), ["document", "html", "libs"]);
assert.deepEqual(html.libs, state.libs);
assert.match(html.html, /SSR_FIRST/);
assert.match(html.html, /color:red/);
assert.equal(session.credential, "server-first-credential-0001");
for (const forbidden of ["PRIVATE", "UNREQUESTED", "htmlDocument", session.credential!]) assert.equal(JSON.stringify(html).includes(forbidden), false);
for (const name of ["unknown", "secret", "state", "extra"]) assert.throws(() => session.cut({ html: name }), /unavailable/i);
assert.throws(() => session.cut({ data: [] } as never), /only html/);
const browser = hsonLiveMap.fromClientSnapshot({ authority: html.libs, localLibraries: {} });
const wire = pair();
let detach = locus.connect(wire.server, { principalId: "alice" });
const echo = hsonEcho.create({ socket: wire.client, map: browser,
  recovery: { logicalMapId: html.libs.authority.logicalMapId }, session: { credential: session.credential } });
echo.connect();
await echo.session.reattach();
assert.equal((await echo.recovery.recover()).strategy, "current");
const id = echo.session.sessionId;
assert.ok(id);
assert.equal(locus.session.get(id), session);
assert.deepEqual(session.cut().libs, html.libs);
echo.disconnect(); detach();
assert.deepEqual(session.cut().libs, html.libs);
const changed = await session.update({ libraries: ["state"] });
assert.equal(changed.changed, true);
assert.deepEqual(session.cut().libs.libraries.map(entry => entry.name), ["state"]);
assert.throws(() => session.cut({ html: "page" }), /unavailable/i);
await locus.mutate(draft => { const state = draft.lib("state"); if ("at" in state) state.at(["value"]).set("LATER"); });
detach = locus.connect(wire.server, { principalId: "alice" });
echo.connect(); await echo.session.reattach();
assert.equal((await echo.recovery.recover()).strategy, "snapshot");
assert.equal(locus.session.get(id), session);
assert.equal(echo.recovery.lastAppliedRev, locus.rev);
assert.deepEqual(session.cut().libs.libraries.map(entry => entry.name), ["state"]);
for (const raw of wire.frames) assert.equal(raw.includes("htmlDocument"), false);
const wrong = pair(); const wrongDetach = locus.connect(wrong.server, { principalId: "mallory" });
wrong.client.send(JSON.stringify({ type: "session-attach", id: "wrong", credential: session.credential }));
assert.ok(wrong.frames.some(raw => JSON.parse(raw).type === "session-rejected"));
wrongDetach();
echo.disconnect(); detach();
assert.ok(expiry); expiry();
assert.equal(locus.session.get(id), undefined);
assert.throws(() => session.cut(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
assert.throws(() => session.credential, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
await assert.rejects(session.update({ libraries: ["page"] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
echo.dispose(); locus.dispose();
assert.equal(requests.length, 2);

// Session HTML consumes the same legal aggregate root bound as captured state.
{
  const text = "x".repeat(4 * 1024 * 1024 + 256);
  const large = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main "${text}"/>` } });
  const host = hsonLocus.create({ map: large, exposure: [{ library: "page", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["page"] }) });
  const retained = await host.session.create({ libraries: ["page"] });
  const cut = retained.cut({ html: "page" });
  assert.equal(cut.html, `<main>${text}</main>`);
  assert.throws(() => decode_hosted_root(cut.libs.libraries[0]!.root), /bound|limit/i);
  assert.equal(retained.revoke(), true);
  assert.throws(() => retained.cut(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  await assert.rejects(retained.update({ libraries: ["page"] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  host.dispose();
}
{
  const host = hsonLocus.create({ map: hsonLiveMap.fromLibraries({ state: { data: {} } }),
    exposure: [{ library: "state", exposure: "client-public" }], authorizeProjection: () => ({ libraries: ["state"] }) });
  const retained = await host.session.create({ libraries: ["state"] }, { resumable: false });
  assert.equal(retained.credential, undefined);
  host.session.dispose();
  assert.throws(() => retained.cut(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
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
    exposure: ["state", "other"].map(library => ({ library, exposure: "client-public" })),
    authorizeProjection: async ({ requested }) => {
      if (updating) { authorizing?.(); await new Promise<void>(resolve => { release = resolve; }); }
      return { libraries: requested.libraries };
    } });
  const retained = await host.session.create({ libraries: ["state"] });
  updating = true;
  const pending = retained.update({ libraries: ["state", "other"] });
  await started;
  const wire = pair();
  const stop = host.connect(wire.server);
  wire.client.send(JSON.stringify({ type: "session-attach", id: "during-update", credential: retained.credential }));
  assert.ok(wire.frames.some(raw => JSON.parse(raw).type === "session-attached"));
  release?.();
  await assert.rejects(pending, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  assert.deepEqual(retained.cut().libs.libraries.map(entry => entry.name), ["state"]);
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
    exposure: [{ library: "state", exposure: "client-public" }],
    sessionId: () => recycledId ?? "unused",
    authorizeProjection: () => ({ libraries: ["state"] }),
    actions: { remember: context => {
      if (context.origin.kind !== "session") throw new Error("Expected an operation session.");
      recycledId = context.origin.sessionId;
      released = host.session.get(recycledId);
      assert.ok(released);
      assert.deepEqual(released.cut().libs.libraries, []);
    } } });
  const result = await admit_locus_remote_action_internal(host, { message: { type: "action", id: "remember", name: "remember" } });
  assert.equal(result.type, "ack");
  assert.ok(released && recycledId);
  const stale = released;
  assert.throws(() => stale.cut(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  const replacement = await host.session.create({ libraries: ["state"] });
  assert.equal(host.session.get(recycledId), replacement);
  assert.notEqual(released, replacement);
  assert.throws(() => stale.cut(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  assert.throws(() => stale.credential, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  await assert.rejects(stale.update({ libraries: [] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  assert.equal(stale.revoke(), false);
  assert.deepEqual(replacement.cut().libs.libraries.map(entry => entry.name), ["state"]);
  host.dispose();
}

console.log("Retained session checks passed.");

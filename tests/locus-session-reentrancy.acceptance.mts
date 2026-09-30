import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import assert from "node:assert/strict";
import { make_locus_session_manager } from "../src/api/locus/locus.session.ts";
import { hsonLiveMap, hsonLocus } from "../src/index.ts";
import { normalize_locus_effective_projection, make_locus_hosted_projection_policy } from "../src/api/locus/locus.projection.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.session-reentrancy", title: "Session lifecycle reentrancy",
  category: "Locus", runtime: "node", tags: Object.freeze(["locus", "session", "security"]) });

const map = hsonLiveMap.fromLibraries({ state: { data: { value: "visible" } } });
const aggregate = internal_livemap_aggregate_authority(map);
const effective = await normalize_locus_effective_projection(make_locus_hosted_projection_policy(
  aggregate.hostedRegistry(), aggregate.hostedPosition().authority,
  [{ name: "state", ownership: "shared" }], undefined, () => ({ libraries: ["state"] })), { libraries: ["state"] });

for (const terminal of ["revoke", "dispose", "goodbye", "expire"] as const) {
  let expire: (() => void) | undefined;
  const manager = make_locus_session_manager({ credential: () => "reentrancy-credential-0001", schedule: (_delay, callback) => {
    expire = callback; return () => {};
  } });
  const first = manager.create("one", true, { fence: () => {
    if (terminal === "revoke") manager.revoke("one");
    if (terminal === "dispose") manager.dispose();
    if (terminal === "goodbye") manager.goodbye("one", 1);
    if (terminal === "expire") { manager.detach("one", 1); expire?.(); }
  } }, () => {}, () => 0, undefined, effective);
  assert.ok(first.ok);
  const attached = manager.reattach("reentrancy-credential-0001", { fence: () => {} });
  assert.equal(attached.ok, false, terminal);
  assert.equal(manager.projection("one"), undefined, terminal);
  assert.equal(manager.is_active("one", 2), false, terminal);
  assert.equal(manager.debug().reattachmentCount, 0, terminal);
  manager.dispose();
}
{
  const manager = make_locus_session_manager();
  const checks: string[] = [];
  manager.create("one", false, { fence: () => { checks.push("fence"); assert.equal(manager.projection("one"), undefined); } },
    () => {}, () => 0, undefined, effective);
  manager.onChange(event => { checks.push(event.kind); assert.equal(manager.projection("one"), undefined); });
  assert.equal(manager.revoke("one"), true);
  assert.deepEqual(checks, ["fence", "fenced", "revoked"]);
}

// Public capture and HTML cut are unavailable even inside the first fence
// callback, before the revoked lifecycle notification is delivered.
for (const transition of ["revoke", "dispose-manager", "dispose-locus"] as const) {
  const host = hsonLocus.create({ map: hsonLiveMap.fromLibraries({ page: { document: "<main/>" } }),
    libraries: [{ name: "page", ownership: "shared" }], defaultProjection: { libraries: ["page"] },
    authorizeProjection: () => ({ libraries: ["page"] }) });
  let receive: ((raw: string) => void) | undefined;
  let id: string | undefined;
  let credential: string | undefined;
  let retained: import("../src/types/locus.types.ts").LocusSession | undefined;
  let fences = 0;
  const stop = bind_locus_websocket(host, { send(raw) {
    const frame = JSON.parse(raw);
    if (frame.type === "session-created") { id = frame.sessionId; credential = frame.credential; }
    if (frame.type === "session-fenced") {
      fences += 1;
      if (transition === "revoke") {
        assert.throws(() => retained!.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
        assert.throws(() => retained!.now({ html: "page" }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
      } else if (transition === "dispose-manager") host.session.dispose();
      else host.dispose();
    }
  }, close() {}, onMessage(listener) { receive = listener; return () => {}; }, onClose() { return () => {}; } });
  receive?.(JSON.stringify({ type: "session-create", id: "first" }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(id && credential);
  retained = host.session.get(id)!;
  let events = 0;
  const observerAvailability: boolean[] = [];
  host.session.onChange(event => {
    if (event.kind !== "fenced" && event.kind !== "revoked") return;
    events += 1;
    try { retained!.now(); observerAvailability.push(true); }
    catch { observerAvailability.push(false); }
  });
  if (transition === "revoke") assert.equal(retained.revoke(), true);
  else {
    const frames: string[] = [];
    let attach: ((raw: string) => void) | undefined;
    const replacement = bind_locus_websocket(host, { send(raw) { frames.push(raw); }, close() {},
      onMessage(listener) { attach = listener; return () => {}; }, onClose() { return () => {}; } });
    attach?.(JSON.stringify({ type: "session-attach", id: "replacement", credential }));
    assert.equal(frames.some(raw => JSON.parse(raw).type === "session-attached"), false);
    assert.equal(host.session.debug().reattachmentCount, 0);
    replacement();
  }
  assert.equal(fences, 1);
  assert.ok(events >= 1);
  assert.deepEqual(observerAvailability, Array(events).fill(false));
  assert.throws(() => retained.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  stop(); host.dispose();
}

// Transport listener cleanup is externally callable before manager disposal.
// Locus disposal must already fence every capability operation at that point.
{
  const host = hsonLocus.create({ map: hsonLiveMap.fromLibraries({ state: { data: {} } }),
    libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }) });
  const retained = await host.session.create({ libraries: ["state"] });
  let revoked: boolean | undefined;
  bind_locus_websocket(host, { send() {}, close() {},
    onMessage() { return () => { revoked = retained.revoke(); }; }, onClose() { return () => {}; } });
  host.dispose();
  assert.equal(revoked, false);
  assert.throws(() => retained.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
}

// A destination closed synchronously by an old fence or lifecycle observer
// cannot become the manager's new live attachment.
for (const closeAt of ["fence-send", "fenced-listener", "attached-listener"] as const) {
  const scheduled: (() => void)[] = [];
  const host = hsonLocus.create({ map: hsonLiveMap.fromLibraries({ page: { document: "<main/>" } }),
    libraries: [{ name: "page", ownership: "shared" }], defaultProjection: { libraries: ["page"] },
    authorizeProjection: () => ({ libraries: ["page"] }),
    sessions: { schedule: (_delay, callback) => { scheduled.push(callback); return () => {}; } } });
  let firstReceive: ((raw: string) => void) | undefined;
  let destinationReceive: ((raw: string) => void) | undefined;
  let sessionId: string | undefined;
  let credential: string | undefined;
  let closeDestination: (() => void) | undefined;
  let armed = true;
  const stopFirst = bind_locus_websocket(host, { send(raw) {
    const frame = JSON.parse(raw);
    if (frame.type === "session-created") { sessionId = frame.sessionId; credential = frame.credential; }
    if (frame.type === "session-fenced" && closeAt === "fence-send" && armed) closeDestination?.();
  }, close() {}, onMessage(listener) { firstReceive = listener; return () => {}; }, onClose() { return () => {}; } });
  firstReceive?.(JSON.stringify({ type: "session-create", id: "first" }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(sessionId && credential);
  const retained = host.session.get(sessionId)!;
  host.session.onChange(event => {
    if (!armed) return;
    if (closeAt === "fenced-listener" && event.kind === "fenced") closeDestination?.();
    if (closeAt === "attached-listener" && event.kind === "attached" && event.attachment === "reattached") {
      closeDestination?.();
    }
  });
  const destinationFrames: string[] = [];
  closeDestination = bind_locus_websocket(host, { send(raw) { destinationFrames.push(raw); }, close() {},
    onMessage(listener) { destinationReceive = listener; return () => {}; }, onClose() { return () => {}; } });
  destinationReceive?.(JSON.stringify({ type: "session-attach", id: "closed-destination", credential }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  armed = false;
  assert.equal(destinationFrames.some(raw => JSON.parse(raw).type === "session-attached"), false, closeAt);
  const disconnected = host.session.debug().sessions.find(session => session.sessionId === sessionId);
  assert.equal(disconnected?.state, "disconnected", closeAt);
  assert.equal(disconnected.transportAttached, false, closeAt);
  assert.ok(disconnected.expiresAt !== undefined, closeAt);
  assert.equal(scheduled.length, 1, closeAt);
  assert.deepEqual(retained.now().libs.libraries.map(entry => entry.name), ["page"]);

  let validReceive: ((raw: string) => void) | undefined;
  const validFrames: string[] = [];
  const stopValid = bind_locus_websocket(host, { send(raw) { validFrames.push(raw); }, close() {},
    onMessage(listener) { validReceive = listener; return () => {}; }, onClose() { return () => {}; } });
  validReceive?.(JSON.stringify({ type: "session-attach", id: "valid-destination", credential }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(validFrames.some(raw => JSON.parse(raw).type === "session-attached"), closeAt);
  assert.equal(host.session.get(sessionId), retained);
  stopValid();
  scheduled.at(-1)?.();
  assert.equal(host.session.debug().sessions.find(session => session.sessionId === sessionId)?.state, "expired");
  assert.throws(() => retained.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  stopFirst(); host.dispose();
}

console.log("Session reentrancy checks passed.");

import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { LiveHostClientSessionError, hson } from "../../src/index.ts";

let checks = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    checks += 1;
    process.stdout.write(`ok ${checks} - ${name}\n`);
  });
}

function socket_pair() {
  const clientMessages = new Set();
  const serverMessages = new Set();
  const clientCloses = new Set();
  const serverCloses = new Set();
  const clientSent = [];
  const serverSent = [];
  let closed = false;
  const client = {
    send(raw) { clientSent.push(raw); for (const listener of [...serverMessages]) listener(raw); },
    close() { close(); },
    onMessage(listener) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose(listener) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
  };
  const server = {
    send(raw) { serverSent.push(raw); for (const listener of [...clientMessages]) listener(raw); },
    close() { close(); },
    onMessage(listener) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose(listener) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
  };
  function close() {
    if (closed) return;
    closed = true;
    for (const listener of [...clientCloses]) listener();
    for (const listener of [...serverCloses]) listener();
  }
  return { client, server, clientSent, serverSent, close };
}

function fake_clock() {
  let time = 1_000;
  let nextId = 0;
  const tasks = new Map();
  function schedule(delay, callback) {
    const id = ++nextId;
    tasks.set(id, { due: time + delay, callback });
    return () => tasks.delete(id);
  }
  function advance(ms) {
    time += ms;
    while (true) {
      const due = [...tasks.entries()].filter(([, task]) => task.due <= time).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      tasks.delete(due[0]);
      due[1].callback();
    }
  }
  return { now: () => time, schedule, advance, pending: () => tasks.size };
}

function host_fixture(extra = {}) {
  let sessionId = 0;
  let credentialId = 0;
  const clock = extra.clock ?? fake_clock();
  const host = hson.liveHost.create({
    state: { value: 0 },
    logicalMapId: extra.logicalMapId ?? "session-map",
    sessionId: () => `session-${++sessionId}`,
    history: extra.history,
    recovery: extra.recovery,
    actions: {
      set(ctx, value) { ctx.map.set(["value"], value); },
      increment(ctx) { ctx.map.set(["value"], ctx.map.snap().value + 1); },
    },
    sessions: {
      graceMs: extra.graceMs ?? 100,
      now: clock.now,
      schedule: clock.schedule,
      credential: () => `credential-${String(++credentialId).padStart(20, "0")}`,
    },
  });
  return { host, clock };
}

function connect_client(host, options = {}) {
  const pair = socket_pair();
  const connection = host.connect(pair.server);
  const client = hson.liveHost.client({ socket: pair.client, ...options });
  client.connect();
  return { pair, connection, client };
}

async function create_recovered(host) {
  const fixture = connect_client(host, {
    session: {},
    recovery: { logicalMapId: host.stream.logicalMapId },
  });
  const session = await fixture.client.session.create();
  await fixture.client.recovery.recover();
  return { ...fixture, session };
}

function resume_options(host, client, credential) {
  return {
    map: client.map,
    session: { credential },
    recovery: {
      logicalMapId: host.stream.logicalMapId,
      cursor: {
        incarnationId: client.recovery.incarnationId,
        lastAppliedRev: client.recovery.lastAppliedRev,
      },
    },
  };
}

await check("basic reattachment restores session subscriptions and uses replay", async () => {
  const { host } = host_fixture({ logicalMapId: "basic" });
  const first = await create_recovered(host);
  first.client.subscribe(["value"]);
  const credential = first.client.session.credential;
  const originalSessionId = first.client.session.sessionId;
  const options = resume_options(host, first.client, credential);
  first.pair.close();
  host.map.set(["value"], 1);

  const second = connect_client(host, options);
  const attached = await second.client.session.reattach();
  assert.equal(attached.sessionId, originalSessionId);
  assert.equal(attached.reattached, true);
  const recovered = await second.client.recovery.recover();
  assert.equal(recovered.strategy, "replay");
  assert.deepEqual(second.client.map.snap(), host.map.snap());
  assert.equal(host.sessions.debug().sessions.find((item) => item.sessionId === originalSessionId).subscriptionCount, 1);
  await second.client.action("set", 2);
  assert.deepEqual(second.client.map.snap(), { value: 2 });
  assert.equal(second.client.recovery.lastAppliedRev, host.stream.headRev);
});

await check("new attachment fences the old transport and rejects late authority", async () => {
  const { host } = host_fixture({ logicalMapId: "fence" });
  const first = await create_recovered(host);
  first.client.subscribe(["value"]);
  const initialSubscriptions = host.sessions.debug().sessions[0].subscriptionCount;
  const second = connect_client(host, resume_options(host, first.client, first.client.session.credential));
  const attached = await second.client.session.reattach();
  assert.equal(attached.epoch, 2);
  assert.equal(first.client.session.status, "detached");
  assert.equal(first.client.session.failure.code, "LIVEHOST_SESSION_ATTACHMENT_FENCED");
  first.pair.client.send(JSON.stringify({ type: "action", id: "late", name: "increment" }));
  first.pair.client.send(JSON.stringify({ type: "subscribe", path: ["late"] }));
  assert.deepEqual(host.map.snap(), { value: 0 });
  assert.equal(host.sessions.debug().sessions[0].subscriptionCount, initialSubscriptions);
  first.connection.emit_event("late-event", { ignored: true });
  assert.equal(first.pair.serverSent.map(JSON.parse).some((message) => message.type === "event"), false);
});

await check("old close after fencing cannot detach the new epoch", async () => {
  const { host } = host_fixture({ logicalMapId: "close-race" });
  const first = await create_recovered(host);
  const second = connect_client(host, resume_options(host, first.client, first.client.session.credential));
  await second.client.session.reattach();
  first.pair.close();
  assert.equal(host.sessions.debug().sessions[0].state, "attached");
  assert.equal(host.sessions.debug().sessions[0].activeConnectionEpoch, 2);
  await second.client.recovery.recover();
  await second.client.action("increment");
  assert.deepEqual(host.map.snap(), { value: 1 });
});

await check("A to B to C fencing increases epochs and leaves only C authoritative", async () => {
  const { host } = host_fixture({ logicalMapId: "epochs" });
  const first = await create_recovered(host);
  const credential = first.client.session.credential;
  const second = connect_client(host, resume_options(host, first.client, credential));
  assert.equal((await second.client.session.reattach()).epoch, 2);
  const third = connect_client(host, resume_options(host, first.client, credential));
  assert.equal((await third.client.session.reattach()).epoch, 3);
  assert.equal(first.client.session.status, "detached");
  assert.equal(second.client.session.status, "detached");
  assert.equal(third.client.session.status, "attached");
  const diagnostic = host.sessions.debug().sessions[0];
  assert.equal(diagnostic.activeConnectionEpoch, 3);
  assert.equal(diagnostic.fencingCount, 2);
});

await check("fake-clock grace period accepts before deadline and expires after it", async () => {
  const { host, clock } = host_fixture({ logicalMapId: "expiry", graceMs: 100 });
  const first = await create_recovered(host);
  const credential = first.client.session.credential;
  const options = resume_options(host, first.client, credential);
  first.pair.close();
  assert.equal(clock.pending(), 1);
  clock.advance(99);
  const second = connect_client(host, options);
  await second.client.session.reattach();
  assert.equal(clock.pending(), 0);
  second.pair.close();
  clock.advance(101);
  assert.equal(host.sessions.debug().sessions[0].state, "expired");
  assert.equal(clock.pending(), 0);
  const expired = connect_client(host, { session: { credential } });
  await assert.rejects(expired.client.session.reattach(), (error) => error instanceof LiveHostClientSessionError && error.code === "LIVEHOST_SESSION_CREDENTIAL_EXPIRED");
});

await check("attached sessions do not expire when the clock advances", async () => {
  const { host, clock } = host_fixture({ logicalMapId: "attached-expiry", graceMs: 10 });
  const fixture = await create_recovered(host);
  clock.advance(10_000);
  assert.equal(fixture.client.session.status, "attached");
  assert.equal(host.sessions.debug().sessions[0].state, "attached");
  assert.equal(host.sessions.debug().expiryCount, 0);
});

await check("graceful goodbye revokes credentials but leaves map state available", async () => {
  const { host } = host_fixture({ logicalMapId: "goodbye" });
  const first = await create_recovered(host);
  const credential = first.client.session.credential;
  await first.client.action("set", 4);
  await first.client.session.goodbye();
  assert.equal(first.client.session.status, "ended");
  assert.equal(host.sessions.debug().sessions[0].state, "revoked");
  assert.deepEqual(host.map.snap(), { value: 4 });
  await assert.rejects(first.client.session.goodbye(), (error) => error.code === "LIVEHOST_SESSION_ALREADY_GONE");
  const revoked = connect_client(host, { session: { credential } });
  await assert.rejects(revoked.client.session.reattach(), (error) => error.code === "LIVEHOST_SESSION_CREDENTIAL_REVOKED");
  const replacement = await create_recovered(host);
  assert.deepEqual(replacement.client.map.snap(), { value: 4 });
});

await check("missing malformed and unknown credentials are classified", async () => {
  const { host } = host_fixture({ logicalMapId: "invalid-creds" });
  for (const [credential, code] of [
    [undefined, "LIVEHOST_SESSION_CREDENTIAL_MISSING"],
    ["short", "LIVEHOST_SESSION_CREDENTIAL_MALFORMED"],
    ["unknown-credential-value", "LIVEHOST_SESSION_CREDENTIAL_UNKNOWN"],
  ]) {
    const fixture = connect_client(host, { session: credential === undefined ? {} : { credential } });
    await assert.rejects(fixture.client.session.reattach(), (error) => error.code === code);
  }
  const counts = host.sessions.debug().rejectedCredentialCounts;
  assert.equal(counts.LIVEHOST_SESSION_CREDENTIAL_MISSING, 1);
  assert.equal(counts.LIVEHOST_SESSION_CREDENTIAL_MALFORMED, 1);
  assert.equal(counts.LIVEHOST_SESSION_CREDENTIAL_UNKNOWN, 1);
});

await check("expired session can create a new session and snapshot-recover the same map", async () => {
  const { host, clock } = host_fixture({ logicalMapId: "expired-new", graceMs: 5, history: { maxCommits: 0, maxBytes: 0 } });
  const first = await create_recovered(host);
  first.pair.close();
  host.map.set(["value"], 8);
  clock.advance(6);
  const fresh = connect_client(host, { session: {}, recovery: { logicalMapId: host.stream.logicalMapId } });
  await fresh.client.session.create();
  const result = await fresh.client.recovery.recover();
  assert.equal(result.strategy, "snapshot");
  assert.deepEqual(fresh.client.map.snap(), { value: 8 });
});

await check("reattached session uses snapshot when canonical history is unavailable", async () => {
  const { host } = host_fixture({ logicalMapId: "reattach-snapshot", history: { maxCommits: 0, maxBytes: 0 } });
  const first = await create_recovered(host);
  const options = resume_options(host, first.client, first.client.session.credential);
  first.pair.close();
  host.map.set(["value"], 6);
  const second = connect_client(host, options);
  await second.client.session.reattach();
  const result = await second.client.recovery.recover();
  assert.equal(result.strategy, "snapshot");
  assert.deepEqual(second.client.map.snap(), { value: 6 });
  assert.equal(second.client.session.status, "attached");
});

await check("session credentials cannot weaken revision-ahead validation", async () => {
  const { host } = host_fixture({ logicalMapId: "revision-policy" });
  const first = await create_recovered(host);
  const pair = socket_pair();
  host.connect(pair.server);
  const mirror = hson.liveMap.fromJson({ value: 99 });
  const client = hson.liveHost.client({
    socket: pair.client,
    map: mirror,
    session: { credential: first.client.session.credential },
    recovery: {
      logicalMapId: host.stream.logicalMapId,
      cursor: { incarnationId: host.stream.incarnationId, lastAppliedRev: host.stream.headRev + 5 },
    },
  });
  client.connect();
  await client.session.reattach();
  await assert.rejects(client.recovery.recover(), (error) => error.code === "REVISION_AHEAD_OF_AUTHORITY");
  assert.equal(client.map, mirror);
});

await check("two independent sessions fence independently", async () => {
  const { host } = host_fixture({ logicalMapId: "independent" });
  const one = await create_recovered(host);
  const two = await create_recovered(host);
  const replacement = connect_client(host, resume_options(host, one.client, one.client.session.credential));
  await replacement.client.session.reattach();
  assert.equal(one.client.session.status, "detached");
  assert.equal(two.client.session.status, "attached");
  assert.equal(host.sessions.debug().attachedSessionCount, 2);
  assert.equal(host.sessions.debug().fencingCount, 1);
});

await check("expiry disposes subscriptions and scheduler resources without socket retention", async () => {
  const { host, clock } = host_fixture({ logicalMapId: "leaks", graceMs: 5 });
  for (let index = 0; index < 3; index += 1) {
    const fixture = await create_recovered(host);
    fixture.client.subscribe(["value"]);
    fixture.pair.close();
    clock.advance(6);
  }
  const diagnostics = host.sessions.debug();
  assert.equal(diagnostics.activeSessionCount, 0);
  assert.equal(diagnostics.sessions.reduce((total, item) => total + item.subscriptionCount, 0), 0);
  assert.equal(clock.pending(), 0);
});

function ws_socket(ws) {
  return {
    send(raw) { ws.send(raw); },
    close(code, reason) { ws.close(code, reason); },
    onMessage(listener) { const handler = (data) => listener(data.toString()); ws.on("message", handler); return () => ws.off("message", handler); },
    onClose(listener) { ws.on("close", listener); return () => ws.off("close", listener); },
  };
}
function opened(ws) { return new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); }); }
function closed(ws) { return new Promise((resolve) => ws.once("close", resolve)); }

await check("real WebSocket reattachment fences A before B recovers", async () => {
  const { host } = host_fixture({ logicalMapId: "real-session" });
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  server.on("connection", (socket) => host.connect(ws_socket(socket)));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}`;
  const wsA = new WebSocket(url);
  await opened(wsA);
  const clientA = hson.liveHost.client({ socket: ws_socket(wsA), session: {}, recovery: { logicalMapId: host.stream.logicalMapId } });
  clientA.connect();
  await clientA.session.create();
  await clientA.recovery.recover();
  const credential = clientA.session.credential;

  const wsB = new WebSocket(url);
  await opened(wsB);
  const clientB = hson.liveHost.client({ socket: ws_socket(wsB), map: clientA.map, session: { credential }, recovery: { logicalMapId: host.stream.logicalMapId, cursor: { incarnationId: clientA.recovery.incarnationId, lastAppliedRev: clientA.recovery.lastAppliedRev } } });
  clientB.connect();
  const attached = await clientB.session.reattach();
  assert.equal(attached.epoch, 2);
  assert.equal(clientA.session.status, "detached");
  assert.equal((await clientB.recovery.recover()).strategy, "current");
  const closeA = closed(wsA); wsA.close(); await closeA;
  assert.equal(host.sessions.debug().sessions[0].state, "attached");
  const closeB = closed(wsB); wsB.close(); await closeB;
  await new Promise((resolve) => server.close(resolve));
});

process.stdout.write(`LiveHost session acceptance checks passed (${checks}).\n`);

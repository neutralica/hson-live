import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { decode_livehost_server_message, LiveHostClientRecoveryError, hson } from "../../src/index.ts";

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
  let beforeServerDelivery;

  const client = {
    send(raw) {
      clientSent.push(raw);
      for (const listener of [...serverMessages]) listener(raw);
    },
    onMessage(listener) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose(listener) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
  };
  const server = {
    send(raw) {
      serverSent.push(raw);
      beforeServerDelivery?.(JSON.parse(raw));
      for (const listener of [...clientMessages]) listener(raw);
    },
    onMessage(listener) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose(listener) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
  };

  return {
    client,
    server,
    clientSent,
    serverSent,
    set_before_server_delivery(hook) { beforeServerDelivery = hook; },
    push_server(message) { server.send(JSON.stringify(message)); },
    close() {
      for (const listener of [...clientCloses]) listener();
      for (const listener of [...serverCloses]) listener();
    },
  };
}

function attach(host, pair, options = {}) {
  host.connect(pair.server);
  const client = hson.liveHost.client({ socket: pair.client, ...options });
  client.connect();
  return client;
}

function recovery_options(host, map, rev, incarnationId = host.stream.incarnationId) {
  return {
    map,
    recovery: {
      logicalMapId: host.stream.logicalMapId,
      cursor: { incarnationId, lastAppliedRev: rev },
    },
  };
}

function canonical_set(logicalMapId, incarnationId, prevRev, rev, prev, next) {
  return {
    logicalMapId,
    incarnationId,
    prevRev,
    rev,
    ops: [{
      kind: "set",
      path: ["value"],
      prev: { present: true, value: prev },
      next: { present: true, value: next },
    }],
  };
}

function compact_hson(value) {
  return hson.fromJson(value).toHson().noBreak().serialize();
}

await check("protocol accepts string HSON without parsing snapshot syntax", () => {
  const decoded = decode_livehost_server_message(JSON.stringify({
    type: "recovery-snapshot",
    id: "protocol-hson",
    snapshot: {
      logicalMapId: "map",
      incarnationId: "inc",
      rev: 0,
      hson: `<tag "unterminated>`,
    },
  }));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.ok && decoded.value.type, "recovery-snapshot");
});

await check("protocol rejects legacy value snapshots and malformed HSON envelopes", () => {
  const base = { type: "recovery-snapshot", id: "protocol-invalid" };
  const invalidSnapshots = [
    { logicalMapId: "map", incarnationId: "inc", rev: 0, value: {} },
    { logicalMapId: "map", incarnationId: "inc", rev: 0, hson: 123 },
    { logicalMapId: "map", incarnationId: "inc", rev: -1, hson: "<>" },
    { logicalMapId: "", incarnationId: "inc", rev: 0, hson: "<>" },
    { logicalMapId: "map", incarnationId: "", rev: 0, hson: "<>" },
    { logicalMapId: "map", incarnationId: "inc", rev: 0 },
    { logicalMapId: "map", incarnationId: "inc", rev: 0, hson: "<>", extra: true },
  ];
  for (const snapshot of invalidSnapshots) {
    const decoded = decode_livehost_server_message(JSON.stringify({ ...base, snapshot }));
    assert.equal(decoded.ok, false);
    assert.match(decoded.ok ? "" : decoded.error.message, /Malformed LiveHost recovery snapshot message/);
  }
});

await check("snapshot recovery installs one atomic replacement", async () => {
  const host = hson.liveHost.create({ state: { value: 7 }, logicalMapId: "map-snapshot" });
  host.map.set(["value"], 8);
  const schema = hson.liveMap.schema.define((shape) => ({ value: shape.number }));
  const mirror = hson.liveMap.fromJson({ value: 0 });
  mirror.schema.use(schema);
  const pair = socket_pair();
  let queuedTail = false;
  pair.set_before_server_delivery((message) => {
    if (!queuedTail && message.type === "recovery-plan" && message.outcome === "snapshot") {
      queuedTail = true;
      host.map.set(["value"], 9);
    }
  });
  const client = attach(host, pair, { map: mirror, recovery: { logicalMapId: host.stream.logicalMapId } });
  const oldMap = client.map;
  const observed = [];
  client.recovery.on_change((change) => observed.push({ kind: change.kind, value: change.map.snap(), active: change.map === client.map }));
  const result = await client.recovery.recover();
  assert.equal(result.strategy, "snapshot");
  assert.equal(client.recovery.incarnationId, host.stream.incarnationId);
  assert.equal(client.recovery.lastAppliedRev, host.stream.headRev);
  assert.deepEqual(client.map.snap(), host.map.snap());
  assert.notEqual(client.map, oldMap);
  assert.deepEqual(oldMap.snap(), { value: 0 });
  assert.equal(client.map.schema.get(), schema);
  assert.equal(client.recovery.debug().snapshotInstalls, 1);
  assert.equal(observed.filter((change) => change.kind === "snapshot").length, 1);
  assert.deepEqual(observed, [
    { kind: "snapshot", value: { value: 8 }, active: true },
    { kind: "commit", value: { value: 9 }, active: true },
  ]);
  const snapshotMessage = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot");
  assert.equal(typeof snapshotMessage.snapshot.hson, "string");
  assert.equal(snapshotMessage.snapshot.hson.includes("\n"), false);
  assert.equal("value" in snapshotMessage.snapshot, false);
});

await check("replay applies exact commits once and current emits no body", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-replay" });
  const base = host.stream.headRev;
  const mirror = hson.liveMap.fromJson(host.map.snap());
  host.map.set(["value"], 1);
  host.map.set(["value"], 2);
  const pair = socket_pair();
  const client = attach(host, pair, recovery_options(host, mirror, base));
  const revs = [];
  client.recovery.on_change((change) => revs.push(change.rev));
  const replay = await client.recovery.recover();
  assert.equal(replay.strategy, "replay");
  assert.deepEqual(revs, [base + 1, base + 2]);
  assert.deepEqual(client.map.snap(), host.map.snap());
  const notifications = client.recovery.debug().consumerNotifications;
  const current = await client.recovery.recover();
  assert.equal(current.strategy, "current");
  assert.equal(client.recovery.debug().consumerNotifications, notifications);
});

await check("small history falls back to snapshot", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-fallback", history: { maxCommits: 1, maxBytes: 1_000_000 } });
  const base = host.stream.headRev;
  const mirror = hson.liveMap.fromJson(host.map.snap());
  host.map.set(["value"], 1);
  host.map.set(["value"], 2);
  const pair = socket_pair();
  const client = attach(host, pair, recovery_options(host, mirror, base));
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  assert.equal(client.recovery.debug().snapshotInstalls, 1);
});

await check("incarnation mismatch resets only after snapshot validation", async () => {
  const old = hson.liveMap.fromJson({ value: "old" });
  const host = hson.liveHost.create({ state: { value: "new" }, logicalMapId: "same-map", incarnationId: "new-inc" });
  const pair = socket_pair();
  const client = attach(host, pair, recovery_options(host, old, 0, "old-inc"));
  const result = await client.recovery.recover();
  assert.equal(result.strategy, "snapshot");
  assert.equal(result.incarnationChanged, true);
  assert.equal(client.recovery.incarnationId, "new-inc");
  assert.deepEqual(old.snap(), { value: "old" });
  assert.deepEqual(client.map.snap(), { value: "new" });
});

await check("revision ahead rejects without replacing the mirror", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-ahead" });
  const mirror = hson.liveMap.fromJson({ value: 99 });
  const pair = socket_pair();
  const client = attach(host, pair, recovery_options(host, mirror, host.stream.headRev + 2));
  await assert.rejects(client.recovery.recover(), (error) => error instanceof LiveHostClientRecoveryError && error.code === "REVISION_AHEAD_OF_AUTHORITY");
  assert.equal(client.map, mirror);
  assert.equal(client.recovery.lastAppliedRev, host.stream.headRev + 2);
  assert.equal(pair.serverSent.some((raw) => JSON.parse(raw).type === "recovery-snapshot"), false);
});

await check("cut boundary puts pre-cut in body and post-cut in tail", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-cut" });
  const base = host.stream.headRev;
  const mirror = hson.liveMap.fromJson(host.map.snap());
  host.map.set(["value"], 1);
  const pair = socket_pair();
  let mutated = false;
  pair.set_before_server_delivery((message) => {
    if (message.type === "recovery-plan" && !mutated) {
      mutated = true;
      host.map.set(["value"], 2);
    }
  });
  const client = attach(host, pair, recovery_options(host, mirror, base));
  const revs = [];
  client.recovery.on_change((change) => revs.push(change.rev));
  const result = await client.recovery.recover();
  assert.equal(result.headRev, base + 1);
  assert.deepEqual(revs, [base + 1, base + 2]);
  assert.equal(new Set(revs).size, revs.length);
  assert.equal(client.recovery.debug().bodyCommitsApplied, 1);
  assert.equal(client.recovery.debug().tailCommitsApplied, 1);
});

await check("reentrant canonical publication remains ordered", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-reentrant" });
  const pair = socket_pair();
  const client = attach(host, pair, { recovery: { logicalMapId: host.stream.logicalMapId } });
  await client.recovery.recover();
  const base = client.recovery.lastAppliedRev;
  const revs = [];
  client.recovery.on_change((change) => {
    revs.push(change.rev);
    if (change.map.snap().value === 1) host.map.set(["value"], 2);
  });
  host.map.set(["value"], 1);
  assert.deepEqual(revs, [base + 1, base + 2]);
  assert.deepEqual(client.map.snap(), { value: 2 });
});

await check("valid duplicate is ignored after full decode", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-dupe" });
  const pair = socket_pair();
  const client = attach(host, pair, { recovery: { logicalMapId: host.stream.logicalMapId } });
  await client.recovery.recover();
  const base = client.recovery.lastAppliedRev;
  host.map.set(["value"], 1);
  const commit = host.stream.history.replay_after(base, base + 1)[0];
  const recoverRequest = pair.clientSent.map(JSON.parse).find((message) => message.type === "recover");
  const before = client.recovery.debug().consumerNotifications;
  pair.push_server({ type: "commit", id: recoverRequest.id, commit });
  assert.equal(client.recovery.lastAppliedRev, base + 1);
  assert.equal(client.recovery.debug().consumerNotifications, before);
  assert.equal(client.recovery.debug().duplicateCommitsIgnored, 1);
});

await check("gap stops later application and preserves last valid state", async () => {
  const pair = socket_pair();
  const mirror = hson.liveMap.fromJson({ value: 0 });
  const client = hson.liveHost.client({ socket: pair.client, map: mirror, recovery: { logicalMapId: "scripted", cursor: { incarnationId: "inc", lastAppliedRev: 0 } } });
  client.connect();
  const promise = client.recovery.recover();
  const id = JSON.parse(pair.clientSent.at(-1)).id;
  pair.push_server({ type: "recovery-plan", id, sessionId: "s", logicalMapId: "scripted", incarnationId: "inc", headRev: 0, outcome: "current" });
  pair.push_server({ type: "recovery-caught-up", id, caughtUp: { kind: "caught_up", logicalMapId: "scripted", incarnationId: "inc", throughRev: 0 } });
  await promise;
  pair.push_server({ type: "commit", id, commit: canonical_set("scripted", "inc", 1, 2, 1, 2) });
  pair.push_server({ type: "commit", id, commit: canonical_set("scripted", "inc", 2, 3, 2, 3) });
  assert.equal(client.recovery.failure.code, "LIVEHOST_RECOVERY_COMMIT_GAP");
  assert.deepEqual(client.map.snap(), { value: 0 });
  assert.equal(client.recovery.lastAppliedRev, 0);
});

await check("replay conflict preserves cursor and supports a later snapshot attempt", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-conflict" });
  const mirror = hson.liveMap.fromJson({ value: 100 });
  const base = host.stream.headRev;
  host.map.set(["value"], 1);
  const pair = socket_pair();
  const client = attach(host, pair, recovery_options(host, mirror, base));
  await assert.rejects(client.recovery.recover(), (error) => error.code === "LIVEHOST_RECOVERY_REPLAY_CONFLICT");
  assert.equal(client.recovery.lastAppliedRev, base);
  assert.deepEqual(client.map.snap(), { value: 100 });
  const replacement = hson.liveHost.client({ socket: pair.client, recovery: { logicalMapId: host.stream.logicalMapId } });
  replacement.connect();
  assert.equal((await replacement.recovery.recover()).strategy, "snapshot");
});

await check("invalid snapshot retains old mirror and cursor", async () => {
  const pair = socket_pair();
  const mirror = hson.liveMap.fromJson({ value: 1 });
  const client = hson.liveHost.client({ socket: pair.client, map: mirror, recovery: { logicalMapId: "bad-snapshot", cursor: { incarnationId: "old", lastAppliedRev: 4 } } });
  client.connect();
  const promise = client.recovery.recover();
  const id = JSON.parse(pair.clientSent.at(-1)).id;
  pair.push_server({ type: "recovery-plan", id, sessionId: "s", logicalMapId: "bad-snapshot", incarnationId: "new", headRev: 5, outcome: "snapshot", reason: "incarnation_mismatch" });
  pair.push_server({ type: "recovery-snapshot", id, snapshot: { logicalMapId: "bad-snapshot", incarnationId: "new", rev: 6, hson: compact_hson({ value: 2 }) } });
  await assert.rejects(promise, (error) => error.code === "LIVEHOST_RECOVERY_INVALID_SNAPSHOT");
  assert.equal(client.map, mirror);
  assert.equal(client.recovery.lastAppliedRev, 4);
});

await check("malformed snapshot HSON fails installation without advancing state", async () => {
  const pair = socket_pair();
  const mirror = hson.liveMap.fromJson({ value: 1 });
  const client = hson.liveHost.client({ socket: pair.client, map: mirror, recovery: { logicalMapId: "malformed-hson", cursor: { incarnationId: "old", lastAppliedRev: 4 } } });
  client.connect();
  let notifications = 0;
  client.recovery.on_change(() => { notifications += 1; });
  const promise = client.recovery.recover();
  const id = JSON.parse(pair.clientSent.at(-1)).id;
  pair.push_server({ type: "recovery-plan", id, sessionId: "s", logicalMapId: "malformed-hson", incarnationId: "new", headRev: 5, outcome: "snapshot", reason: "incarnation_mismatch" });
  pair.push_server({ type: "recovery-snapshot", id, snapshot: { logicalMapId: "malformed-hson", incarnationId: "new", rev: 5, hson: `<value "unterminated>` } });
  await assert.rejects(
    promise,
    (error) => error.code === "LIVEHOST_RECOVERY_INVALID_SNAPSHOT" && error.cause instanceof Error,
  );
  assert.equal(client.map, mirror);
  assert.deepEqual(client.map.snap(), { value: 1 });
  assert.equal(client.recovery.incarnationId, "old");
  assert.equal(client.recovery.lastAppliedRev, 4);
  assert.equal(client.recovery.debug().snapshotInstalls, 0);
  assert.equal(notifications, 0);
  assert.ok(client.recovery.failure.cause instanceof Error);
});

await check("valid HSON rejected by the active schema does not replace the mirror", async () => {
  const pair = socket_pair();
  const schema = hson.liveMap.schema.define((shape) => ({ value: shape.number }));
  const mirror = hson.liveMap.fromJson({ value: 1 });
  mirror.schema.use(schema);
  const client = hson.liveHost.client({ socket: pair.client, map: mirror, recovery: { logicalMapId: "schema-invalid", cursor: { incarnationId: "old", lastAppliedRev: 4 } } });
  client.connect();
  const promise = client.recovery.recover();
  const id = JSON.parse(pair.clientSent.at(-1)).id;
  pair.push_server({ type: "recovery-plan", id, sessionId: "s", logicalMapId: "schema-invalid", incarnationId: "new", headRev: 5, outcome: "snapshot", reason: "incarnation_mismatch" });
  pair.push_server({ type: "recovery-snapshot", id, snapshot: { logicalMapId: "schema-invalid", incarnationId: "new", rev: 5, hson: compact_hson({ value: "wrong" }) } });
  await assert.rejects(
    promise,
    (error) => error.code === "LIVEHOST_RECOVERY_INVALID_SNAPSHOT" && error.cause instanceof Error,
  );
  assert.equal(client.map, mirror);
  assert.deepEqual(client.map.snap(), { value: 1 });
  assert.equal(client.map.schema.get(), schema);
  assert.equal(client.recovery.lastAppliedRev, 4);
  assert.equal(client.recovery.debug().snapshotInstalls, 0);
});

await check("legacy value snapshot fails as a protocol envelope error", async () => {
  const pair = socket_pair();
  const mirror = hson.liveMap.fromJson({ value: 1 });
  const client = hson.liveHost.client({ socket: pair.client, map: mirror, recovery: { logicalMapId: "legacy-envelope", cursor: { incarnationId: "old", lastAppliedRev: 4 } } });
  client.connect();
  const promise = client.recovery.recover();
  const id = JSON.parse(pair.clientSent.at(-1)).id;
  pair.push_server({ type: "recovery-plan", id, sessionId: "s", logicalMapId: "legacy-envelope", incarnationId: "new", headRev: 5, outcome: "snapshot", reason: "incarnation_mismatch" });
  pair.push_server({ type: "recovery-snapshot", id, snapshot: { logicalMapId: "legacy-envelope", incarnationId: "new", rev: 5, value: { value: 2 } } });
  await assert.rejects(promise, (error) => error.code === "LIVEHOST_RECOVERY_PROTOCOL_DECODE_FAILED");
  assert.equal(client.map, mirror);
  assert.equal(client.recovery.lastAppliedRev, 4);
});

await check("tail overflow is visible and a fresh recovery succeeds", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-overflow", recovery: { maxTailCommits: 1, maxTailBytes: 1_000_000 } });
  const mirror = hson.liveMap.fromJson(host.map.snap());
  host.map.set(["value"], 1);
  const pair = socket_pair();
  let overflow = true;
  pair.set_before_server_delivery((message) => {
    if (overflow && message.type === "recovery-plan") {
      overflow = false;
      host.map.set(["value"], 2);
      host.map.set(["value"], 3);
    }
  });
  const client = attach(host, pair, recovery_options(host, mirror, 0));
  await assert.rejects(client.recovery.recover(), (error) => error.code === "LIVEHOST_RECOVERY_TAIL_OVERFLOW");
  assert.notEqual(client.recovery.status, "caught_up");
  const fresh = hson.liveHost.client({ socket: pair.client, recovery: { logicalMapId: host.stream.logicalMapId } });
  fresh.connect();
  assert.equal((await fresh.recovery.recover()).strategy, "snapshot");
});

await check("disposal is idempotent and later messages cannot mutate", async () => {
  const pair = socket_pair();
  const client = hson.liveHost.client({ socket: pair.client, recovery: { logicalMapId: "dispose-map" } });
  client.connect();
  const promise = client.recovery.recover();
  const id = JSON.parse(pair.clientSent.at(-1)).id;
  pair.push_server({ type: "recovery-plan", id, sessionId: "s", logicalMapId: "dispose-map", incarnationId: "inc", headRev: 0, outcome: "snapshot", reason: "no_usable_revision" });
  client.recovery.dispose();
  client.recovery.dispose();
  await assert.rejects(promise, (error) => error.code === "LIVEHOST_RECOVERY_DISPOSED");
  pair.push_server({ type: "recovery-snapshot", id, snapshot: { logicalMapId: "dispose-map", incarnationId: "inc", rev: 0, hson: compact_hson({ value: 9 }) } });
  assert.deepEqual(client.map.snap(), {});
  assert.equal(client.recovery.status, "disposed");
});

await check("two clients recover independently with replay and snapshot", async () => {
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "map-multi" });
  const base = host.stream.headRev;
  const replayMirror = hson.liveMap.fromJson(host.map.snap());
  host.map.set(["value"], 1);
  const replayPair = socket_pair();
  const snapshotPair = socket_pair();
  const replayClient = attach(host, replayPair, recovery_options(host, replayMirror, base));
  const snapshotClient = attach(host, snapshotPair, { recovery: { logicalMapId: host.stream.logicalMapId } });
  const [replayResult, snapshotResult] = await Promise.all([
    replayClient.recovery.recover(),
    snapshotClient.recovery.recover(),
  ]);
  assert.equal(replayResult.strategy, "replay");
  assert.equal(snapshotResult.strategy, "snapshot");
  host.map.set(["value"], 2);
  assert.deepEqual(replayClient.map.snap(), { value: 2 });
  assert.deepEqual(snapshotClient.map.snap(), { value: 2 });
  assert.equal(replayClient.recovery.lastAppliedRev, host.stream.headRev);
  assert.equal(snapshotClient.recovery.lastAppliedRev, host.stream.headRev);
  assert.notEqual(replayClient.map, snapshotClient.map);
});

await check("legacy hello synchronization remains unchanged", async () => {
  const host = hson.liveHost.create({ state: { value: "legacy" } });
  const pair = socket_pair();
  host.connect(pair.server);
  const client = hson.liveHost.client({ socket: pair.client });
  client.connect();
  assert.deepEqual(client.map.snap(), host.map.snap());
  assert.equal(pair.clientSent.map(JSON.parse).some((message) => message.type === "hello"), true);
  assert.equal(pair.clientSent.map(JSON.parse).some((message) => message.type === "recover"), false);
});

function ws_socket(ws) {
  return {
    send(raw) { ws.send(raw); },
    onMessage(listener) {
      const handler = (data) => listener(data.toString());
      ws.on("message", handler);
      return () => ws.off("message", handler);
    },
    onClose(listener) { ws.on("close", listener); return () => ws.off("close", listener); },
  };
}

function opened(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function closed(ws) {
  return new Promise((resolve) => ws.once("close", resolve));
}

await check("real WebSocket reconnect uses a new session and recovers state", async () => {
  let session = 0;
  const host = hson.liveHost.create({ state: { value: 0 }, logicalMapId: "real-ws", sessionId: () => `session-${++session}` });
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  server.on("connection", (socket) => host.connect(ws_socket(socket)));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}`;

  const ws1 = new WebSocket(url);
  await opened(ws1);
  const first = hson.liveHost.client({ socket: ws_socket(ws1), recovery: { logicalMapId: host.stream.logicalMapId } });
  first.connect();
  const initial = await first.recovery.recover();
  const savedMap = first.map;
  const savedCursor = { incarnationId: first.recovery.incarnationId, lastAppliedRev: first.recovery.lastAppliedRev };
  const close1 = closed(ws1);
  ws1.close();
  await close1;
  host.map.set(["value"], 1);
  host.map.set(["value"], 2);

  const ws2 = new WebSocket(url);
  await opened(ws2);
  const second = hson.liveHost.client({ socket: ws_socket(ws2), map: savedMap, recovery: { logicalMapId: host.stream.logicalMapId, cursor: savedCursor } });
  second.connect();
  const resumed = await second.recovery.recover();
  assert.notEqual(resumed.sessionId, initial.sessionId);
  assert.equal(resumed.strategy, "replay");
  assert.deepEqual(second.map.snap(), host.map.snap());
  const close2 = closed(ws2);
  ws2.close();
  await close2;
  await new Promise((resolve) => server.close(resolve));
});

process.stdout.write(`LiveHost client recovery acceptance checks passed (${checks}).\n`);

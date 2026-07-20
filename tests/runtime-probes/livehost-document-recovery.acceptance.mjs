import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { make_livehost_canonical_stream } from "../../src/api/livehost/livehost.history.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { encode_view_state_snapshot } from "../../src/api/livemap/livemap.document.view-state-codec.ts";
import { ViewStateSnapshotCodecError } from "../../src/api/livemap/livemap.document.view-state-codec.error.ts";
import { LiveHostDocumentSnapshotEncodeError } from "../../src/api/livehost/livehost.document-snapshot.ts";

let checks = 0;

async function check(name, fn) {
  await fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function socket_pair() {
  const clientMessages = new Set();
  const serverMessages = new Set();
  const clientSent = [];
  const serverSent = [];
  let beforeServerDelivery;
  const client = {
    send(raw) {
      clientSent.push(raw);
      for (const listener of [...serverMessages]) listener(raw);
    },
    onMessage(listener) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  const server = {
    send(raw) {
      serverSent.push(raw);
      beforeServerDelivery?.(JSON.parse(raw));
      for (const listener of [...clientMessages]) listener(raw);
    },
    onMessage(listener) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  return {
    client,
    server,
    clientSent,
    serverSent,
    set_before_server_delivery(hook) { beforeServerDelivery = hook; },
  };
}

function element(source) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function fragment(source) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
  return map;
}

function attach(host, map, cursor) {
  const pair = socket_pair();
  const disconnectHost = host.connect(pair.server);
  const client = hson.liveHost.client({
    socket: pair.client,
    map,
    recovery: {
      logicalMapId: host.stream.logicalMapId,
      ...(cursor === undefined ? {} : { cursor }),
    },
  });
  client.connect();
  return { client, pair, disconnectHost };
}

function raw_recovery(host, id, snapshotCapabilities, cursor) {
  const pair = socket_pair();
  const disconnectHost = host.connect(pair.server);
  pair.client.send(JSON.stringify({
    type: "recover",
    id,
    logicalMapId: host.stream.logicalMapId,
    ...(cursor ?? {}),
    ...(snapshotCapabilities === undefined ? {} : { snapshotCapabilities }),
  }));
  return { pair, disconnectHost, messages: pair.serverSent.map(JSON.parse) };
}

function find_node(node, tag) {
  if (node.$_tag === tag) return node;
  for (const child of node.$_content) {
    if (typeof child !== "object" || child === null) continue;
    const found = find_node(child, tag);
    if (found) return found;
  }
  return undefined;
}

function begin_scripted_snapshot_recovery(map, logicalMapId, incarnationId, headRev) {
  const pair = socket_pair();
  const client = hson.liveHost.client({
    socket: pair.client,
    map,
    recovery: {
      logicalMapId,
      cursor: { incarnationId: "previous-incarnation", lastAppliedRev: map.rev },
    },
  });
  client.connect();
  const promise = client.recovery.recover();
  const request = pair.clientSent.map(JSON.parse).find((message) => message.type === "recover");
  pair.server.send(JSON.stringify({
    type: "recovery-plan",
    id: request.id,
    sessionId: "view-state-snapshot-session",
    logicalMapId,
    incarnationId,
    headRev,
    outcome: "snapshot",
    reason: "incarnation_mismatch",
    snapshotEncoding: { format: "view-state", formatVersion: 1 },
  }));
  return { pair, client, promise, requestId: request.id };
}

let scriptedFailureId = 0;
async function expect_scripted_snapshot_failure(snapshotBody, expectedCode, forbidden = []) {
  scriptedFailureId += 1;
  const logicalMapId = snapshotBody.logicalMapId ?? `view-state-failure-${scriptedFailureId}`;
  const incarnationId = snapshotBody.incarnationId ?? `view-state-failure-incarnation-${scriptedFailureId}`;
  const headRev = snapshotBody.rev ?? 0;
  const mirror = element(`<aside data-_quid="0000000000000050"/>`);
  const before = mirror.capture();
  const { pair, client, promise, requestId } = begin_scripted_snapshot_recovery(
    mirror,
    logicalMapId,
    incarnationId,
    headRev,
  );
  pair.server.send(JSON.stringify({
    type: "recovery-snapshot",
    id: requestId,
    snapshot: { logicalMapId, incarnationId, rev: headRev, mode: "element", ...snapshotBody },
  }));
  let observed;
  await assert.rejects(promise, (error) => {
    observed = error;
    return error.code === expectedCode;
  });
  const rejectedTailSource = element(`<aside/>`);
  const rejectedTail = rejectedTailSource.document.attrs.set(root, "tail-after-failure", "must-not-apply");
  pair.server.send(JSON.stringify({
    type: "recovery-commit",
    id: requestId,
    phase: "tail",
    commit: {
      logicalMapId,
      incarnationId,
      mode: "element",
      prevRev: headRev,
      rev: headRev + 1,
      ops: rejectedTail.ops,
    },
  }));
  assert.deepEqual(client.map.capture(), before);
  assert.equal(client.recovery.lastAppliedRev, before.rev);
  assert.equal(client.recovery.debug().snapshotInstalls, 0);
  assert.equal(client.recovery.debug().tailCommitsApplied, 0);
  for (const privateText of forbidden) assert.equal(observed.message.includes(privateText), false);
  return { client, error: observed };
}

const root = { kind: "path", path: [] };

await check("replace-attrs canonical history is detached and published exactly once", async () => {
  let observer;
  const fakeAuthority = {
    mode: "element",
    rev: 0,
    commits: {
      observe(listener) {
        observer = listener;
        return () => {};
      },
    },
  };
  const stream = make_livehost_canonical_stream(fakeAuthority, {
    logicalMapId: "replace-attrs-history",
    incarnationId: "replace-attrs-incarnation",
  });
  const publications = [];
  stream.on_commit((commit) => publications.push(commit));
  const attrs = { style: { color: "red" }, title: "after" };
  observer({
    kind: "commit",
    origin: "authoritative",
    commit: {
      changed: true,
      prevRev: 0,
      rev: 1,
      ops: [{ domain: "graph", op: "replace-attrs", target: root, attrs }],
    },
  });
  const retained = stream.history.replay_after(0, 1);
  assert.equal(retained?.length, 1);
  assert.equal(publications.length, 1);
  assert.equal(stream.headRev, 1);
  assert.equal(stream.history.debug().retainedCommitCount, 1);
  const retainedOp = retained?.[0]?.ops[0];
  assert.equal(retainedOp?.op, "replace-attrs");
  if (retainedOp?.op !== "replace-attrs") throw new Error("Expected replace-attrs");
  assert.notEqual(retainedOp.attrs, attrs);
  attrs.title = "caller-mutated";
  attrs.style.color = "blue";
  assert.deepEqual(retainedOp.attrs, { style: { color: "red" }, title: "after" });
});

await check("state and existing-map constructor forms are mutually exclusive at runtime", async () => {
  assert.throws(
    () => hson.liveHost.create({ state: {}, map: element(`<main/>`) }),
    /mutually exclusive/,
  );
});

await check("existing element authority publishes detached graph history and replays to an element mirror", async () => {
  const initial = `<main data-_quid="0000000000000001" <p data-_quid="0000000000000002" "old"/>/>`;
  const authority = element(initial);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-element-replay" });
  const sourceCommit = authority.document.attrs.set({ kind: "quid", quid: "0000000000000002" }, "title", "kept");
  const retained = host.stream.history.replay_after(0, 1);
  assert.equal(host.map, authority);
  assert.equal(host.stream.mode, "element");
  assert.equal(retained?.length, 1);
  assert.notEqual(retained?.[0]?.ops, sourceCommit.ops);
  assert.deepEqual(retained?.[0]?.ops, sourceCommit.ops);

  const mirror = element(initial);
  const { client } = attach(host, mirror, { incarnationId: host.stream.incarnationId, lastAppliedRev: 0 });
  const result = await client.recovery.recover();
  assert.equal(result.strategy, "replay");
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "element");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("0000000000000002")?.$_attrs?.title, "kept");
});

await check("node-bearing fragment history is detached and incremental replay preserves QUID lookup", async () => {
  const initial = `<section data-_quid="0000000000000003" "old"/> "tail"`;
  const authority = fragment(initial);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-fragment-replay" });
  const replacement = element(`<article data-_quid="0000000000000004" "new"/>`).element.node();
  const sourceCommit = authority.document.content.replace(root, 0, replacement);
  const retained = host.stream.history.replay_after(0, 1)?.[0];
  const sourceOp = sourceCommit.ops[0];
  const retainedOp = retained?.ops[0];
  assert.equal(sourceOp?.op, "replace-content");
  assert.equal(retainedOp?.op, "replace-content");
  if (sourceOp?.op !== "replace-content" || retainedOp?.op !== "replace-content") throw new Error("Expected content replacement");
  assert.notEqual(retainedOp.replacement, sourceOp.replacement);
  assert.deepEqual(retainedOp.replacement, sourceOp.replacement);

  const mirror = fragment(initial);
  const { client } = attach(host, mirror, { incarnationId: host.stream.incarnationId, lastAppliedRev: 0 });
  assert.equal((await client.recovery.recover()).strategy, "replay");
  assert.equal(client.map.mode, "fragment");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("0000000000000004")?.$_tag, "article");
});

await check("insert-content history detaches canonical nodes from source commits and live graph", async () => {
  const initial = `<a/> <c/>`;
  const authority = fragment(initial);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-insert-history" });
  const content = element(`<b data-_quid="000000000000001h"/>`).element.node();
  const sourceCommit = authority.document.content.insert(root, 1, content);
  const retained = host.stream.history.replay_after(0, 1)?.[0];
  const sourceOp = sourceCommit.ops[0];
  const retainedOp = retained?.ops[0];
  assert.equal(sourceOp?.op, "insert-content");
  assert.equal(retainedOp?.op, "insert-content");
  if (sourceOp?.op !== "insert-content" || retainedOp?.op !== "insert-content") {
    throw new Error("Expected content insertion");
  }
  assert.notEqual(retainedOp.content, sourceOp.content);
  assert.deepEqual(retainedOp.content, sourceOp.content);
  content.$_tag = "caller-mutated";
  sourceOp.content.$_tag = "commit-mutated";
  assert.equal(authority.document.byQuid("000000000000001h")?.$_tag, "b");
  assert.equal(retainedOp.content.$_tag, "b");
});

await check("element snapshot recovery restores exact revision, mode, and persisted QUIDs in place", async () => {
  const authority = element(`<main data-_quid="0000000000000005" <p data-_quid="0000000000000006"/>/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-element-snapshot" });
  authority.document.attrs.set(root, "class", "ready");
  const mirror = element(`<aside data-_quid="0000000000000007"/>`);
  const { client } = attach(host, mirror);
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "element");
  assert.equal(client.map.rev, host.stream.headRev);
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("0000000000000005")?.$_tag, "main");
  assert.equal(client.map.document.byQuid("0000000000000006")?.$_tag, "p");
});

await check("fragment snapshot recovery reconstructs fragment mode without JSON projection", async () => {
  const authority = fragment(`"lead" <section data-_quid="0000000000000008"/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-fragment-snapshot" });
  const mirror = fragment(`<div/> "old"`);
  const { client, pair } = attach(host, mirror);
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  assert.equal(client.map.mode, "fragment");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("0000000000000008")?.$_tag, "section");
  const messages = pair.serverSent.map(JSON.parse);
  const plan = messages.find((message) => message.type === "recovery-plan");
  const snapshot = messages.find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.deepEqual(plan.snapshotEncoding, { format: "view-state", formatVersion: 1 });
  assert.equal(snapshot?.mode, "fragment");
  assert.equal(snapshot?.format, "view-state");
  assert.equal(snapshot?.formatVersion, 1);
  assert.equal(typeof snapshot?.payload, "string");
  assert.equal("hson" in snapshot, false);
  assert.equal("value" in snapshot, false);
});

await check("an old client without capabilities receives the established HSON snapshot shape", async () => {
  const authority = element(`<main/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "old-client-hson-snapshot" });
  const pair = socket_pair();
  host.connect(pair.server);
  pair.client.send(JSON.stringify({
    type: "recover",
    id: "old-client-recovery",
    logicalMapId: host.stream.logicalMapId,
  }));
  const messages = pair.serverSent.map(JSON.parse);
  const plan = messages.find((message) => message.type === "recovery-plan");
  const snapshot = messages.find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal("snapshotEncoding" in plan, false);
  assert.equal(typeof snapshot.hson, "string");
  assert.equal("format" in snapshot, false);
  assert.equal("formatVersion" in snapshot, false);
  assert.equal("payload" in snapshot, false);
  const recovered = hson.liveMap.fromHson(snapshot.hson);
  assert.equal(canonical_hson_graph_equal(recovered.capture().root, authority.capture().root), true);
});

await check("HSON-only and unsupported future view-state advertisements select HSON explicitly", async () => {
  const authority = element(`<main data-_quid="0000000000000040"/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "hson-capability-selection" });
  for (const [id, capabilities] of [
    ["hson-only", { hson: true }],
    ["empty-view-state", { hson: true, viewStateVersions: [] }],
    ["future-view-state", { hson: true, viewStateVersions: [99] }],
  ]) {
    const { messages, disconnectHost } = raw_recovery(host, id, capabilities);
    const plan = messages.find((message) => message.type === "recovery-plan");
    const snapshot = messages.find((message) => message.type === "recovery-snapshot")?.snapshot;
    assert.deepEqual(plan.snapshotEncoding, { format: "hson" });
    assert.equal(typeof snapshot.hson, "string");
    assert.equal("format" in snapshot, false);
    disconnectHost();
  }
});

await check("snapshot capabilities cannot change during one connection", async () => {
  const authority = element(`<main/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "immutable-snapshot-selection" });
  const pair = socket_pair();
  host.connect(pair.server);
  pair.client.send(JSON.stringify({
    type: "recover",
    id: "first-selection",
    logicalMapId: host.stream.logicalMapId,
    snapshotCapabilities: { hson: true },
  }));
  pair.client.send(JSON.stringify({
    type: "recover",
    id: "changed-selection",
    logicalMapId: host.stream.logicalMapId,
    snapshotCapabilities: { hson: true, viewStateVersions: [1] },
  }));
  const messages = pair.serverSent.map(JSON.parse);
  assert.deepEqual(
    messages.find((message) => message.type === "recovery-plan" && message.id === "first-selection")?.snapshotEncoding,
    { format: "hson" },
  );
  const failure = messages.find((message) => message.type === "recovery-error" && message.id === "changed-selection");
  assert.equal(failure.error.code, "LIVEHOST_RECOVERY_NEGOTIATION_FAILED");
  assert.equal(messages.some((message) => message.type === "recovery-snapshot" && message.id === "changed-selection"), false);
});

await check("malformed snapshot capability advertisements reject without document disclosure", async () => {
  const authority = element(`<main title="private-capability-document"/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "malformed-capabilities" });
  const malformed = [
    true,
    { hson: true, viewStateVersions: "1" },
    { hson: true, viewStateVersions: [1.5] },
    { hson: true, viewStateVersions: [-1] },
    { hson: true, viewStateVersions: [1, 1] },
    { hson: true, unexpected: true },
  ];
  for (const [index, snapshotCapabilities] of malformed.entries()) {
    const { messages, disconnectHost } = raw_recovery(
      host,
      `malformed-capabilities-${index}`,
      snapshotCapabilities,
    );
    const error = messages.find((message) => message.type === "error");
    assert.equal(error.error.code, "LIVEHOST_SNAPSHOT_CAPABILITIES_INVALID");
    assert.equal(JSON.stringify(error).includes("private-capability-document"), false);
    disconnectHost();
  }
});

await check("view-state negotiation is acknowledged for replay-only recovery", async () => {
  const authority = element(`<main data-_quid="0000000000000049"/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "view-state-replay-only" });
  const mirror = element(`<main data-_quid="0000000000000049"/>`);
  authority.document.attrs.set(root, "title", "replayed");
  const { client, pair } = attach(host, mirror, {
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  assert.equal((await client.recovery.recover()).strategy, "replay");
  const messages = pair.serverSent.map(JSON.parse);
  const plan = messages.find((message) => message.type === "recovery-plan");
  assert.deepEqual(plan.snapshotEncoding, { format: "view-state", formatVersion: 1 });
  assert.equal(messages.some((message) => message.type === "recovery-snapshot"), false);
  assert.equal(messages.filter((message) => message.type === "recovery-commit").length, 1);
  assert.equal(client.map.rev, authority.rev);
});

await check("snapshot negotiation is isolated across simultaneous connections and reconnect", async () => {
  const authority = element(`<main data-_quid="000000000000004a" <span/>/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "snapshot-selection-isolation" });
  const oldConnection = raw_recovery(host, "old-connection", undefined);
  const modernMirror = element(`<aside/>`);
  const modernConnection = attach(host, modernMirror);
  await modernConnection.client.recovery.recover();

  const oldPlan = oldConnection.messages.find((message) => message.type === "recovery-plan");
  const oldSnapshot = oldConnection.messages.find((message) => message.type === "recovery-snapshot")?.snapshot;
  const modernMessages = modernConnection.pair.serverSent.map(JSON.parse);
  const modernPlan = modernMessages.find((message) => message.type === "recovery-plan");
  const modernSnapshot = modernMessages.find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal("snapshotEncoding" in oldPlan, false);
  assert.equal(typeof oldSnapshot.hson, "string");
  assert.deepEqual(modernPlan.snapshotEncoding, { format: "view-state", formatVersion: 1 });
  assert.equal(modernSnapshot.format, "view-state");
  assert.equal(canonical_hson_graph_equal(modernConnection.client.map.capture().root, authority.capture().root), true);
  const oldRecovered = hson.liveMap.fromHson(oldSnapshot.hson);
  assert.equal(canonical_hson_graph_equal(oldRecovered.capture().root, authority.capture().root), true);

  modernConnection.client.disconnect();
  modernConnection.disconnectHost();
  const reconnect = raw_recovery(host, "reconnected-without-capabilities", undefined);
  const reconnectPlan = reconnect.messages.find((message) => message.type === "recovery-plan");
  const reconnectSnapshot = reconnect.messages.find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal("snapshotEncoding" in reconnectPlan, false);
  assert.equal(typeof reconnectSnapshot.hson, "string");
  oldConnection.disconnectHost();
  reconnect.disconnectHost();
});

await check("view-state element snapshot recovery preserves typed document state exactly", async () => {
  const logicalMapId = "view-state-element-snapshot";
  const authority = element(`<main data-_quid="0000000000000041" <span data-_quid="0000000000000042"/>/>`);
  authority.document.attrs.replace(root, {
    count: 0,
    enabled: false,
    missing: null,
    empty: "",
    style: { opacity: 0.5, width: { value: 2, unit: "px" } },
  });
  const capture = authority.capture();
  const host = hson.liveHost.create({ map: authority, logicalMapId, incarnationId: "view-state-element-incarnation" });
  const mirror = element(`<aside/>`);
  const { client, pair } = attach(host, mirror);

  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  const snapshot = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal(snapshot.format, "view-state");
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(typeof snapshot.payload, "string");
  assert.equal("hson" in snapshot, false);
  assert.equal(snapshot.logicalMapId, host.stream.logicalMapId);
  assert.equal(snapshot.incarnationId, host.stream.incarnationId);
  assert.equal(snapshot.mode, capture.mode);
  assert.equal(snapshot.rev, capture.rev);
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "element");
  assert.equal(client.map.rev, capture.rev);
  assert.equal(canonical_hson_graph_equal(client.map.capture().root, capture.root), true);
  const restored = find_node(client.map.capture().root, "main");
  assert.equal(restored.$_attrs.count, 0);
  assert.equal(restored.$_attrs.enabled, false);
  assert.equal(restored.$_attrs.missing, null);
  assert.equal(restored.$_attrs.empty, "");
  assert.deepEqual(restored.$_attrs.style.width, { unit: "px", value: 2 });
  assert.equal(restored.$_meta["data-_quid"], "0000000000000041");
});

await check("view-state empty-fragment snapshot recovery preserves an otherwise unserializable root", async () => {
  const logicalMapId = "view-state-empty-fragment";
  const authority = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  assert.equal(authority.mode, "fragment");
  const capture = authority.capture();
  const host = hson.liveHost.create({ map: authority, logicalMapId, incarnationId: "view-state-empty-fragment-incarnation" });
  const mirror = fragment(`"old"`);
  const { client, pair } = attach(host, mirror);

  await client.recovery.recover();
  const snapshot = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal(snapshot.format, "view-state");
  assert.equal("hson" in snapshot, false);
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "fragment");
  assert.equal(client.map.rev, capture.rev);
  assert.deepEqual(client.map.capture().root.$_content, []);
  assert.equal(canonical_hson_graph_equal(client.map.capture().root, capture.root), true);
});

await check("view-state snapshot recovery applies the existing JSON replay tail afterward", async () => {
  const logicalMapId = "view-state-snapshot-tail";
  const authority = element(`<main data-_quid="0000000000000043"/>`);
  authority.document.attrs.set(root, "count", 1);
  const host = hson.liveHost.create({ map: authority, logicalMapId, incarnationId: "view-state-snapshot-tail-incarnation" });
  const mirror = element(`<aside/>`);
  const pair = socket_pair();
  host.connect(pair.server);
  let queuedTail = false;
  pair.set_before_server_delivery((message) => {
    if (!queuedTail && message.type === "recovery-plan" && message.outcome === "snapshot") {
      queuedTail = true;
      authority.document.attrs.set(root, "title", "tail-applied");
    }
  });
  const client = hson.liveHost.client({
    socket: pair.client,
    map: mirror,
    recovery: { logicalMapId },
  });
  client.connect();

  await client.recovery.recover();
  const snapshotMessage = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot");
  const tailMessage = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-commit" && message.phase === "tail");
  assert.equal(snapshotMessage.snapshot.format, "view-state");
  assert.equal("hson" in snapshotMessage.snapshot, false);
  assert.equal(tailMessage.commit.rev, host.stream.headRev);
  assert.equal(client.map.rev, host.stream.headRev);
  assert.equal(client.recovery.lastAppliedRev, host.stream.headRev);
  const restored = find_node(client.map.capture().root, "main");
  assert.equal(restored.$_attrs.count, 1);
  assert.equal(restored.$_attrs.title, "tail-applied");
  assert.equal(client.recovery.debug().snapshotInstalls, 1);
  assert.equal(client.recovery.debug().tailCommitsApplied, 1);
});

await check("view-state snapshot mode and revision mismatches fail before restore", async () => {
  const source = element(`<main data-_quid="0000000000000044"/>`);
  source.document.attrs.set(root, "private-title", "mode-revision-secret");
  const capture = source.capture();
  const encoded = encode_view_state_snapshot(capture);

  await expect_scripted_snapshot_failure(
    { rev: capture.rev, mode: "fragment", ...encoded },
    "LIVEHOST_RECOVERY_SNAPSHOT_MODE_MISMATCH",
    ["mode-revision-secret", encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { rev: capture.rev + 1, mode: capture.mode, ...encoded },
    "LIVEHOST_RECOVERY_SNAPSHOT_REVISION_MISMATCH",
    ["mode-revision-secret", encoded.payload],
  );
});

await check("view-state snapshot envelope discrimination rejects unsupported and ambiguous bodies", async () => {
  const source = element(`<main/>`);
  const capture = source.capture();
  const encoded = encode_view_state_snapshot(capture);
  const common = { rev: capture.rev, mode: capture.mode };

  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state", formatVersion: 2, payload: encoded.payload },
    "LIVEHOST_RECOVERY_SNAPSHOT_VERSION_UNSUPPORTED",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "unknown-view-state-format", formatVersion: 1, payload: encoded.payload },
    "LIVEHOST_RECOVERY_SNAPSHOT_FORMAT_UNSUPPORTED",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, hson: `<main/>`, ...encoded },
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    common,
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state", formatVersion: 1 },
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state", payload: encoded.payload },
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state", formatVersion: 1, payload: 42 },
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
});

await check("view-state codec failures are translated without payload disclosure", async () => {
  const privatePayload = `private-view-state-payload <`;
  const { client, error } = await expect_scripted_snapshot_failure(
    {
      rev: 0,
      mode: "element",
      format: "view-state",
      formatVersion: 1,
      payload: privatePayload,
    },
    "LIVEHOST_RECOVERY_SNAPSHOT_DECODE_FAILED",
    [privatePayload, "private-view-state-payload"],
  );
  assert.equal(error.cause instanceof ViewStateSnapshotCodecError, true);
  assert.equal(error.cause.code, "VIEW_STATE_SNAPSHOT_SYNTAX_INVALID");
  assert.equal(client.recovery.failure.cause, error.cause);
});

await check("negotiated view-state encoding failure sends neither snapshot nor HSON fallback tail", async () => {
  const privateStyle = "private-invalid-inline-style";
  const events = [];
  const authority = element(`<main/>`);
  const host = hson.liveHost.create({
    map: authority,
    logicalMapId: "view-state-encode-failure",
    trace: { emit(event) { events.push(event); } },
  });
  const ownedRoot = authority.debug.node([]).must();
  const ownedMain = find_node(ownedRoot, "main");
  ownedMain.$_attrs = { style: { _hover: { color: privateStyle } } };

  let planningError;
  assert.throws(
    () => host.recovery.plan_with_snapshot_encoding(
      { logicalMapId: host.stream.logicalMapId },
      { format: "view-state", formatVersion: 1 },
    ),
    (error) => {
      planningError = error;
      return error.code === "LIVEHOST_RECOVERY_SNAPSHOT_FAILED";
    },
  );
  assert.equal(planningError.cause instanceof LiveHostDocumentSnapshotEncodeError, true);
  assert.equal(planningError.cause.code, "LIVEHOST_RECOVERY_SNAPSHOT_ENCODE_FAILED");
  assert.equal(planningError.cause.cause instanceof ViewStateSnapshotCodecError, true);
  assert.equal(planningError.message.includes(privateStyle), false);

  const mirror = element(`<aside/>`);
  const { client, pair } = attach(host, mirror);
  await assert.rejects(
    client.recovery.recover(),
    (error) => error.code === "LIVEHOST_RECOVERY_SNAPSHOT_FAILED",
  );
  const sent = pair.serverSent.map(JSON.parse);
  assert.equal(sent.some((message) => message.type === "recovery-snapshot"), false);
  assert.equal(sent.some((message) => message.type === "recovery-commit"), false);
  assert.equal(sent.some((message) => message.type === "recovery-caught-up"), false);
  assert.equal(JSON.stringify(sent).includes(privateStyle), false);
  assert.equal(JSON.stringify(events).includes(privateStyle), false);
  assert.equal(events.some((event) => event.phase === "recovery.complete" && event.status === "success"), false);
});

await check("unsupported internal snapshot encoding rejects before material construction", async () => {
  const authority = element(`<main/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "invalid-internal-snapshot-encoding" });
  assert.throws(
    () => host.recovery.plan_with_snapshot_encoding(
      { logicalMapId: host.stream.logicalMapId },
      { format: "future-snapshot-format" },
    ),
    (error) => error.code === "LIVEHOST_RECOVERY_SNAPSHOT_FAILED"
      && error.cause instanceof LiveHostDocumentSnapshotEncodeError,
  );
});

await check("document history gap falls back to a same-mode snapshot", async () => {
  const initial = `<main data-_quid="0000000000000009"/>`;
  const authority = element(initial);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-gap", history: { maxCommits: 1 } });
  const mirror = element(initial);
  authority.document.attrs.set(root, "class", "one");
  authority.document.attrs.set(root, "title", "two");
  const { client } = attach(host, mirror, { incarnationId: host.stream.incarnationId, lastAppliedRev: 0 });
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  assert.equal(client.map.mode, "element");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("0000000000000009")?.$_attrs?.title, "two");
});

await check("projected subscription requests are rejected on document authorities without stream damage", async () => {
  const authority = element(`<main/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-subscription-gate" });
  const pair = socket_pair();
  host.connect(pair.server);
  const before = host.stream.history.debug();
  pair.client.send(JSON.stringify({ type: "subscribe", path: [] }));
  await Promise.resolve();
  const response = pair.serverSent.map(JSON.parse).at(-1);
  assert.equal(response.type, "error");
  assert.equal(response.error.code, "LIVEHOST_PROJECTED_SUBSCRIPTION_UNSUPPORTED");
  assert.equal(authority.rev, 0);
  assert.equal(host.stream.headRev, 0);
  assert.deepEqual(host.stream.history.debug(), before);
});

await check("legacy projected hello is classified as recovery-required for document authorities", async () => {
  const host = hson.liveHost.create({ map: element(`<main/>`) });
  const pair = socket_pair();
  host.connect(pair.server);
  pair.client.send(JSON.stringify({ type: "hello" }));
  await Promise.resolve();
  const response = pair.serverSent.map(JSON.parse).at(-1);
  assert.equal(response.type, "error");
  assert.equal(response.error.code, "LIVEHOST_DOCUMENT_RECOVERY_REQUIRED");
});

await check("document tracing summarizes domain, origin, mode, revision, and recovery material without content", async () => {
  const events = [];
  const trace = { emit(event) { events.push(event); } };
  const authority = element(`<main/>`);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "document-trace", trace });
  authority.document.attrs.set(root, "class", "ready");
  const replayPlan = host.recovery.plan({
    logicalMapId: host.stream.logicalMapId,
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  replayPlan.complete();
  const snapshotPlan = host.recovery.plan({ logicalMapId: host.stream.logicalMapId });
  snapshotPlan.complete();
  await Promise.resolve();
  await Promise.resolve();
  const publication = events.find((event) => event.phase === "commit.publication");
  assert.deepEqual(publication?.details, {
    logicalMapId: "document-trace",
    incarnationId: host.stream.incarnationId,
    mapMode: "element",
    prevRev: 0,
    rev: 1,
    revision: 1,
    operationDomain: "graph",
    operationCount: 1,
    operationKinds: ["set-attr"],
    origin: "authoritative",
    listenerCount: 0,
    outcome: "published",
  });
  assert.deepEqual(
    events.filter((event) => event.phase === "recovery.material").map((event) => event.details.strategy),
    ["incremental-replay", "snapshot"],
  );
  assert.equal(JSON.stringify(events).includes("ready"), false);

  const replayEvents = [];
  const replayAuthority = element(`<main/>`);
  hson.liveHost.create({ map: replayAuthority, trace: { emit(event) { replayEvents.push(event); } } });
  const source = element(`<main/>`);
  replayAuthority.replay(source.document.attrs.set(root, "title", "replayed"));
  const replayPublication = replayEvents.find((event) => event.phase === "commit.publication");
  assert.equal(replayPublication?.status, "skip");
  assert.equal(replayPublication?.details.origin, "replay");
  assert.equal(JSON.stringify(replayEvents).includes("replayed"), false);
});

await check("hosted document action carries action causation into commit publication without attrs", async () => {
  const events = [];
  const authority = element(`<main data-_quid="0000000000000031"/>`);
  const host = hson.liveHost.create({
    map: authority,
    logicalMapId: "document-action-trace",
    incarnationId: "document-action-incarnation",
    trace: { emit(event) { events.push(event); } },
  });
  const mirror = element(`<main data-_quid="0000000000000031"/>`);
  const client = await attach(host, mirror).client;
  const result = await client.action("document.attrs.set", {
    target: root,
    name: "title",
    value: "document-private-value",
  });
  assert.equal(result.type, "ack");
  const rootEvent = events.find((event) => event.phase === "action.received");
  const publication = events.find((event) => event.phase === "commit.publication" && event.details?.sourceAction === "document.attrs.set");
  assert.equal(publication?.details.sourceTraceId, rootEvent?.traceId);
  assert.equal(publication?.details.logicalMapId, "document-action-trace");
  assert.equal(publication?.details.incarnationId, "document-action-incarnation");
  assert.equal(publication?.details.mapMode, "element");
  assert.equal(publication?.details.prevRev, 0);
  assert.equal(publication?.details.rev, 1);
  assert.equal(JSON.stringify(events).includes("document-private-value"), false);
});

process.stdout.write(`# ${checks} LiveHost document recovery checks passed\n`);

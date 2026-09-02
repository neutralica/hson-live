import { emit_hson_live_test_completion } from "../launcher-completion.mjs";
import { create_test_event_emitter } from "../test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { make_locus_canonical_stream } from "../../src/api/locus/locus.history.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { decode_locus_graph_content } from "../../src/api/locus/locus.graph-content-codec.ts";
import { encode_view_state_snapshot } from "../../src/api/livemap/livemap.document.view-state-codec.ts";
import { ViewStateSnapshotCodecError } from "../../src/api/livemap/livemap.document.view-state-codec.error.ts";
import { LocusDocumentSnapshotEncodeError } from "../../src/api/locus/locus.document-snapshot.ts";
import { internal_livemap_root } from "../../src/api/livemap/livemap.internal.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.document-recovery",
  title: "Locus document recovery",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["document", "recovery", "snapshot"]),
});

const testEvents = create_test_event_emitter("locus.document-recovery");
let checks = 0;

async function check(name, fn) {

  testEvents.case_begin(name, name);
  try {
    await fn();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
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
  if (map.mode !== "document") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function multiNodeDocument(source) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected multiNodeDocument, observed ${map.mode}`);
  return map;
}

function attach(host, map, cursor) {
  const pair = socket_pair();
  const disconnectHost = host.connect(pair.server);
  const client = hson.echo.create({
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
  const client = hson.echo.create({
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
    snapshotEncoding: { format: "view-state" },
  }));
  return { pair, client, promise, requestId: request.id };
}

let scriptedFailureId = 0;
async function expect_scripted_snapshot_failure(snapshotBody, expectedCode, forbidden = []) {
  scriptedFailureId += 1;
  const logicalMapId = snapshotBody.logicalMapId ?? `view-state-failure-${scriptedFailureId}`;
  const incarnationId = snapshotBody.incarnationId ?? `view-state-failure-incarnation-${scriptedFailureId}`;
  const headRev = snapshotBody.rev ?? 0;
  const mirror = element(`<aside @000000050/>`);
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
    snapshot: { logicalMapId, incarnationId, rev: headRev, mode: "document", ...snapshotBody },
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
      mode: "document",
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

const root = { kind: "path", path: [0] };
const documentRoot = { kind: "path", path: [] };

await check("replace-attrs canonical history is detached and published exactly once", async () => {
  let observer;
  const fakeAuthority = {
    mode: "document",
    rev: 0,
    commits: {
      observe(listener) {
        observer = listener;
        return () => {};
      },
    },
  };
  const stream = make_locus_canonical_stream(fakeAuthority, {
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
    () => hson.locus.create({ state: {}, map: element(`<main/>`) }),
    /mutually exclusive/,
  );
});

await check("existing element authority publishes detached graph history and replays to an element mirror", async () => {
  const initial = `<main @000000001 <p @000000002 "old"/>/>`;
  const authority = element(initial);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-element-replay" });
  const sourceCommit = await host.mutate((draft) => draft.document.attrs.set({ kind: "quid", quid: "000000002" }, "title", "kept"));
  const retained = host.stream.history.replay_after(0, 1);
  assert.equal(host.map, authority);
  assert.equal(host.stream.mode, "document");
  assert.equal(retained?.length, 1);
  assert.notEqual(retained?.[0]?.ops, sourceCommit.ops);
  assert.deepEqual(retained?.[0]?.ops, sourceCommit.ops);
  assert.deepEqual(retained?.[0]?.ops[0]?.target, {
    kind: "path",
    path: [0, 0, 0],
    witness: { quid: "000000002" },
  });

  const mirror = element(initial);
  const { client } = attach(host, mirror, { incarnationId: host.stream.incarnationId, lastAppliedRev: 0 });
  const result = await client.recovery.recover();
  assert.equal(result.strategy, "replay");
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "document");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("000000002")?.$_attrs?.title, "kept");
});

await check("node-bearing multiNodeDocument history is detached and incremental replay preserves QUID lookup", async () => {
  const initial = `<section @000000003 "old"/> "tail"`;
  const authority = multiNodeDocument(initial);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-multiNodeDocument-replay" });
  const replacement = element(`<article @000000004 "new"/>`).at([]).snap();
  const sourceCommit = await host.mutate((draft) => draft.document.content.replace(documentRoot, 0, replacement));
  const retained = host.stream.history.replay_after(0, 1)?.[0];
  const sourceOp = sourceCommit.ops[0];
  const retainedOp = retained?.ops[0];
  assert.equal(sourceOp?.op, "replace-content");
  assert.equal(retainedOp?.op, "replace-content");
  if (sourceOp?.op !== "replace-content" || retainedOp?.op !== "replace-content") throw new Error("Expected content replacement");
  assert.notEqual(retainedOp.replacement, sourceOp.replacement);
  assert.deepEqual(decode_locus_graph_content(retainedOp.replacement), sourceOp.replacement);
  assert.equal(JSON.stringify(retainedOp.replacement).includes("$_tag"), false);
  assert.equal(
    host.stream.history.debug().retainedEncodedBytes,
    new TextEncoder().encode(JSON.stringify(retained)).byteLength,
  );

  const mirror = multiNodeDocument(initial);
  const { client } = attach(host, mirror, { incarnationId: host.stream.incarnationId, lastAppliedRev: 0 });
  assert.equal((await client.recovery.recover()).strategy, "replay");
  assert.equal(client.map.mode, "document");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("000000004")?.$_tag, "article");
});

await check("insert-content history detaches canonical nodes from source commits and live graph", async () => {
  const initial = `<a/> <c/>`;
  const authority = multiNodeDocument(initial);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-insert-history" });
  const content = element(`<b @00000001h/>`).at([]).snap();
  const sourceCommit = await host.mutate((draft) => draft.document.content.insert(documentRoot, 1, content));
  const retained = host.stream.history.replay_after(0, 1)?.[0];
  const sourceOp = sourceCommit.ops[0];
  const retainedOp = retained?.ops[0];
  assert.equal(sourceOp?.op, "insert-content");
  assert.equal(retainedOp?.op, "insert-content");
  if (sourceOp?.op !== "insert-content" || retainedOp?.op !== "insert-content") {
    throw new Error("Expected content insertion");
  }
  assert.notEqual(retainedOp.content, sourceOp.content);
  assert.deepEqual(decode_locus_graph_content(retainedOp.content), sourceOp.content);
  content.$_tag = "caller-mutated";
  sourceOp.content.$_tag = "commit-mutated";
  assert.equal(authority.document.byQuid("00000001h")?.$_tag, "b");
  assert.equal(decode_locus_graph_content(retainedOp.content).$_tag, "b");
});

await check("element snapshot recovery restores exact revision, mode, and persisted QUIDs in place", async () => {
  const authority = element(`<main @000000005 <p @000000006/>/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-element-snapshot" });
  await host.mutate((draft) => draft.document.attrs.set(root, "class", "ready"));
  const mirror = element(`<aside @000000007/>`);
  const { client } = attach(host, mirror);
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "document");
  assert.equal(client.map.rev, host.stream.headRev);
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("000000005")?.$_tag, "main");
  assert.equal(client.map.document.byQuid("000000006")?.$_tag, "p");
});

await check("multiNodeDocument snapshot recovery reconstructs multiNodeDocument mode without JSON projection", async () => {
  const authority = multiNodeDocument(`"lead" <section @000000008/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-multiNodeDocument-snapshot" });
  const mirror = multiNodeDocument(`<div/> "old"`);
  const { client, pair } = attach(host, mirror);
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  assert.equal(client.map.mode, "document");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("000000008")?.$_tag, "section");
  const messages = pair.serverSent.map(JSON.parse);
  const plan = messages.find((message) => message.type === "recovery-plan");
  const snapshot = messages.find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.deepEqual(plan.snapshotEncoding, { format: "view-state" });
  assert.equal(snapshot?.mode, "document");
  assert.equal(snapshot?.format, "view-state");
  assert.equal("formatVersion" in snapshot, false);
  assert.equal(typeof snapshot?.payload, "string");
  assert.equal("hson" in snapshot, false);
  assert.equal("value" in snapshot, false);
});

await check("an old client without capabilities receives the established Hson snapshot shape", async () => {
  const authority = element(`<main/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "old-client-hson-snapshot" });
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

await check("Hson-only capability advertisements select Hson explicitly", async () => {
  const authority = element(`<main @000000040/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "hson-capability-selection" });
  for (const [id, capabilities] of [["hson-only", { hson: true }]]) {
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
  const host = hson.locus.create({ map: authority, logicalMapId: "immutable-snapshot-selection" });
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
    snapshotCapabilities: { hson: true, viewState: true },
  }));
  const messages = pair.serverSent.map(JSON.parse);
  assert.deepEqual(
    messages.find((message) => message.type === "recovery-plan" && message.id === "first-selection")?.snapshotEncoding,
    { format: "hson" },
  );
  const failure = messages.find((message) => message.type === "recovery-error" && message.id === "changed-selection");
  assert.equal(failure.error.code, "LOCUS_RECOVERY_NEGOTIATION_FAILED");
  assert.equal(messages.some((message) => message.type === "recovery-snapshot" && message.id === "changed-selection"), false);
});

await check("concurrent recovery is rejected without a second material sequence", async () => {
  const authority = element(`<main @000000048/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "concurrent-recovery" });
  const pair = socket_pair();
  host.connect(pair.server);
  let repeated = false;
  pair.set_before_server_delivery((message) => {
    if (repeated || message.type !== "recovery-plan" || message.id !== "first-recovery") return;
    repeated = true;
    pair.client.send(JSON.stringify({
      type: "recover",
      id: "concurrent-recovery",
      logicalMapId: host.stream.logicalMapId,
      snapshotCapabilities: { hson: true, viewState: true },
    }));
  });
  pair.client.send(JSON.stringify({
    type: "recover",
    id: "first-recovery",
    logicalMapId: host.stream.logicalMapId,
    snapshotCapabilities: { hson: true, viewState: true },
  }));
  const messages = pair.serverSent.map(JSON.parse);
  assert.equal(messages.filter((message) => message.type === "recovery-plan").length, 1);
  assert.equal(messages.filter((message) => message.type === "recovery-snapshot").length, 1);
  assert.equal(messages.filter((message) => message.type === "recovery-caught-up").length, 1);
  assert.equal(
    messages.find((message) => message.type === "recovery-error" && message.id === "concurrent-recovery")?.error.code,
    "LOCUS_RECOVERY_IN_PROGRESS",
  );
});

await check("completed request IDs reject while a new same-capability resync remains deliberate", async () => {
  const authority = element(`<main @000000047/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "completed-recovery" });
  const pair = socket_pair();
  host.connect(pair.server);
  const request = {
    type: "recover",
    id: "completed-request",
    logicalMapId: host.stream.logicalMapId,
    snapshotCapabilities: { hson: true, viewState: true },
  };
  pair.client.send(JSON.stringify(request));
  pair.client.send(JSON.stringify(request));
  pair.client.send(JSON.stringify({ ...request, id: "fresh-resync" }));
  const messages = pair.serverSent.map(JSON.parse);
  assert.equal(
    messages.find((message) => message.type === "recovery-error" && message.id === "completed-request")?.error.code,
    "LOCUS_RECOVERY_COMPLETED",
  );
  assert.equal(messages.filter((message) => message.type === "recovery-plan" && message.id === "completed-request").length, 1);
  assert.equal(messages.filter((message) => message.type === "recovery-caught-up" && message.id === "completed-request").length, 1);
  assert.equal(messages.filter((message) => message.type === "recovery-plan" && message.id === "fresh-resync").length, 1);
  assert.equal(messages.filter((message) => message.type === "recovery-caught-up" && message.id === "fresh-resync").length, 1);
});

await check("malformed snapshot capability advertisements reject without document disclosure", async () => {
  const authority = element(`<main title="private-capability-document"/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "malformed-capabilities" });
  const malformed = [
    true,
    { hson: true, viewState: false },
    { hson: true, viewStateVersions: [2] },
    { hson: true, unexpected: true },
  ];
  for (const [index, snapshotCapabilities] of malformed.entries()) {
    const { messages, disconnectHost } = raw_recovery(
      host,
      `malformed-capabilities-${index}`,
      snapshotCapabilities,
    );
    const error = messages.find((message) => message.type === "error");
    assert.equal(error.error.code, "LOCUS_SNAPSHOT_CAPABILITIES_INVALID");
    assert.equal(JSON.stringify(error).includes("private-capability-document"), false);
    disconnectHost();
  }
});

await check("view-state negotiation is acknowledged for replay-only recovery", async () => {
  const authority = element(`<main @000000049/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "view-state-replay-only" });
  const mirror = element(`<main @000000049/>`);
  await host.mutate((draft) => draft.document.attrs.set(root, "title", "replayed"));
  const { client, pair } = attach(host, mirror, {
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  assert.equal((await client.recovery.recover()).strategy, "replay");
  const messages = pair.serverSent.map(JSON.parse);
  const plan = messages.find((message) => message.type === "recovery-plan");
  assert.deepEqual(plan.snapshotEncoding, { format: "view-state" });
  assert.equal(messages.some((message) => message.type === "recovery-snapshot"), false);
  assert.equal(messages.filter((message) => message.type === "recovery-commit").length, 1);
  assert.equal(client.map.rev, authority.rev);
});

await check("snapshot negotiation is isolated across simultaneous connections and reconnect", async () => {
  const authority = element(`<main @00000004a <span/>/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "snapshot-selection-isolation" });
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
  assert.deepEqual(modernPlan.snapshotEncoding, { format: "view-state" });
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
  const authority = element(`<main @000000041 <span @000000042/>/>`);
  authority.document.attrs.replace(root, {
    count: 0,
    enabled: false,
    missing: null,
    empty: "",
    style: { opacity: 0.5, width: { value: 2, unit: "px" } },
  });
  const capture = authority.capture();
  const host = hson.locus.create({ map: authority, logicalMapId, incarnationId: "view-state-element-incarnation" });
  const mirror = element(`<aside/>`);
  const { client, pair } = attach(host, mirror);

  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  const snapshot = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal(snapshot.format, "view-state");
  assert.equal("formatVersion" in snapshot, false);
  assert.equal(typeof snapshot.payload, "string");
  assert.equal("hson" in snapshot, false);
  assert.equal(snapshot.logicalMapId, host.stream.logicalMapId);
  assert.equal(snapshot.incarnationId, host.stream.incarnationId);
  assert.equal(snapshot.mode, capture.mode);
  assert.equal(snapshot.rev, capture.rev);
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "document");
  assert.equal(client.map.rev, capture.rev);
  assert.equal(canonical_hson_graph_equal(client.map.capture().root, capture.root), true);
  const restored = find_node(client.map.capture().root, "main");
  assert.equal(restored.$_attrs.count, 0);
  assert.equal(restored.$_attrs.enabled, false);
  assert.equal(restored.$_attrs.missing, null);
  assert.equal(restored.$_attrs.empty, "");
  assert.deepEqual(restored.$_attrs.style.width, { unit: "px", value: 2 });
  assert.equal(restored.$_meta["quid"], "000000041");
});

await check("view-state empty-multiNodeDocument snapshot recovery preserves an otherwise unserializable root", async () => {
  const logicalMapId = "view-state-empty-multiNodeDocument";
  const authority = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  assert.equal(authority.mode, "document");
  const capture = authority.capture();
  const host = hson.locus.create({ map: authority, logicalMapId, incarnationId: "view-state-empty-multiNodeDocument-incarnation" });
  const mirror = multiNodeDocument(`"old"`);
  const { client, pair } = attach(host, mirror);

  await client.recovery.recover();
  const snapshot = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal(snapshot.format, "view-state");
  assert.equal("hson" in snapshot, false);
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "document");
  assert.equal(client.map.rev, capture.rev);
  assert.deepEqual(client.map.capture().root.$_content, []);
  assert.equal(canonical_hson_graph_equal(client.map.capture().root, capture.root), true);
});

await check("view-state snapshot recovery applies the existing JSON replay tail afterward", async () => {
  const logicalMapId = "view-state-snapshot-tail";
  const authority = element(`<main @000000043/>`);
  authority.document.attrs.set(root, "count", 1);
  const host = hson.locus.create({ map: authority, logicalMapId, incarnationId: "view-state-snapshot-tail-incarnation" });
  const mirror = element(`<aside/>`);
  const pair = socket_pair();
  host.connect(pair.server);
  let queuedTail = false;
  pair.set_before_server_delivery((message) => {
    if (!queuedTail && message.type === "recovery-plan" && message.outcome === "snapshot") {
      queuedTail = true;
      void host.mutate((draft) => draft.document.attrs.set(root, "title", "tail-applied"));
    }
  });
  const client = hson.echo.create({
    socket: pair.client,
    map: mirror,
    recovery: { logicalMapId },
  });
  client.connect();

  await client.recovery.recover();
  const snapshotMessage = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot");
  const tailMessage = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-commit" && message.phase === "tail");
  const recoveryMessages = pair.serverSent.map(JSON.parse).filter((message) => message.id === tailMessage.id);
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
  assert.deepEqual(recoveryMessages.map((message) => message.type), [
    "recovery-plan",
    "recovery-snapshot",
    "recovery-commit",
    "recovery-caught-up",
  ]);
  assert.equal(recoveryMessages.at(-1).caughtUp.throughRev, host.stream.headRev);
});

await check("view-state snapshot mode and revision mismatches fail before restore", async () => {
  const source = element(`<main @000000044/>`);
  source.document.attrs.set(root, "private-title", "mode-revision-secret");
  const capture = source.capture();
  const encoded = encode_view_state_snapshot(capture);

  await expect_scripted_snapshot_failure(
    { rev: capture.rev, mode: "data-object", ...encoded },
    "LOCUS_RECOVERY_SNAPSHOT_MODE_MISMATCH",
    ["mode-revision-secret", encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { rev: capture.rev + 1, mode: capture.mode, ...encoded },
    "LOCUS_RECOVERY_SNAPSHOT_REVISION_MISMATCH",
    ["mode-revision-secret", encoded.payload],
  );
});

await check("view-state snapshot envelope discrimination rejects unsupported and ambiguous bodies", async () => {
  const source = element(`<main/>`);
  const capture = source.capture();
  const encoded = encode_view_state_snapshot(capture);
  const common = { rev: capture.rev, mode: capture.mode };

  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state", formatVersion: 1, payload: encoded.payload },
    "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "unknown-view-state-format", payload: encoded.payload },
    "LOCUS_RECOVERY_SNAPSHOT_FORMAT_UNSUPPORTED",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, hson: `<main/>`, ...encoded },
    "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    common,
    "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state" },
    "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state", payload: encoded.payload, extra: true },
    "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "view-state", payload: 42 },
    "LOCUS_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
});

await check("view-state codec failures are translated without payload disclosure", async () => {
  const privatePayload = `private-view-state-payload <`;
  const { client, error } = await expect_scripted_snapshot_failure(
    {
      rev: 0,
      mode: "document",
      format: "view-state",
      payload: privatePayload,
    },
    "LOCUS_RECOVERY_SNAPSHOT_DECODE_FAILED",
    [privatePayload, "private-view-state-payload"],
  );
  assert.equal(error.cause instanceof ViewStateSnapshotCodecError, true);
  assert.equal(error.cause.code, "VIEW_STATE_SNAPSHOT_SYNTAX_INVALID");
  assert.equal(client.recovery.failure.cause, error.cause);
});

await check("strict authority rejects malformed canonical state before recovery service", async () => {
  const privateStyle = "private-invalid-inline-style";
  const authority = element(`<main/>`);
  const ownedRoot = internal_livemap_root(authority);
  const ownedMain = find_node(ownedRoot, "main");
  ownedMain.$_attrs = { style: { _hover: { color: privateStyle } } };
  let message = "";
  assert.throws(() => hson.locus.create({ map: authority }), (error) => {
    message = error.message;
    return /malformed canonical Hson root/.test(message);
  });
  assert.equal(message.includes(privateStyle), false);
});

await check("unsupported internal snapshot encoding rejects before material construction", async () => {
  const authority = element(`<main/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "invalid-internal-snapshot-encoding" });
  assert.throws(
    () => host.recovery.plan_with_snapshot_encoding(
      { logicalMapId: host.stream.logicalMapId },
      { format: "future-snapshot-format" },
    ),
    (error) => error.code === "LOCUS_RECOVERY_SNAPSHOT_FAILED"
      && error.cause instanceof LocusDocumentSnapshotEncodeError,
  );
});

await check("document history gap falls back to a same-mode snapshot", async () => {
  const initial = `<main @000000009/>`;
  const authority = element(initial);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-gap", history: { maxCommits: 1 } });
  const mirror = element(initial);
  await host.mutate((draft) => draft.document.attrs.set(root, "class", "one"));
  await host.mutate((draft) => draft.document.attrs.set(root, "title", "two"));
  const { client } = attach(host, mirror, { incarnationId: host.stream.incarnationId, lastAppliedRev: 0 });
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  assert.equal(client.map.mode, "document");
  assert.deepEqual(client.map.capture(), authority.capture());
  assert.equal(client.map.document.byQuid("000000009")?.$_attrs?.title, "two");
});

await check("projected subscription requests are rejected on document authorities without stream damage", async () => {
  const authority = element(`<main/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-subscription-gate" });
  const pair = socket_pair();
  host.connect(pair.server);
  const before = host.stream.history.debug();
  pair.client.send(JSON.stringify({ type: "subscribe", path: [] }));
  await Promise.resolve();
  const response = pair.serverSent.map(JSON.parse).at(-1);
  assert.equal(response.type, "error");
  assert.equal(response.error.code, "LOCUS_PROJECTED_SUBSCRIPTION_UNSUPPORTED");
  assert.equal(authority.rev, 0);
  assert.equal(host.stream.headRev, 0);
  assert.deepEqual(host.stream.history.debug(), before);
});

await check("legacy projected hello is classified as recovery-required for document authorities", async () => {
  const host = hson.locus.create({ map: element(`<main/>`) });
  const pair = socket_pair();
  host.connect(pair.server);
  pair.client.send(JSON.stringify({ type: "hello" }));
  await Promise.resolve();
  const response = pair.serverSent.map(JSON.parse).at(-1);
  assert.equal(response.type, "error");
  assert.equal(response.error.code, "LOCUS_DOCUMENT_RECOVERY_REQUIRED");
});

await check("document tracing summarizes domain, origin, mode, revision, and recovery material without content", async () => {
  const events = [];
  const trace = { emit(event) { events.push(event); } };
  const authority = element(`<main/>`);
  const host = hson.locus.create({ map: authority, logicalMapId: "document-trace", trace });
  await host.mutate((draft) => draft.document.attrs.set(root, "class", "ready"));
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
    mapMode: "document",
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
  const replayHost = hson.locus.create({ map: replayAuthority, trace: { emit(event) { replayEvents.push(event); } } });
  const source = element(`<main/>`);
  assert.throws(() => replayAuthority.replay(source.document.attrs.set(root, "title", "replayed")));
  assert.equal(replayEvents.some((event) => event.phase === "commit.publication"), false);
  assert.equal(JSON.stringify(replayEvents).includes("replayed"), false);
  replayHost.dispose();
});

await check("hosted document action carries action causation into commit publication without attrs", async () => {
  const events = [];
  const authority = element(`<main @000000031/>`);
  const host = hson.locus.create({
    map: authority,
    logicalMapId: "document-action-trace",
    incarnationId: "document-action-incarnation",
    trace: { emit(event) { events.push(event); } },
  });
  const mirror = element(`<main @000000031/>`);
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
  assert.equal(publication?.details.mapMode, "document");
  assert.equal(publication?.details.prevRev, 0);
  assert.equal(publication?.details.rev, 1);
  assert.equal(JSON.stringify(events).includes("document-private-value"), false);
});

process.stdout.write(`# ${checks} Locus document recovery checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("locus.document-recovery", checks, checks, 0);

import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { make_livehost_canonical_stream } from "../../src/api/livehost/livehost.history.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { encode_canonical_document_snapshot } from "../../src/api/livemap/livemap.document.snapshot-codec.ts";
import { CanonicalDocumentSnapshotCodecError } from "../../src/api/livemap/livemap.document.snapshot-codec.error.ts";

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
      for (const listener of [...clientMessages]) listener(raw);
    },
    onMessage(listener) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  return { client, server, clientSent, serverSent };
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
  host.connect(pair.server);
  const client = hson.liveHost.client({
    socket: pair.client,
    map,
    recovery: {
      logicalMapId: host.stream.logicalMapId,
      ...(cursor === undefined ? {} : { cursor }),
    },
  });
  client.connect();
  return { client, pair };
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
    sessionId: "canonical-snapshot-session",
    logicalMapId,
    incarnationId,
    headRev,
    outcome: "snapshot",
    reason: "incarnation_mismatch",
  }));
  return { pair, client, promise, requestId: request.id };
}

function canonical_snapshot(logicalMapId, incarnationId, capture, outer = {}) {
  return {
    logicalMapId,
    incarnationId,
    rev: capture.rev,
    mode: capture.mode,
    ...encode_canonical_document_snapshot(capture),
    ...outer,
  };
}

let scriptedFailureId = 0;
async function expect_scripted_snapshot_failure(snapshotBody, expectedCode, forbidden = []) {
  scriptedFailureId += 1;
  const logicalMapId = snapshotBody.logicalMapId ?? `canonical-failure-${scriptedFailureId}`;
  const incarnationId = snapshotBody.incarnationId ?? `canonical-failure-incarnation-${scriptedFailureId}`;
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
  const snapshot = pair.serverSent.map(JSON.parse).find((message) => message.type === "recovery-snapshot")?.snapshot;
  assert.equal(snapshot?.mode, "fragment");
  assert.equal(typeof snapshot?.hson, "string");
  assert.equal("format" in snapshot, false);
  assert.equal("formatVersion" in snapshot, false);
  assert.equal("payload" in snapshot, false);
  assert.equal("value" in snapshot, false);
});

await check("canonical element snapshot recovery preserves typed document state exactly", async () => {
  const logicalMapId = "canonical-element-snapshot";
  const incarnationId = "canonical-element-incarnation";
  const authority = element(`<main data-_quid="0000000000000041" <span data-_quid="0000000000000042"/>/>`);
  authority.document.attrs.replace(root, {
    count: 0,
    enabled: false,
    missing: null,
    empty: "",
    style: { opacity: 0.5, width: { value: 2, unit: "px" } },
  });
  const capture = authority.capture();
  const mirror = element(`<aside/>`);
  const { pair, client, promise, requestId } = begin_scripted_snapshot_recovery(
    mirror,
    logicalMapId,
    incarnationId,
    capture.rev,
  );
  const snapshot = canonical_snapshot(logicalMapId, incarnationId, capture);
  assert.equal("hson" in snapshot, false);
  pair.server.send(JSON.stringify({ type: "recovery-snapshot", id: requestId, snapshot }));
  pair.server.send(JSON.stringify({
    type: "recovery-caught-up",
    id: requestId,
    caughtUp: { kind: "caught_up", logicalMapId, incarnationId, throughRev: capture.rev },
  }));

  assert.equal((await promise).strategy, "snapshot");
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

await check("canonical empty-fragment snapshot recovery preserves an otherwise unserializable root", async () => {
  const logicalMapId = "canonical-empty-fragment";
  const incarnationId = "canonical-empty-fragment-incarnation";
  const authority = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  assert.equal(authority.mode, "fragment");
  const capture = authority.capture();
  const mirror = fragment(`"old"`);
  const { pair, client, promise, requestId } = begin_scripted_snapshot_recovery(
    mirror,
    logicalMapId,
    incarnationId,
    capture.rev,
  );
  pair.server.send(JSON.stringify({
    type: "recovery-snapshot",
    id: requestId,
    snapshot: canonical_snapshot(logicalMapId, incarnationId, capture),
  }));
  pair.server.send(JSON.stringify({
    type: "recovery-caught-up",
    id: requestId,
    caughtUp: { kind: "caught_up", logicalMapId, incarnationId, throughRev: capture.rev },
  }));

  await promise;
  assert.equal(client.map, mirror);
  assert.equal(client.map.mode, "fragment");
  assert.equal(client.map.rev, capture.rev);
  assert.deepEqual(client.map.capture().root.$_content, []);
  assert.equal(canonical_hson_graph_equal(client.map.capture().root, capture.root), true);
});

await check("canonical snapshot recovery applies the existing JSON replay tail afterward", async () => {
  const logicalMapId = "canonical-snapshot-tail";
  const incarnationId = "canonical-snapshot-tail-incarnation";
  const authority = element(`<main data-_quid="0000000000000043"/>`);
  authority.document.attrs.set(root, "count", 1);
  const capture = authority.capture();
  const tailCommit = authority.document.attrs.set(root, "title", "tail-applied");
  const mirror = element(`<aside/>`);
  const { pair, client, promise, requestId } = begin_scripted_snapshot_recovery(
    mirror,
    logicalMapId,
    incarnationId,
    capture.rev,
  );
  pair.server.send(JSON.stringify({
    type: "recovery-snapshot",
    id: requestId,
    snapshot: canonical_snapshot(logicalMapId, incarnationId, capture),
  }));
  pair.server.send(JSON.stringify({
    type: "recovery-caught-up",
    id: requestId,
    caughtUp: { kind: "caught_up", logicalMapId, incarnationId, throughRev: capture.rev },
  }));
  pair.server.send(JSON.stringify({
    type: "recovery-commit",
    id: requestId,
    phase: "tail",
    commit: {
      logicalMapId,
      incarnationId,
      mode: "element",
      prevRev: tailCommit.prevRev,
      rev: tailCommit.rev,
      ops: tailCommit.ops,
    },
  }));

  await promise;
  assert.equal(client.map.rev, tailCommit.rev);
  assert.equal(client.recovery.lastAppliedRev, tailCommit.rev);
  const restored = find_node(client.map.capture().root, "main");
  assert.equal(restored.$_attrs.count, 1);
  assert.equal(restored.$_attrs.title, "tail-applied");
  assert.equal(client.recovery.debug().snapshotInstalls, 1);
  assert.equal(client.recovery.debug().tailCommitsApplied, 1);
});

await check("canonical snapshot mode and revision mismatches fail before restore", async () => {
  const source = element(`<main data-_quid="0000000000000044"/>`);
  source.document.attrs.set(root, "private-title", "mode-revision-secret");
  const capture = source.capture();
  const encoded = encode_canonical_document_snapshot(capture);

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

await check("canonical snapshot envelope discrimination rejects unsupported and ambiguous bodies", async () => {
  const source = element(`<main/>`);
  const capture = source.capture();
  const encoded = encode_canonical_document_snapshot(capture);
  const common = { rev: capture.rev, mode: capture.mode };

  await expect_scripted_snapshot_failure(
    { ...common, format: "canonical-hson", formatVersion: 2, payload: encoded.payload },
    "LIVEHOST_RECOVERY_SNAPSHOT_VERSION_UNSUPPORTED",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "unknown-canonical-format", formatVersion: 1, payload: encoded.payload },
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
    { ...common, format: "canonical-hson", formatVersion: 1 },
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "canonical-hson", payload: encoded.payload },
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
    [encoded.payload],
  );
  await expect_scripted_snapshot_failure(
    { ...common, format: "canonical-hson", formatVersion: 1, payload: 42 },
    "LIVEHOST_RECOVERY_SNAPSHOT_ENVELOPE_INVALID",
  );
});

await check("canonical codec failures are translated without payload disclosure", async () => {
  const privatePayload = `private-canonical-payload <`;
  const { client, error } = await expect_scripted_snapshot_failure(
    {
      rev: 0,
      mode: "element",
      format: "canonical-hson",
      formatVersion: 1,
      payload: privatePayload,
    },
    "LIVEHOST_RECOVERY_SNAPSHOT_DECODE_FAILED",
    [privatePayload, "private-canonical-payload"],
  );
  assert.equal(error.cause instanceof CanonicalDocumentSnapshotCodecError, true);
  assert.equal(error.cause.code, "CANONICAL_SNAPSHOT_SYNTAX_INVALID");
  assert.equal(client.recovery.failure.cause, error.cause);
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

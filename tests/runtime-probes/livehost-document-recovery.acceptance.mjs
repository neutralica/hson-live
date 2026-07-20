import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { make_livehost_canonical_stream } from "../../src/api/livehost/livehost.history.ts";

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
  assert.equal("value" in snapshot, false);
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

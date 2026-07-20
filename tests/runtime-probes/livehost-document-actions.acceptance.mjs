import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function socket_pair() {
  const clientMessages = new Set();
  const serverMessages = new Set();
  const client = {
    send(raw) { for (const listener of [...serverMessages]) listener(raw); },
    close() {},
    onMessage(listener) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  const server = {
    send(raw) { for (const listener of [...clientMessages]) listener(raw); },
    close() {},
    onMessage(listener) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  return { client, server };
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

async function connected_document_client(host, mirror, cursor = { incarnationId: host.stream.incarnationId, lastAppliedRev: mirror.rev }) {
  const pair = socket_pair();
  host.connect(pair.server);
  const client = hson.liveHost.client({
    socket: pair.client,
    map: mirror,
    session: {},
    recovery: { logicalMapId: host.stream.logicalMapId, cursor },
  });
  client.connect();
  await client.session.create();
  await client.recovery.recover();
  return client;
}

async function assert_single_hosted_commit({ host, client, action, payload, verify }) {
  let authoritative = 0;
  let published = 0;
  let replayed = 0;
  let clientChanges = 0;
  host.map.commits.observe((event) => {
    if (event.kind === "commit" && event.origin === "authoritative") authoritative += 1;
  });
  host.stream.on_commit(() => { published += 1; });
  client.map.commits.observe((event) => {
    if (event.kind === "commit" && event.origin === "replay") replayed += 1;
  });
  client.recovery.on_change((event) => {
    if (event.kind === "commit") clientChanges += 1;
  });
  const beforeRev = host.map.rev;
  const beforeHistory = host.stream.history.debug().retainedCommitCount;
  const result = await client.action(action, payload);
  assert.equal(result.type, "ack");
  assert.equal(result.completionRev, beforeRev + 1);
  assert.equal(host.map.rev, beforeRev + 1);
  assert.equal(host.stream.headRev, beforeRev + 1);
  assert.equal(host.stream.history.debug().retainedCommitCount, beforeHistory + 1);
  assert.equal(authoritative, 1);
  assert.equal(published, 1);
  assert.equal(replayed, 1);
  assert.equal(clientChanges, 1);
  assert.deepEqual(client.map.capture(), host.map.capture());
  verify();
  return result;
}

const rootPath = { kind: "path", path: [] };

await check("document.attr.set uses a QUID target and flows through one authoritative commit and replay", async () => {
  const initial = `<main data-_quid="0000000000000001" <p data-_quid="0000000000000002"/>/>`;
  const host = hson.liveHost.create({ map: element(initial), logicalMapId: "hosted-attr-set" });
  const client = await connected_document_client(host, element(initial));
  await assert_single_hosted_commit({
    host,
    client,
    action: "document.attr.set",
    payload: { target: { kind: "quid", quid: "0000000000000002" }, name: "title", value: "kept" },
    verify() {
      assert.equal(host.map.element.byQuid("0000000000000002")?.$_attrs?.title, "kept");
    },
  });
});

await check("document.attr.drop uses a fragment path target and flows through one authoritative commit and replay", async () => {
  const initial = `<section id="remove"/> "tail"`;
  const host = hson.liveHost.create({ map: fragment(initial), logicalMapId: "hosted-attr-drop" });
  const client = await connected_document_client(host, fragment(initial));
  await assert_single_hosted_commit({
    host,
    client,
    action: "document.attr.drop",
    payload: { target: { kind: "path", path: [0] }, name: "id" },
    verify() {
      assert.equal(host.map.fragment.content()[0].$_attrs, undefined);
    },
  });
});

await check("document.content.replace uses a path target and replays one canonical node replacement", async () => {
  const initial = `<main <p data-_quid="0000000000000003" "old"/>/>`;
  const host = hson.liveHost.create({ map: element(initial), logicalMapId: "hosted-content-replace" });
  const client = await connected_document_client(host, element(initial));
  const replacement = element(`<article data-_quid="0000000000000004" "new"/>`).element.node();
  await assert_single_hosted_commit({
    host,
    client,
    action: "document.content.replace",
    payload: { target: rootPath, index: 0, replacement },
    verify() {
      assert.equal(host.map.element.byQuid("0000000000000004")?.$_tag, "article");
      assert.equal(host.map.element.byQuid("0000000000000003"), undefined);
    },
  });
});

await check("document.content.insert uses a fragment path and publishes one canonical insertion", async () => {
  const initial = `<a/> <c/>`;
  const host = hson.liveHost.create({ map: fragment(initial), logicalMapId: "hosted-content-insert" });
  const client = await connected_document_client(host, fragment(initial));
  const content = element(`<b data-_quid="000000000000001c"/>`).element.node();
  await assert_single_hosted_commit({
    host,
    client,
    action: "document.content.insert",
    payload: { target: rootPath, index: 1, content },
    verify() {
      assert.deepEqual(host.map.fragment.content().map((item) => item.$_tag), ["a", "b", "c"]);
      assert.equal(host.map.fragment.byQuid("000000000000001c")?.$_tag, "b");
    },
  });
});

await check("document.content.remove uses a QUID target and publishes one canonical removal", async () => {
  const initial = `<main data-_quid="000000000000001d"/>`;
  const authority = element(initial);
  const mirror = element(initial);
  const extra = element(`<aside "kept"/>`).element.node().$_content[0];
  authority.element.content.insert({ kind: "quid", quid: "000000000000001d" }, 1, extra);
  mirror.element.content.insert({ kind: "quid", quid: "000000000000001d" }, 1, extra);
  const host = hson.liveHost.create({ map: authority, logicalMapId: "hosted-content-remove" });
  const client = await connected_document_client(host, mirror);
  await assert_single_hosted_commit({
    host,
    client,
    action: "document.content.remove",
    payload: { target: { kind: "quid", quid: "000000000000001d" }, index: 0 },
    verify() {
      assert.equal(host.map.element.node().$_content.length, 1);
    },
  });
});

await check("document.content.move uses final-position semantics in one graph operation", async () => {
  const initial = `<a/> <b data-_quid="000000000000001e"/> <c/> <d/>`;
  const host = hson.liveHost.create({ map: fragment(initial), logicalMapId: "hosted-content-move" });
  const client = await connected_document_client(host, fragment(initial));
  await assert_single_hosted_commit({
    host,
    client,
    action: "document.content.move",
    payload: { target: rootPath, from: 1, to: 3 },
    verify() {
      assert.deepEqual(host.map.fragment.content().map((item) => item.$_tag), ["a", "c", "d", "b"]);
      assert.equal(host.map.element, undefined);
      assert.equal(host.map.fragment.byQuid("000000000000001e")?.$_tag, "b");
    },
  });
});

await check("each hosted operation accepts its alternate path or persisted-QUID target style", async () => {
  const initial = `<main data-_quid="0000000000000009" id="drop" <p data-_quid="000000000000000a" "old"/>/>`;
  const host = hson.liveHost.create({ map: element(initial) });
  const client = await connected_document_client(host, element(initial));
  const textCluster = element(`<p "new"/>`).element.node().$_content[0];
  const insertedCluster = element(`<i "inserted"/>`).element.node().$_content[0];
  assert.equal((await client.action("document.attr.set", {
    target: rootPath,
    name: "class",
    value: "path",
  })).type, "ack");
  assert.equal((await client.action("document.attr.drop", {
    target: { kind: "quid", quid: "0000000000000009" },
    name: "id",
  })).type, "ack");
  assert.equal((await client.action("document.content.replace", {
    target: { kind: "quid", quid: "000000000000000a" },
    index: 0,
    replacement: textCluster,
  })).type, "ack");
  assert.equal((await client.action("document.content.insert", {
    target: { kind: "quid", quid: "000000000000000a" },
    index: 1,
    content: insertedCluster,
  })).type, "ack");
  assert.equal((await client.action("document.content.move", {
    target: { kind: "quid", quid: "000000000000000a" },
    from: 0,
    to: 1,
  })).type, "ack");
  assert.equal((await client.action("document.content.remove", {
    target: { kind: "path", path: [0, 0] },
    index: 1,
  })).type, "ack");
  assert.equal(host.map.rev, 6);
  assert.equal(host.map.element.byQuid("0000000000000009")?.$_attrs?.class, "path");
  assert.equal(host.map.element.byQuid("0000000000000009")?.$_attrs?.id, undefined);
  assert.deepEqual(host.map.element.byQuid("000000000000000a")?.$_content, [
    insertedCluster,
  ]);
  assert.deepEqual(client.map.capture(), host.map.capture());
});

await check("all six names are recognized but unavailable for data-object and data-array authorities", async () => {
  for (const state of [{ value: 1 }, [1]]) {
    const host = hson.liveHost.create({ state });
    const pair = socket_pair();
    host.connect(pair.server);
    const client = hson.liveHost.client({ socket: pair.client });
    client.connect();
    for (const [name, payload] of [
      ["document.attr.set", { target: rootPath, name: "id", value: "x" }],
      ["document.attr.drop", { target: rootPath, name: "id" }],
      ["document.content.replace", { target: rootPath, index: 0, replacement: "x" }],
      ["document.content.insert", { target: rootPath, index: 0, content: "x" }],
      ["document.content.remove", { target: rootPath, index: 0 }],
      ["document.content.move", { target: rootPath, from: 0, to: 1 }],
    ]) {
      const before = host.map.capture();
      const result = await client.action(name, payload);
      assert.equal(result.error.code, "LIVEHOST_ACTION_UNAVAILABLE");
      assert.notEqual(result.error.code, "LIVEHOST_UNKNOWN_ACTION");
      assert.deepEqual(host.map.capture(), before);
      assert.equal(host.stream.history.debug().retainedCommitCount, 0);
    }
  }
});

await check("payload and local document failures leave authority and history unchanged", async () => {
  const initial = `<main data-_quid="0000000000000005" <p/>/>`;
  const host = hson.liveHost.create({ map: element(initial), logicalMapId: "hosted-failures" });
  const client = await connected_document_client(host, element(initial));
  const invalid = [
    ["document.attr.set", null, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.attr.set", { target: rootPath, name: "bad name", value: "x" }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.attr.set", { target: rootPath, name: "id", value: { structured: true } }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.attr.set", { target: { kind: "path", path: [99] }, name: "id", value: "x" }, "DOCUMENT_PATH_OUT_OF_RANGE"],
    ["document.attr.drop", { target: { kind: "quid", quid: "0000000000000006" }, name: "id" }, "DOCUMENT_TARGET_NOT_FOUND"],
    ["document.content.replace", { target: rootPath, index: -1, replacement: "x" }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.content.replace", { target: rootPath, index: 9, replacement: "x" }, "INVALID_DOCUMENT_CONTENT_INDEX"],
    ["document.content.replace", { target: rootPath, index: 0, replacement: "x" }, "INVALID_DOCUMENT_REPLACEMENT"],
    ["document.content.replace", { target: rootPath, index: 0, replacement: { $_tag: "bad" } }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.content.insert", { target: rootPath, index: -1, content: "x" }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.content.insert", { target: rootPath, index: 9, content: "x" }, "INVALID_DOCUMENT_CONTENT_INDEX"],
    ["document.content.insert", { target: rootPath, index: 0, content: { $_tag: "bad" } }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.content.remove", { target: rootPath, index: -1 }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.content.remove", { target: rootPath, index: 9 }, "INVALID_DOCUMENT_CONTENT_INDEX"],
    ["document.content.move", { target: rootPath, from: 0, to: -1 }, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"],
    ["document.content.move", { target: rootPath, from: 0, to: 9 }, "INVALID_DOCUMENT_CONTENT_INDEX"],
  ];
  for (const [name, payload, code] of invalid) {
    const before = host.map.capture();
    const history = host.stream.history.debug().retainedCommitCount;
    const result = await client.action(name, payload);
    assert.equal(result.error.code, code);
    assert.deepEqual(host.map.capture(), before);
    assert.equal(host.stream.history.debug().retainedCommitCount, history);
  }
});

await check("authorization denial occurs before the local document mutation", async () => {
  let authorizations = 0;
  const initial = `<main/>`;
  const host = hson.liveHost.create({
    map: element(initial),
    authorizeAction(context) {
      authorizations += 1;
      assert.equal(context.action, "document.attr.set");
      return false;
    },
  });
  const client = await connected_document_client(host, element(initial));
  const result = await client.action("document.attr.set", { target: rootPath, name: "id", value: "blocked" });
  assert.equal(result.error.code, "LIVEHOST_ACTION_FORBIDDEN");
  assert.equal(authorizations, 1);
  assert.equal(host.map.rev, 0);
  assert.equal(host.stream.history.debug().retainedCommitCount, 0);
});

await check("a duplicate retry returns the cached acknowledgement without a second mutation", async () => {
  const initial = `<main/>`;
  const host = hson.liveHost.create({ map: element(initial) });
  const client = await connected_document_client(host, element(initial));
  let commits = 0;
  host.stream.on_commit(() => { commits += 1; });
  const first = client.action("document.attr.set", { target: rootPath, name: "id", value: "once" });
  const executed = await first;
  const retried = await client.retry_action(first.request);
  assert.equal(executed.delivery, "executed");
  assert.equal(retried.delivery, "cached");
  assert.equal(host.map.rev, 1);
  assert.equal(host.stream.headRev, 1);
  assert.equal(host.stream.history.debug().retainedCommitCount, 1);
  assert.equal(commits, 1);
});

await check("same-position hosted move acknowledges without commit, history, replay or revision", async () => {
  const initial = `<a/> <b/>`;
  const host = hson.liveHost.create({ map: fragment(initial) });
  const client = await connected_document_client(host, fragment(initial));
  let authoritative = 0;
  let published = 0;
  let replayed = 0;
  host.map.commits.observe((event) => {
    if (event.kind === "commit" && event.origin === "authoritative") authoritative += 1;
  });
  host.stream.on_commit(() => { published += 1; });
  client.map.commits.observe((event) => {
    if (event.kind === "commit" && event.origin === "replay") replayed += 1;
  });
  const result = await client.action("document.content.move", { target: rootPath, from: 1, to: 1 });
  assert.equal(result.type, "ack");
  assert.equal(result.completionRev, 0);
  assert.equal(host.map.rev, 0);
  assert.equal(host.stream.history.debug().retainedCommitCount, 0);
  assert.deepEqual({ authoritative, published, replayed }, { authoritative: 0, published: 0, replayed: 0 });
});

await check("authorization denial prevents a structural document mutation", async () => {
  const initial = `<a/> <b/>`;
  const host = hson.liveHost.create({
    map: fragment(initial),
    authorizeAction(context) {
      assert.equal(context.action, "document.content.move");
      return false;
    },
  });
  const client = await connected_document_client(host, fragment(initial));
  const result = await client.action("document.content.move", { target: rootPath, from: 0, to: 1 });
  assert.equal(result.error.code, "LIVEHOST_ACTION_FORBIDDEN");
  assert.equal(host.map.rev, 0);
  assert.equal(host.stream.history.debug().retainedCommitCount, 0);
});

await check("a duplicate structural retry does not insert twice", async () => {
  const initial = `<a/> <c/>`;
  const host = hson.liveHost.create({ map: fragment(initial) });
  const client = await connected_document_client(host, fragment(initial));
  const first = client.action("document.content.insert", {
    target: rootPath,
    index: 2,
    content: element(`<b/>`).element.node(),
  });
  const executed = await first;
  const retried = await client.retry_action(first.request);
  assert.equal(executed.delivery, "executed");
  assert.equal(retried.delivery, "cached");
  assert.equal(host.map.rev, 1);
  assert.equal(host.map.fragment.content().length, 3);
  assert.equal(host.stream.history.debug().retainedCommitCount, 1);
});

await check("incremental recovery after a hosted action reconstructs an identical document", async () => {
  const initial = `<main data-_quid="0000000000000007"/>`;
  const host = hson.liveHost.create({ map: element(initial), logicalMapId: "hosted-recovery-replay" });
  const actor = await connected_document_client(host, element(initial));
  await actor.action("document.attr.set", { target: { kind: "quid", quid: "0000000000000007" }, name: "class", value: "ready" });
  actor.disconnect();
  const recovered = await connected_document_client(host, element(initial), {
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  assert.equal(recovered.recovery.strategy, "replay");
  assert.deepEqual(recovered.map.capture(), host.map.capture());
});

await check("snapshot fallback after a hosted action reconstructs an identical document", async () => {
  const initial = `<main data-_quid="0000000000000008"/>`;
  const host = hson.liveHost.create({ map: element(initial), logicalMapId: "hosted-recovery-snapshot", history: { maxCommits: 0 } });
  const actor = await connected_document_client(host, element(initial));
  await actor.action("document.attr.set", { target: rootPath, name: "title", value: "snapshot" });
  actor.disconnect();
  const recovered = await connected_document_client(host, element(initial), {
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  assert.equal(recovered.recovery.strategy, "snapshot");
  assert.deepEqual(recovered.map.capture(), host.map.capture());
  assert.equal(recovered.map.element.byQuid("0000000000000008")?.$_attrs?.title, "snapshot");
});

await check("incremental recovery preserves an inserted node and its QUID", async () => {
  const initial = `<a/> <c/>`;
  const host = hson.liveHost.create({ map: fragment(initial), logicalMapId: "hosted-structural-replay" });
  const actor = await connected_document_client(host, fragment(initial));
  await actor.action("document.content.insert", {
    target: rootPath,
    index: 1,
    content: element(`<b data-_quid="000000000000001f"/>`).element.node(),
  });
  actor.disconnect();
  const recovered = await connected_document_client(host, fragment(initial), {
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  assert.equal(recovered.recovery.strategy, "replay");
  assert.deepEqual(recovered.map.capture(), host.map.capture());
  assert.equal(recovered.map.fragment.byQuid("000000000000001f")?.$_tag, "b");
});

await check("snapshot fallback preserves movement order, mode, revision and QUID", async () => {
  const initial = `<a/> <b data-_quid="000000000000001g"/> <c/>`;
  const host = hson.liveHost.create({
    map: fragment(initial),
    logicalMapId: "hosted-structural-snapshot",
    history: { maxCommits: 0 },
  });
  const actor = await connected_document_client(host, fragment(initial));
  await actor.action("document.content.move", { target: rootPath, from: 1, to: 2 });
  actor.disconnect();
  const recovered = await connected_document_client(host, fragment(initial), {
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  assert.equal(recovered.recovery.strategy, "snapshot");
  assert.equal(recovered.map.mode, "fragment");
  assert.equal(recovered.map.rev, host.map.rev);
  assert.deepEqual(recovered.map.capture(), host.map.capture());
  assert.equal(recovered.map.fragment.byQuid("000000000000001g")?.$_tag, "b");
});

process.stdout.write(`# ${checks} hosted document action checks passed\n`);

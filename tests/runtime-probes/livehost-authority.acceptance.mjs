import { emit_hson_live_test_completion } from "../launcher-completion.mjs";
import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { create_livehost_internal } from "../../src/api/livehost/livehost.core.ts";
import { LiveHostAuthorityError } from "../../src/api/livehost/livehost.authority.ts";
import { create_live_trace_collector } from "../../src/diagnostics/index.ts";
import {
  get_livemap_staged_authority,
  LiveMapTransitionError,
} from "../../src/api/livemap/livemap.authority.ts";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function deferred_gates() {
  const calls = [];
  return {
    calls,
    gate(input) {
      return new Promise((resolve, reject) => calls.push({ input, resolve, reject }));
    },
  };
}

function element(source = `<main @000000001/>`) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("expected element map");
  return map;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function test_socket() {
  const messageListeners = new Set();
  const closeListeners = new Set();
  const sent = [];
  return {
    sent,
    socket: {
      send(raw) { sent.push(JSON.parse(raw)); },
      close() {},
      onMessage(listener) { messageListeners.add(listener); return () => messageListeners.delete(listener); },
      onClose(listener) { closeListeners.add(listener); return () => closeListeners.delete(listener); },
    },
    receive(message) { for (const listener of [...messageListeners]) listener(JSON.stringify(message)); },
    close() { for (const listener of [...closeListeners]) listener(); },
  };
}

await check("every host strictly fences its map and records accepted mutation", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const host = hson.liveHost.create({ map });
  assert.throws(() => map.set(["value"], 1), (cause) => cause instanceof LiveMapTransitionError);
  const commit = await host.mutate((draft) => draft.set(["value"], 2));
  assert.deepEqual([commit.rev, map.rev, host.stream.headRev], [1, 1, 1]);
  host.dispose();
  await tick();
  assert.equal(map.set(["value"], 3).rev, 2);
});

await check("exclusive projected mutation waits at the gate then ingests once", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const gates = deferred_gates();
  const host = create_livehost_internal({ map }, { authorityGate: gates.gate });
  const events = [];
  const publications = [];
  map.feed([], () => events.push("feed"));
  map.commits.observe((event) => events.push(event.kind));
  host.stream.on_commit((commit) => publications.push(commit.rev));
  const mutation = host.mutate((draft) => draft.set(["value"], 1));
  await tick();
  assert.equal(gates.calls.length, 1);
  assert.deepEqual(map.snap(), { value: 0 });
  assert.equal(map.rev, 0);
  assert.equal(host.stream.headRev, 0);
  assert.deepEqual(events, []);
  gates.calls[0].resolve();
  const commit = await mutation;
  assert.deepEqual([commit.prevRev, commit.rev, map.rev, host.stream.headRev], [0, 1, 1, 1]);
  assert.deepEqual(map.snap(), { value: 1 });
  assert.deepEqual(events, ["feed", "commit"]);
  assert.deepEqual(publications, [1]);
  assert.equal(host.stream.history.debug().retainedCommitCount, 1);
  host.dispose();
});

await check("exclusive FIFO prepares the second request only after the first accepts", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const gates = deferred_gates();
  const host = create_livehost_internal({ map }, { authorityGate: gates.gate });
  const callbacks = [];
  const first = host.mutate((draft) => { callbacks.push(["a", draft.rev]); return draft.set(["value"], 1); });
  const second = host.mutate((draft) => { callbacks.push(["b", draft.rev]); return draft.set(["value"], 2); });
  await tick();
  assert.deepEqual(callbacks, [["a", 0]]);
  gates.calls[0].resolve();
  await first;
  await tick();
  assert.deepEqual(callbacks, [["a", 0], ["b", 1]]);
  gates.calls[1].resolve();
  await second;
  assert.equal(map.rev, 2);
  assert.deepEqual(host.stream.history.replay_after(0)?.map((commit) => commit.rev), [1, 2]);
  host.dispose();
});

await check("gate rejection is inert and releases the queue for the next request", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const gates = deferred_gates();
  const host = create_livehost_internal({ map }, { authorityGate: gates.gate });
  const rejected = host.mutate((draft) => draft.set(["value"], 1));
  const next = host.mutate((draft) => draft.set(["value"], 2));
  await tick();
  gates.calls[0].reject(new Error("durability unavailable"));
  await assert.rejects(rejected, (cause) => cause instanceof LiveHostAuthorityError && cause.code === "LIVEHOST_AUTHORITY_GATE_REJECTED");
  assert.equal(map.rev, 0);
  assert.equal(host.stream.headRev, 0);
  await tick();
  gates.calls[1].resolve();
  assert.equal((await next).rev, 1);
  assert.deepEqual(map.snap(), { value: 2 });
  host.dispose();
});

await check("no-op participates in FIFO but skips gate history and publication", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  let gateCalls = 0;
  const host = create_livehost_internal(
    { map },
    { authorityGate: () => { gateCalls += 1; } },
  );
  const commit = await host.mutate((draft) => draft.set(["value"], 0));
  assert.equal(commit.changed, false);
  assert.equal(gateCalls, 0);
  assert.equal(map.rev, 0);
  assert.equal(host.stream.history.debug().retainedCommitCount, 0);
  host.dispose();
});

await check("exclusive document mutations preserve typed state and identity", async () => {
  const map = element();
  const host = hson.liveHost.create({ map });
  assert.throws(
    () => map.document.attrs.set({ kind: "path", path: [] }, "direct", true),
    (cause) => cause instanceof LiveMapTransitionError && cause.code === "LIVEMAP_MANAGED_MUTATION_REJECTED",
  );
  const commit = await host.mutate((draft) => draft.document.attrs.setMany(
    { kind: "quid", quid: "000000001" },
    { hidden: false, nullable: null, style: { width: { value: 2, unit: "px" } } },
  ));
  assert.equal(commit.rev, 1);
  assert.equal(map.document.attrs.get({ kind: "path", path: [] }, "hidden"), false);
  assert.deepEqual(map.document.attrs.get({ kind: "path", path: [] }, "style"), { width: { value: 2, unit: "px" } });
  assert.equal(map.document.byQuid("000000001")?.$_tag, "main");
  assert.equal(host.stream.headRev, 1);
  host.dispose();
});

await check("retained references and every privileged bypass are fenced dynamically", async () => {
  const map = hson.liveMap.fromJson({ value: 0, items: [1] });
  const handle = map.at(["value"]);
  const proxy = map.proxy(["value"]);
  const array = map.at(["items"]).array;
  const debug = map.debug.node([]);
  const raw = debug.must();
  const capture = map.capture();
  const replayCommit = hson.liveMap.fromJson({ value: 0, items: [1] }).set(["value"], 1);
  const host = hson.liveHost.create({ map });
  const rejected = (fn) => assert.throws(fn, (cause) => cause instanceof LiveMapTransitionError && cause.code === "LIVEMAP_MANAGED_MUTATION_REJECTED");
  rejected(() => host.map.set(["value"], 1));
  rejected(() => map.set(["value"], 1));
  rejected(() => handle.set(1));
  rejected(() => proxy.$_.set(1));
  rejected(() => array.push(2));
  rejected(() => debug.setAttr("x", "y"));
  rejected(() => map.debug.node([]));
  rejected(() => map.schema.use(hson.liveMap.schema.define((shape) => ({ value: shape.number, items: shape.array(shape.number) }))));
  rejected(() => map.restore(capture));
  rejected(() => map.replay(replayCommit));
  raw.$_content.length = 0;
  assert.deepEqual(map.snap(), { value: 0, items: [1] });
  host.dispose();
  assert.equal(map.set(["value"], 2).rev, 1);
});

await check("async, multi-commit, and retained-draft misuse remain inert", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const host = hson.liveHost.create({ map });
  await assert.rejects(host.mutate(async (draft) => draft.set(["value"], 1)));
  await assert.rejects(host.mutate((draft) => {
    draft.set(["value"], 1);
    return draft.set(["value"], 2);
  }));
  let retained;
  await host.mutate((draft) => { retained = draft; return draft.set(["value"], 3); });
  assert.throws(() => retained.set(["value"], 4));
  assert.equal(map.rev, 1);
  assert.deepEqual(map.snap(), { value: 3 });
  host.dispose();
});

await check("exclusive actions track awaited and unawaited queued mutations", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const gates = deferred_gates();
  const host = create_livehost_internal({
    map,
        actions: {
      set: (ctx, payload) => { void ctx.mutate((draft) => draft.set(["value"], payload.value)); },
      twice: async (ctx) => {
        await ctx.mutate((draft) => draft.set(["value"], 2));
        await ctx.mutate((draft) => draft.set(["value"], 3));
      },
    },
  }, { authorityGate: gates.gate });
  const action = host.dispatch_action({ type: "action", id: "a", name: "set", payload: { value: 1 } });
  await tick();
  assert.equal(map.rev, 0);
  gates.calls[0].resolve();
  const response = await action;
  assert.equal(response.type, "ack");
  assert.equal(response.completionRev, 1);

  const twice = host.dispatch_action({ type: "action", id: "b", name: "twice" });
  await tick(); gates.calls[1].resolve(); await tick(); gates.calls[2].resolve();
  const twiceResponse = await twice;
  assert.equal(twiceResponse.type, "ack");
  assert.equal(twiceResponse.completionRev, 3);
  host.dispose();
});

await check("exclusive action contexts expire after tracked work settles", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  let retainedContext;
  const host = hson.liveHost.create({
    map,
        actions: {
      retain: (context) => { retainedContext = context; },
    },
  });
  assert.equal((await host.dispatch_action({ type: "action", id: "retain", name: "retain" })).type, "ack");
  await assert.rejects(retainedContext.mutate((draft) => draft.set(["value"], 1)));
  assert.equal(map.rev, 0);
  host.dispose();
});

await check("built-in document actions use the exclusive queue", async () => {
  const map = element();
  const gates = deferred_gates();
  const host = create_livehost_internal({ map }, { authorityGate: gates.gate });
  const action = host.dispatch_action({
    type: "action",
    id: "document-action",
    name: "document.attrs.set",
    payload: { target: { kind: "path", path: [] }, name: "hidden", value: false },
  });
  await tick();
  assert.equal(map.document.attrs.get({ kind: "path", path: [] }, "hidden"), undefined);
  gates.calls[0].resolve();
  const response = await action;
  assert.equal(response.type, "ack");
  assert.equal(map.document.attrs.get({ kind: "path", path: [] }, "hidden"), false);
  host.dispose();
});

await check("managed link targets enqueue without blocking source acceptance", async () => {
  const source = hson.liveMap.fromJson({ value: 0 });
  const target = hson.liveMap.fromJson({ value: 0 });
  source.at(["value"]).linkTo(target.at(["value"]));
  const gates = deferred_gates();
  const host = create_livehost_internal({ map: target }, { authorityGate: gates.gate });
  source.set(["value"], 4);
  await tick();
  assert.equal(target.snap(["value"]), 0);
  gates.calls[0].resolve();
  await tick();
  assert.equal(target.snap(["value"]), 4);
  assert.equal(host.stream.headRev, 1);
  host.dispose();
});

await check("same-host and cross-host managed links queue separate commits without deadlock", async () => {
  const selfMap = hson.liveMap.fromJson({ source: 0, target: 0 });
  selfMap.at(["source"]).linkTo(selfMap.at(["target"]));
  const selfHost = hson.liveHost.create({ map: selfMap });
  await selfHost.mutate((draft) => draft.set(["source"], 5));
  await tick();
  assert.deepEqual(selfMap.snap(), { source: 5, target: 5 });
  assert.equal(selfMap.rev, 2);
  selfHost.dispose();

  const left = hson.liveMap.fromJson({ value: 0 });
  const right = hson.liveMap.fromJson({ value: 0 });
  left.at(["value"]).linkTo(right.at(["value"]));
  const leftHost = hson.liveHost.create({ map: left });
  const rightHost = hson.liveHost.create({ map: right });
  await leftHost.mutate((draft) => draft.set(["value"], 6));
  await tick();
  assert.equal(right.snap(["value"]), 6);
  assert.equal(right.rev, 1);
  leftHost.dispose();
  rightHost.dispose();
});

await check("observer failures do not block exclusive history ingestion", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  map.commits.observe(() => { throw new Error("observer failure"); });
  const host = hson.liveHost.create({ map });
  const commit = await host.mutate((draft) => draft.set(["value"], 1));
  assert.equal(commit.rev, 1);
  assert.equal(map.rev, 1);
  assert.equal(host.stream.headRev, 1);
  host.dispose();
});

await check("Host history advances before fallible external publication", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const host = hson.liveHost.create({ map });
  let observed;
  host.stream.on_commit((commit) => {
    observed = [commit.rev, map.rev, host.stream.headRev];
    throw new Error("publication failure");
  });
  const commit = await host.mutate((draft) => draft.set(["value"], 1));
  assert.equal(commit.rev, 1);
  assert.deepEqual(observed, [1, 1, 1]);
  assert.equal(host.stream.history.debug().publicationErrorCount, 1);
  host.dispose();
});

await check("hello is current-only while live subscribe sync and action seq remain useful", async () => {
  const host = hson.liveHost.create({
    state: { value: 0 },
    actions: {
      set: async (context, payload) => {
        await context.mutate((draft) => draft.set(["value"], payload));
      },
    },
  });
  const first = test_socket();
  host.connect(first.socket);
  first.receive({ type: "hello", clientId: "first" });
  first.receive({ type: "subscribe", path: ["value"] });
  assert.deepEqual(first.sent.map((message) => message.type), ["hello", "sync"]);
  assert.equal(first.sent[1].value, 0);

  const response = await host.dispatch_action({ type: "action", id: "set-one", name: "set", payload: 1 });
  assert.equal(response.type, "ack");
  assert.deepEqual([host.seq, host.map.rev, host.stream.headRev], [1, 1, 1]);
  first.close();
  await host.mutate((draft) => draft.set(["value"], 2));
  assert.deepEqual([host.seq, host.map.rev, host.stream.headRev], [1, 2, 2]);

  const second = test_socket();
  host.connect(second.socket);
  second.receive({ type: "hello", clientId: "second" });
  assert.deepEqual(second.sent.map((message) => message.type), ["hello"]);
  assert.deepEqual(second.sent[0].snapshot, { value: 2 });
  second.receive({ type: "subscribe", path: ["value"] });
  assert.deepEqual(second.sent.map((message) => message.type), ["hello", "sync"]);
  assert.equal(second.sent[1].value, 2);

  const legacy = hson.liveHost.protocol.decode(JSON.stringify({ type: "hello", clientId: "legacy", lastSeq: 0 }));
  assert.equal(legacy.ok, false);
  second.close();
  host.dispose();
});

await check("authority traces expose lifecycle metadata without mutation content", async () => {
  const trace = create_live_trace_collector({ capacity: 32 });
  const map = hson.liveMap.fromJson({ secret: "do-not-trace" });
  const host = hson.liveHost.create({ map, trace });
  await host.mutate((draft) => draft.set(["secret"], "still-private"));
  const authorityEvents = trace.events().filter((event) => event.phase.startsWith("authority."));
  assert.deepEqual(authorityEvents.map((event) => event.phase), [
    "authority.enqueued",
    "authority.prepared",
    "authority.gate-started",
    "authority.gate-completed",
    "authority.accepted",
  ]);
  const serialized = JSON.stringify(authorityEvents);
  assert.equal(serialized.includes("do-not-trace"), false);
  assert.equal(serialized.includes("still-private"), false);
  assert.equal(serialized.includes("secret"), false);
  host.dispose();
});

await check("post-gate acceptance invariant failure is terminal", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const host = create_livehost_internal(
    { map },
    { authorityGate: ({ transition }) => get_livemap_staged_authority(map).discard(transition) },
  );
  await assert.rejects(
    host.mutate((draft) => draft.set(["value"], 1)),
    (cause) => cause instanceof LiveHostAuthorityError && cause.code === "LIVEHOST_AUTHORITY_TERMINAL",
  );
  await assert.rejects(
    host.mutate((draft) => draft.set(["value"], 2)),
    (cause) => cause instanceof LiveHostAuthorityError && cause.code === "LIVEHOST_AUTHORITY_TERMINAL",
  );
  assert.equal(map.rev, 0);
  assert.throws(
    () => host.recovery.plan({ logicalMapId: host.stream.logicalMapId }),
    (cause) => cause?.code === "LIVEHOST_RECOVERY_DISPOSED",
  );
  host.dispose();
});

await check("accepted history-ingestion failure is classified and fences later authority", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const host = create_livehost_internal(
    { map },
    { beforeAcceptedCommitIngestion: () => { throw new Error("injected ingestion failure"); } },
  );
  await assert.rejects(
    host.mutate((draft) => draft.set(["value"], 1)),
    (cause) => cause instanceof LiveHostAuthorityError
      && cause.code === "LIVEHOST_AUTHORITY_ACCEPTED_INGESTION_FAILED",
  );
  assert.equal(map.rev, 1);
  assert.equal(host.stream.headRev, 0);
  await assert.rejects(host.mutate((draft) => draft.set(["value"], 2)));
  host.dispose();
});

await check("host destruction rejects queued work and releases management after active gate settles", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const gates = deferred_gates();
  const host = create_livehost_internal({ map }, { authorityGate: gates.gate });
  const active = host.mutate((draft) => draft.set(["value"], 1));
  const queued = host.mutate((draft) => draft.set(["value"], 2));
  await tick();
  host.dispose();
  await assert.rejects(queued, (cause) => cause instanceof LiveHostAuthorityError && cause.code === "LIVEHOST_AUTHORITY_CLOSED");
  assert.throws(() => map.set(["value"], 3), (cause) => cause instanceof LiveMapTransitionError);
  gates.calls[0].resolve();
  assert.equal((await active).rev, 1);
  await tick();
  assert.equal(map.set(["value"], 3).rev, 2);
});

await check("single-host ownership conflicts and release are controlled", async () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const first = hson.liveHost.create({ map });
  assert.throws(
    () => hson.liveHost.create({ map }),
    (cause) => cause instanceof LiveHostAuthorityError && cause.code === "LIVEHOST_AUTHORITY_ALREADY_MANAGED",
  );
  first.dispose();
  await tick();
  const replacement = hson.liveHost.create({ map });
  assert.equal((await replacement.mutate((draft) => draft.set(["value"], 1))).rev, 1);
  replacement.dispose();
});

process.stdout.write(`# ${checks} strict LiveHost authority checks passed\n`);
emit_hson_live_test_completion("livehost.authority", checks, checks, 0);

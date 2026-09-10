// @hson-live-external-test
import assert from "node:assert/strict";
import { AsyncLiveTree, hson } from "../src/index.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { link_node_to_el, unlinkElement } from "../src/api/livetree/utils/node-map-helpers.ts";
import { create_locus_internal } from "../src/api/locus/locus.core.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.async-authoring",
  title: "Explicit AsyncLiveTree authoring",
  category: "LiveTree",
  runtime: "node",
  tags: Object.freeze(["livetree", "async", "echo", "reflect", "document", "authoring"]),
});

const testEvents = create_test_event_emitter("livetree.async-authoring");
let checks = 0;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    testEvents.diagnostic(name, "assertion", (error instanceof Error ? error.message : String(error)).slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function document(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected a document LiveMap.");
  return map;
}

function authored_element(binding: ReturnType<typeof hson.reflect>) {
  const node = binding.tree.node.$_content[0];
  if (node === null || typeof node !== "object") throw new Error("Expected a projected document element.");
  return create_livetree(node).adoptRoots(binding.tree.hostRootNode());
}

class AttributeProjection {
  private readonly values = new Map<string, string>();
  public setAttribute(name: string, value: string): void { this.values.set(name, value); }
  public removeAttribute(name: string): void { this.values.delete(name); }
  public getAttribute(name: string): string | null { return this.values.get(name) ?? null; }
  public getAttributeNames(): string[] { return [...this.values.keys()]; }
}

type ServerMessage = Readonly<{ type?: string; completionRev?: number; commit?: Readonly<{ rev?: number }> }>;
function controlled_socket_pair(): Readonly<{
  client: LocusSocketLike;
  server: LocusSocketLike;
  heldCommits: readonly string[];
  clientSent: readonly Readonly<{ type?: string; name?: string }>[];
  holdCommits(): void;
  disconnectServer(): void;
  releaseNextCommit(): ServerMessage;
  nextDelivered(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage>;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const heldCommits: string[] = [];
  const delivered: ServerMessage[] = [];
  const clientSent: Readonly<{ type?: string; name?: string }>[] = [];
  const waiters = new Set<Readonly<{ predicate: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }>>();
  const serverCloseListeners = new Set<() => void>();
  let commitsHeld = false;
  const deliver = (raw: string): ServerMessage => {
    const message = JSON.parse(raw) as ServerMessage;
    delivered.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      waiters.delete(waiter);
      waiter.resolve(message);
    }
    for (const listener of [...clientMessages]) listener(raw);
    return message;
  };
  return Object.freeze({
    client: Object.freeze({
      send(raw: string) {
        clientSent.push(JSON.parse(raw) as Readonly<{ type?: string; name?: string }>);
        for (const listener of [...serverMessages]) listener(raw);
      },
      close() {},
      onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
      onClose() { return () => {}; },
    }),
    server: Object.freeze({
      send(raw: string) {
        const message = JSON.parse(raw) as ServerMessage;
        if (commitsHeld && message.type === "commit") heldCommits.push(raw);
        else deliver(raw);
      },
      close() {},
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverCloseListeners.add(listener); return () => serverCloseListeners.delete(listener); },
    }),
    heldCommits,
    clientSent,
    holdCommits() { commitsHeld = true; },
    disconnectServer() { for (const listener of [...serverCloseListeners]) listener(); },
    releaseNextCommit() {
      const raw = heldCommits.shift();
      if (raw === undefined) throw new Error("Expected a held commit.");
      return deliver(raw);
    },
    nextDelivered(predicate) {
      const existing = delivered.findLast(predicate);
      return existing === undefined
        ? new Promise((resolve) => waiters.add(Object.freeze({ predicate, resolve })))
        : Promise.resolve(existing);
    },
  });
}

let hostedSequence = 0;
async function hosted(source: string, options: { authorizeAction?: () => boolean } = {}) {
  const authority = document(source);
  const host = hson.locus.create({ map: authority, logicalMapId: `async-${++hostedSequence}`, sessions: {}, ...options });
  const replica = document(source);
  const pair = controlled_socket_pair();
  host.connect(pair.server);
  const echo = hson.echo.create({ socket: pair.client, map: replica, session: {}, recovery: { logicalMapId: host.stream.logicalMapId } });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const binding = hson.reflect(replica);
  return { authority, host, replica, pair, echo, binding, tree: authored_element(binding) };
}

await check("standalone calls are promises closed over AsyncLiveTree and preserve explicit sync identity", async () => {
  const tree = hson.liveTree.fromHson(`<main/>`);
  const dom = new AttributeProjection();
  link_node_to_el(tree.node, dom as unknown as Element);
  const operation = tree.async.attrs.set("id", "main");
  assert.equal(operation instanceof Promise, true);
  const owner = await operation;
  assert.equal(owner instanceof AsyncLiveTree, true);
  assert.equal(owner, tree.async);
  assert.equal(owner.sync, tree);
  assert.equal(tree.attrs.get("id"), "main");
  assert.equal(dom.getAttribute("id"), "main");
  unlinkElement(dom as unknown as Element);
  assert.equal(await owner.flags.set("hidden"), owner);
  assert.equal(await owner.classlist.add("ready"), owner);
  assert.equal(await owner.text.set("hello"), owner);
  assert.equal(await owner.form.setValue("field"), owner);
  assert.equal(tree.text.get(), "hello");
  assert.equal(tree.form.getValue(), "field");
  await assert.rejects(tree.async.attrs.set("bad name", "x"), /name/i);
});

await check("local Reflect remains synchronously canonical underneath async settlement", async () => {
  const map = document(`<main/>`);
  const binding = hson.reflect(map);
  const tree = authored_element(binding);
  const owner = await tree.async.attrs.set("title", "local");
  assert.equal(owner, tree.async);
  assert.equal(map.rev, 1);
  assert.equal(map.at([]).attrs.get("title"), "local");
  assert.equal(tree.attrs.get("title"), "local");
  assert.equal(tree.attrs.set("id", "sync-local"), tree);
  assert.equal(map.rev, 2);
  binding.dispose();
});

await check("hosted sync fence publishes nothing and async success waits for authority plus matching Echo commit", async () => {
  const fixture = await hosted(`<main/>`);
  const dom = new AttributeProjection();
  link_node_to_el(fixture.tree.node, dom as unknown as Element);
  const beforeRequests = fixture.pair.clientSent.filter((message) => message.type === "action").length;
  assert.throws(
    () => fixture.tree.attrs.set("blocked", "sync"),
    (error) => typeof error === "object" && error !== null
      && Reflect.get(error, "code") === "DOCUMENT_REFLECT_UNSUPPORTED_OPERATION"
      && /tree\.async/.test(String(Reflect.get(error, "message"))),
  );
  assert.throws(() => fixture.tree.async.sync.attrs.set("blocked", "sync"), /tree\.async/);
  assert.equal(fixture.pair.clientSent.filter((message) => message.type === "action").length, beforeRequests);
  assert.equal(fixture.authority.rev, 0);
  assert.equal(fixture.replica.rev, 0);
  assert.equal(fixture.tree.attrs.get("blocked"), undefined);
  assert.equal(dom.getAttribute("blocked"), null);

  fixture.pair.holdCommits();
  let settled = false;
  const operation = fixture.tree.async.attrs.set("title", "hosted").then((owner) => { settled = true; return owner; });
  await fixture.pair.nextDelivered((message) => message.type === "ack" && message.completionRev === 1);
  await Promise.resolve();
  assert.equal(fixture.authority.rev, 1);
  assert.equal(fixture.replica.rev, 0);
  assert.equal(settled, false);
  fixture.pair.releaseNextCommit();
  const owner = await operation;
  assert.equal(owner, fixture.tree.async);
  assert.equal(fixture.replica.rev, 1);
  assert.equal(fixture.tree.attrs.get("title"), "hosted");
  fixture.binding.dispose();
  fixture.echo.dispose();
});

await check("authoritative denial rejects its operation without poisoning the serialized queue", async () => {
  const decisions = [false, true];
  const fixture = await hosted(`<main/>`, { authorizeAction: () => decisions.shift() ?? true });
  const denied = fixture.tree.async.attrs.set("title", "denied");
  const accepted = fixture.tree.async.attrs.set("id", "accepted");
  await assert.rejects(denied, (error) => typeof error === "object" && error !== null
    && Reflect.get(error, "code") === "LOCUS_ACTION_FORBIDDEN");
  assert.equal(await accepted, fixture.tree.async);
  assert.equal(fixture.authority.rev, 1);
  assert.equal(fixture.replica.rev, 1);
  assert.equal(fixture.tree.attrs.get("title"), undefined);
  assert.equal(fixture.tree.attrs.get("id"), "accepted");
  fixture.binding.dispose();
  fixture.echo.dispose();
});

await check("disposal rejects a canonically pending async operation", async () => {
  const fixture = await hosted(`<main/>`);
  fixture.pair.holdCommits();
  const pending = fixture.tree.async.attrs.set("title", "pending");
  await fixture.pair.nextDelivered((message) => message.type === "ack" && message.completionRev === 1);
  fixture.echo.dispose();
  await assert.rejects(pending, /disposed/i);
  fixture.binding.dispose();
});

await check("retryable disconnect preserves one logical async operation through recovery", async () => {
  let enteredResolve = (): void => {};
  let releaseResolve = (): void => {};
  const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
  let executions = 0;
  const authority = document(`<main/>`);
  const host = create_locus_internal(
    { map: authority, logicalMapId: "async-retry", sessions: {} },
    { authorityGate: async () => { executions += 1; enteredResolve(); await release; } },
  );
  const replica = document(`<main/>`);
  const pair = controlled_socket_pair();
  host.connect(pair.server);
  const echo = hson.echo.create({ socket: pair.client, map: replica, session: {}, recovery: { logicalMapId: host.stream.logicalMapId } });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const binding = hson.reflect(replica);
  const tree = authored_element(binding);
  const operation = tree.async.attrs.set("title", "retried");
  await entered;
  echo.disconnect();
  pair.disconnectServer();
  host.connect(pair.server);
  echo.connect();
  await echo.session.reattach();
  await echo.recovery.recover();
  releaseResolve();
  assert.equal(await operation, tree.async);
  assert.equal(executions, 1);
  assert.equal(authority.rev, 1);
  assert.equal(replica.rev, 1);
  binding.dispose();
  echo.dispose();
});

testEvents.terminal("pass");

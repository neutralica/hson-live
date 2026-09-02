import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { document_binding_for_node } from "../src/api/livetree/lifecycle/document-binding-state.ts";
import { echo_document_authority_for } from "../src/api/echo/echo.document-authority.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { create_locus_internal } from "../src/api/locus/locus.core.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.reflect-authoring",
  title: "Echo reflected document authoring",
  category: "Reflect",
  runtime: "node",
  tags: Object.freeze(["echo", "reflect", "document", "authoring"]),
});

const testEvents = create_test_event_emitter("echo.reflect-authoring");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {

  testEvents.case_begin(name, name);
  try {
    await run();
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

function document(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected a document LiveMap.");
  return map;
}

function socket_pair() {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const client = {
    send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
    close() {},
    onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  const server = {
    send(raw: string) { for (const listener of [...clientMessages]) listener(raw); },
    close() {},
    onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  return { client, server };
}

function authored_element(binding: ReturnType<typeof hson.reflect>) {
  const node = binding.tree.node.$_content[0];
  if (node === null || typeof node !== "object") throw new Error("Expected a projected document element.");
  return create_livetree(node).adoptRoots(binding.tree.hostRootNode());
}

class AttributeProjection {
  readonly values = new Map<string, string>();
  setAttribute(name: string, value: string): void { this.values.set(name, value); }
  removeAttribute(name: string): void { this.values.delete(name); }
  getAttribute(name: string): string | null { return this.values.get(name) ?? null; }
  getAttributeNames(): string[] { return [...this.values.keys()]; }
}

function mount(node: HsonNode): AttributeProjection {
  const projection = new AttributeProjection();
  for (const [name, value] of Object.entries(node.$_attrs ?? {})) projection.values.set(name, String(value));
  link_node_to_el(node, projection as unknown as Element);
  return projection;
}

function wait_for_revision(map: DocumentLiveMap, revision: number): Promise<void> {
  if (map.rev >= revision) return Promise.resolve();
  return new Promise((resolve) => {
    const off = map.commits.observe(() => {
      if (map.rev < revision) return;
      off();
      resolve();
    });
  });
}

await check("one-map Echo fences direct mutation before graph, revision, publication, and Reflect projection", async () => {
  const authoritative = document(`<main/>`);
  const host = hson.locus.create({ map: authoritative, logicalMapId: "echo-fence" });
  const replica = document(`<main/>`);
  const pair = socket_pair();
  host.connect(pair.server);
  const echo = hson.echo.create({ socket: pair.client, map: replica, recovery: { logicalMapId: host.stream.logicalMapId } });
  const binding = hson.reflect(replica);
  const tree = authored_element(binding);
  const dom = mount(tree.node);
  let publications = 0;
  replica.commits.observe(() => { publications += 1; });
  const before = replica.capture();
  assert.throws(() => replica.document.attrs.set({ kind: "path", path: [0] }, "title", "forbidden"), /controlled|managed|Echo/i);
  assert.deepEqual(replica.capture(), before);
  assert.equal(replica.rev, 0);
  assert.equal(publications, 0);
  assert.equal(tree.attrs.get("title"), undefined);
  assert.equal(dom.getAttribute("title"), null);
  assert.throws(() => tree.quid, /identity|QUID/i);
  assert.equal(replica.rev, 0);
  binding.dispose();
  echo.dispose();
});

await check("hosted nested remove is a void request and changes projection only after acceptance", async () => {
  const authoritative = document(`<main <span/>/>`);
  const host = hson.locus.create({ map: authoritative, logicalMapId: "echo-remove", sessions: {} });
  const replica = document(`<main <span/>/>`);
  const pair = socket_pair();
  host.connect(pair.server);
  const echo = hson.echo.create({ socket: pair.client, map: replica, session: {}, recovery: { logicalMapId: host.stream.logicalMapId } });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const binding = hson.reflect(replica);
  const main = authored_element(binding);
  const span = main.content.mustOnly({ warn: false });
  assert.deepEqual(document_binding_for_node(span.node)?.canonicalPath, [0, 0, 0]);
  assert.notEqual(echo_document_authority_for(replica), undefined);
  const result: void = span.remove();
  assert.equal(result, undefined);
  assert.equal(authoritative.rev, 0);
  assert.equal(replica.rev, 0);
  assert.equal(span.isDisposed, false);
  assert.equal(binding.status, "active");
  await wait_for_revision(replica, 1);
  assert.equal(authoritative.rev, 1);
  assert.equal(replica.rev, 1);
  assert.equal(span.isDisposed, true);
  assert.equal(binding.status, "active");
  binding.dispose();
  echo.dispose();
});

await check("hosted Reflect stays pessimistic and queued convenience edits lower after completionRev", async () => {
  let releaseFirst: (() => void) | undefined;
  let gateCount = 0;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const authoritative = document(`<main class="base"/>`);
  const host = create_locus_internal(
    { map: authoritative, logicalMapId: "echo-authoring", sessions: {} },
    { authorityGate: async () => { gateCount += 1; if (gateCount === 1) await firstGate; } },
  );
  const replica = document(`<main class="base"/>`);
  const pair = socket_pair();
  host.connect(pair.server);
  const echo = hson.echo.create({
    socket: pair.client,
    map: replica,
    session: {},
    recovery: { logicalMapId: host.stream.logicalMapId },
  });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const binding = hson.reflect(replica);
  const tree = authored_element(binding);
  const dom = mount(tree.node);

  tree.attrs.set("title", "accepted");
  tree.classlist.add("one");
  tree.classlist.add("two");
  tree.style.set.color("red");
  tree.style.set.backgroundColor("black");
  await Promise.resolve();
  assert.equal(authoritative.rev, 0);
  assert.equal(replica.rev, 0);
  assert.equal(tree.attrs.get("title"), undefined);
  assert.equal(dom.getAttribute("title"), null);

  releaseFirst?.();
  await wait_for_revision(replica, 5);
  assert.equal(authoritative.rev, 5);
  assert.equal(replica.rev, 5);
  assert.equal(tree.attrs.get("title"), "accepted");
  assert.equal(tree.attrs.get("class"), "base one two");
  assert.deepEqual(tree.attrs.get("style"), { backgroundColor: "black", color: "red" });
  assert.equal(dom.getAttribute("title"), "accepted");
  assert.equal(dom.getAttribute("class"), "base one two");
  assert.equal(binding.status, "active");
  binding.dispose();
  echo.dispose();
});

await check("one-map authorization denial settles without Reflect failure and the Echo queue continues", async () => {
  const decisions = [false, true];
  const authoritative = document(`<main/>`);
  const host = hson.locus.create({
    map: authoritative,
    logicalMapId: "echo-authorization",
    sessions: {},
    authorizeAction: () => decisions.shift() ?? true,
  });
  const replica = document(`<main/>`);
  const pair = socket_pair();
  host.connect(pair.server);
  const echo = hson.echo.create({
    socket: pair.client,
    map: replica,
    session: {},
    recovery: { logicalMapId: host.stream.logicalMapId },
  });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const binding = hson.reflect(replica);
  const tree = authored_element(binding);
  const dom = mount(tree.node);
  tree.attrs.set("title", "denied");
  tree.attrs.set("id", "accepted");
  await wait_for_revision(replica, 1);
  assert.equal(authoritative.rev, 1);
  assert.equal(replica.rev, 1);
  assert.equal(tree.attrs.get("title"), undefined);
  assert.equal(dom.getAttribute("title"), null);
  assert.equal(tree.attrs.get("id"), "accepted");
  assert.equal(dom.getAttribute("id"), "accepted");
  assert.equal(binding.status, "active");
  binding.dispose();
  echo.dispose();
});

testEvents.terminal("pass");

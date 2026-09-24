// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import { create_linked_livetree_in_runtime, create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { get_el_for_node, link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import {
  disposables_drain_for_subjects,
  lifecycle_resource_counts_for_subject,
  own_disposable_for_subject,
} from "../src/api/livetree/managers/lifecycle-registry.ts";
import { create_livetree_runtime, runtime_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import {
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _reflect_document_for_runtime_test,
} from "../src/_tests/diagnostics-internal.ts";
import { element, path, projected_element, raw_node } from "./helpers/reflect-unit6.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.realization-resource-ownership",
  title: "LiveTree realization-local resource ownership",
  category: "LiveTree",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["lifecycle", "listeners", "reflect", "echo", "quid", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livetree.realization-resource-ownership");
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

type ListenerRecord = Readonly<{
  listener: EventListenerOrEventListenerObject;
  capture: boolean;
}>;

class RuntimeDocument {
  readonly defaultView = null;
}

class RuntimeElement {
  readonly nodeType = 1;
  isConnected = false;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly ownerDocument = new RuntimeDocument();
  readonly listeners = new Map<string, Set<ListenerRecord>>();
  readonly attrs = new Map<string, string>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener === null) return;
    const records = this.listeners.get(type) ?? new Set<ListenerRecord>();
    records.add({ listener, capture: typeof options === "boolean" ? options : !!options?.capture });
    this.listeners.set(type, records);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    const records = this.listeners.get(type);
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    if (listener === null || records === undefined) return;
    for (const record of records) {
      if (record.listener === listener && record.capture === capture) records.delete(record);
    }
    if (records.size === 0) this.listeners.delete(type);
  }

  dispatch(type: string): void {
    for (const record of [...(this.listeners.get(type) ?? [])]) {
      if (typeof record.listener === "function") record.listener(new Event(type));
      else record.listener.handleEvent(new Event(type));
    }
  }

  querySelectorAll(): RuntimeElement[] { return []; }
  replaceChildren(): void {}
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  remove(): void { this.isConnected = false; }
}

function attach(node: HsonNode): RuntimeElement {
  const target = new RuntimeElement();
  link_node_to_el(node, target as unknown as Element);
  return target;
}

function document(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected a document LiveMap.");
  return map;
}

function authored_node(root: HsonNode): HsonNode {
  const node = root.$_content[0];
  if (node === null || typeof node !== "object") throw new Error("Expected an authored document node.");
  return node;
}

function socket_pair() {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientSent: string[] = [];
  const client = {
    send(raw: string) { clientSent.push(raw); for (const listener of [...serverMessages]) listener(raw); },
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
  return { client, server, clientSent };
}

await check("QUID-free standalone listeners work, dispose manually, and clean terminally", () => {
  const node: HsonNode = { $_tag: "button", $_content: [] };
  const tree = create_linked_livetree_in_runtime(node, create_livetree_runtime());
  const target = attach(node);
  let calls = 0;
  const first = tree.listen.onClick(() => { calls += 1; });
  assert.equal(node.$_meta?.quid, undefined);
  target.dispatch("click");
  assert.equal(calls, 1);
  first.off();
  target.dispatch("click");
  assert.equal(calls, 1);

  tree.listen.onClick(() => { calls += 1; });
  assert.equal(lifecycle_resource_counts_for_subject(node, runtime_for_tree(tree)).listener, 1);
  tree.remove();
  target.dispatch("click");
  assert.equal(calls, 1);
  assert.equal(target.listeners.has("click"), false);
});

await check("detach, reinsertion, and aliases preserve exact ownership", () => {
  const firstNode: HsonNode = { $_tag: "button", $_content: [] };
  const secondNode: HsonNode = { $_tag: "button", $_content: [] };
  const parent = create_livetree({ $_tag: "main", $_content: [firstNode, secondNode] });
  const first = create_livetree(firstNode).adoptRoots(parent.hostRootNode());
  const alias = create_livetree(firstNode).adoptRoots(parent.hostRootNode());
  const second = create_livetree(secondNode).adoptRoots(parent.hostRootNode());
  const firstTarget = attach(firstNode);
  const secondTarget = attach(secondNode);
  let firstCalls = 0;
  let secondCalls = 0;
  first.listen.onClick(() => { firstCalls += 1; });
  second.listen.onClick(() => { secondCalls += 1; });

  first.detach();
  firstTarget.dispatch("click");
  parent.append(first);
  firstTarget.dispatch("click");
  assert.equal(firstCalls, 2);
  assert.equal(firstTarget.listeners.get("click")?.size, 1);

  firstTarget.dispatch("click");
  assert.equal(firstCalls, 3);
  assert.equal(lifecycle_resource_counts_for_subject(firstNode).listener, 1);

  alias.remove();
  firstTarget.dispatch("click");
  secondTarget.dispatch("click");
  assert.equal(firstCalls, 3);
  assert.equal(secondCalls, 1);
  assert.equal(secondTarget.listeners.get("click")?.size, 1);
  parent.remove();
  secondTarget.dispatch("click");
  assert.equal(secondCalls, 1);
  assert.equal(secondTarget.listeners.has("click"), false);
});

await check("QUID-free local Reflect registration leaves graph, revision, publication, and overlay unchanged", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const node = raw_node(binding.tree.node, []);
  const tree = _create_livetree_for_runtime_test(runtime, node).adoptRoots(binding.tree.hostRootNode());
  const target = attach(node);
  const beforeCapture = map.capture();
  const beforeRevision = map.rev;
  let publications = 0;
  const stop = map.commits.observe(() => { publications += 1; });
  let calls = 0;
  const listener = tree.listen.onClick(() => { calls += 1; });

  target.dispatch("click");
  assert.equal(calls, 1);
  assert.equal(node.$_meta?.quid, undefined);
  assert.equal(map.rev, beforeRevision);
  assert.equal(publications, 0);
  assert.deepEqual(map.capture(), beforeCapture);

  const acquired = tree.quid;
  assert.equal(typeof acquired, "string");
  target.dispatch("click");
  assert.equal(calls, 2);
  assert.equal(lifecycle_resource_counts_for_subject(node, runtime_for_tree(tree)).listener, 1);

  listener.off();
  assert.equal(target.listeners.has("click"), false);
  stop();
  binding.dispose();
  binding.tree.remove();
});

await check("distinct QUID-free reflected subjects keep independent resources", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a/> <b/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const firstNode = raw_node(binding.tree.node, [0, 0]);
  const secondNode = raw_node(binding.tree.node, [0, 1]);
  const first = _create_livetree_for_runtime_test(runtime, firstNode).adoptRoots(binding.tree.hostRootNode());
  const second = _create_livetree_for_runtime_test(runtime, secondNode).adoptRoots(binding.tree.hostRootNode());
  const firstTarget = attach(firstNode);
  const secondTarget = attach(secondNode);
  let firstCalls = 0;
  let secondCalls = 0;
  const firstListener = first.listen.onClick(() => { firstCalls += 1; });
  second.listen.onClick(() => { secondCalls += 1; });

  firstListener.off();
  firstTarget.dispatch("click");
  secondTarget.dispatch("click");
  assert.deepEqual([firstCalls, secondCalls], [0, 1]);
  assert.equal(firstNode.$_meta?.quid, undefined);
  assert.equal(secondNode.$_meta?.quid, undefined);
  assert.equal(lifecycle_resource_counts_for_subject(firstNode, runtime_for_tree(first)).listener, 0);
  assert.equal(lifecycle_resource_counts_for_subject(secondNode, runtime_for_tree(second)).listener, 1);
  binding.dispose();
});

await check("compatible Reflect reuse preserves resources on the same exact subject", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a @000000r01/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const original = raw_node(binding.tree.node, [0, 0]);
  const tree = _create_livetree_for_runtime_test(runtime, original).adoptRoots(binding.tree.hostRootNode());
  const target = attach(original);
  let calls = 0;
  tree.listen.onClick(() => { calls += 1; });

  map.document.content.replace(path(0), 0, projected_element(`<a @000000r01 title="same"/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]), original);
  assert.equal(get_el_for_node(original), target);
  target.dispatch("click");
  assert.equal(calls, 1);

  binding.dispose();
});

await check("incompatible same-QUID replacement cleans the outgoing subject without transfer", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a @000000r02/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const original = raw_node(binding.tree.node, [0, 0]);
  const tree = _create_livetree_for_runtime_test(runtime, original).adoptRoots(binding.tree.hostRootNode());
  const outgoingEvents = tree.events;
  let calls = 0;
  const off = outgoingEvents.on("probe", () => { calls += 1; });
  assert.equal(lifecycle_resource_counts_for_subject(original, runtime_for_tree(tree)).treeEvent, 1);
  outgoingEvents.emit("probe");
  assert.equal(calls, 1);

  map.document.content.replace(path(0), 0, projected_element(`<i @000000r02/>`));
  const replacement = raw_node(binding.tree.node, [0, 0]);
  assert.notEqual(replacement, original);
  assert.equal(lifecycle_resource_counts_for_subject(original, runtime_for_tree(tree)).treeEvent, 0);
  assert.equal(lifecycle_resource_counts_for_subject(replacement, runtime_for_tree(tree)).treeEvent, 0);
  assert.throws(() => outgoingEvents.emit("probe"), /disposed/);
  assert.equal(calls, 1);
  off();
  binding.dispose();
});

await check("exact-subject terminal draining reaches a fixed point after isolated failure", () => {
  const node: HsonNode = { $_tag: "main", $_content: [] };
  const runtime = create_livetree_runtime();
  const tree = create_linked_livetree_in_runtime(node, runtime);
  const calls = { initial: 0, reentrant: 0, throwing: 0, following: 0 };
  const warnings: unknown[][] = [];
  const priorWarn = console.warn;

  own_disposable_for_subject(node, () => {
    calls.initial += 1;
    own_disposable_for_subject(node, () => { calls.reentrant += 1; }, "binding", runtime);
  }, "listener", runtime);
  own_disposable_for_subject(node, () => {
    calls.throwing += 1;
    throw new Error("expected cleanup failure");
  }, "other", runtime);
  own_disposable_for_subject(node, () => { calls.following += 1; }, "tree-event", runtime);

  let drain: ReturnType<typeof disposables_drain_for_subjects>;
  console.warn = (...values: unknown[]) => { warnings.push(values); };
  try {
    drain = disposables_drain_for_subjects([node], undefined, runtime);
  } finally {
    console.warn = priorWarn;
  }

  assert.deepEqual(calls, { initial: 1, reentrant: 1, throwing: 1, following: 1 });
  assert.deepEqual(drain, { passes: 2, callbacks: 4, bounded: false });
  assert.equal(warnings.length, 1);
  assert.deepEqual(lifecycle_resource_counts_for_subject(node, runtime), {
    total: 0,
    binding: 0,
    listener: 0,
    treeEvent: 0,
    resizeObserver: 0,
    other: 0,
  });
  tree.remove();
});

await check("QUID-free hosted Reflect registration stays browser-local and submits no operation", async () => {
  const authoritative = document(`<main/>`);
  const host = hson.locus.create({ map: authoritative, logicalMapId: "resource-owner", sessions: {} });
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
  const node = authored_node(binding.tree.node);
  const tree = create_livetree(node).adoptRoots(binding.tree.hostRootNode());
  const target = attach(node);
  const authorityRevision = authoritative.rev;
  const clientRevision = replica.rev;
  const sent = pair.clientSent.length;
  let publications = 0;
  const stop = replica.commits.observe(() => { publications += 1; });
  let calls = 0;

  const listener = tree.listen.onClick(() => { calls += 1; });
  target.dispatch("click");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(node.$_meta?.quid, undefined);
  assert.equal(authoritative.rev, authorityRevision);
  assert.equal(replica.rev, clientRevision);
  assert.equal(publications, 0);
  assert.equal(pair.clientSent.length, sent);

  listener.off();
  assert.equal(target.listeners.has("click"), false);
  stop();
  binding.dispose();
  echo.dispose();
});

process.stdout.write(`# ${checks} realization-local resource ownership checks passed\n`);
testEvents.terminal("pass");

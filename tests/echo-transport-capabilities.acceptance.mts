import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonLocus, type HsonSchema } from "../src/index.ts";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import type { EchoAttachmentEvent, EchoFiniteOperationRequest, EchoReplicaTransport,
  EchoSynchronizationObserver, EchoSynchronizationRequest } from "../src/types/echo.transport.types.ts";
import type { LocusWebSocketLike } from "../src/api/locus/locus.websocket.ts";
import { create_locus_hosted_aggregate_authority_internal } from "../src/api/locus/locus.aggregate.authority.ts";
import { test_public_projection } from "./helpers/hosted-catalog.mts";
import { create_test_event_emitter } from "./test-events.mjs";
import { create_echo_websocket_transport, type EchoWebSocketLike } from "../src/api/echo/echo.websocket.ts";
import { decodeEndpointMessage } from "../src/api/echo/echo.websocket-codec.internal.ts";
import { decode_echo_hosted_aggregate_synchronization_frame_internal } from "../src/api/echo/echo.aggregate-websocket.internal.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.aggregate.protocol.ts";
import { bind_node_locus_websocket } from "../src/api/locus/node/locus.node-socket.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.transport-capabilities", title: "Transport-neutral Echo and Locus capabilities",
  category: "Echo", runtime: "node", tags: Object.freeze(["echo", "locus", "transport-neutral", "operations", "recovery", "session"]),
});
const events = create_test_event_emitter("echo.transport-capabilities");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (cause) { events.case_end(name, "fail"); events.terminal("fail"); throw cause; }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

await check("finite submission distinguishes response, proved non-submission, and uncertainty", async () => {
  const received: string[] = [];
  const inbound = new Set<(raw: string) => void>();
  const closes = new Set<() => void>();
  const physical: LocusWebSocketLike = Object.freeze({
    send(raw) { received.push(raw); },
    close() { for (const listener of [...closes]) listener(); },
    onMessage(listener) { inbound.add(listener); return () => inbound.delete(listener); },
    onClose(listener) { closes.add(listener); return () => closes.delete(listener); },
  });
  const transport = test_echo_transport(physical);
  const request = { type: "session-create" as const, id: "create-one" };
  const abort = new AbortController(); abort.abort("before admission");
  assert.equal((await transport.operations.submit(request, { signal: abort.signal })).kind, "not-submitted");
  assert.deepEqual(received, []);
  const response = transport.operations.submit(request);
  await Promise.resolve();
  for (const listener of [...inbound]) listener(JSON.stringify({ type: "session-rejected", format: "hson-locus-hosted-aggregate-message",
    id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "rejected" }));
  assert.equal((await response).kind, "response");
  const uncertain = transport.operations.submit({ ...request, id: "create-two" });
  await Promise.resolve();
  physical.close();
  assert.equal((await uncertain).kind, "uncertain");
  transport.dispose();
});

await check("ordered feed replacement fences late output without ending finite operations", async () => {
  let active: EchoSynchronizationObserver | undefined;
  let available = true;
  const submitted: string[] = [];
  const transport: EchoReplicaTransport = Object.freeze({
    operations: Object.freeze({ async submit(request: EchoFiniteOperationRequest) {
      submitted.push(request.id);
      return available ? Object.freeze({ kind: "uncertain" as const }) : Object.freeze({ kind: "not-submitted" as const });
    } }),
    attachment: Object.freeze({ observe(listener: (event: EchoAttachmentEvent) => void) { listener(Object.freeze({ kind: "available" })); return () => {}; } }),
    synchronization: Object.freeze({ async open(_request: EchoSynchronizationRequest, observer: EchoSynchronizationObserver) {
      const previous = active;
      active = observer;
      previous?.onEnd(Object.freeze({ kind: "cancelled" }));
      return Object.freeze({ cancel() { if (active === observer) { active = undefined; observer.onEnd(Object.freeze({ kind: "cancelled" })); } } });
    } }),
  });
  const old: string[] = [];
  const next: string[] = [];
  const request = { type: "recover" as const, id: "old", logicalMapId: "map" };
  const first = await transport.synchronization.open(request, { onOutput: (output) => { old.push(output.type); }, onEnd: () => {} });
  const second = await transport.synchronization.open({ ...request, id: "next" }, { onOutput: (output) => { next.push(output.type); }, onEnd: () => {} });
  first.cancel();
  await active?.onOutput({ type: "synchronization-failure", id: "next", error: { message: "new feed" } });
  assert.deepEqual(old, []);
  assert.deepEqual(next, ["synchronization-failure"]);
  available = false;
  assert.equal((await transport.operations.submit({ type: "session-create", id: "failure" })).kind, "not-submitted");
  assert.equal(active === undefined, false, "finite operation failure does not end synchronization");
  available = true;
  assert.equal((await transport.operations.submit({ type: "session-create", id: "success" })).kind, "uncertain");
  assert.deepEqual(submitted, ["failure", "success"]);
  second.cancel();
});

await check("Locus logical attachment keeps finite admission separate from replaceable sync", async () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema } });
  const authority = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(map), map,
    actions: { echo: (_context, payload) => payload } });
  const notices: string[] = [];
  const attachment = authority.attach((notice) => { notices.push(notice.type); }, { principalId: "alice" });
  const created = await attachment.operations.submit({ type: "session-create", id: "create" });
  assert.equal(created.type, "session-created");
  assert.equal(attachment.binding.attached, true);
  const first: string[] = [];
  const stopFirst = attachment.synchronization.open({ type: "recover", id: "first", logicalMapId: authority.logicalMapId },
    (output) => { first.push(output.type); });
  for (let turn = 0; turn < 30 && !first.includes("recovery-caught-up"); turn++) await Promise.resolve();
  assert.equal(first.includes("recovery-caught-up"), true);
  stopFirst();
  assert.equal(attachment.binding.attached, true);
  const second: string[] = [];
  const stopSecond = attachment.synchronization.open({ type: "recover", id: "second", logicalMapId: authority.logicalMapId },
    (output) => { second.push(output.type); });
  for (let turn = 0; turn < 30 && !second.includes("recovery-caught-up"); turn++) await Promise.resolve();
  const payload = Hson.data.from({ value: 1 });
  const outcome = await attachment.operations.submit({ type: "action", id: "action", name: "echo", payload,
    clientId: "client", requestId: "stable", attemptId: "attempt" });
  assert.equal(outcome.type, "ack");
  assert.equal(second.includes("recovery-caught-up"), true);
  stopSecond(); attachment.close(); authority.dispose();
  assert.deepEqual(notices, []);
});

await check("Locus ends displaced, cancelled, and closed subscriptions once", async () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema } });
  const authority = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(map), map });
  const attachment = authority.attach(() => {});
  await attachment.operations.submit({ type: "session-create", id: "create" });
  const ended: string[] = [];
  const request = { type: "recover" as const, id: "first", logicalMapId: authority.logicalMapId };
  const first = attachment.synchronization.open(request, () => {}, () => ended.push("first"));
  const second = attachment.synchronization.open({ ...request, id: "second" }, () => {}, () => ended.push("second"));
  assert.deepEqual(ended, ["first"]);
  first();
  assert.deepEqual(ended, ["first"]);
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
  second();
  second();
  assert.deepEqual(ended, ["first", "second"]);
  const third = attachment.synchronization.open({ ...request, id: "third" }, () => {}, () => ended.push("third"));
  attachment.close();
  third();
  assert.deepEqual(ended, ["first", "second", "third"]);
  const another = authority.attach(() => {});
  await another.operations.submit({ type: "session-create", id: "another-create" });
  const fourth = another.synchronization.open({ ...request, id: "fourth" }, () => {}, () => ended.push("fourth"));
  authority.dispose();
  fourth();
  assert.deepEqual(ended, ["first", "second", "third", "fourth"]);
});

await check("reentrant subscription replacement cannot install an orphan sink", async () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema } });
  const authority = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(map), map });
  const attachment = authority.attach(() => {});
  await attachment.operations.submit({ type: "session-create", id: "create" });
  const ended: string[] = [];
  const output: string[] = [];
  const nestedOutput: string[] = [];
  const request = { type: "recover" as const, id: "first", logicalMapId: authority.logicalMapId };
  let nestedStop: () => void = () => {};
  const firstStop = attachment.synchronization.open(request, () => {}, () => {
    ended.push("first");
    nestedStop = attachment.synchronization.open({ ...request, id: "nested" }, (value) => { nestedOutput.push(value.type); },
      () => ended.push("nested"));
  });
  const displacedStop = attachment.synchronization.open({ ...request, id: "displaced" }, (value) => { output.push(value.type); },
    () => ended.push("displaced"));
  for (let turn = 0; turn < 30 && !output.includes("recovery-caught-up"); turn++) await Promise.resolve();
  assert.deepEqual(ended, ["first", "nested"]);
  assert.deepEqual(nestedOutput, []);
  assert.equal(output.includes("recovery-caught-up"), true);
  firstStop(); nestedStop();
  assert.deepEqual(ended, ["first", "nested"]);
  attachment.close();
  displacedStop();
  assert.deepEqual(ended, ["first", "nested", "displaced"]);
  let closedEnd = 0;
  attachment.synchronization.open({ ...request, id: "after-close" }, () => {}, () => { closedEnd += 1; });
  assert.equal(closedEnd, 1);
  authority.dispose();
});

await check("Node Locus WebSocket binding forwards finite operations and releases listeners", async () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema } });
  const locus = hsonLocus.create({ ...test_public_projection(map), map });
  class NodeSocket extends EventEmitter {
    readyState: number = WebSocket.OPEN;
    bufferedAmount = 0;
    readonly sent: string[] = [];
    send(raw: string): void { this.sent.push(raw); }
    close(): void { this.readyState = WebSocket.CLOSED; this.emit("close"); }
  }
  const socket = new NodeSocket();
  const stop = bind_node_locus_websocket(locus, socket as unknown as WebSocket);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "session-create", id: "node-create" })), false);
  for (let turn = 0; turn < 100 && !socket.sent.some((raw) => JSON.parse(raw).type === "session-created"); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(socket.sent.some((raw) => JSON.parse(raw).type === "session-created"), true);
  stop(); socket.close();
  assert.equal(socket.listenerCount("message"), 0);
  assert.equal(socket.listenerCount("close"), 0);
  locus.dispose();
});

class ControlledWebSocket implements EchoWebSocketLike {
  static sockets: ControlledWebSocket[] = [];
  static autoOpen = true;
  readyState = 0;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<Function>>();
  throwSend = false;
  constructor(_url: string) {
    ControlledWebSocket.sockets.push(this);
    if (ControlledWebSocket.autoOpen) queueMicrotask(() => this.open());
  }
  private emit(type: string, event?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
  open(): void { if (this.readyState !== 0) return; this.readyState = 1; this.emit("open"); }
  emitFrame(value: unknown): void { this.emit("message", { data: JSON.stringify(value) }); }
  send(raw: string): void { if (this.throwSend) throw new Error("send invoked and failed"); this.sent.push(raw); }
  close(): void { if (this.readyState < 2) this.readyState = 2; }
  finishClose(): void { this.readyState = 3; this.emit("close"); }
  listenerCount(): number { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: string, listener: Function): void {
    const set = this.listeners.get(type) ?? new Set<Function>(); set.add(listener); this.listeners.set(type, set);
  }
  removeEventListener(type: "open", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  removeEventListener(type: "close", listener: () => void): void;
  removeEventListener(type: "error", listener: () => void): void;
  removeEventListener(type: string, listener: Function): void { this.listeners.get(type)?.delete(listener); }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !predicate(); turn++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true);
}

await check("authority error frames enforce format, exact fields, and nested structure", () => {
  const valid = { type: "error", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: "attempt", ok: false,
    seq: 0, error: { code: "LOCUS_ACTION_FAILED", message: "failed", path: ["state", 0] } };
  assert.equal(decodeEndpointMessage(JSON.stringify(valid), LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT)?.type, "error");
  for (const malformed of [{ ...valid, format: "wrong" }, { ...valid, ok: true }, { ...valid, extra: 1 },
    { ...valid, error: { ...valid.error, extra: 1 } }, { ...valid, error: { ...valid.error, path: ["state", -1] } }]) {
    assert.equal(decodeEndpointMessage(JSON.stringify(malformed), LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT), undefined);
  }
  const sync = { type: "error", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: "recovery", code: "LOCUS_SYNC_FAILED", message: "failed" };
  assert.equal(decode_echo_hosted_aggregate_synchronization_frame_internal(JSON.stringify(sync))?.type, "synchronization-failure");
  for (const malformed of [{ ...sync, ok: false }, { ...sync, extra: 1 }]) {
    assert.throws(() => decode_echo_hosted_aggregate_synchronization_frame_internal(JSON.stringify(malformed)), /malformed/i);
  }
});

await check("WebSocket pre-send rejection differs from loss after send", async () => {
  ControlledWebSocket.sockets = []; ControlledWebSocket.autoOpen = true;
  const transport = create_echo_websocket_transport({ url: "fixture://echo", WebSocketConstructor: ControlledWebSocket });
  assert.equal((await transport.operations.submit({ type: "session-create", id: "x".repeat(4_300_000) })).kind, "not-submitted");
  const socket = ControlledWebSocket.sockets[0]!;
  assert.equal(socket.sent.length, 0);
  const unencodable = { type: "session-create", id: { toJSON() { throw new Error("encoding failed"); } } } as unknown as EchoFiniteOperationRequest;
  assert.equal((await transport.operations.submit(unencodable)).kind, "not-submitted");
  assert.equal(socket.sent.length, 0);
  const abort = new AbortController(); abort.abort();
  assert.equal((await transport.operations.submit({ type: "session-create", id: "aborted" }, { signal: abort.signal })).kind, "not-submitted");
  const afterSend = new AbortController();
  const abortedAfterSend = transport.operations.submit({ type: "session-create", id: "after-send" }, { signal: afterSend.signal });
  await waitFor(() => socket.sent.length === 1);
  afterSend.abort();
  assert.equal((await abortedAfterSend).kind, "uncertain");
  socket.throwSend = true;
  assert.equal((await transport.operations.submit({ type: "session-create", id: "send-threw" })).kind, "uncertain");
  socket.throwSend = false;
  const pending = transport.operations.submit({ type: "session-create", id: "sent" });
  await waitFor(() => socket.sent.length === 2);
  assert.equal(socket.listenerCount(), 4);
  socket.finishClose();
  assert.equal((await pending).kind, "uncertain");
  transport.dispose();
});

await check("late old synchronization error cannot terminate a replacement", async () => {
  ControlledWebSocket.sockets = []; ControlledWebSocket.autoOpen = true;
  const transport = create_echo_websocket_transport({ url: "fixture://echo", WebSocketConstructor: ControlledWebSocket });
  const request = { type: "recover" as const, id: "old", logicalMapId: "map" };
  const next: string[] = [];
  await transport.synchronization.open(request, { onOutput() {}, onEnd() {} });
  const replacement = await transport.synchronization.open({ ...request, id: "new" }, {
    onOutput(output) { next.push(output.type); }, onEnd() { next.push("ended"); },
  });
  const socket = ControlledWebSocket.sockets[0]!;
  socket.emitFrame({ type: "error", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: "old", code: "LOCUS_SYNC_FAILED", message: "late" });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(next, []);
  socket.emitFrame({ type: "error", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: "new", code: "LOCUS_SYNC_FAILED", message: "current" });
  await waitFor(() => next.length === 1);
  assert.deepEqual(next, ["synchronization-failure"]);
  replacement.cancel(); transport.dispose(); socket.finishClose();
});

await check("pending synchronization open aborts without an orphan feed", async () => {
  ControlledWebSocket.sockets = []; ControlledWebSocket.autoOpen = false;
  const transport = create_echo_websocket_transport({ url: "fixture://echo", WebSocketConstructor: ControlledWebSocket });
  const abort = new AbortController();
  const opening = transport.synchronization.open({ type: "recover", id: "pending", logicalMapId: "map" },
    { onOutput() { assert.fail("Aborted feed published output."); }, onEnd() {} }, { signal: abort.signal });
  abort.abort();
  await assert.rejects(opening);
  for (const socket of ControlledWebSocket.sockets) { socket.open(); assert.deepEqual(socket.sent, []); }
  transport.dispose();
  for (const socket of ControlledWebSocket.sockets) socket.finishClose();
});

await check("aborting an established WebSocket feed cancels its server binding", async () => {
  ControlledWebSocket.sockets = []; ControlledWebSocket.autoOpen = true;
  const transport = create_echo_websocket_transport({ url: "fixture://echo", WebSocketConstructor: ControlledWebSocket });
  const abort = new AbortController();
  const ends: string[] = [];
  await transport.synchronization.open({ type: "recover", id: "active", logicalMapId: "map" },
    { onOutput() {}, onEnd(end) { ends.push(end.kind); } }, { signal: abort.signal });
  const socket = ControlledWebSocket.sockets[0]!;
  assert.equal(socket.sent.length, 1);
  abort.abort();
  assert.deepEqual(ends, ["cancelled"]);
  assert.equal(socket.readyState, 2, "WebSocket cancellation closes the physical binding without a recovery-cancel frame");
  socket.finishClose();
  assert.equal(socket.listenerCount(), 0);
  transport.dispose();
});

await check("old physical listeners are removed after overlapping reconnects", async () => {
  ControlledWebSocket.sockets = []; ControlledWebSocket.autoOpen = true;
  const transport = create_echo_websocket_transport({ url: "fixture://echo", WebSocketConstructor: ControlledWebSocket });
  const stop = transport.attachment.observe(() => {});
  await waitFor(() => ControlledWebSocket.sockets[0]?.readyState === 1);
  for (let cycle = 0; cycle < 3; cycle++) {
    const old = ControlledWebSocket.sockets.at(-1)!;
    old.close();
    const id = `cycle-${cycle}`;
    const result = transport.operations.submit({ type: "session-create", id });
    await waitFor(() => ControlledWebSocket.sockets.length === cycle + 2);
    const current = ControlledWebSocket.sockets.at(-1)!;
    await waitFor(() => current.sent.length === 1);
    current.emitFrame({ type: "session-rejected", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "probe" });
    assert.equal((await result).kind, "response");
    old.finishClose();
    assert.equal(old.listenerCount(), 0);
    assert.equal(current.readyState, 1);
  }
  stop(); transport.dispose(); ControlledWebSocket.sockets.at(-1)!.finishClose();
  assert.equal(ControlledWebSocket.sockets.every((socket) => socket.listenerCount() === 0), true);
});

process.stdout.write(`1..${checks}\n`);
events.terminal("pass");

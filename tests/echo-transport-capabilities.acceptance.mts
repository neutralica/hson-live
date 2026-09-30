import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import type { EchoAttachmentEvent, EchoFiniteOperationRequest, EchoReplicaTransport,
  EchoSynchronizationObserver, EchoSynchronizationRequest } from "../src/types/echo.transport.types.ts";
import type { LocusWebSocketLike } from "../src/api/locus/locus.websocket.ts";
import { create_locus_hosted_aggregate_authority_internal } from "../src/api/locus/locus.aggregate.authority.ts";
import { test_public_projection } from "./helpers/hosted-catalog.mts";
import { create_test_event_emitter } from "./test-events.mjs";

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
  await active?.onOutput({ type: "synchronization-failure", error: { message: "new feed" } });
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

process.stdout.write(`1..${checks}\n`);
events.terminal("pass");

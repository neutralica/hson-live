import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_echo_endpoint_internal } from "../src/api/echo/echo.endpoint.ts";
import { create_echo_solo_replica_capability_internal } from "../src/api/echo/echo.solo-replica.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { make_echo_document_authority } from "../src/api/echo/echo.document-authority.ts";
import type { LocusClientMessage } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.replica-capability",
  title: "Echo replica capability lifecycle",
  category: "Echo",
  runtime: "node",
  tags: Object.freeze(["echo", "replica", "recovery", "management", "disposal"]),
});

const testEvents = create_test_event_emitter("echo.replica-capability");
let checks = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    testEvents.diagnostic(name, "assertion", error instanceof Error ? error.message : "Check failed.");
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

await check("solo capability owns management across failure and releases it once terminally", async () => {
  const map = hsonLiveMap.fromJson({ value: 0 });
  const replica = create_echo_solo_replica_capability_internal(map, true);
  assert.throws(() => map.set(["value"], 1), /managed|reserved|controlled/i);
  replica.markFailed(new Error("recoverable"));
  assert.equal(replica.ready, false);
  const ready = replica.waitUntilReady();
  replica.markReady();
  await ready;
  assert.equal(replica.ready, true);
  replica.dispose();
  replica.dispose();
  replica.markReady();
  assert.equal(replica.ready, false);
  assert.doesNotThrow(() => map.set(["value"], 2));
});

await check("aggregate capability owns one complete mirror and cannot revive after disposal", async () => {
  const StateSchema = Hson`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
  const replica = create_echo_aggregate_replica_capability_internal(map);
  assert.throws(() => map.lib("state").at(["value"]).set(1), /managed|reserved|controlled/i);
  replica.markFailed(new Error("recoverable"));
  assert.equal(replica.ready, false);
  replica.markReady();
  assert.equal(replica.ready, true);
  replica.dispose();
  replica.dispose();
  replica.markReady();
  assert.equal(replica.ready, false);
  assert.doesNotThrow(() => map.lib("state").at(["value"]).set(2));
});

await check("replica failure does not destroy a healthy endpoint", async () => {
  const sent: LocusClientMessage[] = [];
  const endpoint = create_echo_endpoint_internal({
    transport: { send: (message) => sent.push(message) },
    sessionRequired: false,
    ids: { actionId: () => "request", actionAttemptId: () => "attempt" },
  });
  const replica = create_echo_solo_replica_capability_internal(hsonLiveMap.fromJson({ value: 0 }), true);
  endpoint.connect();
  replica.markFailed(new Error("replica unavailable"));
  assert.equal(endpoint.ready, true);
  const action = endpoint.action("increment", { by: 1 });
  endpoint.receive({ type: "ack", id: "request", requestId: "request", attemptId: "attempt", ok: true, seq: 1 });
  assert.equal((await action).type, "ack");
  assert.equal(sent.some((message) => message.type === "action"), true);
  endpoint.dispose();
  replica.dispose();
});

await check("terminal replica disposal cancels document revision observers and drains the queue", async () => {
  const map = hsonLiveMap.fromHson("<main/>");
  const replica = create_echo_solo_replica_capability_internal(map, true);
  let revision = 0;
  let dispatches = 0;
  let lowerings = 0;
  const observers = new Set<() => void>();
  const authority = make_echo_document_authority(
    async () => {
      dispatches += 1;
      return Object.freeze({ accepted: true, completionRev: 2 });
    },
    () => revision,
    (listener) => {
      observers.add(listener);
      return () => observers.delete(listener);
    },
    () => replica.ready,
    replica.onDispose,
    replica.waitUntilReady,
  );
  authority.enqueue(() => {
    lowerings += 1;
    return Object.freeze({ name: "document.attrs.clear" as const, payload: { target: { kind: "path" as const, path: [] } } });
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(dispatches, 1);
  assert.equal(authority.pendingRevisionWaits(), 1);
  assert.equal(observers.size, 1);
  replica.dispose();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(authority.pendingRevisionWaits(), 0);
  assert.equal(observers.size, 0);
  revision = 2;
  for (const observer of [...observers]) observer();
  authority.enqueue(() => {
    lowerings += 1;
    return Object.freeze({ name: "document.attrs.clear" as const, payload: { target: { kind: "path" as const, path: [] } } });
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual({ dispatches, lowerings }, { dispatches: 1, lowerings: 1 });
  authority.dispose();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");

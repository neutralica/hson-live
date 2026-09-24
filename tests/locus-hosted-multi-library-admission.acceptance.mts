import { test_public_exposure } from "./helpers/hosted-exposure.mts";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonLocus, type HsonSchema } from "../src/index.ts";
import type { LocusClientActionMessage } from "../src/types/locus.types.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";
import { admit_locus_remote_action_internal } from "../src/api/locus/locus.remote-action.internal.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const ValueSchema: HsonSchema = Hson.schema`<type "data" content <value <number <int true min 0>>>>`;
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.aggregate-admission", title: "Hosted multi-library external admission", category: "Locus", runtime: "node", tags: Object.freeze(["locus", "livemap", "libraries", "actions", "admission"]) });
const testEvents = create_test_event_emitter("locus.aggregate-admission");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  try { await run(); testEvents.case_end(name, "pass"); }
  catch (error) { testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error; }
  checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}
function deferred<T>() { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>((done) => { resolve = done; }); return Object.freeze({ promise, resolve }); }
function make_map() { return hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: ValueSchema }, other: { data: { value: 0 }, schema: ValueSchema } }); }
type TestActions = Readonly<{ cross: Readonly<{ value: number }>; held: number }>;
function message(id: string, name: keyof TestActions, payload: TestActions[keyof TestActions]): LocusClientActionMessage<TestActions> {
  return Object.freeze({ type: "action", id: `${id}-wire`, clientId: `${id}-client`, requestId: `${id}-request`, attemptId: `${id}-attempt`, name, payload }) as LocusClientActionMessage<TestActions>;
}

await check("bound aggregate admission preserves atomic completion, authorization context, dedupe, and cleanup", async () => {
  const map = make_map(); let executions = 0; const sessions: string[] = []; let server!: ReturnType<typeof create_locus_hosted_aggregate_socket_internal<TestActions>>;
  server = create_locus_hosted_aggregate_socket_internal<TestActions>({
    exposure: test_public_exposure(map),
    map,
    authorizeAction(context) {
      sessions.push(context.session.sessionId); assert.equal(context.session.resumable, false);
      assert.equal(context.connection?.principalId, "alice"); assert.deepEqual(context.connection?.attachment, { role: "editor" });
      assert.equal(server.sessions.debug().attachedSessionCount > 0, true); return true;
    },
    actions: { cross: async (context, payload) => {
      executions += 1; const value = (payload?.materialize() as { value: number }).value;
      await context.mutate((draft) => {
        const state = draft.lib("state"), other = draft.lib("other");
        if (!("at" in state) || !("at" in other)) throw new Error("Expected data libraries.");
        state.at(["value"]).set(value); other.at(["value"]).set(value);
      });
      return { accepted: true };
    } },
  });
  const request = message("cross", "cross", { value: 7 });
  const ingress = { connection: { principalId: "alice", attachment: { role: "editor" } } } as const;
  const first = await admit_locus_remote_action_internal<TestActions>(server, { ...ingress, message: request });
  assert.equal(first.type, "ack"); assert.equal(first.delivery, "executed"); assert.equal(first.completionRev, 1); assert.equal(first.seq, 1);
  const cached = await admit_locus_remote_action_internal<TestActions>(server, { ...ingress, message: { ...request, id: "cross-retry", attemptId: "cross-retry-attempt", retry: true } });
  assert.equal(cached.type, "ack"); assert.equal(cached.delivery, "cached"); assert.equal(executions, 1); assert.notEqual(sessions[0], sessions[1]);
  assert.equal(map.lib("state").snap(["value"]), 7); assert.equal(map.lib("other").snap(["value"]), 7);
  assert.equal(server.actionRequests.debug().retainedTerminalCount, 1); assert.equal(server.sessions.debug().sessions.length, 0);
  server.dispose();
});

await check("aggregate whole-action FIFO remains ahead of the common admission seam", async () => {
  const map = make_map(), gate = deferred<void>(), entered: number[] = [];
  const server = create_locus_hosted_aggregate_socket_internal<TestActions>({ exposure: test_public_exposure(map), map, actions: {
    held: async (context, payload) => {
      const value = payload?.scalar(); if (typeof value !== "number") throw new Error("Expected numeric action data.");
      entered.push(value); if (value === 1) await gate.promise;
      await context.mutate((draft) => { const state = draft.lib("state"); if (!("at" in state)) throw new Error("Expected data library."); state.at(["value"]).set(value); });
      return payload;
    },
  } });
  const first = admit_locus_remote_action_internal<TestActions>(server, { message: message("first", "held", 1) });
  await Promise.resolve();
  const second = admit_locus_remote_action_internal<TestActions>(server, { message: message("second", "held", 2) });
  await Promise.resolve(); assert.deepEqual(entered, [1]); gate.resolve();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.completionRev, 1); assert.equal(two.completionRev, 2); assert.deepEqual(entered, [1, 2]); assert.equal(map.lib("state").snap(["value"]), 2);
  assert.equal(server.sessions.debug().sessions.length, 0); server.dispose();
});

await check("aggregate authorization rejection retains no lineage or ephemeral session", async () => {
  const server = create_locus_hosted_aggregate_socket_internal<TestActions>({ exposure: test_public_exposure(make_map()), map: make_map(), authorizeAction: () => false, actions: { held: () => 1 } });
  const result = await admit_locus_remote_action_internal<TestActions>(server, { message: message("denied", "held", 1), connection: { principalId: "alice" } });
  assert.equal(result.type, "error"); if (result.type === "error") assert.equal(result.error.code, "LOCUS_ACTION_FORBIDDEN");
  assert.equal(server.actionRequests.debug().retainedTerminalCount, 0); assert.equal(server.sessions.debug().sessions.length, 0); server.dispose();
});

await check("the internal admission capability remains bound after the normal aggregate Locus facade is created", async () => {
  let locus!: import("../src/types/locus.types.ts").Locus<ReturnType<typeof make_map>, TestActions>;
  locus = hsonLocus.create({
    exposure: test_public_exposure(make_map()),
    map: make_map(),
    authorizeAction: () => { assert.equal(locus.activity.snapshot().retainedSessionCount, 1); return true; },
    actions: { held: (_context, payload) => payload },
  });
  const result = await admit_locus_remote_action_internal<TestActions>(locus, { message: message("facade", "held", 4) });
  assert.equal(result.type, "ack"); if (result.type === "ack") assert.equal(result.result === undefined ? undefined : Hson.data.materialize(result.result), 4);
  assert.equal(locus.sessions.debug().sessions.length, 0); assert.equal(locus.activity.snapshot().retainedSessionCount, 0); locus.dispose();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");

import { test_public_projection } from "./helpers/hosted-exposure.mts";
import assert from "node:assert/strict";
import type { JsonValue } from "../src/core/types.ts";
import { Hson, HsonData, hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { make_echo_document_authority } from "../src/api/echo/echo.document-authority.ts";
import { create_echo_endpoint_internal } from "../src/api/echo/echo.endpoint.ts";
import { create_echo_semantic_connection_internal } from "../src/api/echo/echo.client.ts";
import { create_echo_finite_operation_adapter_internal } from "../src/api/echo/echo.operation.internal.ts";
import { create_echo_synchronization_adapter_internal } from "../src/api/echo/echo.synchronization.internal.ts";
import { create_multi_library_echo_socket_client_internal } from "../src/api/echo/echo.multi-library.socket.ts";
import type {
  EchoHostedAggregateSynchronizationOutput,
} from "../src/api/echo/echo.aggregate-websocket.internal.ts";
import type { LocusHostedAggregateSynchronizationRequest } from "../src/api/locus/locus.hosted-multi-library.transport.internal.ts";
import {
  attach_locus_semantic_transport_internal,
  type LocusCanonicalPublication,
  type LocusFiniteOperationOutcome,
  type LocusSynchronizationOutput,
} from "../src/api/locus/locus.transport.internal.ts";
import {
  create_locus_hosted_aggregate_socket_internal,
} from "../src/api/locus/locus.hosted-multi-library.socket.ts";
import type {
  LocusHostedAggregateCanonicalPublication,
  LocusHostedAggregateSynchronizationOutput,
} from "../src/api/locus/locus.hosted-multi-library.transport.internal.ts";
import type { LocusActionPayloads } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.transport-capabilities",
  title: "Transport-neutral Echo and Locus capabilities",
  category: "Echo",
  runtime: "node",
  tags: Object.freeze(["echo", "locus", "transport-neutral", "operations", "recovery", "session"]),
});

const testEvents = create_test_event_emitter("echo.transport-capabilities");
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

function finite<TType extends LocusFiniteOperationOutcome["type"]>(
  outcomes: readonly LocusFiniteOperationOutcome[],
  type: TType,
): Extract<LocusFiniteOperationOutcome, { type: TType }> {
  const outcome = outcomes.findLast((candidate) => candidate.type === type);
  if (outcome === undefined) throw new Error(`Expected finite ${type} outcome.`);
  return outcome as Extract<LocusFiniteOperationOutcome, { type: TType }>;
}

await check("aggregate authority uses the same operation/synchronization attachment split below socket framing", async () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema } });
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map, actions: { echo: (_context, payload) => payload } });
  const outputs: Array<LocusFiniteOperationOutcome | LocusHostedAggregateSynchronizationOutput | LocusHostedAggregateCanonicalPublication> = [];
  const attachment = server.attach({
    finite: (output) => outputs.push(output),
    synchronization: (output) => outputs.push(output),
    publication: (output) => outputs.push(output),
    event: () => {},
  }, { principalId: "alice" });
  await attachment.operations.submit({ type: "session-create", id: "aggregate-session" });
  const created = outputs.find((output) => output.type === "session-created");
  assert.equal(typeof created?.credential, "string");
  assert.equal(attachment.binding.attached, true);
  const payload = Hson.data.fromHson(Hson.canonical`<'10' -0 '2' <__proto__ <polluted true>> __proto__ <safe true> null null>`);
  await attachment.operations.submit({
    type: "action",
    id: "aggregate-attempt",
    clientId: "aggregate-client",
    requestId: "aggregate-request",
    attemptId: "aggregate-attempt",
    name: "echo",
    payload,
  });
  const acknowledged = finite(outputs.filter((output): output is LocusFiniteOperationOutcome => output.type === "ack" || output.type === "error" || output.type === "action-status" || output.type.startsWith("session-")), "ack");
  assert.equal(acknowledged.result, payload);
  assert.equal(Object.hasOwn(acknowledged, "resultData"), false);
  assert.equal(Object.hasOwn(acknowledged, "format"), false);
  attachment.synchronization.begin({
    type: "recover",
    id: "aggregate-recovery",
    logicalMapId: server.logicalMapId,
  });
  for (let turn = 0; turn < 20 && !outputs.some((output) => output.type === "recovery-caught-up"); turn += 1) {
    await Promise.resolve();
  }
  assert.deepEqual(
    outputs.filter((output) => output.type.startsWith("recovery-")).map((output) => output.type),
    ["recovery-plan", "recovery-snapshot", "recovery-caught-up"],
  );
  await server.mutate((draft) => {
    const state = draft.lib("state");
    if (!("at" in state)) throw new Error("Expected aggregate data library.");
    state.at(["value"]).set(1);
  });
  assert.equal(outputs.some((output) => output.type === "commit"), true);
  attachment.close();
  server.dispose();
});

await check("finite settlement and downstream convergence are independently deliverable", async () => {
  type Actions = LocusActionPayloads & Readonly<{ "document.attrs.clear": HsonData }>;
  let submitted: import("../src/api/echo/echo.operation.internal.ts").EchoFiniteOperationRequest<Actions> | undefined;
  const operationAdapter = create_echo_finite_operation_adapter_internal<Actions>((request) => { submitted = request; });
  const endpoint = create_echo_endpoint_internal<Actions>({
    operations: operationAdapter.capability,
    clientId: "document-client",
    sessionRequired: false,
    ids: { actionId: () => "document-request", actionAttemptId: () => "document-attempt" },
  });
  endpoint.connect();
  let revision = 0;
  const observers = new Set<() => void>();
  const authority = make_echo_document_authority(
    async (action) => {
      const result = await endpoint.action(action.name, Hson.data.from(action.payload));
      return result.type === "ack"
        ? Object.freeze({ accepted: true, completionRev: result.completionRev })
        : Object.freeze({ accepted: false, error: result.error });
    },
    () => revision,
    (listener) => { observers.add(listener); return () => observers.delete(listener); },
    () => true,
    undefined,
    undefined,
    () => ({ logicalMapId: "document-map", incarnationId: "document-incarnation" }),
  );
  let settled = false;
  const pending = authority.enqueue(() => Object.freeze({
    name: "document.attrs.clear" as const,
    payload: { target: { kind: "path" as const, path: [] } },
  }));
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(submitted?.type, "action");
  operationAdapter.deliver({
    type: "ack",
    id: "document-request",
    requestId: "document-request",
    attemptId: "document-attempt",
    ok: true,
    seq: 1,
    completionRev: 1,
    delivery: "executed",
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(revision, 0);
  assert.equal(settled, false);
  assert.equal(authority.pendingRevisionWaits(), 1);
  revision = 1;
  for (const observer of [...observers]) observer();
  await pending;
  assert.equal(settled, true);
  assert.equal(authority.pendingRevisionWaits(), 0);
  authority.dispose();
  endpoint.dispose();
  operationAdapter.clear();
});

await check("internal Echo composition accepts independent capabilities with one semantic binding", async () => {
  const binding = Object.freeze({ authority: "aggregate-test" });
  const operations = create_echo_finite_operation_adapter_internal(() => {}, binding);
  const synchronization = create_echo_synchronization_adapter_internal(() => {}, binding);
  let detachments = 0;
  const connection = create_echo_semantic_connection_internal({
    operations: operations.capability,
    synchronization: synchronization.capability,
    lifecycle: { attach: () => () => { detachments += 1; } },
    clientId: "composed-client",
  });
  connection.echo.connect();
  assert.equal(connection.connected, true);
  connection.echo.disconnect();
  assert.equal(connection.connected, false);
  assert.equal(detachments, 1);
  connection.echo.dispose();

  const mismatchedSynchronization = create_echo_synchronization_adapter_internal(() => {}, Object.freeze({}));
  assert.throws(() => create_echo_semantic_connection_internal({
    operations: operations.capability,
    synchronization: mismatchedSynchronization.capability,
    lifecycle: { attach: () => () => {} },
  }), /one authority\/session binding/u);
  operations.clear();
  synchronization.clear();
  mismatchedSynchronization.clear();
});

await check("aggregate result and publication ingress remain independently orderable", async () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
  const authorityMap = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema } });
  const server = create_locus_hosted_aggregate_socket_internal({
    ...test_public_projection(authorityMap),
    map: authorityMap,
    actions: {
      async set(context, payload) {
        const value = payload?.entries()?.find(([name]) => name === "value")?.[1].scalar();
        if (typeof value !== "number") throw new Error("Expected numeric value.");
        await context.mutate((draft) => {
          const state = draft.lib("state");
          if (!("at" in state)) throw new Error("Expected data library.");
          state.at(["value"]).set(value);
        });
        return payload;
      },
    },
  });
  const binding = Object.freeze({ authority: server });
  let attachment: ReturnType<typeof server.attach> | undefined;
  const operations = create_echo_finite_operation_adapter_internal((request) => { void attachment?.operations.submit(request); }, binding);
  const synchronization = create_echo_synchronization_adapter_internal<
    LocusHostedAggregateSynchronizationRequest,
    EchoHostedAggregateSynchronizationOutput
  >((request) => attachment?.synchronization.begin(request), binding);
  const delayedFinite: LocusFiniteOperationOutcome[] = [];
  const delayedPublications: Array<Extract<EchoHostedAggregateSynchronizationOutput, { type: "commit" | "progress" }>> = [];
  let delayFinite = false;
  let delayPublication = false;
  attachment = server.attach({
    finite(output) { if (delayFinite) delayedFinite.push(output); else operations.deliver(output); },
    synchronization: synchronization.deliver,
    publication(output) { if (delayPublication) delayedPublications.push(output); else synchronization.deliver(output); },
    event: () => {},
  });
  const connection = create_echo_semantic_connection_internal({
    operations: operations.capability,
    synchronization: synchronization.capability,
    lifecycle: { attach: () => () => {} },
    clientId: "aggregate-composed-client",
  });
  const unusedSocket = Object.freeze({ send: () => {}, close: () => {}, onMessage: () => () => {}, onClose: () => () => {} });
  const client = create_multi_library_echo_socket_client_internal({
    socket: unusedSocket,
    logicalMapId: server.logicalMapId,
    connection,
  });
  await client.connect();
  const initialRevision = client.lastAppliedRev;

  delayPublication = true;
  const resultFirst = await client.action("set", { value: 1 });
  assert.equal(resultFirst.type, "ack");
  assert.equal(client.lastAppliedRev, initialRevision);
  synchronization.deliver(delayedPublications.shift()!);
  assert.equal(client.lastAppliedRev, (initialRevision ?? 0) + 1);
  delayPublication = false;

  delayFinite = true;
  const publicationFirst = client.action("set", { value: 2 });
  for (let turn = 0; turn < 20 && delayedFinite.length === 0; turn += 1) await Promise.resolve();
  assert.equal(client.lastAppliedRev, (initialRevision ?? 0) + 2);
  operations.deliver(delayedFinite.shift()!);
  assert.equal((await publicationFirst).type, "ack");

  client.dispose();
  connection.echo.dispose();
  attachment.close();
  server.dispose();
  operations.clear();
  synchronization.clear();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");

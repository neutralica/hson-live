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

await check("finite operations use typed capability delivery without a socket", async () => {
  type Actions = Readonly<{ echo: JsonValue }>;
  const authorizationPrincipals: (string | undefined)[] = [];
  const host = hson.locus.create({
    state: { value: 0 },
    logicalMapId: "semantic-operation-map",
    incarnationId: "semantic-operation-incarnation",
    schema: { actions: { echo: { payload: (value: unknown): value is HsonData | undefined => value === undefined || typeof value === "string" } } },
    authorizeAction(context) {
      authorizationPrincipals.push(context.connection?.principalId);
      return true;
    },
    actions: { echo: (_context, payload) => payload },
  });
  const outcomes: LocusFiniteOperationOutcome[] = [];
  const attachment = attach_locus_semantic_transport_internal<Actions>(host, {
    connection: { principalId: "alice", attachment: Object.freeze({ kind: "test" }) },
    downstream: {
      finite: (outcome) => outcomes.push(outcome),
      synchronization: () => {},
      publication: () => {},
      event: () => {},
    },
  });
  await attachment.operations.submit({ type: "session-create", id: "session-create" });
  const created = finite(outcomes, "session-created");
  assert.equal(attachment.binding.principalId, "alice");
  assert.equal(attachment.binding.sessionId, created.sessionId);
  assert.equal(attachment.binding.attachmentEpoch, created.epoch);
  assert.equal(attachment.binding.attached, true);

  const payload = Hson.data.fromHson(Hson.canonical`<'10' -0 '2' <__proto__ <polluted true>> __proto__ <safe true> tail [0,-0]>`);
  await attachment.operations.submit({
    type: "action",
    id: "attempt-1",
    clientId: "logical-client",
    requestId: "logical-request",
    attemptId: "attempt-1",
    name: "echo",
    payload,
  });
  const first = finite(outcomes, "ack");
  assert.equal(first.requestId, "logical-request");
  assert.equal(first.attemptId, "attempt-1");
  assert.equal(first.delivery, "executed");
  assert.equal(first.completionRev, 0);
  assert.equal(first.result, payload);
  assert.equal(Object.is(first.result === undefined ? undefined : Hson.data.materialize(Hson.data.entries(first.result)?.[0]?.[1]!), -0), true);

  await attachment.operations.submit({
    type: "action",
    id: "attempt-2",
    clientId: "logical-client",
    requestId: "logical-request",
    attemptId: "attempt-2",
    name: "echo",
    payload,
    retry: true,
  });
  const cached = finite(outcomes, "ack");
  assert.equal(cached.requestId, "logical-request");
  assert.equal(cached.attemptId, "attempt-2");
  assert.equal(cached.delivery, "cached");

  await attachment.operations.submit({
    type: "action-status",
    id: "status-1",
    clientId: "logical-client",
    requestId: "logical-request",
  });
  const status = finite(outcomes, "action-status");
  assert.equal(status.state, "succeeded");
  assert.equal(status.outcome?.completionRev, 0);
  assert.equal(status.outcome?.state === "succeeded" && status.outcome.result === payload, true);
  assert.deepEqual(authorizationPrincipals, ["alice", "alice"]);
  attachment.close();
  host.dispose();
});

await check("typed synchronization preserves recovery cut, tail, caught-up, live delivery, and cancellation", async () => {
  const host = hson.locus.create({
    state: { value: 0 },
    logicalMapId: "semantic-sync-map",
    incarnationId: "semantic-sync-incarnation",
  });
  const base = host.stream.headRev;
  await host.mutate((draft) => draft.set(["value"], 1));
  const synchronization: LocusSynchronizationOutput[] = [];
  const publications: LocusCanonicalPublication[] = [];
  let injected: Promise<unknown> | undefined;
  const attachment = attach_locus_semantic_transport_internal(host, {
    connection: { principalId: "alice" },
    downstream: {
      finite: () => {},
      synchronization: (output) => {
        synchronization.push(output);
        if (output.type === "recovery-plan" && injected === undefined) {
          injected = host.mutate((draft) => draft.set(["value"], 2));
        }
      },
      publication: (publication) => publications.push(publication),
      event: () => {},
    },
  });
  await attachment.operations.submit({ type: "session-create", id: "session-create" });
  attachment.synchronization.begin({
    type: "recover",
    id: "recover-1",
    logicalMapId: host.stream.logicalMapId,
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: base,
    snapshotCapabilities: { hson: true, viewState: true },
  });
  await injected;
  await Promise.resolve();
  const plan = synchronization.find((output) => output.type === "recovery-plan");
  const commits = synchronization.filter((output): output is Extract<LocusSynchronizationOutput, { type: "recovery-commit" }> => output.type === "recovery-commit");
  const caught = synchronization.find((output) => output.type === "recovery-caught-up");
  assert.equal(plan?.type === "recovery-plan" && plan.outcome, "replay");
  assert.deepEqual(commits.map((output) => [output.phase, output.commit.rev]), [["body", base + 1], ["tail", base + 2]]);
  assert.equal(caught?.type === "recovery-caught-up" && caught.caughtUp.throughRev, base + 2);

  await host.mutate((draft) => draft.set(["value"], 3));
  assert.deepEqual(publications.map((output) => output.commit.rev), [base + 3]);
  attachment.synchronization.cancel();
  await host.mutate((draft) => draft.set(["value"], 4));
  assert.deepEqual(publications.map((output) => output.commit.rev), [base + 3]);
  attachment.close();
  host.dispose();
});

await check("semantic session survives attachment replacement and fences the stale attachment", async () => {
  const host = hson.locus.create({ state: {}, logicalMapId: "binding-map", incarnationId: "binding-incarnation", sessions: {} });
  const firstOutcomes: LocusFiniteOperationOutcome[] = [];
  const secondOutcomes: LocusFiniteOperationOutcome[] = [];
  const first = attach_locus_semantic_transport_internal(host, {
    connection: { principalId: "alice" },
    downstream: { finite: (value) => firstOutcomes.push(value), synchronization: () => {}, publication: () => {}, event: () => {} },
  });
  await first.operations.submit({ type: "session-create", id: "create" });
  const created = finite(firstOutcomes, "session-created");
  const second = attach_locus_semantic_transport_internal(host, {
    connection: { principalId: "alice" },
    downstream: { finite: (value) => secondOutcomes.push(value), synchronization: () => {}, publication: () => {}, event: () => {} },
  });
  await second.operations.submit({ type: "session-attach", id: "attach", credential: created.credential });
  const attached = finite(secondOutcomes, "session-attached");
  assert.equal(attached.sessionId, created.sessionId);
  assert.equal(attached.epoch, created.epoch + 1);
  assert.equal(firstOutcomes.some((outcome) => outcome.type === "session-fenced"), true);
  assert.equal(first.binding.attached, false);
  assert.equal(second.binding.attached, true);
  assert.equal(second.binding.logicalMapId, first.binding.logicalMapId);
  assert.equal(second.binding.incarnationId, first.binding.incarnationId);
  first.close();
  second.close();
  host.dispose();
});

await check("aggregate authority uses the same operation/synchronization attachment split below socket framing", async () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema } });
  const server = create_locus_hosted_aggregate_socket_internal({ map, actions: { echo: (_context, payload) => payload } });
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
  const delayedPublications: Array<Extract<EchoHostedAggregateSynchronizationOutput, { type: "commit" }>> = [];
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

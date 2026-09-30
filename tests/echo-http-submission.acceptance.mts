import assert from "node:assert/strict";
import { hsonEcho } from "../src/index.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.aggregate.protocol.ts";
import type { EchoAttachmentEvent, EchoFiniteOperationRequest } from "../src/types/echo.transport.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http-submission", title: "HTTP finite submission classification", category: "Echo", runtime: "node",
  tags: Object.freeze(["echo", "http", "submission", "uncertainty"]),
});
const events = create_test_event_emitter("echo.http-submission");
events.case_begin("classifications", "HTTP admission proof and response loss remain distinct");
const created = { type: "session-created", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
  id: "create", sessionId: "session", credential: "credential", epoch: 1,
  logicalMapId: "map", incarnationId: "incarnation" };
const status = { type: "action-status", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
  id: "status", requestId: "request", state: "unknown" };
const statusRequest = { type: "action-status" as const, id: "status", clientId: "client", requestId: "request" };
let mode: "ok" | "host-denied" | "capability-denied" | "lost" = "ok";
let sent = 0;
let lastHeader: string | null = null;
const fetcher: typeof fetch = async (input, init) => {
  if (String(input).endsWith("/sync")) return new Response(null, { status: 503 });
  sent += 1;
  lastHeader = new Headers(init?.headers).get("x-hson-attachment");
  const request = JSON.parse(String(init?.body)) as { type: string };
  if (request.type === "session-create") return new Response(JSON.stringify(created), {
    headers: { "content-type": "application/json", "x-hson-attachment": "a".repeat(64) },
  });
  if (mode === "lost") throw new TypeError("response lost after possible admission");
  if (mode === "host-denied") return new Response(null, { status: 403 });
  if (mode === "capability-denied") return new Response(null, { status: 403,
    headers: { "x-hson-attachment-state": "invalid" } });
  return new Response(JSON.stringify(status), { headers: { "content-type": "application/json" } });
};
const transport = hsonEcho.transport.http({ endpoint: "https://example.test/_hson", fetch: fetcher });
try {
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await transport.operations.submit({ type: "session-create", id: "create" },
    { signal: aborted.signal })).kind, "not-submitted");
  assert.equal(sent, 0);
  const malformed = { type: "action", id: "malformed", name: "act", clientId: "client",
    requestId: "request", attemptId: "attempt", payload: { invalid: () => {} } };
  assert.equal((await transport.operations.submit(malformed as unknown as EchoFiniteOperationRequest)).kind, "not-submitted");
  assert.equal(sent, 0);
  assert.equal((await transport.operations.submit({ type: "session-create", id: "create" })).kind, "response");
  const eventsSeen: EchoAttachmentEvent["kind"][] = [];
  const stop = transport.attachment.observe((event) => { eventsSeen.push(event.kind); });
  mode = "host-denied";
  assert.equal((await transport.operations.submit(statusRequest)).kind, "not-submitted");
  assert.equal(lastHeader, "a".repeat(64));
  assert.deepEqual(eventsSeen, ["available"], "host authentication failure does not fence attachment");
  mode = "lost";
  assert.equal((await transport.operations.submit(statusRequest)).kind, "uncertain");
  assert.deepEqual(eventsSeen, ["available"], "finite response loss does not interrupt attachment");
  mode = "ok";
  assert.equal((await transport.operations.submit(statusRequest)).kind, "response");
  mode = "capability-denied";
  assert.equal((await transport.operations.submit(statusRequest)).kind, "not-submitted");
  assert.deepEqual(eventsSeen.slice(0, 3), ["available", "fenced", "observation-interrupted"]);
  assert.equal((await transport.operations.submit(statusRequest)).kind, "not-submitted");
  stop();
} finally { transport.dispose(); }

let createAttempts = 0;
const lostCreate = hsonEcho.transport.http({ endpoint: "https://example.test/_hson", fetch: async () => {
  createAttempts += 1;
  throw new TypeError("connection reset after send");
} });
try {
  assert.equal((await lostCreate.operations.submit({ type: "session-create", id: "lost-create" })).kind, "uncertain");
  assert.equal(createAttempts, 1, "uncertain create is not repeated");
} finally { lostCreate.dispose(); }
let invalidEndpointFetches = 0;
const invalidEndpoint = hsonEcho.transport.http({ endpoint: "://invalid", fetch: async () => {
  invalidEndpointFetches += 1;
  throw new Error("Fetch must not run when Request construction fails.");
} });
try {
  assert.equal((await invalidEndpoint.operations.submit({ type: "session-create", id: "invalid-endpoint" })).kind, "not-submitted");
  assert.equal(invalidEndpointFetches, 0);
} finally { invalidEndpoint.dispose(); }
events.case_end("classifications", "pass");
events.terminal("pass");

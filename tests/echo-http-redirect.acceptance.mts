import assert from "node:assert/strict";
import { createServer } from "node:http";
import { hsonEcho } from "../src/index.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.aggregate.protocol.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http-redirect", title: "HTTP Echo rejects credential and capability redirects",
  category: "Echo", runtime: "node-real-http1", tags: Object.freeze(["echo", "http", "security", "redirect"]),
});
const events = create_test_event_emitter("echo.http-redirect");
events.case_begin("redirects", "307 and 308 never forward sensitive HTTP Echo requests");

let redirectedRequests = 0;
let redirectStatus = 307;
let crossOrigin = false;
let crossUrl = "";
const redirected = createServer((_request, response) => {
  redirectedRequests += 1;
  response.writeHead(200, { connection: "close" });
  response.end();
});
const source = createServer(async (request, response) => {
  if (request.url === "/redirected") {
    redirectedRequests += 1;
    response.writeHead(200, { connection: "close" });
    response.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { type: string; id?: string };
  if (message.type === "session-create" && message.id === "bootstrap") {
    response.writeHead(200, { "content-type": "application/json", "x-hson-attachment": "a".repeat(64), connection: "close" });
    response.end(JSON.stringify({ type: "session-created", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id: "bootstrap", sessionId: "session", credential: "retained-secret", epoch: 1,
      logicalMapId: "map", incarnationId: "incarnation" }));
    return;
  }
  response.writeHead(redirectStatus, { location: crossOrigin ? crossUrl : "/redirected", connection: "close" });
  response.end();
});
const listen = (server: typeof source): Promise<number> => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
});
const otherPort = await listen(redirected);
const sourcePort = await listen(source);
crossUrl = `http://127.0.0.1:${otherPort}/redirected`;
const endpoint = `http://127.0.0.1:${sourcePort}/_hson`;
const originalSetInterval = globalThis.setInterval;
let heartbeatTick: (() => void) | undefined;
globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
  if (delay === 30_000) {
    heartbeatTick = () => callback(...args);
    const timer = originalSetInterval(() => {}, 1_000_000);
    timer.unref?.();
    return timer;
  }
  return originalSetInterval(callback, delay, ...args);
}) as typeof globalThis.setInterval;
try {
  for (const status of [307, 308]) for (const across of [false, true]) {
    redirectStatus = status;
    crossOrigin = across;
    const transport = hsonEcho.transport.http({ endpoint });
    try {
      assert.equal((await transport.operations.submit({ type: "session-create", id: "bootstrap" })).kind, "response");
      assert.equal((await transport.operations.submit({ type: "session-create", id: "redirect-create" })).kind, "uncertain");
      assert.equal((await transport.operations.submit({ type: "session-attach", id: "redirect-attach",
        credential: "retained-secret" })).kind, "uncertain");
      assert.equal((await transport.operations.submit({ type: "action-status", id: "status",
        clientId: "client", requestId: "request" })).kind, "uncertain");
      await assert.rejects(transport.synchronization.open({ type: "recover", id: "sync", logicalMapId: "map" },
        { onOutput() {}, onEnd() {} }));
      assert.ok(heartbeatTick);
      heartbeatTick();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(redirectedRequests, 0, `${status} ${across ? "cross-origin" : "same-origin"} forwarded a request`);
    } finally { transport.dispose(); }
  }
} finally {
  globalThis.setInterval = originalSetInterval;
  source.closeAllConnections();
  redirected.closeAllConnections();
  await Promise.all([new Promise<void>((resolve) => source.close(() => resolve())),
    new Promise<void>((resolve) => redirected.close(() => resolve()))]);
}
events.case_end("redirects", "pass");
events.terminal("pass");

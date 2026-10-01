import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { once } from "node:events";
import { bind_locus_http, hsonEcho, hsonLiveMap, hsonLocus } from "../src/index.ts";
import { start_node_application_host } from "../src/api/livehost/node/livehost.node-application-host.ts";
import type { LiveHostApplication } from "../src/types/livehost.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http2", title: "Echo HTTP/2 multiplexed semantic transport", category: "Echo", runtime: "node-real-http2",
  tags: Object.freeze(["echo", "http2", "locus", "stream", "node-host"]),
});
const events = create_test_event_emitter("echo.http2");
events.case_begin("multiplex", "HTTP/2 stream and independent finite request");

const cert = await readFile(new URL("./fixtures/livehost-tls/cert.pem", import.meta.url));
const key = await readFile(new URL("./fixtures/livehost-tls/key.pem", import.meta.url));
const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
const locus = hsonLocus.create({ map, libraries: [{ name: "state", ownership: "shared" }],
  defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
const binding = bind_locus_http(locus, { endpoint: "/_hson" });
let releaseFinite: (() => void) | undefined;
let finiteEntered: (() => void) | undefined;
let enteredFinite = new Promise<void>((resolve) => { finiteEntered = resolve; });
let holdFinite = false;
const application: LiveHostApplication = {
  name: "echo-h2",
  requests: ["/_hson", "/_hson/sync"].map((path) => ({ method: "POST", path,
    async handle(request, context) {
      if (holdFinite && path === "/_hson" && (await request.clone().text()).includes('"id":"h2-inflight"')) {
        finiteEntered?.();
        await new Promise<void>((resolve) => { releaseFinite = resolve; });
      }
      return binding.handle(request, { principalId: context.principal.id });
    } })),
  dispose() { binding.dispose(); },
};
const host = await start_node_application_host({ port: 0, http2: { key, cert }, applications: [application] });
const session: ClientHttp2Session = connect(host.httpUrl, { ca: cert, servername: "localhost" });
await once(session, "connect");
assert.equal(session.alpnProtocol, "h2");
let cancelSync: (() => void) | undefined;
let syncOpenCount = 0;

const fetchH2: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  const outgoing: Record<string, string> = { ":path": url.pathname, ":method": init?.method ?? "GET" };
  headers.forEach((value, name) => { outgoing[name] = value; });
  if (init?.signal?.aborted) throw init.signal.reason;
  return new Promise<Response>((resolve, reject) => {
    const request = session.request(outgoing);
    if (url.pathname.endsWith("/sync") && typeof init?.body === "string"
      && JSON.parse(init.body).type === "recover") {
      syncOpenCount += 1;
      cancelSync = () => request.close(constants.NGHTTP2_CANCEL);
    }
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let settled = false;
    const body = new ReadableStream<Uint8Array>({
      start(target) { controller = target; },
      cancel() { request.close(constants.NGHTTP2_CANCEL); },
    });
    const abort = () => request.close(constants.NGHTTP2_CANCEL);
    init?.signal?.addEventListener("abort", abort, { once: true });
    request.on("response", (received) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(received)) {
        if (name.startsWith(":") || value === undefined) continue;
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else responseHeaders.set(name, String(value));
      }
      settled = true;
      resolve(new Response(body, { status: Number(received[":status"]), headers: responseHeaders }));
    });
    request.on("data", (chunk: Buffer) => {
      try { controller?.enqueue(new Uint8Array(chunk)); } catch { /* Consumer cancelled. */ }
    });
    request.on("end", () => {
      init?.signal?.removeEventListener("abort", abort);
      try { controller?.close(); } catch { /* Consumer cancelled. */ }
    });
    request.on("error", (cause) => {
      init?.signal?.removeEventListener("abort", abort);
      if (!settled) reject(cause);
      else { try { controller?.error(cause); } catch { /* Consumer cancelled. */ } }
    });
    request.on("close", () => {
      init?.signal?.removeEventListener("abort", abort);
      if (!settled) reject(new Error("HTTP/2 finite stream closed before response."));
    });
    request.end(typeof init?.body === "string" ? init.body : undefined);
  });
};

const transport = hsonEcho.transport.http({ endpoint: `${host.httpUrl}/_hson`, fetch: fetchH2 });
try {
  const retained = await locus.session.create({ libraries: ["state"] },
    { connection: { principalId: "development-anonymous" } });
  const replica = await hsonEcho.create({ now: retained.now(), credential: retained.credential!, transport });
  assert.equal(replica.sync.status, "caught_up");
  const status = await transport.operations.submit({ type: "action-status", id: "h2-status", clientId: "client", requestId: "unknown" });
  assert.equal(status.kind, "response", "finite request completes beside continuing sync stream");
  const aborted = new AbortController();
  aborted.abort();
  const failed = await transport.operations.submit({ type: "action-status", id: "h2-cancelled",
    clientId: "client", requestId: "unknown" }, { signal: aborted.signal });
  assert.equal(failed.kind, "not-submitted");
  await locus.stage((draft) => {
    const state = draft.lib("state");

    state.at(["value"]).set(1);
  });
  for (let i = 0; i < 100 && replica.sync.debug().lastAppliedRev !== locus.rev; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(replica.sync.debug().lastAppliedRev, locus.rev, "finite cancellation leaves sync alive");
  holdFinite = true;
  const inFlightAbort = new AbortController();
  const inFlight = transport.operations.submit({ type: "action-status", id: "h2-inflight",
    clientId: "client", requestId: "unknown" }, { signal: inFlightAbort.signal });
  await enteredFinite;
  inFlightAbort.abort();
  releaseFinite?.();
  assert.equal((await inFlight).kind, "uncertain", "in-flight finite cancellation cannot prove non-submission");
  await locus.stage((draft) => {
    const state = draft.lib("state");

    state.at(["value"]).set(2);
  });
  for (let i = 0; i < 100 && replica.sync.debug().lastAppliedRev !== locus.rev; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(replica.sync.debug().lastAppliedRev, locus.rev, "in-flight finite cancellation leaves sync alive");
  const epoch = replica.session.epoch;
  holdFinite = true;
  enteredFinite = new Promise<void>((resolve) => { finiteEntered = resolve; });
  const sibling = transport.operations.submit({ type: "action-status", id: "h2-inflight",
    clientId: "client", requestId: "unknown" });
  await enteredFinite;
  cancelSync?.();
  releaseFinite?.();
  assert.equal((await sibling).kind, "response", "sync cancellation leaves in-flight finite work independent");
  holdFinite = false;
  const afterCancellation = await transport.operations.submit({ type: "action-status", id: "h2-after-sync",
    clientId: "client", requestId: "unknown" });
  assert.equal(afterCancellation.kind, "response", "stream cancellation leaves sibling finite request usable");
  for (let i = 0; i < 100 && (syncOpenCount < 2 || replica.sync.status !== "caught_up"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(syncOpenCount >= 2);
  assert.equal(replica.session.epoch, epoch);
  replica.dispose();
} finally {
  transport.dispose();
  session.close();
  await host.dispose();
  locus.dispose();
}
events.case_end("multiplex", "pass");
events.terminal("pass");

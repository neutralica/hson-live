// @hson-live-external-test
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { connect as connect_h2, constants as h2_constants, type ClientHttp2Session, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http2";
import { request as https_request } from "node:https";
import WebSocket from "ws";
import type { LiveHostApplication } from "hson-live/livehost";
import { start_node_application_host, create_node_exact_origin_policy, type NodeRequestContext, type NodeApplicationSecurity, type NodePolicyResult } from "hson-live/livehost/node";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livehost.node-http2", title: "LiveHost secure HTTP/2", category: "LiveHost",
  runtime: "node-real-http2", tags: Object.freeze(["transport", "http2", "websocket", "node-host", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livehost.node-http2");
let checks = 0;
let sequence = Promise.resolve();

function check(name: string, run: () => void | Promise<void>): void {
  sequence = sequence.then(async () => {

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
  });
}

function socket_close(websocket: WebSocket): Promise<number> {
  return new Promise((resolve) => websocket.once("close", (code) => resolve(code)));
}

function next_message(websocket: WebSocket): Promise<WebSocket.RawData> {
  return new Promise((resolve) => websocket.once("message", resolve));
}

function deferred<T = void>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(cause?: unknown): void;
}> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return Object.freeze({ promise, resolve, reject });
}

function production_security(
  contexts: NodeRequestContext[] = [],
  token = "correct-horse-battery-staple",
): NodeApplicationSecurity {
  const security: NodeApplicationSecurity = {
    origin: create_node_exact_origin_policy({ allowedOrigins: ["https://public.example"] }),
    authenticate(context) {
      contexts.push(context);
      return context.headers.get("authorization") === `Bearer ${token}`
        ? { ok: true, value: Object.freeze({ id: "principal-a", anonymous: false, value: { role: "tester" } }) }
        : { ok: false, status: 401, code: "AUTH_REQUIRED" };
    },
    authorize: (): NodePolicyResult<void> => ({ ok: true, value: undefined }),
  };
  return Object.freeze(security);
}

const secureHeaders = Object.freeze({
  Origin: "https://public.example",
  Authorization: "Bearer correct-horse-battery-staple",
});

const tls = {
  key: await readFile(new URL("./fixtures/livehost-tls/key.pem", import.meta.url)),
  cert: await readFile(new URL("./fixtures/livehost-tls/cert.pem", import.meta.url)),
};

async function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("HTTP/2 test timed out")), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

function h2_result(session: ClientHttp2Session, path: string, method = "GET", body?: string,
  extra: OutgoingHttpHeaders = {}): Promise<{ headers: IncomingHttpHeaders; body: string }> {
  return within(new Promise((resolve, reject) => {
    const request = session.request({ ":path": path, ":method": method, ...extra }, {
      endStream: body === undefined,
    });
    let headers: IncomingHttpHeaders = {};
    const chunks: Buffer[] = [];
    request.on("response", (value) => { headers = value; });
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve({ headers, body: Buffer.concat(chunks).toString() }));
    if (body !== undefined) request.end(body);
  }));
}

check("secure HTTP/2 shares Web request/response adaptation and HTTP/1 fallback", async () => {
  const observed: NodeRequestContext[] = [];
  const application: LiveHostApplication = {
    name: "h2-adaptation",
    requests: ["GET", "POST"].map((method) => ({
      method, path: "/adapt",
      async handle(request: Request) {
        assert.equal([...request.headers.keys()].some((key) => key.startsWith(":")), false);
        const headers = new Headers({ "x-ordinary": "preserved", "content-type": "application/json" });
        headers.append("set-cookie", "first=one; Path=/");
        headers.append("set-cookie", "second=two; Path=/");
        return new Response(JSON.stringify({ url: request.url, method: request.method, body: await request.text() }), {
          status: 201, headers,
        });
      },
    })),
    dispose() {},
  };
  const host = await start_node_application_host({ port: 0, http2: tls, applications: [application],
    security: new Map([[application.name, {
      origin(context) { observed.push(context); return { ok: true, value: undefined }; },
      authenticate() { return { ok: true, value: { anonymous: true } }; },
      authorize() { return { ok: true, value: undefined }; },
    }]]),
  });
  const session = connect_h2(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  try {
    await within(once(session, "connect"));
    assert.equal(session.alpnProtocol, "h2");
    assert.equal(host.httpUrl, `https://127.0.0.1:${host.port}`);
    assert.equal(host.url, `wss://127.0.0.1:${host.port}`);
    for (const body of [undefined, "posted without content-length"]) {
      const method = body === undefined ? "GET" : "POST";
      const result = await h2_result(session, "/adapt?q=one%20two", method, body, { ":authority": new URL(host.httpUrl).host });
      assert.equal(result.headers[":status"], 201);
      assert.equal(result.headers["x-ordinary"], "preserved");
      assert.deepEqual(result.headers["set-cookie"], ["first=one; Path=/", "second=two; Path=/"]);
      assert.deepEqual(JSON.parse(result.body), { url: `${host.httpUrl}/adapt?q=one%20two`, method, body: body ?? "" });
    }
    const fallback = await within(new Promise<string>((resolve, reject) => {
      const request = https_request(`${host.httpUrl}/adapt?q=one%20two`, { ca: tls.cert, servername: "localhost" }, (response) => {
        assert.equal(response.httpVersion, "1.1");
        assert.equal(response.statusCode, 201);
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString()));
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    }));
    assert.deepEqual(JSON.parse(fallback), { url: `${host.httpUrl}/adapt?q=one%20two`, method: "GET", body: "" });
    assert.ok(observed.every((context) => context.rawScheme === "https" && context.effectiveOrigin === host.httpUrl));
  } finally { session.destroy(); await host.dispose(); }
});

check("HTTP/2 filters connection-specific and Connection-nominated response headers", async () => {
  const host = await start_node_application_host({ port: 0, http2: tls, applications: [{
    name: "h2-headers", requests: [{ method: "GET", path: "/headers", handle() {
      return new Response("ok", { headers: {
        connection: "keep-alive, x-hop", "keep-alive": "timeout=5", "proxy-connection": "keep-alive",
        "transfer-encoding": "chunked", upgrade: "websocket", te: "trailers", "x-hop": "omit", "x-end": "keep",
      } });
    } }], dispose() {},
  }] });
  const session = connect_h2(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  try {
    const result = await h2_result(session, "/headers");
    assert.equal(result.headers[":status"], 200);
    assert.equal(result.body, "ok");
    for (const name of ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "x-hop"]) {
      assert.equal(result.headers[name], undefined, name);
    }
    assert.equal(result.headers["x-end"], "keep");
  } finally { session.destroy(); await host.dispose(); }
});

check("HTTP/2 incrementally streams, cancels independently, and settles active sessions on disposal", async () => {
  const canceled = [deferred<void>(), deferred<void>()];
  let opened = 0;
  const host = await start_node_application_host({ port: 0, http2: tls, applications: [{
    name: "h2-streams", requests: [{ method: "GET", path: "/stream", handle() {
      const index = opened++;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode(`first-${index}`)); },
        cancel() { canceled[index]?.resolve(undefined); },
      }));
    } }, { method: "GET", path: "/sibling", handle() { return new Response("sibling alive"); } }], dispose() {},
  }] });
  const session = connect_h2(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  try {
    const first = session.request({ ":path": "/stream" });
    assert.equal(String((await within(once(first, "data")))[0]), "first-0");
    const second = session.request({ ":path": "/stream" });
    assert.equal(String((await within(once(second, "data")))[0]), "first-1");
    first.close(h2_constants.NGHTTP2_CANCEL);
    await within(canceled[0]!.promise);
    assert.equal(second.closed, false);
    assert.equal((await h2_result(session, "/sibling")).body, "sibling alive");
    assert.equal(session.destroyed, false);
    const closed = once(session, "close");
    await within(host.dispose());
    await within(Promise.all([closed, canceled[1]!.promise]));
    assert.equal(second.closed, true);
  } finally { session.destroy(); await host.dispose(); }
});

check("secure WebSocket upgrades remain HTTP/1 and expose HTTPS application requests", async () => {
  let requestUrl = "";
  const host = await start_node_application_host({ port: 0, http2: tls, applications: [{
    name: "h2-websocket", connections: [{ path: "/socket", accept(request, connection) {
      requestUrl = request.url;
      connection.onMessage((data) => connection.send(data));
    } }], dispose() {},
  }] });
  const websocket = new WebSocket(`${host.url}/socket?q=1`, { ca: tls.cert });
  try {
    await within(once(websocket, "open"));
    const reply = next_message(websocket);
    websocket.send("secure echo");
    assert.equal((await within(reply)).toString(), "secure echo");
    assert.equal(requestUrl, `${host.httpUrl}/socket?q=1`);
    const closed = socket_close(websocket);
    await within(host.dispose());
    assert.equal(await within(closed), 1001);
  } finally { websocket.terminate(); await host.dispose(); }
});

check("HTTP/2 preserves URL/header limits, security rejection and bodyless GET policy", async () => {
  const host = await start_node_application_host({ port: 0, http2: tls,
    deployment: { mode: "production", limits: { maxUrlBytes: 80, maxHeaderValueBytes: 128 } },
    security: new Map([["h2-policy", production_security()]]), applications: [{
      name: "h2-policy", requests: [{ method: "GET", path: "/policy", handle() { return new Response("allowed"); } }], dispose() {},
    }],
  });
  const session = connect_h2(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  try {
    assert.equal((await h2_result(session, "/policy")).headers[":status"], 403);
    assert.equal((await h2_result(session, "/policy", "GET", undefined, secureHeaders)).body, "allowed");
    assert.equal((await h2_result(session, "/policy", "GET", "body", secureHeaders)).headers[":status"], 400);
    assert.equal((await h2_result(session, `/policy?${"x".repeat(100)}`)).headers[":status"], 413);
    assert.equal((await h2_result(session, "/policy", "GET", undefined, { "x-large": "x".repeat(200) })).headers[":status"], 413);
  } finally { session.destroy(); await host.dispose(); }
});

check("HTTP/2 response backpressure bounds pulling and resumes without losing bytes", async () => {
  let pulls = 0;
  const total = 512;
  const chunk = new Uint8Array(16 * 1024).fill(97);
  const host = await start_node_application_host({ port: 0, http2: tls, applications: [{
    name: "h2-pressure", requests: [{ method: "GET", path: "/pressure", handle() {
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
          if (pulls === total) controller.close();
        },
      }));
    } }], dispose() {},
  }] });
  const session = connect_h2(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  try {
    const request = session.request({ ":path": "/pressure" });
    request.pause();
    await within(once(request, "response"));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.ok(pulls > 0 && pulls < total, `Expected bounded pulling, received ${pulls}`);
    let bytes = 0;
    request.on("data", (data: Buffer) => { bytes += data.length; assert.ok(data.every((byte) => byte === 97)); });
    const ended = once(request, "end");
    request.resume();
    await within(ended);
    assert.equal(bytes, total * chunk.length);
    assert.equal(pulls, total);
  } finally { session.destroy(); await host.dispose(); }
});

check("HTTP/2 HEAD omits and cancels the application response body", async () => {
  const canceled = deferred<void>();
  const host = await start_node_application_host({ port: 0, http2: tls, applications: [{
    name: "h2-head", requests: [{ method: "HEAD", path: "/head", handle() {
      return new Response(new ReadableStream<Uint8Array>({ cancel() { canceled.resolve(undefined); } }), {
        status: 202, headers: { "x-head": "preserved" },
      });
    } }], dispose() {},
  }] });
  const session = connect_h2(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  try {
    const result = await h2_result(session, "/head", "HEAD");
    assert.equal(result.body, "");
    assert.equal(result.headers[":status"], 202);
    assert.equal(result.headers["x-head"], "preserved");
    await within(canceled.promise);
  } finally { session.destroy(); await host.dispose(); }
});

check("HTTP/2 ingress timeout cancels only stalled uploads, not completed unread bodies", async () => {
  const cancellations = [deferred<void>(), deferred<void>()];
  let opened = 0;
  const host = await start_node_application_host({ port: 0, http2: tls,
    deployment: { mode: "production", limits: { requestTimeoutMs: 80 } },
    security: new Map([["h2-upload", production_security()]]), applications: [{
      name: "h2-upload", requests: [{ method: "POST", path: "/upload", handle() {
        const index = opened++;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode("open")); },
          cancel() { cancellations[index]?.resolve(undefined); },
        }));
      } }], dispose() {},
    }],
  });
  const session = connect_h2(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  try {
    const completed = session.request({ ":method": "POST", ":path": "/upload", ...secureHeaders });
    const firstData = once(completed, "data");
    completed.end("completed body deliberately left unread by application");
    await within(firstData);
    const stalled = session.request({ ":method": "POST", ":path": "/upload", ...secureHeaders });
    await within(once(stalled, "data"));
    await within(cancellations[1]!.promise);
    assert.equal(completed.closed, false);
    assert.equal((await h2_result(session, "/healthz")).headers[":status"], 200);
    completed.close(h2_constants.NGHTTP2_CANCEL);
    await within(cancellations[0]!.promise);
  } finally { session.destroy(); await host.dispose(); }
});

check("invalid TLS startup rejects and disposes its application once", async () => {
  let disposed = 0;
  await assert.rejects(start_node_application_host({ port: 0, http2: { key: "invalid", cert: "invalid" },
    applications: [{ name: "invalid-tls", dispose() { disposed += 1; } }],
  }));
  assert.equal(disposed, 1);
});

await sequence;
process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");

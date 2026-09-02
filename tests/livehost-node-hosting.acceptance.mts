import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as node_request } from "node:http";
import { create_locus, type LocusSocketLike } from "hson-live/locus";
import type {
  LiveHostApplication,
  LiveHostApplicationContext,
  LiveHostConnection,
  LiveHostPrincipal,
} from "hson-live/livehost";
import {
  assert_supported_livehost_node_runtime,
  create_node_exact_origin_policy,
  is_supported_livehost_node_runtime,
  start_node_application_host,
  type NodeApplicationSecurity,
  type NodeHostOperationalEvent,
  type NodePolicyResult,
  type NodeRequestContext,
} from "hson-live/livehost/node";
import WebSocket from "ws";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livehost.node-hosting",
  title: "LiveHost Node hosting",
  category: "LiveHost",
  runtime: "node-real-websocket",
  tags: Object.freeze(["transport", "websocket", "node-host", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livehost.node-hosting");
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

function open_websocket(url: string, headers?: Readonly<Record<string, string>>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url, { headers });
    websocket.once("open", () => resolve(websocket));
    websocket.once("error", reject);
  });
}

function rejected_websocket_status(url: string, headers?: Readonly<Record<string, string>>): Promise<number> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url, { headers });
    websocket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      response.resume();
    });
    websocket.once("open", () => {
      websocket.close();
      reject(new Error("WebSocket unexpectedly opened."));
    });
    websocket.once("error", () => undefined);
  });
}

function socket_close(websocket: WebSocket): Promise<number> {
  return new Promise((resolve) => websocket.once("close", (code) => resolve(code)));
}

function next_message(websocket: WebSocket): Promise<WebSocket.RawData> {
  return new Promise((resolve) => websocket.once("message", resolve));
}

function raw_http_status(url: string, method: string, body?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = node_request(url, {
      method,
      headers: body === undefined ? {} : { "content-length": Buffer.byteLength(body) },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end(body);
  });
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

async function failed_connection_code(url: string): Promise<number> {
  const websocket = new WebSocket(url);
  const closed = socket_close(websocket);
  await new Promise<void>((resolve, reject) => {
    websocket.once("open", resolve);
    websocket.once("error", reject);
  });
  return closed;
}

function echo_application(
  name: string,
  requestPath: string,
  connectionPath?: string,
  dispose?: () => void | Promise<void>,
): LiveHostApplication {
  return Object.freeze({
    name,
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: requestPath,
      handle(request: Request, context: LiveHostApplicationContext) {
        return new Response(`${name}:${new URL(request.url).pathname}:${context.applicationName}`, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    })]),
    ...(connectionPath === undefined ? {} : {
      connections: Object.freeze([Object.freeze({
        path: connectionPath,
        accept(_request: Request, connection: LiveHostConnection) {
          connection.onMessage((data) => connection.send(data));
        },
      })]),
    }),
    async dispose() { await dispose?.(); },
  });
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

function locus_socket(connection: LiveHostConnection): LocusSocketLike {
  return Object.freeze({
    send(message: string) { connection.send(message); },
    close(code?: number, reason?: string) { connection.close(code, reason); },
    onMessage(listener: (message: string) => void) {
      return connection.onMessage((data) => {
        if (typeof data === "string") listener(data);
        else connection.close(1003, "Locus accepts text messages only.");
      });
    },
    onClose(listener: () => void) { return connection.onClose(listener); },
  });
}

check("supported Node runtime contract remains explicit", () => {
  assert.equal(is_supported_livehost_node_runtime("22.12.0"), true);
  assert.equal(is_supported_livehost_node_runtime("24.14.0"), true);
  assert.equal(is_supported_livehost_node_runtime("20.11.0"), false);
  assert.equal(is_supported_livehost_node_runtime("25.0.0"), false);
  assert.throws(() => assert_supported_livehost_node_runtime("20.11.0"), />=22.12.0 <25/);
});

check("zero-Locus application receives Web Request and returns Web Response", async () => {
  let disposed = 0;
  let ready = false;
  const application: LiveHostApplication = Object.freeze({
    name: "zero-locus",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/zero",
      handle(request: Request, context: LiveHostApplicationContext) {
        assert.equal(request instanceof Request, true);
        assert.equal(context.principal.anonymous, true);
        return new Response("zero-locus-ok", { status: 201, headers: { "x-livehost": "generic" } });
      },
    })]),
    ready: () => ready,
    dispose() { disposed += 1; },
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  assert.deepEqual(host.applicationNames, ["zero-locus"]);
  assert.equal(host.ready(), false);
  assert.deepEqual(await (await fetch(`${host.httpUrl}/healthz`)).json(), {
    ready: false,
    applications: [{ name: "zero-locus", ready: false }],
  });
  ready = true;
  const response = await fetch(`${host.httpUrl}/zero`);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-livehost"), "generic");
  assert.equal(await response.text(), "zero-locus-ok");
  assert.equal(host.ready(), true);
  assert.equal(await rejected_websocket_status(`${host.url}/zero`), 404);
  await host.dispose();
  await host.dispose();
  assert.equal(disposed, 1);
});

check("Web Response bytes begin streaming before the source completes", async () => {
  const releaseTail = deferred<void>();
  const firstObserved = deferred<void>();
  const application: LiveHostApplication = Object.freeze({
    name: "streaming-response",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/streaming-response",
      handle() {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0, 255, 1]));
            void releaseTail.promise.then(() => {
              controller.enqueue(new Uint8Array([2, 128]));
              controller.close();
            });
          },
        }), { headers: { "content-type": "application/octet-stream" } });
      },
    })]),
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  let ended = false;
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    const request = node_request(`${host.httpUrl}/streaming-response`, (response) => {
      response.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
        firstObserved.resolve(undefined);
      });
      response.once("end", () => {
        ended = true;
        resolve();
      });
      response.once("error", reject);
    });
    request.once("error", reject);
    request.end();
  });
  await firstObserved.promise;
  assert.equal(ended, false);
  assert.deepEqual(chunks, [Buffer.from([0, 255, 1])]);
  releaseTail.resolve(undefined);
  await completed;
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 1, 2, 128]));
  await host.dispose();
});

check("Web Response transport preserves repeated Set-Cookie and ordinary headers", async () => {
  const application: LiveHostApplication = Object.freeze({
    name: "response-headers",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/response-headers",
      handle() {
        const headers = new Headers({ "x-ordinary": "preserved" });
        headers.append("set-cookie", "first=one; Path=/");
        headers.append("set-cookie", "second=two; Path=/");
        return new Response("headers", { headers });
      },
    })]),
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  const observed = await new Promise<Readonly<{
    ordinary: string | undefined;
    cookies: readonly string[] | undefined;
    body: string;
  }>>((resolve, reject) => {
    const request = node_request(`${host.httpUrl}/response-headers`, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => {
        const ordinary = response.headers["x-ordinary"];
        resolve(Object.freeze({
          ordinary: Array.isArray(ordinary) ? ordinary.join(", ") : ordinary,
          cookies: response.headers["set-cookie"],
          body: Buffer.concat(chunks).toString(),
        }));
      });
      response.once("error", reject);
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(observed.ordinary, "preserved");
  assert.deepEqual(observed.cookies, ["first=one; Path=/", "second=two; Path=/"]);
  assert.equal(observed.body, "headers");
  await host.dispose();
});

check("Response body failure before commitment becomes the host failure response", async () => {
  const application: LiveHostApplication = Object.freeze({
    name: "precommit-response-failure",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/precommit-response-failure",
      handle() {
        return new Response(new ReadableStream<Uint8Array>({
          pull() { throw new Error("precommit body failure"); },
        }), { status: 202 });
      },
    })]),
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  const response = await fetch(`${host.httpUrl}/precommit-response-failure`);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Application request failed.\n");
  await host.dispose();
});

check("Response body failure after commitment aborts without a second semantic body", async () => {
  const failBody = deferred<void>();
  const firstObserved = deferred<void>();
  const application: LiveHostApplication = Object.freeze({
    name: "committed-response-failure",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/committed-response-failure",
      handle() {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("application-prefix"));
            void failBody.promise.then(() => controller.error(new Error("late body failure")));
          },
        }), { status: 202, headers: { "x-application": "committed" } });
      },
    })]),
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  const result = new Promise<Readonly<{ status: number; body: string; aborted: boolean; header?: string }>>((resolve, reject) => {
    const request = node_request(`${host.httpUrl}/committed-response-failure`, (response) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (aborted: boolean): void => {
        if (settled) return;
        settled = true;
        const header = response.headers["x-application"];
        resolve(Object.freeze({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString(),
          aborted,
          ...(header === undefined
            ? {}
            : { header: Array.isArray(header) ? header.join(", ") : header }),
        }));
      };
      response.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
        firstObserved.resolve(undefined);
      });
      response.once("end", () => finish(false));
      response.once("aborted", () => finish(true));
      response.once("error", () => finish(true));
    });
    request.once("error", reject);
    request.end();
  });
  await firstObserved.promise;
  failBody.resolve(undefined);
  const observed = await result;
  assert.deepEqual(observed, {
    status: 202,
    body: "application-prefix",
    aborted: true,
    header: "committed",
  });
  assert.equal(observed.body.includes("Application request failed."), false);
  await host.dispose();
});

check("synchronous connection acceptance failure is contained with close 1011", async () => {
  const application: LiveHostApplication = Object.freeze({
    name: "sync-accept-failure",
    connections: Object.freeze([Object.freeze({
      path: "/sync-accept-failure",
      accept() { throw new Error("sync accept failure"); },
    })]),
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  assert.equal(await failed_connection_code(`${host.url}/sync-accept-failure`), 1011);
  await host.dispose();
});

check("asynchronous connection acceptance failure is contained with close 1011", async () => {
  const application: LiveHostApplication = Object.freeze({
    name: "async-accept-failure",
    connections: Object.freeze([Object.freeze({
      path: "/async-accept-failure",
      async accept() { throw new Error("async accept failure"); },
    })]),
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  assert.equal(await failed_connection_code(`${host.url}/async-accept-failure`), 1011);
  await host.dispose();
});

check("multiple applications remain isolated by exact request paths", async () => {
  const alpha = echo_application("alpha", "/alpha");
  const beta = echo_application("beta", "/beta");
  const host = await start_node_application_host({ port: 0, applications: [alpha, beta] });
  assert.equal(await (await fetch(`${host.httpUrl}/alpha`)).text(), "alpha:/alpha:alpha");
  assert.equal(await (await fetch(`${host.httpUrl}/beta`)).text(), "beta:/beta:beta");
  assert.equal((await fetch(`${host.httpUrl}/missing`)).status, 404);
  await host.dispose();
});

check("registration rejects duplicate names and exact routes atomically", async () => {
  let disposals = 0;
  const first = echo_application("same", "/first", undefined, () => { disposals += 1; });
  const second = echo_application("same", "/second", undefined, () => { disposals += 1; });
  await assert.rejects(start_node_application_host({ port: 0, applications: [first, second] }), /Duplicate/);
  assert.equal(disposals, 2);
  await assert.rejects(start_node_application_host({
    port: 0,
    applications: [echo_application("a", "/same"), echo_application("b", "/same")],
  }), /overlaps/);
  await assert.rejects(start_node_application_host({
    port: 0,
    applications: [echo_application("health", "/healthz")],
  }), /reserved/);
});

check("optional connection capability carries text and binary data", async () => {
  const host = await start_node_application_host({
    port: 0,
    applications: [echo_application("echo", "/echo-http", "/echo")],
  });
  const websocket = await open_websocket(`${host.url}/echo`);
  let received = next_message(websocket);
  websocket.send("text");
  assert.equal((await received).toString(), "text");
  received = next_message(websocket);
  websocket.send(new Uint8Array([1, 2, 3]));
  assert.deepEqual(new Uint8Array(await received as Buffer), new Uint8Array([1, 2, 3]));
  websocket.close();
  await host.dispose();
});

check("connection paths select applications without interpreting Locus topology", async () => {
  const selections: string[] = [];
  const loci = new Map([
    ["room-a", create_locus({ state: { room: "a" }, logicalMapId: "logical-a" })],
    ["room-b", create_locus({ state: { room: "b" }, logicalMapId: "logical-b" })],
  ]);
  const application: LiveHostApplication = Object.freeze({
    name: "optional-locus",
    connections: Object.freeze([Object.freeze({
      path: "/rooms",
      accept(request: Request, connection: LiveHostConnection) {
        const selector = new URL(request.url).searchParams.get("locus") ?? "";
        selections.push(selector);
        const locus = loci.get(selector);
        if (locus === undefined) {
          connection.close(1008, "Unknown application Locus.");
          return;
        }
        locus.connect(locus_socket(connection));
      },
    })]),
    dispose() {
      for (const locus of loci.values()) locus.dispose();
      loci.clear();
    },
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  const websocket = await open_websocket(`${host.url}/rooms?locus=room-b`);
  const message = next_message(websocket);
  websocket.send(JSON.stringify({ type: "hello" }));
  assert.equal(JSON.parse((await message).toString()).type, "hello");
  assert.deepEqual(selections, ["room-b"]);
  assert.equal(loci.get("room-a")?.stream.logicalMapId, "logical-a");
  assert.equal(loci.get("room-b")?.stream.logicalMapId, "logical-b");
  websocket.close();
  await host.dispose();
});

check("production authentication principal reaches generic request context", async () => {
  let principal: LiveHostPrincipal | undefined;
  const application: LiveHostApplication = Object.freeze({
    name: "secure",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/secure",
      handle(_request: Request, context: LiveHostApplicationContext) {
        principal = context.principal;
        return new Response("secure");
      },
    })]),
    dispose() {},
  });
  const security = production_security();
  await assert.rejects(start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [application],
  }), /requires explicit security/);
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [application],
    security: new Map([[application.name, security]]),
  });
  assert.equal((await fetch(`${host.httpUrl}/secure`)).status, 403);
  assert.equal((await fetch(`${host.httpUrl}/secure`, { headers: secureHeaders })).status, 200);
  assert.equal(principal?.id, "principal-a");
  assert.deepEqual(principal?.value, { role: "tester" });
  await host.dispose();
});

check("trusted proxy evidence remains available to Node security", async () => {
  const contexts: NodeRequestContext[] = [];
  const application = echo_application("proxy", "/proxy");
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      proxy: { trustImmediatePeer: () => true, forwardedForHop: "first" },
    },
    applications: [application],
    security: new Map([[application.name, production_security(contexts)]]),
  });
  const response = await fetch(`${host.httpUrl}/proxy`, {
    headers: {
      ...secureHeaders,
      "X-Forwarded-For": "203.0.113.10, 10.0.0.4",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "public.example",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(contexts[0]?.proxyInterpretation, "trusted-proxy");
  assert.equal(contexts[0]?.effectiveClientAddress, "203.0.113.10");
  assert.equal(contexts[0]?.effectiveOrigin, "https://public.example");
  await host.dispose();
});

check("asynchronous security policy remains bounded before upgrade", async () => {
  const application = echo_application("bounded", "/bounded-http", "/bounded");
  const security: NodeApplicationSecurity = Object.freeze({
    origin: () => new Promise<NodePolicyResult<void>>(() => undefined),
    authenticate: (): NodePolicyResult<LiveHostPrincipal> => ({ ok: true, value: { id: "late", anonymous: false } }),
    authorize: (): NodePolicyResult<void> => ({ ok: true, value: undefined }),
  });
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production", limits: { handshakeTimeoutMs: 20 } },
    applications: [application],
    security: new Map([[application.name, security]]),
  });
  assert.equal(await rejected_websocket_status(`${host.url}/bounded`), 408);
  await host.dispose();
});

check("connection limits and message budgets remain Node runtime responsibilities", async () => {
  const application = echo_application("limited", "/limited-http", "/limited");
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      limits: {
        maxConnections: 1,
        maxConnectionsPerApplication: 1,
        maxConnectionsPerClient: 1,
        maxMessagesPerWindow: 1,
      },
    },
    applications: [application],
    security: new Map<string, NodeApplicationSecurity>([[application.name, {
      origin: (): NodePolicyResult<void> => ({ ok: true, value: undefined }),
      authenticate: (): NodePolicyResult<LiveHostPrincipal> => ({ ok: true, value: { anonymous: true } }),
      authorize: (): NodePolicyResult<void> => ({ ok: true, value: undefined }),
    }]]),
  });
  const first = await open_websocket(`${host.url}/limited`);
  assert.equal(await rejected_websocket_status(`${host.url}/limited`), 503);
  const closed = socket_close(first);
  first.send("one");
  first.send("two");
  assert.equal(await closed, 1008);
  await host.dispose();
});

check("URL limits and bodyless GET ingress remain Node runtime responsibilities", async () => {
  let dispatches = 0;
  const application: LiveHostApplication = Object.freeze({
    name: "bounded-request",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/bounded-request",
      handle() {
        dispatches += 1;
        return new Response("ok");
      },
    })]),
    dispose() {},
  });
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production", limits: { maxUrlBytes: 80 } },
    applications: [application],
    security: new Map([[application.name, production_security()]]),
  });
  assert.equal(await raw_http_status(`${host.httpUrl}/bounded-request?${"x".repeat(100)}`, "GET"), 413);
  assert.equal(await raw_http_status(`${host.httpUrl}/bounded-request`, "GET", "body"), 400);
  assert.equal(dispatches, 0);
  await host.dispose();
});

check("shutdown is idempotent, disposes once, and closes active connections", async () => {
  let disposals = 0;
  const application = echo_application("shutdown", "/shutdown-http", "/shutdown", () => {
    disposals += 1;
  });
  const host = await start_node_application_host({ port: 0, applications: [application] });
  const websocket = await open_websocket(`${host.url}/shutdown`);
  const closed = socket_close(websocket);
  await Promise.all([host.dispose(), host.dispose()]);
  assert.equal(await closed, 1001);
  assert.equal(disposals, 1);
});

check("bounded shutdown reports an application disposal timeout", async () => {
  let disposals = 0;
  const application: LiveHostApplication = Object.freeze({
    name: "slow-disposal",
    dispose() {
      disposals += 1;
      return new Promise<void>(() => undefined);
    },
  });
  const host = await start_node_application_host({
    port: 0,
    shutdownTimeoutMs: 20,
    applications: [application],
  });
  await assert.rejects(host.dispose(), /shutdown exceeded 20ms/);
  assert.equal(disposals, 1);
});

check("heartbeat preserves responsive idle connections", async () => {
  const application = echo_application("heartbeat", "/heartbeat-http", "/heartbeat");
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      limits: { heartbeatIntervalMs: 30, heartbeatDeadlineMs: 10 },
    },
    applications: [application],
    security: new Map([[application.name, production_security()]]),
  });
  const websocket = await open_websocket(`${host.url}/heartbeat`, secureHeaders);
  await new Promise<void>((resolve) => setTimeout(resolve, 90));
  assert.equal(websocket.readyState, WebSocket.OPEN);
  websocket.close();
  await host.dispose();
});

check("heartbeat terminates a connection that does not answer ping", async () => {
  const application = echo_application("heartbeat-timeout", "/heartbeat-timeout-http", "/heartbeat-timeout");
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      limits: { heartbeatIntervalMs: 30, heartbeatDeadlineMs: 10 },
    },
    applications: [application],
    security: new Map([[application.name, production_security()]]),
  });
  const websocket = new WebSocket(`${host.url}/heartbeat-timeout`, {
    headers: secureHeaders,
    autoPong: false,
  });
  await new Promise<void>((resolve, reject) => {
    websocket.once("open", resolve);
    websocket.once("error", reject);
  });
  assert.equal(await socket_close(websocket), 1006);
  await host.dispose();
});

check("outgoing backpressure remains a Node transport limit", async () => {
  const events: NodeHostOperationalEvent[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, "bufferedAmount");
  assert.equal(descriptor?.configurable, true);
  Object.defineProperty(WebSocket.prototype, "bufferedAmount", {
    configurable: true,
    get(this: WebSocket) {
      if (Reflect.get(this, "_isServer") === true) return 2;
      return descriptor?.get === undefined ? 0 : Reflect.apply(descriptor.get, this, []);
    },
  });
  const application: LiveHostApplication = Object.freeze({
    name: "backpressure",
    connections: Object.freeze([Object.freeze({
      path: "/backpressure",
      accept(_request: Request, connection: LiveHostConnection) {
        connection.send("canonical-commit");
      },
    })]),
    dispose() {},
  });
  try {
    const host = await start_node_application_host({
      port: 0,
      deployment: { mode: "production", limits: { maxBufferedAmount: 1 } },
      applications: [application],
      security: new Map([[application.name, production_security()]]),
      log: (event) => events.push(event),
    });
    const websocket = new WebSocket(`${host.url}/backpressure`, { headers: secureHeaders });
    const closed = socket_close(websocket);
    await new Promise<void>((resolve, reject) => {
      websocket.once("open", resolve);
      websocket.once("error", reject);
    });
    assert.equal(await closed, 1013);
    assert.equal(events.some((event) => event.type === "backpressure" && event.code === "NODE_HOST_BACKPRESSURE"), true);
    await host.dispose();
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(WebSocket.prototype, "bufferedAmount");
    else Object.defineProperty(WebSocket.prototype, "bufferedAmount", descriptor);
  }
});

check("generic application lifecycle composes with structured Node events", async () => {
  const events: NodeHostOperationalEvent[] = [];
  const application = echo_application("events", "/events", "/events-connect");
  const host = await start_node_application_host({
    port: 0,
    applications: [application],
    log: (event) => events.push(event),
  });
  await fetch(`${host.httpUrl}/events`);
  const websocket = await open_websocket(`${host.url}/events-connect`);
  websocket.close();
  await host.dispose();
  assert.deepEqual(
    new Set(events.map((event) => event.type)),
    new Set([
      "host-startup",
      "application-registration",
      "host-listening",
      "http-dispatch",
      "websocket-dispatch",
      "shutdown-start",
      "shutdown-completion",
    ]),
  );
});

check("generic LiveHost layer has no Node or ws dependency", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/api/livehost/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/types/livehost.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/api/livehost/services/livehost.authority-registry.ts", import.meta.url), "utf8"),
  ]);
  for (const source of sources) {
    assert.equal(/node:(?:http|https|net|stream)/.test(source), false);
    assert.equal(/from ["']ws["']/.test(source), false);
    assert.equal(source.includes("IncomingMessage"), false);
    assert.equal(source.includes("ServerResponse"), false);
  }
});

await sequence;
process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livehost.node-hosting", checks, checks, 0);

import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { create_locus } from "hson-live/locus";
import {
  create_browser_locus_socket,
  type BrowserWebSocketLike,
} from "hson-live/locus";
import {
  assert_supported_livehost_node_runtime,
  create_node_exact_origin_policy,
  is_supported_livehost_node_runtime,
  normalize_node_request,
  start_node_application_host,
  type NodeApplicationSecurity,
  type NodeAuthorityNamespace,
  type NodeHostedApplication,
  type NodeHostOperationalEvent,
  type NodePolicyResult,
  type NodeRequestContext,
} from "hson-live/livehost/node";
import { create_node_locus_socket } from "hson-live/locus/node";
import WebSocket, { type RawData } from "ws";

let checks = 0;
let sequence = Promise.resolve();

function check(name: string, run: () => void | Promise<void>): void {
  sequence = sequence.then(async () => {
    await run();
    checks += 1;
    process.stdout.write(`ok ${checks} - ${name}\n`);
  });
}

class MockBrowserWebSocket implements BrowserWebSocketLike {
  readonly listeners = new Map<string, Set<(event: Readonly<{ data: unknown }>) => void>>();
  readonly sent: string[] = [];
  readonly closes: Array<Readonly<{ code?: number; reason?: string }>> = [];
  readyState = 0;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) });
    this.readyState = 3;
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: string, listener: (event: Readonly<{ data: unknown }>) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "open", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  removeEventListener(type: "close", listener: () => void): void;
  removeEventListener(type: "error", listener: () => void): void;
  removeEventListener(type: string, listener: (event: Readonly<{ data: unknown }>) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event?: Readonly<{ data: unknown }>): void {
    if (type === "open") this.readyState = 1;
    if (type === "close") this.readyState = 3;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event ?? { data: undefined });
  }
}

function browser_fixture(): Readonly<{
  raw: MockBrowserWebSocket;
  adapter: ReturnType<typeof create_browser_locus_socket>;
}> {
  let raw: MockBrowserWebSocket | undefined;
  class Constructor extends MockBrowserWebSocket {
    constructor(_url: string) {
      super();
      raw = this;
    }
  }
  const adapter = create_browser_locus_socket("ws://example.test", Constructor);
  if (raw === undefined) throw new Error("browser fixture constructor did not run");
  return { raw, adapter };
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

function next_json_message(websocket: WebSocket): Promise<Readonly<Record<string, unknown>>> {
  return new Promise((resolve) => websocket.once("message", (data) => resolve(JSON.parse(data.toString()))));
}

type MockApplication = Readonly<{
  registration: NodeHostedApplication;
  accepts(): number;
  disposals(): number;
}>;

function mock_application(
  name: string,
  authorities: readonly NodeAuthorityNamespace[],
  httpPath?: string,
  dispose?: () => void | Promise<void>,
): MockApplication {
  let accepts = 0;
  let disposals = 0;
  let disposed = false;
  return Object.freeze({
    registration: Object.freeze({
      name,
      authorities,
      ...(httpPath === undefined ? {} : {
        httpRoutes: Object.freeze([Object.freeze({
          method: "GET",
          path: httpPath,
          handle(_request: IncomingMessage, response: ServerResponse) {
            response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
            response.end(name);
          },
        })]),
      }),
      acceptWebSocket(_locusSelector: string, websocket: WebSocket) {
        accepts += 1;
        websocket.on("message", (message: RawData) => websocket.send(`${name}:${message.toString()}`));
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        disposals += 1;
        await dispose?.();
      },
    }),
    accepts: () => accepts,
    disposals: () => disposals,
  });
}

async function captured_error(run: () => Promise<unknown>): Promise<Error | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return undefined;
}

check("browser adapter delivers text messages after opening", async () => {
  const { raw, adapter } = browser_fixture();
  const received: string[] = [];
  adapter.socket.onMessage((message) => received.push(message));
  raw.emit("open");
  await adapter.ready;
  raw.emit("message", { data: "hello" });
  assert.deepEqual(received, ["hello"]);
  assert.equal(adapter.status, "open");
  adapter.dispose();
});

check("browser adapter message disposal is idempotent", () => {
  const { raw, adapter } = browser_fixture();
  const received: string[] = [];
  const stop = adapter.socket.onMessage((message) => received.push(message));
  stop?.();
  stop?.();
  raw.emit("open");
  raw.emit("message", { data: "ignored" });
  assert.deepEqual(received, []);
  adapter.dispose();
});

check("browser adapter propagates close and normalizes late close listeners", () => {
  const { raw, adapter } = browser_fixture();
  let closes = 0;
  raw.emit("open");
  adapter.socket.onClose(() => closes += 1);
  raw.emit("close");
  adapter.socket.onClose(() => closes += 1);
  assert.equal(closes, 2);
  assert.equal(adapter.status, "closed");
  adapter.dispose();
});

check("browser adapter rejects non-text messages with close code 1003", () => {
  const { raw, adapter } = browser_fixture();
  raw.emit("open");
  raw.emit("message", { data: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(raw.closes.at(-1), { code: 1003, reason: "Locus accepts text messages only." });
  adapter.dispose();
});

check("browser adapter rejects send unless open and normalizes close and error detail", () => {
  const { raw, adapter } = browser_fixture();
  assert.throws(() => adapter.socket.send("early"), /not open/);
  raw.emit("open");
  adapter.socket.send("ready");
  adapter.socket.close(1008, "policy");
  assert.deepEqual(raw.sent, ["ready"]);
  assert.deepEqual(raw.closes.at(-1), { code: 1008, reason: "policy" });
  raw.emit("error");
  assert.deepEqual(raw.closes.at(-1), { code: 1011, reason: "Locus WebSocket error." });
  adapter.dispose();
});

check("browser adapter readiness failure and cleanup are idempotent", async () => {
  const { raw, adapter } = browser_fixture();
  adapter.dispose();
  adapter.dispose();
  await assert.rejects(adapter.ready, /disposed before opening/);
  assert.equal(raw.listeners.get("open")?.size, 0);
  assert.equal(raw.listeners.get("message")?.size, 0);
  assert.equal(raw.closes.length, 1);
});

check("Node adapter delivers real ws text messages", async () => {
  const app = mock_application("node-text", [{ kind: "exact", value: "node-text" }]);
  const host = await start_node_application_host({ port: 0, applications: [app.registration] });
  const client = await open_websocket(`${host.url}?locus=node-text`);
  const received = new Promise<string>((resolve) => client.once("message", (data) => resolve(data.toString())));
  client.send("hello");
  assert.equal(await received, "node-text:hello");
  client.close();
  await host.stop();
});

check("Node adapter rejects binary messages with close code 1003", async () => {
  let adapted = false;
  const app: NodeHostedApplication = Object.freeze({
    name: "node-binary",
    authorities: [{ kind: "exact" as const, value: "node-binary" }],
    acceptWebSocket(_locusSelector, websocket) {
      adapted = true;
      create_node_locus_socket(websocket).onMessage(() => undefined);
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?locus=node-binary`);
  const closed = socket_close(client);
  client.send(Buffer.from([1, 2, 3]));
  assert.equal(await closed, 1003);
  assert.equal(adapted, true);
  await host.stop();
});

check("Node adapter message listener disposal is idempotent", async () => {
  let messages = 0;
  const app: NodeHostedApplication = Object.freeze({
    name: "node-dispose",
    authorities: [{ kind: "exact" as const, value: "node-dispose" }],
    acceptWebSocket(_locusSelector, websocket) {
      const stop = create_node_locus_socket(websocket).onMessage(() => messages += 1);
      stop?.();
      stop?.();
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?locus=node-dispose`);
  client.send("ignored");
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(messages, 0);
  client.close();
  await host.stop();
});

check("Node adapter close listener disposal is idempotent", async () => {
  let closes = 0;
  const app: NodeHostedApplication = Object.freeze({
    name: "node-close",
    authorities: [{ kind: "exact" as const, value: "node-close" }],
    acceptWebSocket(_locusSelector, websocket) {
      const stop = create_node_locus_socket(websocket).onClose(() => closes += 1);
      stop?.();
      stop?.();
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?locus=node-close`);
  const closed = socket_close(client);
  client.close();
  await closed;
  assert.equal(closes, 0);
  await host.stop();
});

check("Node adapter isolates send after transport closure", async () => {
  let adapter: ReturnType<typeof create_node_locus_socket> | undefined;
  const app: NodeHostedApplication = Object.freeze({
    name: "node-send",
    authorities: [{ kind: "exact" as const, value: "node-send" }],
    acceptWebSocket(_locusSelector, websocket) {
      adapter = create_node_locus_socket(websocket);
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?locus=node-send`);
  const closed = socket_close(client);
  client.close();
  await closed;
  assert.doesNotThrow(() => adapter?.send("late"));
  assert.doesNotThrow(() => adapter?.close());
  await host.stop();
});

check("socket adapters expose transport behavior but no authority state", () => {
  const { raw, adapter } = browser_fixture();
  const keys = Object.keys(adapter.socket).sort();
  assert.deepEqual(keys, ["close", "onClose", "onMessage", "send"]);
  assert.equal("authorities" in adapter.socket, false);
  assert.equal("sessions" in adapter.socket, false);
  raw.emit("open");
  adapter.dispose();
});

check("built browser and Locus entrypoints exclude Node transport modules", async () => {
  const [root, locus, authorityCore, nodeHost] = await Promise.all([
    readFile(new URL("../dist/index.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/api/locus/index.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/api/locus/locus.core.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/api/livehost/node/livehost.node-application-host.js", import.meta.url), "utf8"),
  ]);
  for (const source of [root, locus, authorityCore]) {
    assert.equal(source.includes("node:http"), false);
    assert.equal(source.includes('from "ws"'), false);
  }
  assert.equal(nodeHost.includes("node:http"), true);
  assert.equal(nodeHost.includes('from "ws"'), true);
});

check("multiple applications receive only their HTTP and WebSocket routes", async () => {
  const alpha = mock_application("alpha", [{ kind: "exact", value: "alpha" }], "/alpha");
  const beta = mock_application("beta", [{ kind: "prefix", value: "beta:" }], "/beta");
  const host = await start_node_application_host({ port: 0, applications: [alpha.registration, beta.registration] });
  const alphaSocket = await open_websocket(`${host.url}?locus=alpha`);
  const betaSocket = await open_websocket(`${host.url}?locus=beta%3Aroom`);
  assert.equal(await (await fetch(`${host.httpUrl}/alpha`)).text(), "alpha");
  assert.equal(await (await fetch(`${host.httpUrl}/beta`)).text(), "beta");
  assert.equal((await fetch(`${host.httpUrl}/missing`)).status, 404);
  assert.equal(alpha.accepts(), 1);
  assert.equal(beta.accepts(), 1);
  alphaSocket.close();
  betaSocket.close();
  await host.stop();
});

check("duplicate application names reject atomically", async () => {
  const first = mock_application("same", [{ kind: "exact", value: "first" }]);
  const second = mock_application("same", [{ kind: "exact", value: "second" }]);
  await assert.rejects(
    start_node_application_host({ port: 0, applications: [first.registration, second.registration] }),
    /Duplicate/,
  );
  assert.equal(first.disposals(), 1);
  assert.equal(second.disposals(), 1);
});

check("duplicate and reserved HTTP routes reject atomically", async () => {
  const first = mock_application("first", [{ kind: "exact", value: "first" }], "/same");
  const second = mock_application("second", [{ kind: "exact", value: "second" }], "/same");
  await assert.rejects(
    start_node_application_host({ port: 0, applications: [first.registration, second.registration] }),
    /HTTP route/,
  );
  const health = mock_application("health", [{ kind: "exact", value: "health" }], "/healthz");
  await assert.rejects(start_node_application_host({ port: 0, applications: [health.registration] }), /reserved route/);
});

check("overlapping authority namespaces reject atomically", async () => {
  const first = mock_application("first", [{ kind: "prefix", value: "room:" }]);
  const second = mock_application("second", [{ kind: "exact", value: "room:value" }]);
  await assert.rejects(
    start_node_application_host({ port: 0, applications: [first.registration, second.registration] }),
    /overlap/,
  );
  assert.equal(first.disposals(), 1);
  assert.equal(second.disposals(), 1);
});

check("missing malformed and unmatched authorities never touch application state", async () => {
  const app = mock_application("selected", [{
    kind: "prefix",
    value: "room:",
    suffix: { minLength: 2, maxLength: 8, pattern: /^[a-z]+$/ },
  }]);
  const host = await start_node_application_host({ port: 0, applications: [app.registration] });
  assert.equal(await rejected_websocket_status(host.url), 400);
  assert.equal(await rejected_websocket_status(`${host.url}?livehost=room%3Aok`), 400);
  assert.equal(await rejected_websocket_status(`${host.url}?locus=room%3A1`), 404);
  assert.equal(await rejected_websocket_status(`${host.url}?locus=unknown`), 404);
  assert.equal(app.accepts(), 0);
  await host.stop();
});

check("health reports readiness without authority or application state", async () => {
  const secret = "secret-authority";
  const app = mock_application("safe-name", [{ kind: "exact", value: secret }]);
  const host = await start_node_application_host({ port: 0, applications: [app.registration] });
  const response = await fetch(`${host.httpUrl}/healthz`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(text), { ready: true, applications: [{ name: "safe-name", ready: true }] });
  assert.equal(text.includes(secret), false);
  await host.stop();
});

check("startup conflict leaves no partially listening server", async () => {
  const first = mock_application("first", [{ kind: "exact", value: "same" }]);
  const second = mock_application("second", [{ kind: "exact", value: "same" }]);
  const error = await captured_error(() => start_node_application_host({
    host: "127.0.0.1",
    port: 0,
    applications: [first.registration, second.registration],
  }));
  assert.match(error?.message ?? "", /overlap/);
  assert.equal(first.disposals(), 1);
  assert.equal(second.disposals(), 1);
});

check("application disposal remains independent", async () => {
  const alpha = mock_application("alpha", [{ kind: "exact", value: "alpha" }]);
  const beta = mock_application("beta", [{ kind: "exact", value: "beta" }]);
  const host = await start_node_application_host({ port: 0, applications: [alpha.registration, beta.registration] });
  await alpha.registration.dispose();
  const betaSocket = await open_websocket(`${host.url}?locus=beta`);
  assert.equal(beta.accepts(), 1);
  assert.equal(alpha.disposals(), 1);
  betaSocket.close();
  await host.stop();
  assert.equal(alpha.disposals(), 1);
  assert.equal(beta.disposals(), 1);
});

check("multiple Locus authorities coexist behind independent applications", async () => {
  const firstAuthority = create_locus({ state: { id: "equal", count: 0 } });
  const secondAuthority = create_locus({ state: { id: "equal", count: 0 } });
  const first: NodeHostedApplication = Object.freeze({
    name: "authority-a",
    authorities: [{ kind: "exact" as const, value: "authority-a" }],
    acceptWebSocket(_id, websocket) {
      firstAuthority.connect(create_node_locus_socket(websocket));
    },
    dispose() { firstAuthority.dispose(); },
  });
  const second: NodeHostedApplication = Object.freeze({
    name: "authority-b",
    authorities: [{ kind: "exact" as const, value: "authority-b" }],
    acceptWebSocket(_id, websocket) {
      secondAuthority.connect(create_node_locus_socket(websocket));
    },
    dispose() { secondAuthority.dispose(); },
  });
  const host = await start_node_application_host({ port: 0, applications: [first, second] });
  assert.notEqual(firstAuthority, secondAuthority);
  assert.deepEqual(firstAuthority.map.snap(), secondAuthority.map.snap());
  assert.deepEqual(Object.keys(host).sort(), [
    "applicationNames", "connectionCount", "disconnectConnections", "host", "httpUrl", "port", "stop", "url",
  ]);
  await host.stop();
});

check("authority-only hosting creates no rendering runtime or DOM and installs no signals", async () => {
  const beforeInt = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  const app = mock_application("empty", [{ kind: "exact", value: "empty" }]);
  const host = await start_node_application_host({ port: 0, applications: [app.registration] });
  assert.equal(typeof Reflect.get(globalThis, "document"), "undefined");
  assert.equal(typeof Reflect.get(globalThis, "CSSStyleSheet"), "undefined");
  assert.equal(process.listenerCount("SIGINT"), beforeInt);
  assert.equal(process.listenerCount("SIGTERM"), beforeTerm);
  await host.stop();
});

check("shutdown is idempotent disposes once and closes active sockets", async () => {
  const app = mock_application("active", [{ kind: "exact", value: "active" }]);
  const host = await start_node_application_host({ port: 0, applications: [app.registration] });
  const websocket = await open_websocket(`${host.url}?locus=active`);
  const closed = socket_close(websocket);
  await Promise.all([host.stop(), host.stop()]);
  assert.equal(await closed, 1001);
  assert.equal(app.disposals(), 1);
});

check("bounded shutdown reports a clear disposal timeout", async () => {
  const app = mock_application(
    "slow",
    [{ kind: "exact", value: "slow" }],
    undefined,
    () => new Promise<void>(() => undefined),
  );
  const host = await start_node_application_host({ port: 0, shutdownTimeoutMs: 20, applications: [app.registration] });
  await assert.rejects(host.stop(), /shutdown exceeded 20ms/);
  assert.equal(app.disposals(), 1);
});

check("operational events remain structured and separate from protocol state", async () => {
  const events: NodeHostOperationalEvent[] = [];
  const app = mock_application("logged", [{ kind: "exact", value: "logged" }], "/logged");
  const host = await start_node_application_host({
    port: 0,
    applications: [app.registration],
    log: (event) => events.push(event),
  });
  await fetch(`${host.httpUrl}/logged`);
  const websocket = await open_websocket(`${host.url}?locus=logged`);
  websocket.close();
  await host.stop();
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
  assert.equal(events.some((event) => "authorityId" in event), false);
});

function production_security(
  contexts: NodeRequestContext[] = [],
  token = "correct-horse-battery-staple",
): NodeApplicationSecurity {
  const security: NodeApplicationSecurity = {
    origin: create_node_exact_origin_policy({
      allowedOrigins: ["https://public.example"],
      allowMissing: false,
      allowNull: false,
    }),
    authenticate(context) {
      contexts.push(context);
      return context.headers.get("authorization") === `Bearer ${token}`
        ? {
            ok: true,
            value: Object.freeze({
              id: "principal-a",
              anonymous: false,
              value: Object.freeze({ role: "tester" }),
            }),
          }
        : { ok: false, status: 401, code: "AUTH_REQUIRED" };
    },
    authorizeAuthority: () => ({ ok: true, value: undefined }),
  };
  return Object.freeze(security);
}

function secure_application(
  contexts: NodeRequestContext[] = [],
  security: NodeApplicationSecurity = production_security(contexts),
): MockApplication {
  let accepts = 0;
  let disposals = 0;
  const registration: NodeHostedApplication = {
    name: "secure",
    authorities: [{ kind: "exact", value: "secure" }],
    security,
    httpRoutes: [{
      method: "GET",
      path: "/bootstrap",
      access: "bootstrap-read",
      bodyless: true,
      handle(_request, response, context) {
        contexts.push(context);
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("secure");
      },
    }],
    acceptWebSocket(_locusSelector, websocket, context) {
      accepts += 1;
      contexts.push(context.request);
      websocket.on("message", (message: RawData) => websocket.send(message));
    },
    dispose() {
      disposals += 1;
    },
  };
  return Object.freeze({
    registration: Object.freeze(registration),
    accepts: () => accepts,
    disposals: () => disposals,
  });
}

const secureHeaders = Object.freeze({
  Origin: "https://public.example",
  Authorization: "Bearer correct-horse-battery-staple",
});

check("supported Node runtime contract is explicit and executable-boundary only", () => {
  assert.equal(is_supported_livehost_node_runtime("22.12.0"), true);
  assert.equal(is_supported_livehost_node_runtime("22.20.1"), true);
  assert.equal(is_supported_livehost_node_runtime("24.14.0"), true);
  assert.equal(is_supported_livehost_node_runtime("20.11.0"), false);
  assert.equal(is_supported_livehost_node_runtime("25.0.0"), false);
  assert.throws(() => assert_supported_livehost_node_runtime("20.11.0"), />=22.12.0 <25/);
});

check("production registration requires explicit application security before listening", async () => {
  const app = mock_application("insecure", [{ kind: "exact", value: "insecure" }]);
  await assert.rejects(
    start_node_application_host({
      port: 0,
      deployment: { mode: "production" },
      applications: [app.registration],
    }),
    /requires explicit security policy/,
  );
  assert.equal(app.disposals(), 1);
});

check("direct mode ignores spoofed forwarded identity", async () => {
  const contexts: NodeRequestContext[] = [];
  const app = secure_application(contexts);
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [app.registration],
  });
  const response = await fetch(`${host.httpUrl}/bootstrap`, {
    headers: {
      ...secureHeaders,
      "X-Forwarded-For": "203.0.113.10",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "spoof.example",
    },
  });
  assert.equal(response.status, 200);
  const context = contexts[0];
  assert.equal(context?.proxyInterpretation, "direct");
  assert.equal(context?.effectiveScheme, "http");
  assert.notEqual(context?.effectiveHost, "spoof.example");
  assert.notEqual(context?.effectiveClientAddress, "203.0.113.10");
  await host.stop();
});

check("trusted immediate proxy supplies explicit first-hop external identity", async () => {
  const contexts: NodeRequestContext[] = [];
  const app = secure_application(contexts);
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      proxy: {
        trustImmediatePeer: () => true,
        forwardedForHop: "first",
      },
    },
    applications: [app.registration],
  });
  const response = await fetch(`${host.httpUrl}/bootstrap`, {
    headers: {
      ...secureHeaders,
      "X-Forwarded-For": "203.0.113.10, 10.0.0.4",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "public.example",
    },
  });
  assert.equal(response.status, 200);
  const context = contexts[0];
  assert.equal(context?.proxyInterpretation, "trusted-proxy");
  assert.equal(context?.effectiveClientAddress, "203.0.113.10");
  assert.equal(context?.effectiveOrigin, "https://public.example");
  await host.stop();
});

check("trusted proxy rejects unsupported or malformed forwarded ambiguity", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      proxy: { trustImmediatePeer: () => true, forwardedForHop: "last" },
    },
    applications: [app.registration],
  });
  const response = await fetch(`${host.httpUrl}/bootstrap`, {
    headers: { ...secureHeaders, Forwarded: "for=203.0.113.10;proto=https" },
  });
  assert.equal(response.status, 400);
  assert.equal(app.accepts(), 0);
  await host.stop();
});

check("one exact origin policy protects HTTP and WebSocket before dispatch", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [app.registration],
  });
  assert.equal((await fetch(`${host.httpUrl}/bootstrap`, {
    headers: { ...secureHeaders, Origin: "https://evil.example" },
  })).status, 403);
  assert.equal(await rejected_websocket_status(
    `${host.url}?locus=secure`,
    { ...secureHeaders, Origin: "https://evil.example" },
  ), 403);
  assert.equal(app.accepts(), 0);
  await host.stop();
});

check("missing and null browser origins require explicit policy choices", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [app.registration],
  });
  assert.equal((await fetch(`${host.httpUrl}/bootstrap`, {
    headers: { Authorization: secureHeaders.Authorization },
  })).status, 403);
  assert.equal((await fetch(`${host.httpUrl}/bootstrap`, {
    headers: { Authorization: secureHeaders.Authorization, Origin: "null" },
  })).status, 403);
  await host.stop();
});

check("authentication and authority authorization complete before callbacks or upgrade", async () => {
  let authentication = 0;
  let authorization = 0;
  const securityValue: NodeApplicationSecurity = {
    origin: () => ({ ok: true, value: undefined }),
    authenticate() {
      authentication += 1;
      return { ok: false, status: 401, code: "AUTH_REQUIRED" };
    },
    authorizeAuthority() {
      authorization += 1;
      return { ok: true, value: undefined };
    },
  };
  const security = Object.freeze(securityValue);
  const app = secure_application([], security);
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [app.registration],
  });
  assert.equal(await rejected_websocket_status(`${host.url}?locus=secure`), 401);
  assert.equal(authentication, 1);
  assert.equal(authorization, 0);
  assert.equal(app.accepts(), 0);
  await host.stop();
});

check("HTTP bootstrap and WebSocket independently authenticate the same principal", async () => {
  const principalIds: string[] = [];
  const operations: string[] = [];
  const securityValue: NodeApplicationSecurity = {
    origin: create_node_exact_origin_policy({ allowedOrigins: ["https://public.example"] }),
    authenticate() {
      return { ok: true, value: { id: "same-user", anonymous: false } };
    },
    authorizeAuthority(_context, principal, operation) {
      principalIds.push(principal.id ?? "");
      operations.push(operation);
      return { ok: true, value: undefined };
    },
  };
  const security = Object.freeze(securityValue);
  const app = secure_application([], security);
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [app.registration],
  });
  assert.equal((await fetch(`${host.httpUrl}/bootstrap`, { headers: secureHeaders })).status, 200);
  const websocket = await open_websocket(`${host.url}?locus=secure`, secureHeaders);
  websocket.close();
  assert.deepEqual(principalIds, ["same-user", "same-user"]);
  assert.deepEqual(operations, ["bootstrap-read", "websocket-connect"]);
  await host.stop();
});

check("asynchronous policy is bounded before WebSocket acceptance", async () => {
  const securityValue: NodeApplicationSecurity = {
    origin: () => new Promise<NodePolicyResult<void>>(() => undefined),
    authenticate: () => ({ ok: true, value: { id: "late", anonymous: false } }),
    authorizeAuthority: () => ({ ok: true, value: undefined }),
  };
  const security = Object.freeze(securityValue);
  const app = secure_application([], security);
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production", limits: { handshakeTimeoutMs: 20 } },
    applications: [app.registration],
  });
  assert.equal(await rejected_websocket_status(`${host.url}?locus=secure`), 408);
  assert.equal(app.accepts(), 0);
  await host.stop();
});

check("finite URL and bodyless-route limits reject before application state", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production", limits: { maxUrlBytes: 80 } },
    applications: [app.registration],
  });
  const response = await fetch(`${host.httpUrl}/bootstrap?${"x".repeat(100)}`, { headers: secureHeaders });
  assert.equal(response.status, 413);
  assert.equal(app.accepts(), 0);
  await host.stop();
});

check("connection admission is bounded globally before a second upgrade", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      limits: { maxConnections: 1, maxConnectionsPerApplication: 1, maxConnectionsPerClient: 1 },
    },
    applications: [app.registration],
  });
  const first = await open_websocket(`${host.url}?locus=secure`, secureHeaders);
  assert.equal(await rejected_websocket_status(`${host.url}?locus=secure`, secureHeaders), 503);
  first.close();
  await host.stop();
});

check("WebSocket message-rate budget closes abusive connections", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      limits: { maxMessagesPerWindow: 1, messageWindowMs: 10_000 },
    },
    applications: [app.registration],
  });
  const websocket = await open_websocket(`${host.url}?locus=secure`, secureHeaders);
  const closed = socket_close(websocket);
  websocket.send("one");
  websocket.send("two");
  assert.equal(await closed, 1008);
  await host.stop();
});

check("security events are structured and redact selectors principals and credentials", async () => {
  const events: NodeHostOperationalEvent[] = [];
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [app.registration],
    log: (event) => events.push(event),
  });
  await rejected_websocket_status(`${host.url}?locus=secure`, {
    Origin: "https://public.example",
    Authorization: "Bearer very-secret-invalid-token",
  });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("very-secret-invalid-token"), false);
  assert.equal(serialized.includes("principal-a"), false);
  assert.equal(serialized.includes("livehost"), false);
  assert.equal(events.some((event) => event.type === "policy-rejection"), true);
  await host.stop();
});

check("resumable credentials are principal-bound before an active attachment can be fenced", async () => {
  let nextSession = 0;
  const authority = create_locus({
    state: { value: 0 },
    sessionId: () => `bound-session-${++nextSession}`,
  });
  const securityValue: NodeApplicationSecurity = {
    origin: create_node_exact_origin_policy({ allowedOrigins: ["https://public.example"] }),
    authenticate(context) {
      const id = context.headers.get("x-test-principal");
      return id === undefined
        ? { ok: false, status: 401, code: "AUTH_REQUIRED" }
        : { ok: true, value: { id, anonymous: false, value: { id } } };
    },
    authorizeAuthority: () => ({ ok: true, value: undefined }),
  };
  const security = Object.freeze(securityValue);
  const appValue: NodeHostedApplication = {
    name: "bound",
    authorities: [{ kind: "exact", value: "bound" }],
    security,
    acceptWebSocket(_locusSelector, websocket, context) {
      authority.connect(create_node_locus_socket(websocket), {
        principalId: context.principal.id,
        attachment: context.principal.value,
      });
    },
    dispose() {
      authority.dispose();
    },
  };
  const app = Object.freeze(appValue);
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [app],
  });
  const headersA = { Origin: "https://public.example", "X-Test-Principal": "principal-a" };
  const first = await open_websocket(`${host.url}?locus=bound`, headersA);
  const createdMessage = next_json_message(first);
  first.send(JSON.stringify({ type: "session-create", id: "create" }));
  const created = await createdMessage;
  assert.equal(created.type, "session-created");
  assert.equal(typeof created.credential, "string");

  let fenced = false;
  first.on("message", (data) => {
    if (JSON.parse(data.toString()).type === "session-fenced") fenced = true;
  });
  const wrong = await open_websocket(`${host.url}?locus=bound`, {
    Origin: "https://public.example",
    "X-Test-Principal": "principal-b",
  });
  const rejectedMessage = next_json_message(wrong);
  wrong.send(JSON.stringify({ type: "session-attach", id: "wrong", credential: created.credential }));
  const rejected = await rejectedMessage;
  assert.equal(rejected.type, "session-rejected");
  assert.equal(rejected.code, "LOCUS_SESSION_CREDENTIAL_UNKNOWN");
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.equal(fenced, false);

  const second = await open_websocket(`${host.url}?locus=bound`, headersA);
  const attachedMessage = next_json_message(second);
  second.send(JSON.stringify({ type: "session-attach", id: "right", credential: created.credential }));
  assert.equal((await attachedMessage).type, "session-attached");
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.equal(fenced, true);
  first.close();
  wrong.close();
  second.close();
  await host.stop();
});

check("heartbeat preserves responsive idle sockets", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      limits: { heartbeatIntervalMs: 30, heartbeatDeadlineMs: 10 },
    },
    applications: [app.registration],
  });
  const websocket = await open_websocket(`${host.url}?locus=secure`, secureHeaders);
  await new Promise<void>((resolve) => setTimeout(resolve, 90));
  assert.equal(websocket.readyState, WebSocket.OPEN);
  websocket.close();
  await host.stop();
});

check("heartbeat terminates a socket that does not answer ping", async () => {
  const app = secure_application();
  const host = await start_node_application_host({
    port: 0,
    deployment: {
      mode: "production",
      limits: { heartbeatIntervalMs: 30, heartbeatDeadlineMs: 10 },
    },
    applications: [app.registration],
  });
  const websocket = new WebSocket(`${host.url}?locus=secure`, {
    headers: secureHeaders,
    autoPong: false,
  });
  await new Promise<void>((resolve, reject) => {
    websocket.once("open", resolve);
    websocket.once("error", reject);
  });
  assert.equal(await socket_close(websocket), 1006);
  await host.stop();
});

check("Node adapter closes on outgoing backpressure without dropping a canonical message", async () => {
  let backpressure = 0;
  const security = production_security();
  const appValue: NodeHostedApplication = {
    name: "pressure",
    authorities: [{ kind: "exact", value: "pressure" }],
    security,
    acceptWebSocket(_locusSelector, websocket) {
      Object.defineProperty(websocket, "bufferedAmount", { configurable: true, value: 2 });
      create_node_locus_socket(websocket, {
        maxBufferedAmount: 1,
        onBackpressure: () => backpressure += 1,
      }).send("canonical-commit");
    },
    dispose() {},
  };
  const host = await start_node_application_host({
    port: 0,
    deployment: { mode: "production" },
    applications: [Object.freeze(appValue)],
  });
  const websocket = await open_websocket(`${host.url}?locus=pressure`, secureHeaders);
  assert.equal(await socket_close(websocket), 1013);
  assert.equal(backpressure, 1);
  await host.stop();
});

await sequence;
process.stdout.write(`# ${checks} Locus Node hosting checks passed\n`);
emit_hson_live_test_completion("livehost.node-hosting", checks, checks, 0);

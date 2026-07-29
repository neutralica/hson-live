// @hson-live-external-test
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { create_livehost } from "hson-live/livehost";
import {
  create_browser_livehost_socket,
  type BrowserWebSocketLike,
} from "hson-live/livehost";
import {
  create_node_livehost_socket,
  start_node_application_host,
  type NodeAuthorityNamespace,
  type NodeHostedApplication,
  type NodeHostOperationalEvent,
} from "hson-live/livehost/node";
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
  adapter: ReturnType<typeof create_browser_livehost_socket>;
}> {
  let raw: MockBrowserWebSocket | undefined;
  class Constructor extends MockBrowserWebSocket {
    constructor(_url: string) {
      super();
      raw = this;
    }
  }
  const adapter = create_browser_livehost_socket("ws://example.test", Constructor);
  if (raw === undefined) throw new Error("browser fixture constructor did not run");
  return { raw, adapter };
}

function open_websocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url);
    websocket.once("open", () => resolve(websocket));
    websocket.once("error", reject);
  });
}

function rejected_websocket_status(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url);
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
      acceptWebSocket(_authorityId: string, websocket: WebSocket) {
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
  assert.deepEqual(raw.closes.at(-1), { code: 1003, reason: "LiveHost accepts text messages only." });
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
  assert.deepEqual(raw.closes.at(-1), { code: 1011, reason: "LiveHost WebSocket error." });
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
  const client = await open_websocket(`${host.url}?livehost=node-text`);
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
    acceptWebSocket(_authorityId, websocket) {
      adapted = true;
      create_node_livehost_socket(websocket).onMessage(() => undefined);
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?livehost=node-binary`);
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
    acceptWebSocket(_authorityId, websocket) {
      const stop = create_node_livehost_socket(websocket).onMessage(() => messages += 1);
      stop?.();
      stop?.();
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?livehost=node-dispose`);
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
    acceptWebSocket(_authorityId, websocket) {
      const stop = create_node_livehost_socket(websocket).onClose(() => closes += 1);
      stop?.();
      stop?.();
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?livehost=node-close`);
  const closed = socket_close(client);
  client.close();
  await closed;
  assert.equal(closes, 0);
  await host.stop();
});

check("Node adapter isolates send after transport closure", async () => {
  let adapter: ReturnType<typeof create_node_livehost_socket> | undefined;
  const app: NodeHostedApplication = Object.freeze({
    name: "node-send",
    authorities: [{ kind: "exact" as const, value: "node-send" }],
    acceptWebSocket(_authorityId, websocket) {
      adapter = create_node_livehost_socket(websocket);
    },
    dispose() {},
  });
  const host = await start_node_application_host({ port: 0, applications: [app] });
  const client = await open_websocket(`${host.url}?livehost=node-send`);
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

check("built browser and authority entrypoints exclude Node transport modules", async () => {
  const [root, livehost, authorityCore, nodeHost] = await Promise.all([
    readFile(new URL("../dist/index.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/api/livehost/index.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/api/livehost/livehost.core.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/api/livehost/node/livehost.node-application-host.js", import.meta.url), "utf8"),
  ]);
  for (const source of [root, livehost, authorityCore]) {
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
  const alphaSocket = await open_websocket(`${host.url}?livehost=alpha`);
  const betaSocket = await open_websocket(`${host.url}?livehost=beta%3Aroom`);
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
  assert.equal(await rejected_websocket_status(`${host.url}?livehost=room%3A1`), 404);
  assert.equal(await rejected_websocket_status(`${host.url}?livehost=unknown`), 404);
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
  const betaSocket = await open_websocket(`${host.url}?livehost=beta`);
  assert.equal(beta.accepts(), 1);
  assert.equal(alpha.disposals(), 1);
  betaSocket.close();
  await host.stop();
  assert.equal(alpha.disposals(), 1);
  assert.equal(beta.disposals(), 1);
});

check("multiple LiveHost authorities coexist behind independent applications", async () => {
  const firstAuthority = create_livehost({ state: { id: "equal", count: 0 } });
  const secondAuthority = create_livehost({ state: { id: "equal", count: 0 } });
  const first: NodeHostedApplication = Object.freeze({
    name: "authority-a",
    authorities: [{ kind: "exact" as const, value: "authority-a" }],
    acceptWebSocket(_id, websocket) {
      firstAuthority.connect(create_node_livehost_socket(websocket));
    },
    dispose() { firstAuthority.dispose(); },
  });
  const second: NodeHostedApplication = Object.freeze({
    name: "authority-b",
    authorities: [{ kind: "exact" as const, value: "authority-b" }],
    acceptWebSocket(_id, websocket) {
      secondAuthority.connect(create_node_livehost_socket(websocket));
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
  const websocket = await open_websocket(`${host.url}?livehost=active`);
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
  const websocket = await open_websocket(`${host.url}?livehost=logged`);
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

await sequence;
process.stdout.write(`# ${checks} LiveHost Node hosting checks passed\n`);

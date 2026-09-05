import { createServer, type IncomingMessage } from "node:http";
import { createSecureServer, Http2ServerRequest, Http2ServerResponse, type ServerHttp2Session } from "node:http2";
import type { AddressInfo, Socket } from "node:net";
import { Duplex, Readable } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type {
  LiveHost,
  LiveHostApplication,
  LiveHostApplicationContext,
  LiveHostConnection,
  LiveHostConnectionRoute,
  LiveHostPrincipal,
  LiveHostRequestRoute,
} from "../../../types/livehost.types.js";
import {
  create_node_development_security,
  normalize_node_request,
  type NodeApplicationSecurity,
  type NodePolicyRejection,
  type NodePolicyResult,
  type NodeRequestContext,
  type NodeTrustedProxyPolicy,
} from "./livehost.node-policy.js";

export type NodeHostOperationalEvent = Readonly<{
  type:
    | "application-registration"
    | "registration-conflict"
    | "host-startup"
    | "host-listening"
    | "http-dispatch"
    | "websocket-dispatch"
    | "policy-rejection"
    | "resource-rejection"
    | "heartbeat-timeout"
    | "backpressure"
    | "startup-failure"
    | "shutdown-start"
    | "shutdown-completion"
    | "shutdown-failure";
  application?: string;
  route?: string;
  host?: string;
  port?: number;
  correlationId?: string;
  transport?: "http" | "websocket";
  proxyInterpretation?: "direct" | "trusted-proxy";
  outcome?: "accepted" | "rejected";
  code?: string;
  error?: string;
}>;

export type NodeHostTransportLimits = Readonly<{
  maxHeaderBytes: number;
  maxHeaderValueBytes: number;
  maxUrlBytes: number;
  headersTimeoutMs: number;
  requestTimeoutMs: number;
  handshakeTimeoutMs: number;
  maxPendingHandshakes: number;
  maxPayloadBytes: number;
  messageWindowMs: number;
  maxMessagesPerWindow: number;
  maxMessageBytesPerWindow: number;
  maxConnections: number;
  maxConnectionsPerApplication: number;
  maxConnectionsPerClient: number;
  heartbeatIntervalMs: number;
  heartbeatDeadlineMs: number;
  maxBufferedAmount: number;
}>;

export type NodeHostDeployment =
  | Readonly<{ mode: "development" }>
  | Readonly<{
      mode: "production";
      proxy?: NodeTrustedProxyPolicy;
      limits?: Partial<NodeHostTransportLimits>;
    }>;

export type NodeApplicationHostOptions = Readonly<{
  host?: string;
  port?: number;
  shutdownTimeoutMs?: number;
  /** Serve HTTPS with HTTP/2 and HTTP/1 compatibility using PEM TLS material. */
  http2?: Readonly<{ key: string | Buffer; cert: string | Buffer }>;
  deployment?: NodeHostDeployment;
  applications: readonly LiveHostApplication[];
  security?: ReadonlyMap<string, NodeApplicationSecurity>;
  log?: (event: NodeHostOperationalEvent) => void;
}>;

export type NodeApplicationHost = LiveHost & Readonly<{
  host: string;
  port: number;
  url: string;
  httpUrl: string;
  connectionCount(applicationName?: string): number;
  disconnectConnections(applicationName?: string): void;
}>;

// Both compatibility APIs use the same routing, policy, and streaming adapters.
type NodeRequest = IncomingMessage | Http2ServerRequest;
type NodeResponse = {
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  readonly headersSent: boolean;
  setHeader(name: string, value: string | string[]): void;
  writeHead(status: number, headers?: Record<string, string>): void;
  write(chunk: Uint8Array): boolean;
  end(): void;
  end(data: string): void;
  destroy(): void;
  once(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
};

type RegisteredRequestRoute = Readonly<{
  application: LiveHostApplication;
  route: LiveHostRequestRoute;
}>;

type RegisteredConnectionRoute = Readonly<{
  application: LiveHostApplication;
  route: LiveHostConnectionRoute;
}>;

type ActiveConnection = {
  readonly application: string;
  readonly route: string;
  readonly clientAddress: string;
  readonly correlationId: string;
  alive: boolean;
  heartbeatDeadline?: ReturnType<typeof setTimeout>;
  messageWindowStartedAt: number;
  messageCount: number;
  messageBytes: number;
};

const PRODUCTION_LIMITS: NodeHostTransportLimits = Object.freeze({
  maxHeaderBytes: 16 * 1024,
  maxHeaderValueBytes: 8 * 1024,
  maxUrlBytes: 4 * 1024,
  headersTimeoutMs: 10_000,
  requestTimeoutMs: 15_000,
  handshakeTimeoutMs: 5_000,
  maxPendingHandshakes: 64,
  maxPayloadBytes: 1024 * 1024,
  messageWindowMs: 10_000,
  maxMessagesPerWindow: 120,
  maxMessageBytesPerWindow: 2 * 1024 * 1024,
  maxConnections: 1_000,
  maxConnectionsPerApplication: 500,
  maxConnectionsPerClient: 20,
  heartbeatIntervalMs: 30_000,
  heartbeatDeadlineMs: 10_000,
  maxBufferedAmount: 1024 * 1024,
});

const DEVELOPMENT_LIMITS: NodeHostTransportLimits = Object.freeze({
  ...PRODUCTION_LIMITS,
  maxPendingHandshakes: 256,
  maxConnections: 10_000,
  maxConnectionsPerApplication: 10_000,
  maxConnectionsPerClient: 1_000,
});

function positive_integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function resolve_limits(deployment: NodeHostDeployment): NodeHostTransportLimits {
  const defaults = deployment.mode === "production" ? PRODUCTION_LIMITS : DEVELOPMENT_LIMITS;
  const values = deployment.mode === "production" ? { ...defaults, ...deployment.limits } : defaults;
  for (const [name, value] of Object.entries(values)) positive_integer(value, `Node host ${name}`);
  if (values.heartbeatDeadlineMs >= values.heartbeatIntervalMs) {
    throw new Error("Node host heartbeatDeadlineMs must be less than heartbeatIntervalMs.");
  }
  return Object.freeze(values);
}

function route_key(route: LiveHostRequestRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

function validate_path(path: string, description: string): void {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error(`${description} must be an exact absolute path.`);
  }
}

function register_applications(
  applications: readonly LiveHostApplication[],
  deployment: NodeHostDeployment,
  security: ReadonlyMap<string, NodeApplicationSecurity>,
  log: (event: NodeHostOperationalEvent) => void,
): Readonly<{
  requests: readonly RegisteredRequestRoute[];
  connections: readonly RegisteredConnectionRoute[];
}> {
  const names = new Set<string>();
  const requestKeys = new Set<string>();
  const connectionPaths = new Set<string>();
  const requests: RegisteredRequestRoute[] = [];
  const connections: RegisteredConnectionRoute[] = [];
  for (const application of applications) {
    if (application.name.trim() === "" || names.has(application.name)) {
      const error = `Duplicate or empty Node application name: ${JSON.stringify(application.name)}.`;
      log({ type: "registration-conflict", application: application.name, error });
      throw new Error(error);
    }
    if (deployment.mode === "production" && !security.has(application.name)) {
      const error = `Production Node application "${application.name}" requires explicit security policy.`;
      log({ type: "registration-conflict", application: application.name, error });
      throw new Error(error);
    }
    names.add(application.name);
    for (const route of application.requests ?? []) {
      validate_path(route.path, `Application "${application.name}" request route`);
      const key = route_key(route);
      if (route.path === "/healthz" || requestKeys.has(key)) {
        const error = route.path === "/healthz"
          ? `Application "${application.name}" conflicts with reserved route ${key}.`
          : `HTTP route ${key} overlaps another application.`;
        log({ type: "registration-conflict", application: application.name, route: key, error });
        throw new Error(error);
      }
      requestKeys.add(key);
      requests.push(Object.freeze({ application, route }));
    }
    for (const route of application.connections ?? []) {
      validate_path(route.path, `Application "${application.name}" connection route`);
      if (connectionPaths.has(route.path)) {
        const error = `Connection route ${route.path} overlaps another application.`;
        log({ type: "registration-conflict", application: application.name, route: route.path, error });
        throw new Error(error);
      }
      connectionPaths.add(route.path);
      connections.push(Object.freeze({ application, route }));
    }
    log({ type: "application-registration", application: application.name });
  }
  return Object.freeze({ requests: Object.freeze(requests), connections: Object.freeze(connections) });
}

function status_text(status: number): string {
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 408) return "Request Timeout";
  if (status === 413) return "Content Too Large";
  if (status === 429) return "Too Many Requests";
  if (status === 503) return "Service Unavailable";
  return "Not Found";
}

function reject_upgrade(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${status_text(status)}\r\n`
    + "Connection: close\r\n"
    + "Content-Type: text/plain; charset=utf-8\r\n"
    + "Cache-Control: no-store\r\n"
    + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
    + body,
  );
  socket.destroy();
}

function reject_http(response: NodeResponse, rejection: NodePolicyRejection): void {
  response.writeHead(rejection.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ error: { code: rejection.code } }));
}

async function dispose_once(
  applications: readonly LiveHostApplication[],
  disposed: Set<LiveHostApplication>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const application of applications) {
    if (disposed.has(application)) continue;
    disposed.add(application);
    try {
      await application.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length !== 0) throw new AggregateError(failures, "One or more applications failed to dispose.");
}

async function bounded_policy<T>(
  run: () => NodePolicyResult<T> | Promise<NodePolicyResult<T>>,
  timeoutMs: number,
): Promise<NodePolicyResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<NodePolicyRejection>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, status: 408, code: "NODE_HOST_POLICY_TIMEOUT" }),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    return { ok: false, status: 403, code: "NODE_HOST_POLICY_FAILED" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function request_has_body(request: NodeRequest): boolean {
  if (request instanceof Http2ServerRequest) return !request.stream.endAfterHeaders;
  return request.headers["transfer-encoding"] !== undefined
    || Number(request.headers["content-length"] ?? "0") !== 0;
}

function make_web_request(request: NodeRequest, url: URL): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name.startsWith(":")) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const method = request.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD" && request_has_body(request)) {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(url, init);
}

function apply_web_response_headers(target: NodeResponse, headers: Headers): void {
  const omitted = new Set<string>();
  if (target instanceof Http2ServerResponse) {
    for (const name of ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te"]) {
      omitted.add(name);
    }
    for (const name of (headers.get("connection") ?? "").split(",")) omitted.add(name.trim().toLowerCase());
  }
  headers.forEach((value, name) => {
    if (name !== "set-cookie" && !omitted.has(name)) target.setHeader(name, value);
  });
  const cookies = headers.getSetCookie();
  if (cookies.length > 0 && !omitted.has("set-cookie")) target.setHeader("set-cookie", cookies);
}

function wait_for_node_response_drain(target: NodeResponse): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = (): void => {
      target.off("drain", drained);
      target.off("close", closed);
      target.off("error", closed);
    };
    const drained = (): void => {
      cleanup();
      resolve(true);
    };
    const closed = (): void => {
      cleanup();
      resolve(false);
    };
    target.once("drain", drained);
    target.once("close", closed);
    target.once("error", closed);
  });
}

async function write_web_response(
  target: NodeResponse,
  source: Response,
  headRequest: boolean,
): Promise<void> {
  if (headRequest || source.body === null) {
    if (source.body !== null) {
      await source.body.cancel("HEAD response body omitted by Node LiveHost.").catch(() => undefined);
    }
    apply_web_response_headers(target, source.headers);
    target.writeHead(source.status);
    target.end();
    return;
  }

  if (target.destroyed) {
    await source.body.cancel("Node response transport disconnected.").catch(() => undefined);
    return;
  }
  const reader = source.body.getReader();
  let disconnected = false;
  const cancel_reader = (): void => {
    if (target.writableEnded) return;
    disconnected = true;
    void reader.cancel("Node response transport disconnected.").catch(() => undefined);
  };
  target.once("close", cancel_reader);
  try {
    let next = await reader.read();
    if (disconnected || target.destroyed) return;
    apply_web_response_headers(target, source.headers);
    target.writeHead(source.status);
    while (!next.done) {
      if (!target.write(next.value) && !(await wait_for_node_response_drain(target))) {
        disconnected = true;
        void reader.cancel("Node response transport disconnected.").catch(() => undefined);
        return;
      }
      next = await reader.read();
      if (disconnected || target.destroyed) return;
    }
    target.end();
  } catch (cause) {
    if (target.headersSent) {
      if (!target.destroyed) target.destroy();
      return;
    }
    throw cause;
  } finally {
    target.off("close", cancel_reader);
    reader.releaseLock();
  }
}

function application_context(
  normalized: NodeRequestContext,
  principal: LiveHostPrincipal,
): LiveHostApplicationContext {
  return Object.freeze({
    applicationName: normalized.application,
    correlationId: normalized.correlationId,
    principal,
    ...(normalized.effectiveClientAddress === "unknown"
      ? {}
      : { clientAddress: normalized.effectiveClientAddress }),
  });
}

function raw_data_bytes(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, value) => total + value.byteLength, 0);
  return data.byteLength;
}

function binary_data(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(Buffer.from(data));
}

function make_connection(
  websocket: WebSocket,
  maxBufferedAmount: number,
  onBackpressure: () => void,
): LiveHostConnection {
  type PendingWrite = Readonly<{ data: string | Uint8Array; bytes: number }>;

  const queued: PendingWrite[] = [];
  let queuedBytes = 0;
  let inFlight = 0;
  let closed = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;

  const clear_drain_timer = (): void => {
    if (drainTimer === undefined) return;
    clearTimeout(drainTimer);
    drainTimer = undefined;
  };

  const release_queue = (): void => {
    clear_drain_timer();
    queued.length = 0;
    queuedBytes = 0;
    inFlight = 0;
  };

  const reject_backpressure = (): void => {
    if (closed) return;
    closed = true;
    release_queue();
    onBackpressure();
    websocket.close(1013, "LiveHost transport backpressure limit exceeded.");
  };

  const queue_limit = (candidateBytes: number): number => {
    let largest = candidateBytes;
    for (const pending of queued) largest = Math.max(largest, pending.bytes);
    return maxBufferedAmount + largest;
  };

  let flush = (): void => undefined;
  const transmit = (pending: PendingWrite): void => {
    if (closed || websocket.readyState !== websocket.OPEN) return;
    inFlight += 1;
    try {
      websocket.send(pending.data, (error) => {
        if (closed) return;
        inFlight = Math.max(0, inFlight - 1);
        if (error != null) {
          closed = true;
          release_queue();
          websocket.close(1011, "LiveHost connection send failed.");
          return;
        }
        flush();
      });
    } catch {
      inFlight = Math.max(0, inFlight - 1);
      closed = true;
      release_queue();
      websocket.close(1011, "LiveHost connection send failed.");
    }
  };

  const schedule_flush = (): void => {
    if (drainTimer !== undefined || closed) return;
    drainTimer = setTimeout(() => {
      drainTimer = undefined;
      flush();
    }, 1);
    drainTimer.unref?.();
  };

  flush = (): void => {
    if (closed || queued.length === 0) return;
    if (websocket.readyState !== websocket.OPEN) {
      release_queue();
      return;
    }
    if (websocket.bufferedAmount > maxBufferedAmount) {
      schedule_flush();
      return;
    }
    while (!closed && queued.length > 0 && websocket.bufferedAmount <= maxBufferedAmount) {
      const pending = queued.shift();
      if (pending === undefined) return;
      queuedBytes -= pending.bytes;
      transmit(pending);
    }
    if (!closed && queued.length > 0) schedule_flush();
  };

  websocket.once("close", () => {
    closed = true;
    release_queue();
  });

  return Object.freeze({
    send(data: string | Uint8Array) {
      if (closed || websocket.readyState !== websocket.OPEN) return;
      const pending = Object.freeze({ data, bytes: Buffer.byteLength(data) });
      if (queued.length > 0 || websocket.bufferedAmount > maxBufferedAmount) {
        if (inFlight === 0 && queued.length === 0) {
          reject_backpressure();
          return;
        }
        if (queuedBytes + pending.bytes > queue_limit(pending.bytes)) {
          reject_backpressure();
          return;
        }
        queued.push(pending);
        queuedBytes += pending.bytes;
        flush();
        return;
      }
      transmit(pending);
    },
    close(code?: number, reason?: string) {
      if (closed || websocket.readyState === websocket.CLOSED) return;
      closed = true;
      release_queue();
      websocket.close(code, reason);
    },
    onMessage(listener: (data: string | Uint8Array) => void) {
      const handle = (data: RawData, isBinary: boolean): void => {
        listener(isBinary ? binary_data(data) : data.toString());
      };
      websocket.on("message", handle);
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        websocket.off("message", handle);
      };
    },
    onClose(listener: () => void) {
      const handle = (): void => listener();
      websocket.on("close", handle);
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        websocket.off("close", handle);
      };
    },
  });
}

/** @experimental Node implementation of the platform-neutral LiveHost contract. */
export async function start_node_application_host(
  options: NodeApplicationHostOptions,
): Promise<NodeApplicationHost> {
  const secure = options.http2 !== undefined;
  const scheme = secure ? "https" : "http";
  const bindHost = options.host ?? "127.0.0.1";
  const bindPort = options.port ?? 8787;
  const shutdownTimeoutMs = positive_integer(options.shutdownTimeoutMs ?? 5_000, "Node application host shutdown timeout");
  const deployment: NodeHostDeployment = options.deployment ?? { mode: "development" };
  const limits = resolve_limits(deployment);
  const log = options.log ?? (() => undefined);
  const applications = Object.freeze([...options.applications]);
  const security = options.security ?? new Map<string, NodeApplicationSecurity>();
  const disposedApplications = new Set<LiveHostApplication>();
  const developmentSecurity = create_node_development_security();
  log({ type: "host-startup", host: bindHost, port: bindPort });
  let routes: ReturnType<typeof register_applications>;
  try {
    routes = register_applications(applications, deployment, security, log);
  } catch (error) {
    await dispose_once(applications, disposedApplications);
    log({
      type: "startup-failure",
      host: bindHost,
      port: bindPort,
      code: "NODE_HOST_REGISTRATION_FAILED",
      error: "Node application registration failed.",
    });
    throw error;
  }

  let operational = false;
  let stopping = false;
  let pendingHandshakes = 0;
  const activeConnections = new Map<WebSocket, ActiveConnection>();
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayloadBytes });

  const security_for = (application: LiveHostApplication): NodeApplicationSecurity =>
    security.get(application.name) ?? developmentSecurity;

  const authorize = async (
    application: LiveHostApplication,
    normalized: NodeRequestContext,
  ): Promise<NodePolicyResult<LiveHostPrincipal>> => {
    const policy = security_for(application);
    const origin = await bounded_policy(() => policy.origin(normalized), limits.handshakeTimeoutMs);
    if (!origin.ok) return origin;
    const authenticated = await bounded_policy(() => policy.authenticate(normalized), limits.handshakeTimeoutMs);
    if (!authenticated.ok) return authenticated;
    const authorized = await bounded_policy(
      () => policy.authorize(normalized, authenticated.value),
      limits.handshakeTimeoutMs,
    );
    return authorized.ok ? authenticated : authorized;
  };

  const normalization_options = (): Readonly<{
    proxy?: NodeTrustedProxyPolicy;
    maxUrlBytes: number;
    maxHeaderValueBytes: number;
  }> => Object.freeze({
    ...(deployment.mode === "production" && deployment.proxy !== undefined
      ? { proxy: deployment.proxy }
      : {}),
    maxUrlBytes: limits.maxUrlBytes,
    maxHeaderValueBytes: limits.maxHeaderValueBytes,
  });

  const log_rejection = (
    application: LiveHostApplication,
    normalized: NodeRequestContext,
    transport: "http" | "websocket",
    rejection: NodePolicyRejection,
  ): void => log({
    type: "policy-rejection",
    application: application.name,
    correlationId: normalized.correlationId,
    transport,
    proxyInterpretation: normalized.proxyInterpretation,
    outcome: "rejected",
    code: rejection.code,
  });

  const handle_request = (request: NodeRequest, response: NodeResponse): void => {
    void (async () => {
      if (request instanceof Http2ServerRequest) {
        // Bound ingress only: a long-lived response must not inherit an upload deadline.
        if (!request.stream.endAfterHeaders) {
          const timer = setTimeout(() => {
            // END_STREAM may already be received while the application leaves body bytes buffered.
            if (!response.destroyed && request.stream.state.remoteClose !== 1) response.destroy();
          }, limits.requestTimeoutMs);
          const clear = (): void => { clearTimeout(timer); };
          request.once("end", clear);
          request.once("close", clear);
        }
        const headerBytes = request.rawHeaders.reduce((sum, value) => sum + Buffer.byteLength(value), 0);
        if (headerBytes > limits.maxHeaderBytes) {
          reject_http(response, { ok: false, status: 413, code: "NODE_HOST_HEADER_LIMIT" });
          return;
        }
      }
      if (!operational || stopping) {
        response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ready: false }));
        return;
      }
      if (Buffer.byteLength(request.url ?? "/") > limits.maxUrlBytes) {
        reject_http(response, { ok: false, status: 413, code: "NODE_HOST_URL_LIMIT" });
        return;
      }
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url ?? "/", `${scheme}://${request.headers[":authority"] ?? request.headers.host ?? bindHost}`);
      } catch {
        reject_http(response, { ok: false, status: 400, code: "NODE_HOST_REQUEST_MALFORMED" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/healthz") {
        const applicationHealth = applications.map((application) => ({
          name: application.name,
          ready: application.ready?.() ?? true,
        }));
        const ready = applicationHealth.every((application) => application.ready);
        log({ type: "http-dispatch", route: "GET /healthz", transport: "http", outcome: "accepted" });
        response.writeHead(ready ? 200 : 503, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ ready, applications: applicationHealth }));
        return;
      }
      const registered = routes.requests.find(({ route }) =>
        route.method.toUpperCase() === request.method && route.path === requestUrl.pathname);
      if (registered === undefined) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found.\n");
        return;
      }
      if ((request.method === "GET" || request.method === "HEAD") && request_has_body(request)) {
        reject_http(response, { ok: false, status: 400, code: "NODE_HOST_BODY_NOT_ALLOWED" });
        return;
      }
      const key = route_key(registered.route);
      const normalized = normalize_node_request(request, {
        transport: "http",
        application: registered.application.name,
        route: key,
      }, normalization_options());
      if (!normalized.ok) {
        reject_http(response, normalized);
        return;
      }
      const authorization = await authorize(registered.application, normalized.value);
      if (response.destroyed) return;
      if (!authorization.ok) {
        log_rejection(registered.application, normalized.value, "http", authorization);
        reject_http(response, authorization);
        return;
      }
      log({
        type: "http-dispatch",
        application: registered.application.name,
        route: key,
        correlationId: normalized.value.correlationId,
        transport: "http",
        proxyInterpretation: normalized.value.proxyInterpretation,
        outcome: "accepted",
      });
      try {
        const webRequest = make_web_request(request, normalized.value.url);
        const webResponse = await registered.route.handle(
          webRequest,
          application_context(normalized.value, authorization.value),
        );
        await write_web_response(response, webResponse, request.method === "HEAD");
      } catch {
        if (response.destroyed || response.writableEnded) return;
        if (response.headersSent) {
          response.destroy();
          return;
        }
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("Application request failed.\n");
      }
    })();
  };
  let server: ReturnType<typeof createServer> | ReturnType<typeof createSecureServer>;
  try {
    server = options.http2 === undefined
      ? createServer({ maxHeaderSize: limits.maxHeaderBytes }, handle_request)
      : createSecureServer({
          key: options.http2.key,
          cert: options.http2.cert,
          allowHTTP1: true,
          handshakeTimeout: limits.handshakeTimeoutMs,
          settings: { maxHeaderListSize: limits.maxHeaderBytes },
        }, handle_request);
  } catch (error) {
    await dispose_once(applications, disposedApplications);
    log({ type: "startup-failure", code: "NODE_HOST_TLS_FAILED", error: "Node application host TLS setup failed." });
    throw error;
  }
  // Node's HTTP/1 compatibility parser reads these properties too.
  Object.assign(server, {
    maxHeaderSize: limits.maxHeaderBytes,
    headersTimeout: limits.headersTimeoutMs,
    requestTimeout: limits.requestTimeoutMs,
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const sessions = new Set<ServerHttp2Session>();
  const sessionClosures = new Set<Promise<void>>();
  if ("updateSettings" in server) {
    server.on("session", (session) => {
      if (stopping) { session.destroy(); return; }
      sessions.add(session);
      const closed = new Promise<void>((resolve) => session.once("close", resolve));
      sessionClosures.add(closed);
      void closed.then(() => { sessions.delete(session); sessionClosures.delete(closed); });
      session.on("error", () => undefined);
    });
  }

  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      if (!operational || stopping) {
        reject_upgrade(socket, 503, "Host is not accepting connection work.");
        return;
      }
      if (pendingHandshakes >= limits.maxPendingHandshakes) {
        log({ type: "resource-rejection", transport: "websocket", outcome: "rejected", code: "NODE_HOST_PENDING_LIMIT" });
        reject_upgrade(socket, 503, "Connection admission unavailable.");
        return;
      }
      if (Buffer.byteLength(request.url ?? "/") > limits.maxUrlBytes) {
        reject_upgrade(socket, 413, "Connection request is too large.");
        return;
      }
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url ?? "/", `${scheme}://${request.headers[":authority"] ?? request.headers.host ?? bindHost}`);
      } catch {
        reject_upgrade(socket, 400, "Malformed connection request.");
        return;
      }
      const registered = routes.connections.find(({ route }) => route.path === requestUrl.pathname);
      if (registered === undefined) {
        reject_upgrade(socket, 404, "No application owns this connection route.");
        return;
      }
      pendingHandshakes += 1;
      try {
        const normalized = normalize_node_request(request, {
          transport: "websocket",
          application: registered.application.name,
          route: registered.route.path,
        }, normalization_options());
        if (!normalized.ok) {
          reject_upgrade(socket, normalized.status, "Connection request rejected.");
          return;
        }
        const authorization = await authorize(registered.application, normalized.value);
        if (!authorization.ok) {
          log_rejection(registered.application, normalized.value, "websocket", authorization);
          reject_upgrade(socket, authorization.status, "Connection policy rejected.");
          return;
        }
        const appConnections = [...activeConnections.values()]
          .filter((item) => item.application === registered.application.name).length;
        const clientConnections = [...activeConnections.values()]
          .filter((item) => item.clientAddress === normalized.value.effectiveClientAddress).length;
        if (
          activeConnections.size >= limits.maxConnections
          || appConnections >= limits.maxConnectionsPerApplication
          || clientConnections >= limits.maxConnectionsPerClient
        ) {
          log({
            type: "resource-rejection",
            application: registered.application.name,
            correlationId: normalized.value.correlationId,
            transport: "websocket",
            proxyInterpretation: normalized.value.proxyInterpretation,
            outcome: "rejected",
            code: "NODE_HOST_CONNECTION_LIMIT",
          });
          reject_upgrade(socket, 503, "Connection capacity unavailable.");
          return;
        }
        if (!operational || stopping || socket.destroyed) {
          if (!socket.destroyed) reject_upgrade(socket, 503, "Host is not accepting connection work.");
          return;
        }
        const webRequest = make_web_request(request, normalized.value.url);
        websocketServer.handleUpgrade(request, socket, head, (websocket) => {
          const state: ActiveConnection = {
            application: registered.application.name,
            route: registered.route.path,
            clientAddress: normalized.value.effectiveClientAddress,
            correlationId: normalized.value.correlationId,
            alive: true,
            messageWindowStartedAt: Date.now(),
            messageCount: 0,
            messageBytes: 0,
          };
          activeConnections.set(websocket, state);
          websocket.on("error", () => undefined);
          websocket.on("pong", () => {
            state.alive = true;
            if (state.heartbeatDeadline !== undefined) clearTimeout(state.heartbeatDeadline);
            state.heartbeatDeadline = undefined;
          });
          websocket.prependListener("message", (data) => {
            const now = Date.now();
            if (now - state.messageWindowStartedAt >= limits.messageWindowMs) {
              state.messageWindowStartedAt = now;
              state.messageCount = 0;
              state.messageBytes = 0;
            }
            state.messageCount += 1;
            state.messageBytes += raw_data_bytes(data);
            if (
              state.messageCount > limits.maxMessagesPerWindow
              || state.messageBytes > limits.maxMessageBytesPerWindow
            ) {
              log({
                type: "resource-rejection",
                application: registered.application.name,
                correlationId: state.correlationId,
                transport: "websocket",
                outcome: "rejected",
                code: "NODE_HOST_MESSAGE_RATE_LIMIT",
              });
              websocket.close(1008, "Connection message budget exceeded.");
            }
          });
          websocket.once("close", () => {
            if (state.heartbeatDeadline !== undefined) clearTimeout(state.heartbeatDeadline);
            activeConnections.delete(websocket);
          });
          log({
            type: "websocket-dispatch",
            application: registered.application.name,
            route: registered.route.path,
            correlationId: normalized.value.correlationId,
            transport: "websocket",
            proxyInterpretation: normalized.value.proxyInterpretation,
            outcome: "accepted",
          });
          const connection = make_connection(websocket, limits.maxBufferedAmount, () => {
            log({
              type: "backpressure",
              application: registered.application.name,
              correlationId: normalized.value.correlationId,
              transport: "websocket",
              outcome: "rejected",
              code: "NODE_HOST_BACKPRESSURE",
            });
          });
          websocket.pause();
          void Promise.resolve().then(() => registered.route.accept(
            webRequest,
            connection,
            application_context(normalized.value, authorization.value),
          )).then(
            () => {
              if (websocket.readyState === websocket.OPEN) websocket.resume();
            },
            () => {
              websocket.resume();
              websocket.close(1011, "Application connection dispatch failed.");
            },
          );
        });
      } finally {
        pendingHandshakes -= 1;
      }
    })();
  });

  const heartbeat = setInterval(() => {
    if (!operational || stopping) return;
    for (const [websocket, state] of activeConnections) {
      if (websocket.readyState !== websocket.OPEN || !state.alive) continue;
      state.alive = false;
      websocket.ping();
      state.heartbeatDeadline = setTimeout(() => {
        if (state.alive) return;
        log({
          type: "heartbeat-timeout",
          application: state.application,
          route: state.route,
          correlationId: state.correlationId,
          transport: "websocket",
          outcome: "rejected",
          code: "NODE_HOST_HEARTBEAT_TIMEOUT",
        });
        websocket.terminate();
      }, limits.heartbeatDeadlineMs);
      state.heartbeatDeadline.unref?.();
    }
  }, limits.heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(bindPort, bindHost);
    });
  } catch (error) {
    clearInterval(heartbeat);
    await dispose_once(applications, disposedApplications);
    log({
      type: "startup-failure",
      host: bindHost,
      port: bindPort,
      code: "NODE_HOST_LISTEN_FAILED",
      error: "Node application host failed to listen.",
    });
    throw error;
  }
  operational = true;
  const address = server.address() as AddressInfo | null;
  if (address === null) {
    clearInterval(heartbeat);
    await dispose_once(applications, disposedApplications);
    server.close();
    throw new Error("Node application host did not expose a TCP address.");
  }
  const port = address.port;
  log({ type: "host-listening", host: bindHost, port });

  let shutdown: Promise<void> | undefined;
  const dispose = (): Promise<void> => shutdown ??= (async () => {
    stopping = true;
    operational = false;
    clearInterval(heartbeat);
    log({ type: "shutdown-start" });
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
    // Cancel every H2 stream on disposal; ordinary stream cancellation never touches its session.
    for (const session of sessions) session.destroy();
    const shutdownWork = (async () => {
      let disposalError: unknown;
      try {
        await dispose_once(applications, disposedApplications);
      } catch (error) {
        disposalError = error;
      }
      for (const [websocket, state] of [...activeConnections]) {
        if (state.heartbeatDeadline !== undefined) clearTimeout(state.heartbeatDeadline);
        websocket.close(1001, "Node application host stopping.");
      }
      await Promise.all([serverClosed, ...sessionClosures]);
      activeConnections.clear();
      if (disposalError !== undefined) throw disposalError;
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        for (const websocket of [...activeConnections.keys()]) websocket.terminate();
        for (const session of sessions) session.destroy();
        for (const socket of sockets) socket.destroy();
        reject(new Error(`Node application host shutdown exceeded ${shutdownTimeoutMs}ms.`));
      }, shutdownTimeoutMs);
    });
    try {
      await Promise.race([shutdownWork, timeout]);
      if (timer !== undefined) clearTimeout(timer);
      log({ type: "shutdown-completion" });
    } catch (error) {
      if (timer !== undefined) clearTimeout(timer);
      log({
        type: "shutdown-failure",
        code: "NODE_HOST_SHUTDOWN_FAILED",
        error: "Node application host shutdown failed.",
      });
      throw error;
    }
  })();

  return Object.freeze({
    host: bindHost,
    port,
    url: `${secure ? "wss" : "ws"}://${bindHost}:${port}`,
    httpUrl: `${scheme}://${bindHost}:${port}`,
    applicationNames: Object.freeze(applications.map((application) => application.name)),
    ready: () => operational && !stopping && applications.every((application) => application.ready?.() ?? true),
    connectionCount(applicationName?: string) {
      return [...activeConnections.values()]
        .filter((connection) => applicationName === undefined || connection.application === applicationName)
        .length;
    },
    disconnectConnections(applicationName?: string) {
      for (const [websocket, connection] of [...activeConnections]) {
        if (applicationName !== undefined && connection.application !== applicationName) continue;
        websocket.close(1012, "Application connection interrupted.");
      }
    },
    dispose,
  });
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  create_node_development_security,
  normalize_node_request,
  type NodeApplicationSecurity,
  type NodeAuthenticatedPrincipal,
  type NodePolicyRejection,
  type NodePolicyResult,
  type NodeRequestContext,
  type NodeTrustedProxyPolicy,
} from "./livehost.node-policy.js";
import type { LocusSelector } from "../../../types/locus.types.js";

export type NodeAuthorityNamespace =
  | Readonly<{ kind: "exact"; value: string }>
  | Readonly<{
      kind: "prefix";
      value: string;
      suffix?: Readonly<{ minLength: number; maxLength: number; pattern: RegExp }>;
    }>;

export type NodeApplicationHttpRoute = Readonly<{
  method: string;
  path: string;
  access?: "bootstrap-read" | "http-route";
  bodyless?: boolean;
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    context: NodeRequestContext,
    principal: NodeAuthenticatedPrincipal,
  ): void | Promise<void>;
}>;

export type NodeWebSocketTransportPolicy = Readonly<{
  maxBufferedAmount: number;
  onBackpressure(): void;
}>;

export type NodeWebSocketDispatchContext = Readonly<{
  request: NodeRequestContext;
  principal: NodeAuthenticatedPrincipal;
  transportPolicy: NodeWebSocketTransportPolicy;
}>;

export type NodeHostedApplication = Readonly<{
  name: string;
  authorities: readonly NodeAuthorityNamespace[];
  httpRoutes?: readonly NodeApplicationHttpRoute[];
  security?: NodeApplicationSecurity;
  ready?(): boolean;
  acceptWebSocket(
    locusSelector: LocusSelector,
    websocket: WebSocket,
    context: NodeWebSocketDispatchContext,
  ): void | Promise<void>;
  dispose(): void | Promise<void>;
}>;

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
  /**
   * Explicit deployment policy. Omission retains the experimental pre-2C1
   * localhost compatibility behavior; production executables must pass
   * `{ mode: "production" }`.
   */
  deployment?: NodeHostDeployment;
  applications: readonly NodeHostedApplication[];
  log?: (event: NodeHostOperationalEvent) => void;
}>;

export type NodeApplicationHost = Readonly<{
  host: string;
  port: number;
  url: string;
  httpUrl: string;
  applicationNames: readonly string[];
  connectionCount(applicationName?: string): number;
  disconnectConnections(applicationName?: string, locusSelector?: LocusSelector): void;
  stop(): Promise<void>;
}>;

type ActiveConnection = {
  readonly application: string;
  readonly locusSelector: LocusSelector;
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

function namespace_matches(namespace: NodeAuthorityNamespace, routingSelector: LocusSelector): boolean {
  if (namespace.kind === "exact") return routingSelector === namespace.value;
  if (!routingSelector.startsWith(namespace.value)) return false;
  const suffix = routingSelector.slice(namespace.value.length);
  if (suffix.length === 0) return false;
  const constraint = namespace.suffix;
  return constraint === undefined
    || (
      suffix.length >= constraint.minLength
      && suffix.length <= constraint.maxLength
      && constraint.pattern.test(suffix)
    );
}

function namespaces_overlap(left: NodeAuthorityNamespace, right: NodeAuthorityNamespace): boolean {
  if (left.kind === "exact") return namespace_matches(right, left.value);
  if (right.kind === "exact") return namespace_matches(left, right.value);
  return left.value.startsWith(right.value) || right.value.startsWith(left.value);
}

function route_key(route: NodeApplicationHttpRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

function validate_applications(
  applications: readonly NodeHostedApplication[],
  deployment: NodeHostDeployment,
  log: (event: NodeHostOperationalEvent) => void,
): void {
  const names = new Set<string>();
  const routes = new Map<string, string>();
  const collectedNamespaces: { application: string; namespace: NodeAuthorityNamespace }[] = [];
  for (const application of applications) {
    if (application.name.trim() === "" || names.has(application.name)) {
      const error = `Duplicate or empty Node application name: ${JSON.stringify(application.name)}.`;
      log({ type: "registration-conflict", application: application.name, error });
      throw new Error(error);
    }
    if (deployment.mode === "production" && application.security === undefined) {
      const error = `Production Node application "${application.name}" requires explicit security policy.`;
      log({ type: "registration-conflict", application: application.name, error });
      throw new Error(error);
    }
    names.add(application.name);
    for (const route of application.httpRoutes ?? []) {
      const key = route_key(route);
      const existing = routes.get(key);
      if (route.path === "/healthz" || existing !== undefined) {
        const error = route.path === "/healthz"
          ? `Application "${application.name}" conflicts with reserved route ${key}.`
          : `HTTP route ${key} overlaps applications "${existing}" and "${application.name}".`;
        log({ type: "registration-conflict", application: application.name, route: key, error });
        throw new Error(error);
      }
      routes.set(key, application.name);
    }
    for (const namespace of application.authorities) {
      if (namespace.value.length === 0) {
        const error = `Application "${application.name}" registered an empty authority namespace.`;
        log({ type: "registration-conflict", application: application.name, error });
        throw new Error(error);
      }
      if (
        namespace.kind === "prefix"
        && namespace.suffix !== undefined
        && (
          !Number.isInteger(namespace.suffix.minLength)
          || !Number.isInteger(namespace.suffix.maxLength)
          || namespace.suffix.minLength < 1
          || namespace.suffix.maxLength < namespace.suffix.minLength
          || namespace.suffix.pattern.global
          || namespace.suffix.pattern.sticky
        )
      ) {
        const error = `Application "${application.name}" registered an invalid authority suffix constraint.`;
        log({ type: "registration-conflict", application: application.name, error });
        throw new Error(error);
      }
      for (const existing of collectedNamespaces) {
        if (namespaces_overlap(existing.namespace, namespace)) {
          const error = `Authority namespaces overlap applications "${existing.application}" and "${application.name}".`;
          log({ type: "registration-conflict", application: application.name, error });
          throw new Error(error);
        }
      }
      collectedNamespaces.push({ application: application.name, namespace });
    }
    log({ type: "application-registration", application: application.name });
  }
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

function reject_http(response: ServerResponse, rejection: NodePolicyRejection): void {
  response.writeHead(rejection.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ error: { code: rejection.code } }));
}

async function dispose_once(
  applications: readonly NodeHostedApplication[],
  disposed: Set<NodeHostedApplication>,
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
  if (failures.length !== 0) throw new AggregateError(failures, "One or more Node applications failed to dispose.");
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

/** @experimental Transport-only Node application host. */
export async function start_node_application_host(
  options: NodeApplicationHostOptions,
): Promise<NodeApplicationHost> {
  const bindHost = options.host ?? "127.0.0.1";
  const bindPort = options.port ?? 8787;
  const shutdownTimeoutMs = positive_integer(options.shutdownTimeoutMs ?? 5_000, "Node application host shutdown timeout");
  const deployment: NodeHostDeployment = options.deployment ?? { mode: "development" };
  const limits = resolve_limits(deployment);
  const log = options.log ?? (() => undefined);
  const applications = Object.freeze([...options.applications]);
  const disposedApplications = new Set<NodeHostedApplication>();
  log({ type: "host-startup", host: bindHost, port: bindPort });
  try {
    validate_applications(applications, deployment, log);
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
  const developmentSecurity = create_node_development_security();

  const security_for = (application: NodeHostedApplication): NodeApplicationSecurity =>
    application.security ?? developmentSecurity;

  const select_authority = (routingSelector: LocusSelector): NodeHostedApplication | undefined => {
    let selected: NodeHostedApplication | undefined;
    for (const application of applications) {
      if (!application.authorities.some((namespace) => namespace_matches(namespace, routingSelector))) continue;
      if (selected !== undefined) throw new Error(`Ambiguous WebSocket authority dispatch for "${routingSelector}".`);
      selected = application;
    }
    return selected;
  };

  const server = createServer({ maxHeaderSize: limits.maxHeaderBytes }, (request, response) => {
    void (async () => {
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
        requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? bindHost}`);
      } catch {
        reject_http(response, { ok: false, status: 400, code: "NODE_HOST_REQUEST_MALFORMED" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/healthz") {
        log({ type: "http-dispatch", route: "GET /healthz", transport: "http", outcome: "accepted" });
        const applicationHealth = applications.map((application) => ({
          name: application.name,
          ready: application.ready?.() ?? true,
        }));
        const ready = applicationHealth.every((application) => application.ready);
        response.writeHead(ready ? 200 : 503, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ ready, applications: applicationHealth }));
        return;
      }
      const route = applications
        .flatMap((application) => (application.httpRoutes ?? []).map((candidate) => ({ application, candidate })))
        .find(({ candidate }) => candidate.method.toUpperCase() === request.method && candidate.path === requestUrl.pathname);
      if (route === undefined) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found.\n");
        return;
      }
      if (
        route.candidate.bodyless === true
        && (request.headers["transfer-encoding"] !== undefined || Number(request.headers["content-length"] ?? "0") !== 0)
      ) {
        reject_http(response, { ok: false, status: 400, code: "NODE_HOST_BODY_NOT_ALLOWED" });
        return;
      }
      const normalized = normalize_node_request(request, {
        transport: "http",
        application: route.application.name,
        route: `${request.method} ${requestUrl.pathname}`,
        ...(requestUrl.searchParams.get("locus") === null
          ? {}
          : { locusSelector: requestUrl.searchParams.get("locus") ?? undefined }),
      }, {
        ...(deployment.mode === "production" && deployment.proxy !== undefined
          ? { proxy: deployment.proxy }
          : {}),
        maxUrlBytes: limits.maxUrlBytes,
        maxHeaderValueBytes: limits.maxHeaderValueBytes,
      });
      if (!normalized.ok) {
        reject_http(response, normalized);
        return;
      }
      const security = security_for(route.application);
      const origin = await bounded_policy(() => security.origin(normalized.value), limits.handshakeTimeoutMs);
      if (!origin.ok) {
        log({ type: "policy-rejection", application: route.application.name, correlationId: normalized.value.correlationId, transport: "http", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "rejected", code: origin.code });
        reject_http(response, origin);
        return;
      }
      const authenticated = await bounded_policy(() => security.authenticate(normalized.value), limits.handshakeTimeoutMs);
      if (!authenticated.ok) {
        log({ type: "policy-rejection", application: route.application.name, correlationId: normalized.value.correlationId, transport: "http", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "rejected", code: authenticated.code });
        reject_http(response, authenticated);
        return;
      }
      const authorized = await bounded_policy(
        () => security.authorizeAuthority(
          normalized.value,
          authenticated.value,
          route.candidate.access ?? "http-route",
        ),
        limits.handshakeTimeoutMs,
      );
      if (!authorized.ok) {
        log({ type: "policy-rejection", application: route.application.name, correlationId: normalized.value.correlationId, transport: "http", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "rejected", code: authorized.code });
        reject_http(response, authorized);
        return;
      }
      log({ type: "http-dispatch", application: route.application.name, route: `${request.method} ${requestUrl.pathname}`, correlationId: normalized.value.correlationId, transport: "http", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "accepted" });
      try {
        await route.candidate.handle(request, response, normalized.value, authenticated.value);
      } catch {
        if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("Application request failed.\n");
      }
    })();
  });
  server.headersTimeout = limits.headersTimeoutMs;
  server.requestTimeout = limits.requestTimeoutMs;

  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      if (!operational || stopping) {
        reject_upgrade(socket, 503, "Host is not accepting WebSocket work.");
        return;
      }
      if (pendingHandshakes >= limits.maxPendingHandshakes) {
        log({ type: "resource-rejection", transport: "websocket", outcome: "rejected", code: "NODE_HOST_PENDING_LIMIT" });
        reject_upgrade(socket, 503, "WebSocket admission unavailable.");
        return;
      }
      if (Buffer.byteLength(request.url ?? "/") > limits.maxUrlBytes) {
        reject_upgrade(socket, 413, "WebSocket request is too large.");
        return;
      }
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url ?? "/", `ws://${request.headers.host ?? bindHost}`);
      } catch {
        reject_upgrade(socket, 400, "Malformed WebSocket request.");
        return;
      }
      const locusSelector = requestUrl.searchParams.get("locus");
      if (locusSelector === null || locusSelector.trim() === "") {
        reject_upgrade(socket, 400, "A non-empty Locus selector is required.");
        return;
      }
      const routingSelector: LocusSelector = locusSelector;
      const application = select_authority(routingSelector);
      if (application === undefined) {
        reject_upgrade(socket, 404, "No application owns this Locus selector.");
        return;
      }
      pendingHandshakes += 1;
      try {
        const normalized = normalize_node_request(request, {
          transport: "websocket",
          application: application.name,
          locusSelector: routingSelector,
        }, {
          ...(deployment.mode === "production" && deployment.proxy !== undefined
            ? { proxy: deployment.proxy }
            : {}),
          maxUrlBytes: limits.maxUrlBytes,
          maxHeaderValueBytes: limits.maxHeaderValueBytes,
        });
        if (!normalized.ok) {
          reject_upgrade(socket, normalized.status, "WebSocket request rejected.");
          return;
        }
        const security = security_for(application);
        const origin = await bounded_policy(() => security.origin(normalized.value), limits.handshakeTimeoutMs);
        if (!origin.ok) {
          log({ type: "policy-rejection", application: application.name, correlationId: normalized.value.correlationId, transport: "websocket", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "rejected", code: origin.code });
          reject_upgrade(socket, origin.status, "WebSocket policy rejected.");
          return;
        }
        const authenticated = await bounded_policy(() => security.authenticate(normalized.value), limits.handshakeTimeoutMs);
        if (!authenticated.ok) {
          log({ type: "policy-rejection", application: application.name, correlationId: normalized.value.correlationId, transport: "websocket", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "rejected", code: authenticated.code });
          reject_upgrade(socket, authenticated.status, "WebSocket policy rejected.");
          return;
        }
        const authorized = await bounded_policy(
          () => security.authorizeAuthority(normalized.value, authenticated.value, "websocket-connect"),
          limits.handshakeTimeoutMs,
        );
        if (!authorized.ok) {
          log({ type: "policy-rejection", application: application.name, correlationId: normalized.value.correlationId, transport: "websocket", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "rejected", code: authorized.code });
          reject_upgrade(socket, authorized.status, "WebSocket policy rejected.");
          return;
        }
        const appConnections = [...activeConnections.values()].filter((item) => item.application === application.name).length;
        const clientConnections = [...activeConnections.values()].filter((item) => item.clientAddress === normalized.value.effectiveClientAddress).length;
        if (
          activeConnections.size >= limits.maxConnections
          || appConnections >= limits.maxConnectionsPerApplication
          || clientConnections >= limits.maxConnectionsPerClient
        ) {
          log({ type: "resource-rejection", application: application.name, correlationId: normalized.value.correlationId, transport: "websocket", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "rejected", code: "NODE_HOST_CONNECTION_LIMIT" });
          reject_upgrade(socket, 503, "WebSocket capacity unavailable.");
          return;
        }
        if (!operational || stopping || socket.destroyed) {
          if (!socket.destroyed) reject_upgrade(socket, 503, "Host is not accepting WebSocket work.");
          return;
        }
        websocketServer.handleUpgrade(request, socket, head, (websocket) => {
          const state: ActiveConnection = {
            application: application.name,
            locusSelector: routingSelector,
            clientAddress: normalized.value.effectiveClientAddress,
            correlationId: normalized.value.correlationId,
            alive: true,
            messageWindowStartedAt: Date.now(),
            messageCount: 0,
            messageBytes: 0,
          };
          activeConnections.set(websocket, state);
          websocket.on("error", () => {
            // Transport errors are normalized to close; applications receive
            // closure through their adapter without an unhandled EventEmitter error.
          });
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
            state.messageBytes += Array.isArray(data)
              ? data.reduce((total, item) => total + item.byteLength, 0)
              : Buffer.byteLength(data);
            if (
              state.messageCount > limits.maxMessagesPerWindow
              || state.messageBytes > limits.maxMessageBytesPerWindow
            ) {
              log({ type: "resource-rejection", application: application.name, correlationId: state.correlationId, transport: "websocket", outcome: "rejected", code: "NODE_HOST_MESSAGE_RATE_LIMIT" });
              websocket.close(1008, "WebSocket message budget exceeded.");
            }
          });
          websocket.once("close", () => {
            if (state.heartbeatDeadline !== undefined) clearTimeout(state.heartbeatDeadline);
            activeConnections.delete(websocket);
          });
          log({ type: "websocket-dispatch", application: application.name, correlationId: normalized.value.correlationId, transport: "websocket", proxyInterpretation: normalized.value.proxyInterpretation, outcome: "accepted" });
          try {
            const accepted = application.acceptWebSocket(routingSelector, websocket, Object.freeze({
              request: normalized.value,
              principal: authenticated.value,
              transportPolicy: Object.freeze({
                maxBufferedAmount: limits.maxBufferedAmount,
                onBackpressure() {
                  log({ type: "backpressure", application: application.name, correlationId: normalized.value.correlationId, transport: "websocket", outcome: "rejected", code: "NODE_HOST_BACKPRESSURE" });
                },
              }),
            }));
            if (accepted instanceof Promise) {
              void accepted.catch(() => {
                websocket.close(1011, "Application WebSocket dispatch failed.");
              });
            }
          } catch {
            websocket.close(1011, "Application WebSocket dispatch failed.");
          }
        });
      } finally {
        pendingHandshakes -= 1;
      }
    })();
  });

  const heartbeat = setInterval(() => {
    if (!operational || stopping) return;
    for (const [websocket, state] of activeConnections) {
      if (websocket.readyState !== websocket.OPEN) continue;
      if (!state.alive) continue;
      state.alive = false;
      websocket.ping();
      state.heartbeatDeadline = setTimeout(() => {
        if (state.alive) return;
        log({ type: "heartbeat-timeout", application: state.application, correlationId: state.correlationId, transport: "websocket", outcome: "rejected", code: "NODE_HOST_HEARTBEAT_TIMEOUT" });
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
  const stop = (): Promise<void> => shutdown ??= (async () => {
    stopping = true;
    operational = false;
    clearInterval(heartbeat);
    log({ type: "shutdown-start" });
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
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
      await serverClosed;
      activeConnections.clear();
      if (disposalError !== undefined) throw disposalError;
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        for (const websocket of [...activeConnections.keys()]) websocket.terminate();
        server.closeAllConnections();
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
    url: `ws://${bindHost}:${port}`,
    httpUrl: `http://${bindHost}:${port}`,
    applicationNames: Object.freeze(applications.map((application) => application.name)),
    connectionCount(applicationName) {
      return [...activeConnections.values()]
        .filter((connection) => applicationName === undefined || connection.application === applicationName)
        .length;
    },
    disconnectConnections(applicationName, locusSelector) {
      for (const [websocket, connection] of [...activeConnections]) {
        if (applicationName !== undefined && connection.application !== applicationName) continue;
        if (locusSelector !== undefined && connection.locusSelector !== locusSelector) continue;
        websocket.close(1012, "Application connection interrupted.");
      }
    },
    stop,
  });
}

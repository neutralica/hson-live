import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

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
  handle(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}>;

export type NodeHostedApplication = Readonly<{
  name: string;
  authorities: readonly NodeAuthorityNamespace[];
  httpRoutes?: readonly NodeApplicationHttpRoute[];
  ready?(): boolean;
  acceptWebSocket(authorityId: string, websocket: WebSocket): void;
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
    | "startup-failure"
    | "shutdown-start"
    | "shutdown-completion"
    | "shutdown-failure";
  application?: string;
  route?: string;
  host?: string;
  port?: number;
  error?: string;
}>;

export type NodeApplicationHostOptions = Readonly<{
  host?: string;
  port?: number;
  shutdownTimeoutMs?: number;
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
  disconnectConnections(applicationName?: string, authorityId?: string): void;
  stop(): Promise<void>;
}>;

type ActiveConnection = Readonly<{
  application: string;
  authorityId: string;
}>;

function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function namespace_matches(namespace: NodeAuthorityNamespace, authorityId: string): boolean {
  if (namespace.kind === "exact") return authorityId === namespace.value;
  if (!authorityId.startsWith(namespace.value)) return false;
  const suffix = authorityId.slice(namespace.value.length);
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

function reject_upgrade(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${status === 400 ? "Bad Request" : "Not Found"}\r\n`
    + "Connection: close\r\n"
    + "Content-Type: text/plain; charset=utf-8\r\n"
    + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
    + body,
  );
  socket.destroy();
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

/** @experimental Transport-only Node application host. */
export async function start_node_application_host(
  options: NodeApplicationHostOptions,
): Promise<NodeApplicationHost> {
  const bindHost = options.host ?? "127.0.0.1";
  const bindPort = options.port ?? 8787;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error("Node application host shutdown timeout must be a positive integer.");
  }
  const log = options.log ?? (() => undefined);
  const applications = Object.freeze([...options.applications]);
  const disposedApplications = new Set<NodeHostedApplication>();
  log({ type: "host-startup", host: bindHost, port: bindPort });
  try {
    validate_applications(applications, log);
  } catch (error) {
    await dispose_once(applications, disposedApplications);
    log({ type: "startup-failure", host: bindHost, port: bindPort, error: error_message(error) });
    throw error;
  }

  let operational = false;
  let stopping = false;
  const activeConnections = new Map<WebSocket, ActiveConnection>();
  const websocketServer = new WebSocketServer({ noServer: true });

  const select_authority = (authorityId: string): NodeHostedApplication | undefined => {
    let selected: NodeHostedApplication | undefined;
    for (const application of applications) {
      if (!application.authorities.some((namespace) => namespace_matches(namespace, authorityId))) continue;
      if (selected !== undefined) throw new Error(`Ambiguous WebSocket authority dispatch for "${authorityId}".`);
      selected = application;
    }
    return selected;
  };

  const server = createServer((request, response) => {
    if (!operational || stopping) {
      response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ready: false }));
      return;
    }
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? bindHost}`);
    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      log({ type: "http-dispatch", route: "GET /healthz" });
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
    log({ type: "http-dispatch", application: route.application.name, route: `${request.method} ${requestUrl.pathname}` });
    void Promise.resolve(route.candidate.handle(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Application request failed.\n");
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (!operational || stopping) {
      reject_upgrade(socket, 404, "Host is not accepting WebSocket work.");
      return;
    }
    const requestUrl = new URL(request.url ?? "/", `ws://${request.headers.host ?? bindHost}`);
    const authorityId = requestUrl.searchParams.get("livehost");
    if (authorityId === null || authorityId.trim() === "") {
      reject_upgrade(socket, 400, "A non-empty livehost authority ID is required.");
      return;
    }
    const application = select_authority(authorityId);
    if (application === undefined) {
      reject_upgrade(socket, 404, "No application owns this livehost authority.");
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      activeConnections.set(websocket, { application: application.name, authorityId });
      websocket.once("close", () => activeConnections.delete(websocket));
      log({ type: "websocket-dispatch", application: application.name });
      try {
        application.acceptWebSocket(authorityId, websocket);
      } catch {
        websocket.close(1011, "Application WebSocket dispatch failed.");
      }
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(bindPort, bindHost);
    });
  } catch (error) {
    await dispose_once(applications, disposedApplications);
    log({ type: "startup-failure", host: bindHost, port: bindPort, error: error_message(error) });
    throw error;
  }
  operational = true;
  const address = server.address() as AddressInfo | null;
  if (address === null) {
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
      for (const websocket of [...activeConnections.keys()]) websocket.close(1001, "Node application host stopping.");
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
      log({ type: "shutdown-failure", error: error_message(error) });
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
    disconnectConnections(applicationName, authorityId) {
      for (const [websocket, connection] of [...activeConnections]) {
        if (applicationName !== undefined && connection.application !== applicationName) continue;
        if (authorityId !== undefined && connection.authorityId !== authorityId) continue;
        websocket.close(1012, "Application connection interrupted.");
      }
    },
    stop,
  });
}

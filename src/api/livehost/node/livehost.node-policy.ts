import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { LiveHostPrincipal } from "../../../types/livehost.types.js";

export type NodeRequestTransport = "http" | "websocket";
export type NodeProxyInterpretation = "direct" | "trusted-proxy";

export type NodeRequestOrigin =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "null" }>
  | Readonly<{ kind: "origin"; value: string }>;

export type NodeRequestHeaderView = Readonly<{
  get(name: string): string | undefined;
  has(name: string): boolean;
}>;

/** Detached, immutable policy input shared by HTTP and WebSocket dispatch. */
export type NodeRequestContext = Readonly<{
  correlationId: string;
  transport: NodeRequestTransport;
  method: string;
  url: URL;
  application: string;
  route?: string;
  rawScheme: "http" | "https";
  effectiveScheme: "http" | "https";
  rawHost: string;
  effectiveHost: string;
  immediatePeerAddress: string;
  effectiveClientAddress: string;
  proxyInterpretation: NodeProxyInterpretation;
  origin: NodeRequestOrigin;
  effectiveOrigin: string;
  headers: NodeRequestHeaderView;
}>;

export type NodePolicyRejection = Readonly<{
  ok: false;
  status: 400 | 401 | 403 | 408 | 413 | 429 | 503;
  code: string;
}>;

export type NodePolicySuccess<T> = Readonly<{ ok: true; value: T }>;
export type NodePolicyResult<T> = NodePolicySuccess<T> | NodePolicyRejection;

export type NodeApplicationSecurity = Readonly<{
  origin(context: NodeRequestContext): NodePolicyResult<void> | Promise<NodePolicyResult<void>>;
  authenticate(
    context: NodeRequestContext,
  ): NodePolicyResult<LiveHostPrincipal> | Promise<NodePolicyResult<LiveHostPrincipal>>;
  authorize(
    context: NodeRequestContext,
    principal: LiveHostPrincipal,
  ): NodePolicyResult<void> | Promise<NodePolicyResult<void>>;
}>;

export type NodeExactOriginPolicyOptions = Readonly<{
  allowedOrigins: readonly string[];
  allowMissing?: boolean;
  allowNull?: boolean;
}>;

export type NodeTrustedProxyPolicy = Readonly<{
  trustImmediatePeer(peerAddress: string): boolean;
  forwardedForHop: "first" | "last";
}>;

export type NodeRequestNormalizationOptions = Readonly<{
  proxy?: NodeTrustedProxyPolicy;
  maxUrlBytes: number;
  maxHeaderValueBytes: number;
}>;

function normalize_host(scheme: "http" | "https", host: string): string {
  if (host.trim() === "" || /[\\/\s]/.test(host)) throw new Error("Malformed Host header.");
  const parsed = new URL(`${scheme}://${host}`);
  if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "") {
    throw new Error("Malformed Host header.");
  }
  return parsed.host.toLowerCase();
}

export function normalize_node_origin(value: string): string {
  const parsed = new URL(value);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new Error("Malformed Origin header.");
  }
  return parsed.origin.toLowerCase();
}

function detached_headers(headers: IncomingHttpHeaders): NodeRequestHeaderView {
  const values = new Map<string, string>();
  for (const [name, raw] of Object.entries(headers)) {
    if (raw === undefined) continue;
    values.set(name.toLowerCase(), Array.isArray(raw) ? raw.join(", ") : raw);
  }
  return Object.freeze({
    get(name) {
      return values.get(name.toLowerCase());
    },
    has(name) {
      return values.has(name.toLowerCase());
    },
  });
}

function forwarded_value(value: string | undefined, hop: "first" | "last"): string | undefined {
  if (value === undefined) return undefined;
  const values = value.split(",").map((item) => item.trim());
  if (values.length === 0 || values.length > 16 || values.some((item) => item === "")) {
    throw new Error("Malformed forwarded header.");
  }
  return hop === "first" ? values[0] : values.at(-1);
}

function raw_scheme(request: Pick<IncomingMessage, "socket">): "http" | "https" {
  return Reflect.get(request.socket, "encrypted") === true ? "https" : "http";
}

export function normalize_node_request(
  request: Pick<IncomingMessage, "headers" | "socket" | "url" | "method">,
  input: Readonly<{
    transport: NodeRequestTransport;
    application: string;
    route?: string;
  }>,
  options: NodeRequestNormalizationOptions,
): NodePolicyResult<NodeRequestContext> {
  try {
    const rawUrl = request.url ?? "/";
    if (Buffer.byteLength(rawUrl) > options.maxUrlBytes) {
      return { ok: false, status: 413, code: "NODE_HOST_URL_LIMIT" };
    }
    for (const value of Object.values(request.headers)) {
      if (value === undefined) continue;
      const normalized = Array.isArray(value) ? value.join(", ") : value;
      if (Buffer.byteLength(normalized) > options.maxHeaderValueBytes) {
        return { ok: false, status: 413, code: "NODE_HOST_HEADER_LIMIT" };
      }
    }
    const headers = detached_headers(request.headers);
    const scheme = raw_scheme(request);
    const rawHost = normalize_host(scheme, headers.get(":authority") ?? headers.get("host") ?? "");
    const peer = request.socket.remoteAddress ?? "unknown";
    const trusted = options.proxy?.trustImmediatePeer(peer) === true;
    let effectiveScheme = scheme;
    let effectiveHost = rawHost;
    let effectiveClientAddress = peer;
    if (trusted) {
      if (headers.has("forwarded")) {
        return { ok: false, status: 400, code: "NODE_HOST_FORWARDED_UNSUPPORTED" };
      }
      const hop = options.proxy?.forwardedForHop ?? "first";
      const forwardedFor = forwarded_value(headers.get("x-forwarded-for"), hop);
      const forwardedProto = forwarded_value(headers.get("x-forwarded-proto"), hop);
      const forwardedHost = forwarded_value(headers.get("x-forwarded-host"), hop);
      if (forwardedProto !== undefined) {
        if (forwardedProto !== "http" && forwardedProto !== "https") {
          return { ok: false, status: 400, code: "NODE_HOST_FORWARDED_PROTO_INVALID" };
        }
        effectiveScheme = forwardedProto;
      }
      if (forwardedHost !== undefined) effectiveHost = normalize_host(effectiveScheme, forwardedHost);
      if (forwardedFor !== undefined) {
        if (forwardedFor.length > 255 || /[\r\n]/.test(forwardedFor)) {
          return { ok: false, status: 400, code: "NODE_HOST_FORWARDED_FOR_INVALID" };
        }
        effectiveClientAddress = forwardedFor;
      }
    }
    const rawOrigin = headers.get("origin");
    const origin: NodeRequestOrigin = rawOrigin === undefined
      ? Object.freeze({ kind: "missing" })
      : rawOrigin === "null"
        ? Object.freeze({ kind: "null" })
        : Object.freeze({ kind: "origin", value: normalize_node_origin(rawOrigin) });
    const url = new URL(rawUrl, `${effectiveScheme}://${effectiveHost}`);
    return {
      ok: true,
      value: Object.freeze({
        correlationId: randomUUID(),
        transport: input.transport,
        method: request.method ?? "GET",
        url,
        application: input.application,
        ...(input.route === undefined ? {} : { route: input.route }),
        rawScheme: scheme,
        effectiveScheme,
        rawHost,
        effectiveHost,
        immediatePeerAddress: peer,
        effectiveClientAddress,
        proxyInterpretation: trusted ? "trusted-proxy" : "direct",
        origin,
        effectiveOrigin: `${effectiveScheme}://${effectiveHost}`,
        headers,
      }),
    };
  } catch {
    return { ok: false, status: 400, code: "NODE_HOST_REQUEST_MALFORMED" };
  }
}

/** Exact browser-origin policy with explicit missing/null handling. */
export function create_node_exact_origin_policy(
  options: NodeExactOriginPolicyOptions,
): NodeApplicationSecurity["origin"] {
  const allowed = new Set(options.allowedOrigins.map(normalize_node_origin));
  return (context) => {
    if (context.origin.kind === "missing") {
      return options.allowMissing === true
        ? { ok: true, value: undefined }
        : { ok: false, status: 403, code: "NODE_HOST_ORIGIN_REQUIRED" };
    }
    if (context.origin.kind === "null") {
      return options.allowNull === true
        ? { ok: true, value: undefined }
        : { ok: false, status: 403, code: "NODE_HOST_ORIGIN_NULL" };
    }
    return allowed.has(context.origin.value)
      ? { ok: true, value: undefined }
      : { ok: false, status: 403, code: "NODE_HOST_ORIGIN_FORBIDDEN" };
  };
}

/** Explicit localhost/test compatibility policy; never selected implicitly in production mode. */
export function create_node_development_security(): NodeApplicationSecurity {
  const security: NodeApplicationSecurity = {
    origin: () => ({ ok: true, value: undefined }),
    authenticate: () => ({
      ok: true,
      value: Object.freeze({ id: "development-anonymous", anonymous: true }),
    }),
    authorize: () => ({ ok: true, value: undefined }),
  };
  return Object.freeze(security);
}

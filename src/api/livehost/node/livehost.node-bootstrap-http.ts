import type { IncomingMessage, ServerResponse } from "node:http";
import {
  capture_livehost_bootstrap,
  encode_livehost_bootstrap,
  LIVEHOST_BOOTSTRAP_MEDIA_TYPE,
  LiveHostBootstrapError,
  type LiveHostBootstrapCodecOptions,
  type LiveHostBootstrapAuthority,
} from "../livehost.bootstrap.js";
import type { LiveHostDisposer } from "../../../types/livehost.types.js";
import type { LiveHostRoutingSelector } from "../../../types/internal/livehost.routing.types.js";

export type NodeLiveHostBootstrapResolution =
  | Readonly<{
      ok: true;
      authority: LiveHostBootstrapAuthority;
      websocketEndpoint: string;
      /** Optional application-owned acquisition held through exact capture and encoding. */
      release?: LiveHostDisposer;
    }>
  | Readonly<{
      ok: false;
      status: 404 | 503;
      code: "LIVEHOST_BOOTSTRAP_AUTHORITY_UNKNOWN" | "LIVEHOST_BOOTSTRAP_AUTHORITY_UNAVAILABLE";
      message: string;
    }>;

export type NodeLiveHostBootstrapOperationalEvent = Readonly<{
  type:
    | "bootstrap-request-accepted"
    | "bootstrap-authority-resolved"
    | "bootstrap-captured"
    | "bootstrap-sent"
    | "bootstrap-rejected"
    | "bootstrap-encode-failure";
  code?: string;
  status?: number;
  encodedBytes?: number;
}>;

export type NodeLiveHostBootstrapHandlerOptions = LiveHostBootstrapCodecOptions & Readonly<{
  selectorParameter?: string;
  resolve(
    authoritySelector: string,
    request: IncomingMessage,
  ): NodeLiveHostBootstrapResolution | Promise<NodeLiveHostBootstrapResolution>;
  log?(event: NodeLiveHostBootstrapOperationalEvent): void;
}>;

const encoder = new TextEncoder();

function write_error(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  const body = JSON.stringify({ error: { code, message } });
  response.writeHead(status, {
    "content-type": "application/problem+json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function accepts_bootstrap(header: string | string[] | undefined): boolean {
  if (header === undefined) return true;
  const values = Array.isArray(header) ? header : [header];
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === "*/*" || value === LIVEHOST_BOOTSTRAP_MEDIA_TYPE);
}

/** @experimental GET-only Node response helper for one application-resolved authority. */
export async function handle_node_livehost_bootstrap_request(
  request: IncomingMessage,
  response: ServerResponse,
  options: NodeLiveHostBootstrapHandlerOptions,
): Promise<void> {
  const log = options.log ?? (() => undefined);
  if (request.method !== "GET") {
    log({ type: "bootstrap-rejected", status: 405, code: "LIVEHOST_BOOTSTRAP_METHOD_UNSUPPORTED" });
    response.setHeader("allow", "GET");
    write_error(
      response,
      405,
      "LIVEHOST_BOOTSTRAP_METHOD_UNSUPPORTED",
      "LiveHost bootstrap supports GET only.",
    );
    return;
  }
  if (!accepts_bootstrap(request.headers.accept)) {
    log({ type: "bootstrap-rejected", status: 406, code: "LIVEHOST_BOOTSTRAP_NOT_ACCEPTABLE" });
    write_error(
      response,
      406,
      "LIVEHOST_BOOTSTRAP_NOT_ACCEPTABLE",
      "The requested response media type is not available.",
    );
    return;
  }
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  } catch {
    log({ type: "bootstrap-rejected", status: 400, code: "LIVEHOST_BOOTSTRAP_REQUEST_INVALID" });
    write_error(response, 400, "LIVEHOST_BOOTSTRAP_REQUEST_INVALID", "LiveHost bootstrap request is malformed.");
    return;
  }
  const selector = requestUrl.searchParams.get(options.selectorParameter ?? "livehost");
  if (selector === null || selector.trim() === "") {
    log({ type: "bootstrap-rejected", status: 400, code: "LIVEHOST_BOOTSTRAP_SELECTOR_INVALID" });
    write_error(
      response,
      400,
      "LIVEHOST_BOOTSTRAP_SELECTOR_INVALID",
      "A non-empty LiveHost authority selector is required.",
    );
    return;
  }
  const routingSelector: LiveHostRoutingSelector = selector;
  log({ type: "bootstrap-request-accepted" });

  let resolution: NodeLiveHostBootstrapResolution;
  try {
    resolution = await options.resolve(routingSelector, request);
  } catch {
    log({ type: "bootstrap-rejected", status: 503, code: "LIVEHOST_BOOTSTRAP_AUTHORITY_UNAVAILABLE" });
    write_error(
      response,
      503,
      "LIVEHOST_BOOTSTRAP_AUTHORITY_UNAVAILABLE",
      "The requested LiveHost authority is unavailable.",
    );
    return;
  }
  if (!resolution.ok) {
    log({ type: "bootstrap-rejected", status: resolution.status, code: resolution.code });
    write_error(response, resolution.status, resolution.code, resolution.message);
    return;
  }
  log({ type: "bootstrap-authority-resolved" });

  try {
    const bootstrap = capture_livehost_bootstrap(
      resolution.authority,
      routingSelector,
      resolution.websocketEndpoint,
      options,
    );
    log({ type: "bootstrap-captured" });
    const body = encode_livehost_bootstrap(bootstrap, options);
    const encodedBytes = encoder.encode(body).byteLength;
    response.writeHead(200, {
      "content-type": LIVEHOST_BOOTSTRAP_MEDIA_TYPE,
      "cache-control": "no-store",
      "content-length": encodedBytes,
    });
    response.end(body);
    log({ type: "bootstrap-sent", status: 200, encodedBytes });
  } catch (cause) {
    const bootstrapError = cause instanceof LiveHostBootstrapError ? cause : undefined;
    const status = bootstrapError?.code === "LIVEHOST_BOOTSTRAP_TOO_LARGE" ? 413 : 500;
    const code = bootstrapError?.code ?? "LIVEHOST_BOOTSTRAP_ENCODING_FAILED";
    log({ type: "bootstrap-encode-failure", status, code });
    write_error(
      response,
      status,
      code,
      status === 413
        ? "LiveHost bootstrap package exceeds its configured byte limit."
        : "LiveHost bootstrap package could not be produced.",
    );
  } finally {
    resolution.release?.();
  }
}

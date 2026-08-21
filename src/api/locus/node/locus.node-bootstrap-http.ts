import type { IncomingMessage, ServerResponse } from "node:http";
import {
  capture_locus_bootstrap,
  encode_locus_bootstrap,
  LOCUS_BOOTSTRAP_MEDIA_TYPE,
  LocusBootstrapError,
  type LocusBootstrapCodecOptions,
  type LocusBootstrapAuthority,
} from "../locus.bootstrap.js";
import type { LocusDisposer, LocusSelector } from "../../../types/locus.types.js";

export type NodeLocusBootstrapResolution =
  | Readonly<{
      ok: true;
      authority: LocusBootstrapAuthority;
      websocketEndpoint: string;
      /** Optional application-owned acquisition held through exact capture and encoding. */
      release?: LocusDisposer;
    }>
  | Readonly<{
      ok: false;
      status: 404 | 503;
      code: "LOCUS_BOOTSTRAP_AUTHORITY_UNKNOWN" | "LOCUS_BOOTSTRAP_AUTHORITY_UNAVAILABLE";
      message: string;
    }>;

export type NodeLocusBootstrapOperationalEvent = Readonly<{
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

export type NodeLocusBootstrapHandlerOptions = LocusBootstrapCodecOptions & Readonly<{
  selectorParameter?: string;
  resolve(
    locusSelector: LocusSelector,
    request: IncomingMessage,
  ): NodeLocusBootstrapResolution | Promise<NodeLocusBootstrapResolution>;
  log?(event: NodeLocusBootstrapOperationalEvent): void;
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
    .some((value) => value === "*/*" || value === LOCUS_BOOTSTRAP_MEDIA_TYPE);
}

/** @experimental GET-only Node response helper for one application-resolved authority. */
export async function handle_node_locus_bootstrap_request(
  request: IncomingMessage,
  response: ServerResponse,
  options: NodeLocusBootstrapHandlerOptions,
): Promise<void> {
  const log = options.log ?? (() => undefined);
  if (request.method !== "GET") {
    log({ type: "bootstrap-rejected", status: 405, code: "LOCUS_BOOTSTRAP_METHOD_UNSUPPORTED" });
    response.setHeader("allow", "GET");
    write_error(
      response,
      405,
      "LOCUS_BOOTSTRAP_METHOD_UNSUPPORTED",
      "Locus bootstrap supports GET only.",
    );
    return;
  }
  if (!accepts_bootstrap(request.headers.accept)) {
    log({ type: "bootstrap-rejected", status: 406, code: "LOCUS_BOOTSTRAP_NOT_ACCEPTABLE" });
    write_error(
      response,
      406,
      "LOCUS_BOOTSTRAP_NOT_ACCEPTABLE",
      "The requested response media type is not available.",
    );
    return;
  }
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  } catch {
    log({ type: "bootstrap-rejected", status: 400, code: "LOCUS_BOOTSTRAP_REQUEST_INVALID" });
    write_error(response, 400, "LOCUS_BOOTSTRAP_REQUEST_INVALID", "Locus bootstrap request is malformed.");
    return;
  }
  const selector = requestUrl.searchParams.get(options.selectorParameter ?? "locus");
  if (selector === null || selector.trim() === "") {
    log({ type: "bootstrap-rejected", status: 400, code: "LOCUS_BOOTSTRAP_SELECTOR_INVALID" });
    write_error(
      response,
      400,
      "LOCUS_BOOTSTRAP_SELECTOR_INVALID",
      "A non-empty Locus selector is required.",
    );
    return;
  }
  const locusSelector: LocusSelector = selector;
  log({ type: "bootstrap-request-accepted" });

  let resolution: NodeLocusBootstrapResolution;
  try {
    resolution = await options.resolve(locusSelector, request);
  } catch {
    log({ type: "bootstrap-rejected", status: 503, code: "LOCUS_BOOTSTRAP_AUTHORITY_UNAVAILABLE" });
    write_error(
      response,
      503,
      "LOCUS_BOOTSTRAP_AUTHORITY_UNAVAILABLE",
      "The requested Locus authority is unavailable.",
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
    const bootstrap = capture_locus_bootstrap(
      resolution.authority,
      locusSelector,
      resolution.websocketEndpoint,
      options,
    );
    log({ type: "bootstrap-captured" });
    const body = encode_locus_bootstrap(bootstrap, options);
    const encodedBytes = encoder.encode(body).byteLength;
    response.writeHead(200, {
      "content-type": LOCUS_BOOTSTRAP_MEDIA_TYPE,
      "cache-control": "no-store",
      "content-length": encodedBytes,
    });
    response.end(body);
    log({ type: "bootstrap-sent", status: 200, encodedBytes });
  } catch (cause) {
    const bootstrapError = cause instanceof LocusBootstrapError ? cause : undefined;
    const status = bootstrapError?.code === "LOCUS_BOOTSTRAP_TOO_LARGE" ? 413 : 500;
    const code = bootstrapError?.code ?? "LOCUS_BOOTSTRAP_ENCODING_FAILED";
    log({ type: "bootstrap-encode-failure", status, code });
    write_error(
      response,
      status,
      code,
      status === 413
        ? "Locus bootstrap package exceeds its configured byte limit."
        : "Locus bootstrap package could not be produced.",
    );
  } finally {
    resolution.release?.();
  }
}

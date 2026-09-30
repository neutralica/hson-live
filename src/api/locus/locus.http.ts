import type { LocusConnectionContext } from "../../types/locus.types.js";
import type { LocusAttachmentNotice } from "./locus.transport.internal.js";
import type { LocusFiniteOperationRequest, LocusSemanticAttachment } from "./locus.transport.internal.js";
import { attach_locus_semantic_transport_internal, locus_publication_byte_limit_internal } from "./locus.transport.internal.js";
import { decode_request, encode_downstream_message } from "./locus.semantic-codec.internal.js";
import { DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES } from "./locus.aggregate.protocol.js";
import { HOSTED_MAX_SNAPSHOT_BYTES } from "../livemap/livemap.hosted-limits.internal.js";

const CAPABILITY_HEADER = "x-hson-attachment";
const JSON_TYPE = "application/json";
const STREAM_TYPE = "application/x-ndjson";
const IDLE_MS = 120_000;
const HEARTBEAT_MS = 30_000;
const NO_STORE = "no-store";
const encoder = new TextEncoder();

type Entry = {
  token: string;
  attachment: LocusSemanticAttachment;
  principalId: string | undefined;
  sessionId: string;
  epoch: number;
  lastActivity: number;
  streams: Set<() => void>;
  notices: Set<(notice: LocusAttachmentNotice) => void>;
  timer?: ReturnType<typeof setTimeout>;
};

export type LocusHttpBinding = Readonly<{
  handle(request: Request, context: LocusConnectionContext): Promise<Response>;
  dispose(): void;
}>;

/** Bind Web Request/Response to the existing Locus semantic attachment authority. */
export function bind_locus_http(locus: object, options: Readonly<{ endpoint: string }>): LocusHttpBinding {
  const configured = new URL(options.endpoint, "http://localhost");
  if (configured.search !== "" || configured.hash !== "") throw new TypeError("HTTP Locus endpoint must not contain query or fragment.");
  const path = configured.pathname.replace(/\/$/u, "") || "/";
  const syncPath = path === "/" ? "/sync" : `${path}/sync`;
  const limit = locus_publication_byte_limit_internal(locus);
  const entries = new Map<string, Entry>();
  let disposed = false;

  const reject = (status: number): Response => new Response(null, { status, headers: { "cache-control": NO_STORE } });
  const rejectCapability = (): Response => new Response(null, { status: 403,
    headers: { "cache-control": NO_STORE, "x-hson-attachment-state": "invalid" } });
  const close = (entry: Entry): void => {
    if (entries.get(entry.token) !== entry) return;
    entries.delete(entry.token);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    for (const stop of [...entry.streams]) stop();
    entry.attachment.close();
  };
  const fence = (entry: Entry): void => {
    if (entries.get(entry.token) !== entry) return;
    entries.delete(entry.token);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    for (const stop of [...entry.streams]) stop();
    // Session reattachment fences the old attachment before committing the new
    // epoch. Closing the old semantic attachment inside that callback would
    // reenter the session manager and abort the atomic transition.
    queueMicrotask(() => entry.attachment.close());
  };
  const schedule = (entry: Entry): void => {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const remaining = IDLE_MS - (Date.now() - entry.lastActivity);
      if (remaining > 0) { entry.timer = setTimeout(() => close(entry), remaining); return; }
      close(entry);
    }, IDLE_MS);
  };
  const current = (token: string | null, context: LocusConnectionContext): Entry | undefined => {
    const entry = token === null ? undefined : entries.get(token);
    if (entry === undefined) return undefined;
    if (entry.principalId !== context.principalId) return undefined;
    if (!entry.attachment.binding.attached
      || entry.attachment.binding.sessionId !== entry.sessionId
      || entry.attachment.binding.attachmentEpoch !== entry.epoch) {
      close(entry);
      return undefined;
    }
    entry.lastActivity = Date.now();
    schedule(entry);
    return entry;
  };
  const body = async (request: Request): Promise<string> => {
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== JSON_TYPE) {
      throw new Error("Unsupported content type.");
    }
    const reader = request.body?.getReader();
    if (reader === undefined) throw new Error("Missing body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) throw new Error("Request exceeds limit.");
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  };

  async function handle(request: Request, context: LocusConnectionContext): Promise<Response> {
    if (disposed) return reject(503);
    const url = new URL(request.url);
    if (url.search !== "") return reject(404);
    const pathname = url.pathname;
    if (pathname !== path && pathname !== syncPath) return reject(404);
    if (request.method !== "POST") return reject(405);
    let raw: string;
    try { raw = await body(request); }
    catch { return reject(400); }
    if (pathname === syncPath) {
      let recovery: Extract<ReturnType<typeof decode_request>, { type: "recover" }> | undefined;
      if (raw !== '{"type":"observe"}') {
        try {
          const decoded = decode_request(raw, limit);
          if (decoded.type !== "recover") return reject(400);
          recovery = decoded;
        } catch { return reject(400); }
      }
      const entry = current(request.headers.get(CAPABILITY_HEADER), context);
      if (entry === undefined) return rejectCapability();
      return stream(entry, recovery, request.signal);
    }
    if (raw === '{"type":"heartbeat"}') {
      const entry = current(request.headers.get(CAPABILITY_HEADER), context);
      return entry === undefined ? rejectCapability() : new Response(null, { status: 204,
        headers: { "cache-control": NO_STORE } });
    }
    let decoded: ReturnType<typeof decode_request>;
    try { decoded = decode_request(raw, limit); }
    catch { return reject(400); }
    if (decoded.type === "recover") return reject(400);
    let entry: Entry | undefined;
    let attachment: LocusSemanticAttachment;
    const establishing = decoded.type === "session-create" || decoded.type === "session-attach";
    if (establishing) {
      if (request.headers.has(CAPABILITY_HEADER)) return reject(400);
      let created: Entry | undefined;
      attachment = attach_locus_semantic_transport_internal(locus, {
        connection: context,
        notice: (notice) => {
          if (created === undefined) return;
          try { for (const listener of [...created.notices]) listener(notice); }
          finally { fence(created); }
        },
        onClose: () => { if (created !== undefined) close(created); },
      });
      try {
        const outcome = await attachment.operations.submit(decoded as LocusFiniteOperationRequest);
        if (outcome.type !== "session-created" && outcome.type !== "session-attached") {
          attachment.close();
          return response(outcome);
        }
        if (!attachment.binding.attached || attachment.binding.sessionId !== outcome.sessionId
          || attachment.binding.attachmentEpoch !== outcome.epoch) {
          attachment.close();
          return reject(409);
        }
        const token = capability();
        created = { token, attachment, principalId: context.principalId,
          sessionId: outcome.sessionId, epoch: outcome.epoch, lastActivity: Date.now(),
          streams: new Set(), notices: new Set() };
        entries.set(token, created);
        schedule(created);
        return response(outcome, token);
      } catch { attachment.close(); return reject(503); }
    }
    entry = current(request.headers.get(CAPABILITY_HEADER), context);
    if (entry === undefined) return rejectCapability();
    attachment = entry.attachment;
    try {
      const outcome = await attachment.operations.submit(decoded as LocusFiniteOperationRequest);
      const result = response(outcome);
      if (outcome.type === "session-detached" || outcome.type === "session-ended") close(entry);
      return result;
    } catch { return reject(503); }
  }

  function response(outcome: unknown, token?: string): Response {
    try {
      return new Response(encode_downstream_message(outcome, limit), {
        status: 200, headers: { "content-type": JSON_TYPE, "cache-control": NO_STORE,
          ...(token === undefined ? {} : { [CAPABILITY_HEADER]: token }) },
      });
    } catch { return reject(503); }
  }

  function stream(entry: Entry, recovery: Extract<ReturnType<typeof decode_request>, { type: "recover" }> | undefined,
    signal: AbortSignal): Response {
    let stopSubscription: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      entry.streams.delete(stop);
      entry.notices.delete(notice);
      signal.removeEventListener("abort", stop);
      if (heartbeat !== undefined) clearInterval(heartbeat);
      stopSubscription?.();
      try { controller?.close(); } catch { /* Already closed or cancelled. */ }
    };
    const push = (value: string): void => {
      if (stopped || controller === undefined) return;
      const encoded = encoder.encode(`${value}\n`);
      if ((controller.desiredSize ?? 0) < encoded.byteLength) { stop(); return; }
      try { controller.enqueue(encoded); } catch { stop(); }
    };
    const notice = (event: LocusAttachmentNotice): void => {
      try { push(encode_downstream_message(event, limit)); } finally { stop(); }
    };
    const readable = new ReadableStream<Uint8Array>({
      start(target) {
        controller = target;
        entry.streams.add(stop);
        entry.notices.add(notice);
        signal.addEventListener("abort", stop, { once: true });
        push(JSON.stringify({ type: "ready" }));
        if (signal.aborted || stopped) { stop(); return; }
        if (recovery !== undefined) {
          try {
            stopSubscription = entry.attachment.synchronization.open(recovery, async (output) => {
              if (stopped || entries.get(entry.token) !== entry || !entry.attachment.binding.attached) { stop(); return; }
              const bound = output.type === "recovery-snapshot" || (output.type === "projection-change" && output.reconciliation !== undefined)
                ? HOSTED_MAX_SNAPSHOT_BYTES : limit;
              push(encode_downstream_message(output, bound));
            }, () => stop());
          } catch (cause) { stop(); throw cause; }
          if (stopped) stopSubscription();
        }
        if (!stopped) heartbeat = setInterval(() => push(JSON.stringify({ type: "heartbeat" })), HEARTBEAT_MS);
      },
      cancel: stop,
    }, { highWaterMark: HOSTED_MAX_SNAPSHOT_BYTES + limit, size: (chunk) => chunk.byteLength });
    return new Response(readable, { headers: { "content-type": STREAM_TYPE, "cache-control": NO_STORE,
      "x-content-type-options": "nosniff" } });
  }

  return Object.freeze({ handle, dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of [...entries.values()]) close(entry);
  } });
}

function capability(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

import type {
  EchoAttachmentEvent, EchoCancellationSignal, EchoFiniteOperationOutcome, EchoFiniteOperationRequest,
  EchoReplicaTransport, EchoSubmission, EchoSynchronizationEnd, EchoSynchronizationObserver,
  EchoSynchronizationRequest, EchoSynchronizationSubscription,
} from "../../types/echo.transport.types.js";
import { encodeEndpointMessage, decodeEndpointMessage } from "./echo.semantic-codec.internal.js";
import { DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../locus/locus.aggregate.protocol.js";
import { HOSTED_MAX_SNAPSHOT_BYTES } from "../livemap/livemap.hosted-limits.internal.js";
import { EchoHttpRecordError, read_echo_http_records_internal } from "./echo.http-framing.internal.js";
import { register_echo_transport_owner_release_internal } from "./echo.transport-owner.internal.js";

const CAPABILITY_HEADER = "x-hson-attachment";
const HEARTBEAT_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();
const FRAME_LIMIT = HOSTED_MAX_SNAPSHOT_BYTES;

export type EchoHttpTransportOptions = Readonly<{
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
}>;
export type EchoHttpTransport = EchoReplicaTransport & Readonly<{ dispose(): void }>;

type Physical = {
  controller: AbortController;
  generation: number;
  observer?: EchoSynchronizationObserver;
  ended: boolean;
};

/** One stateful Fetch transport. Its attachment capability is private to this instance. */
export function create_echo_http_transport(options: EchoHttpTransportOptions): EchoHttpTransport {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function" || typeof options.endpoint !== "string" || options.endpoint.length === 0
    || options.endpoint.includes("?") || options.endpoint.includes("#")) {
    throw new TypeError("HTTP Echo requires a Fetch implementation and an endpoint without query or fragment.");
  }
  const endpoint = options.endpoint.replace(/\/$/u, "") || "/";
  const syncEndpoint = endpoint === "/" ? "/sync" : `${endpoint}/sync`;
  const listeners = new Set<(event: EchoAttachmentEvent) => void>();
  const requests = new Set<AbortController>();
  let capability: string | undefined;
  let sessionId: string | undefined;
  let epoch: number | undefined;
  let physical: Physical | undefined;
  let generation = 0;
  let attachmentGeneration = 0;
  let disposed = false;
  let ownerReleased = false;
  let controlRetry: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatInFlight = false;
  let aggregateCodec: typeof import("./echo.aggregate-semantic-codec.internal.js") | undefined;

  const emit = (event: EchoAttachmentEvent): void => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* One listener cannot prevent other notices. */ }
    }
  };
  const currentAttachment = (token: string, expectedGeneration: number): boolean =>
    !disposed && !ownerReleased && capability === token && attachmentGeneration === expectedGeneration;
  const fence = (): void => {
    if (capability === undefined) return;
    if (sessionId !== undefined && epoch !== undefined) emit(Object.freeze({ kind: "fenced", sessionId, epoch }));
    capability = undefined;
    attachmentGeneration += 1;
    stopHeartbeat();
    stopPhysical(Object.freeze({ kind: "invalid" }));
    emit(Object.freeze({ kind: "observation-interrupted" }));
    queueMicrotask(() => { if (!disposed && listeners.size > 0) emit(Object.freeze({ kind: "available" })); });
  };
  const stopPhysical = (end: EchoSynchronizationEnd): void => {
    const active = physical;
    if (active === undefined) return;
    physical = undefined;
    active.controller.abort();
    if (!active.ended) {
      active.ended = true;
      try { active.observer?.onEnd(end); } catch { /* Teardown is independent of observer exceptions. */ }
    }
    if ((end.kind === "interrupted" || end.kind === "invalid") && capability !== undefined && !disposed) {
      scheduleControl();
    }
  };

  function scheduleControl(): void {
    if (controlRetry !== undefined || disposed || capability === undefined) return;
    controlRetry = setTimeout(() => {
      controlRetry = undefined;
      if (physical === undefined) void startControl();
    }, 1000);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== undefined) { clearInterval(heartbeatTimer); heartbeatTimer = undefined; }
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => { void ping(); }, HEARTBEAT_MS);
  }

  async function ping(): Promise<void> {
    const token = capability;
    const sentGeneration = attachmentGeneration;
    if (token === undefined || heartbeatInFlight || disposed || ownerReleased) return;
    heartbeatInFlight = true;
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    try {
      const response = await fetcher(endpoint, { method: "POST", body: '{"type":"heartbeat"}',
        headers: { "content-type": "application/json", [CAPABILITY_HEADER]: token },
        credentials: options.credentials ?? "same-origin", signal: controller.signal, cache: "no-store", redirect: "error" });
      if (currentAttachment(token, sentGeneration) && response.status === 403
        && response.headers.get("x-hson-attachment-state") === "invalid") fence();
    } catch { /* The lease expires if the client cannot reach the authority. */ }
    finally { clearTimeout(timeout); requests.delete(controller); heartbeatInFlight = false; }
  }

  async function boundedText(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("HTTP Echo response has no body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) {
          await reader.cancel();
          throw new Error("HTTP Echo finite response exceeds its byte limit.");
        }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function responseType(response: Response): string | undefined {
    return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  }

  function releaseOwner(): void {
    if (ownerReleased || disposed) return;
    ownerReleased = true;
    stopPhysical(Object.freeze({ kind: "cancelled" }));
    if (controlRetry !== undefined) { clearTimeout(controlRetry); controlRetry = undefined; }
    for (const controller of requests) controller.abort();
    requests.clear();
    capability = undefined;
    attachmentGeneration += 1;
    stopHeartbeat();
    listeners.clear();
  }

  async function submit(request: EchoFiniteOperationRequest,
    operationOptions?: Readonly<{ signal?: EchoCancellationSignal }>): Promise<EchoSubmission<EchoFiniteOperationOutcome>> {
    if (disposed || ownerReleased || operationOptions?.signal?.aborted) {
      return Object.freeze({ kind: "not-submitted", cause: operationOptions?.signal?.reason });
    }
    const establishing = request.type === "session-create" || request.type === "session-attach";
    if (!establishing && capability === undefined) return Object.freeze({ kind: "not-submitted" });
    const sentToken = capability;
    const sentGeneration = attachmentGeneration;
    let body: string;
    try {
      body = encodeEndpointMessage(request);
      if (encoder.encode(body).byteLength > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) throw new Error("HTTP Echo request exceeds its byte limit.");
    } catch (cause) { return Object.freeze({ kind: "not-submitted", cause }); }
    const controller = new AbortController();
    const abort = (): void => controller.abort(operationOptions?.signal?.reason);
    operationOptions?.signal?.addEventListener("abort", abort, { once: true });
    if (operationOptions?.signal?.aborted || disposed || ownerReleased) {
      operationOptions?.signal?.removeEventListener("abort", abort);
      return Object.freeze({ kind: "not-submitted", cause: operationOptions?.signal?.reason });
    }
    const init: RequestInit = { method: "POST", body,
      headers: { "content-type": "application/json", ...(establishing ? {} : { [CAPABILITY_HEADER]: sentToken! }) },
      credentials: options.credentials ?? "same-origin", signal: controller.signal, cache: "no-store", redirect: "error" };
    try { new Request(endpoint, init); }
    catch (cause) {
      operationOptions?.signal?.removeEventListener("abort", abort);
      return Object.freeze({ kind: "not-submitted", cause });
    }
    if (operationOptions?.signal?.aborted || disposed || ownerReleased) {
      operationOptions?.signal?.removeEventListener("abort", abort);
      return Object.freeze({ kind: "not-submitted", cause: operationOptions?.signal?.reason });
    }
    requests.add(controller);
    try {
      const response = await fetcher(endpoint, init);
      if (response.status === 403) {
        if (!establishing && sentToken !== undefined && currentAttachment(sentToken, sentGeneration)
          && response.headers.get("x-hson-attachment-state") === "invalid") fence();
        return Object.freeze({ kind: "uncertain", cause: new Error("HTTP Echo attachment was rejected.") });
      }
      if (response.status !== 200) return Object.freeze({ kind: "uncertain",
        cause: new Error(`HTTP Echo request failed (${response.status}).`) });
      if (responseType(response) !== "application/json") throw new Error("HTTP Echo finite response has an invalid content type.");
      const raw = await boundedText(response);
      const outcome = decodeEndpointMessage(raw, LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT);
      if (outcome === undefined || outcome.type === "session-fenced" || outcome.id !== request.id) {
        throw new Error("HTTP Echo finite response is malformed.");
      }
      if (outcome.type === "session-created" || outcome.type === "session-attached") {
        if (disposed || ownerReleased || attachmentGeneration !== sentGeneration) {
          throw new Error("HTTP Echo attachment response is no longer current.");
        }
        const token = response.headers.get(CAPABILITY_HEADER);
        if (token === null || !/^[a-f0-9]{64}$/u.test(token)) throw new Error("HTTP Echo attachment capability is missing.");
        stopPhysical(Object.freeze({ kind: "cancelled" }));
        capability = token;
        attachmentGeneration += 1;
        sessionId = outcome.sessionId;
        epoch = outcome.epoch;
        startHeartbeat();
        void startControl();
      } else if (outcome.type === "session-detached" || outcome.type === "session-ended") {
        if (sentToken !== undefined && currentAttachment(sentToken, sentGeneration)) {
          capability = undefined;
          attachmentGeneration += 1;
          stopHeartbeat();
          stopPhysical(Object.freeze({ kind: "cancelled" }));
        }
      }
      return Object.freeze({ kind: "response", outcome });
    } catch (cause) {
      return Object.freeze({ kind: "uncertain", cause });
    } finally {
      requests.delete(controller);
      operationOptions?.signal?.removeEventListener("abort", abort);
    }
  }

  async function startControl(): Promise<void> {
    if (disposed || ownerReleased || capability === undefined || physical !== undefined) return;
    try { await openPhysical(undefined, undefined); }
    catch { if (capability !== undefined) scheduleControl(); }
  }

  async function openPhysical(request: EchoSynchronizationRequest | undefined,
    observer: EchoSynchronizationObserver | undefined,
    signal?: EchoCancellationSignal): Promise<EchoSynchronizationSubscription> {
    if (disposed || ownerReleased || capability === undefined || signal?.aborted) throw signal?.reason ?? new Error("HTTP Echo stream cannot open.");
    const sentToken = capability;
    const sentGeneration = attachmentGeneration;
    if (controlRetry !== undefined) { clearTimeout(controlRetry); controlRetry = undefined; }
    stopPhysical(Object.freeze({ kind: "cancelled" }));
    const active: Physical = { controller: new AbortController(), generation: ++generation,
      ...(observer === undefined ? {} : { observer }), ended: false };
    physical = active;
    const abort = (): void => { if (physical === active) stopPhysical(Object.freeze({ kind: "cancelled" })); };
    signal?.addEventListener("abort", abort, { once: true });
    let body: string;
    try {
      if (request !== undefined) aggregateCodec ??= await import("./echo.aggregate-semantic-codec.internal.js");
      body = request === undefined ? '{"type":"observe"}' : aggregateCodec!.encode_echo_hosted_aggregate_request_frame_internal(request);
    } catch (cause) { abort(); throw cause; }
    if (!currentAttachment(sentToken, sentGeneration) || physical !== active || signal?.aborted) {
      abort();
      throw new Error("HTTP Echo stream opening was displaced.");
    }
    try {
      const response = await fetcher(syncEndpoint, { method: "POST", body,
        headers: { "content-type": "application/json", [CAPABILITY_HEADER]: sentToken },
        credentials: options.credentials ?? "same-origin", signal: active.controller.signal, cache: "no-store", redirect: "error" });
      if (physical !== active || signal?.aborted) throw new Error("HTTP Echo stream opening was displaced.");
      if (response.status === 403) {
        if (currentAttachment(sentToken, sentGeneration)
          && response.headers.get("x-hson-attachment-state") === "invalid") fence();
        throw new Error("HTTP Echo stream admission failed.");
      }
      if (response.status !== 200) throw new Error("HTTP Echo stream admission failed.");
      if (responseType(response) !== "application/x-ndjson") {
        throw new EchoHttpRecordError("HTTP Echo stream has an invalid content type.");
      }
      if (response.body === null) throw new EchoHttpRecordError("HTTP Echo stream has no body.");
      const reader = response.body.getReader();
      const ready = readStream(active, reader, request?.id);
      await ready;
      if (physical !== active || signal?.aborted) throw new Error("HTTP Echo stream opening was displaced.");
      return Object.freeze({ cancel: () => { if (physical === active) stopPhysical(Object.freeze({ kind: "cancelled" })); } });
    } catch (cause) {
      if (physical === active) stopPhysical(Object.freeze({ kind: cause instanceof EchoHttpRecordError
        ? "invalid" : "interrupted", cause }));
      throw cause;
    } finally { signal?.removeEventListener("abort", abort); }
  }

  function readStream(active: Physical, reader: ReadableStreamDefaultReader<Uint8Array>, id?: string): Promise<void> {
    let resolveReady!: () => void;
    let rejectReady!: (cause: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void (async () => {
      let settled = false;
      const accept = async (raw: string): Promise<void> => {
        if (!settled) {
          if (raw !== '{"type":"ready"}') throw new Error("HTTP Echo stream lacks ready framing.");
          settled = true;
          resolveReady();
          return;
        }
        if (raw === '{"type":"heartbeat"}') return;
        const control = decodeEndpointMessage(raw, LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT);
        if (control?.type === "session-fenced") {
          if (control.sessionId === sessionId && control.epoch === epoch) fence();
          return;
        }
        if (control?.type === "session-ended") {
          emit(Object.freeze({ kind: "ended", sessionId: control.sessionId, epoch: control.epoch }));
          capability = undefined;
          stopHeartbeat();
          stopPhysical(Object.freeze({ kind: "invalid" }));
          return;
        }
        if (control !== undefined) throw new Error("Unexpected HTTP Echo control record.");
        if (id === undefined || active.observer === undefined) throw new Error("Unexpected HTTP Echo synchronization record.");
        const output = aggregateCodec?.decode_echo_hosted_aggregate_synchronization_frame_internal(raw);
        if (output === undefined || output.id !== id) throw new Error("HTTP Echo synchronization record is malformed.");
        await active.observer.onOutput(output);
      };
      try {
        await read_echo_http_records_internal(reader, FRAME_LIMIT, async (raw) => {
          if (physical === active) await accept(raw);
        });
        throw new Error("HTTP Echo stream ended.");
      } catch (cause) {
        if (!settled) rejectReady(cause);
        if (physical === active) stopPhysical(Object.freeze({ kind: cause instanceof EchoHttpRecordError
          ? "invalid" : "interrupted", cause }));
      } finally {
        try { await reader.cancel(); } catch { /* Transport was already closed. */ }
        reader.releaseLock();
      }
    })();
    return ready;
  }

  const transport = Object.freeze({
    operations: Object.freeze({ submit }),
    attachment: Object.freeze({ observe(listener: (event: EchoAttachmentEvent) => void) {
      if (disposed || ownerReleased) {
        listener(Object.freeze({ kind: "observation-interrupted" }));
        return () => {};
      }
      listeners.add(listener);
      listener(Object.freeze({ kind: "available" }));
      return () => { listeners.delete(listener); };
    } }),
    synchronization: Object.freeze({ open: (request: EchoSynchronizationRequest, observer: EchoSynchronizationObserver,
      syncOptions?: Readonly<{ signal?: EchoCancellationSignal }>) => openPhysical(request, observer, syncOptions?.signal) }),
    dispose() {
      if (disposed) return;
      disposed = true;
      stopPhysical(Object.freeze({ kind: "interrupted" }));
      emit(Object.freeze({ kind: "observation-interrupted" }));
      if (controlRetry !== undefined) { clearTimeout(controlRetry); controlRetry = undefined; }
      for (const controller of requests) controller.abort();
      requests.clear();
      capability = undefined;
      attachmentGeneration += 1;
      stopHeartbeat();
      listeners.clear();
    },
  });
  register_echo_transport_owner_release_internal(transport, releaseOwner);
  return transport;
}

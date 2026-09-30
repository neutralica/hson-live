import type {
  EchoAttachmentEvent,
  EchoFiniteOperationOutcome,
  EchoFiniteOperationRequest,
  EchoReplicaTransport,
  EchoSubmission,
  EchoSynchronizationEnd,
  EchoSynchronizationObserver,
  EchoSynchronizationOutput,
  EchoSynchronizationRequest,
  EchoCancellationSignal,
} from "../../types/echo.transport.types.js";
import { decodeEndpointMessage, encodeEndpointMessage } from "./echo.websocket-codec.internal.js";
import { DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES, LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../locus/locus.aggregate.protocol.js";

export type EchoWebSocketLike = Readonly<{
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  removeEventListener(type: "open", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  removeEventListener(type: "close", listener: () => void): void;
  removeEventListener(type: "error", listener: () => void): void;
}>;

export type EchoWebSocketConstructor = new (url: string) => EchoWebSocketLike;
export type EchoWebSocketTransport = EchoReplicaTransport & Readonly<{ dispose(): void }>;
export type EchoWebSocketTransportOptions = Readonly<{
  url: string;
  WebSocketConstructor?: EchoWebSocketConstructor;
}>;

function browser_websocket_constructor(): EchoWebSocketConstructor {
  const candidate = Reflect.get(globalThis, "WebSocket");
  if (typeof candidate !== "function") throw new Error("A WebSocket constructor is required.");
  return candidate as EchoWebSocketConstructor;
}

function request_id(request: EchoFiniteOperationRequest): string {
  return request.id;
}

function outcome_id(outcome: EchoFiniteOperationOutcome): string | undefined {
  return outcome.id;
}

function await_opening<T>(promise: Promise<T>, signal?: EchoCancellationSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Echo synchronization opening was cancelled."));
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason ?? new Error("Echo synchronization opening was cancelled.")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void promise.then((value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (cause) => { signal.removeEventListener("abort", abort); reject(cause); });
  });
}

/** Browser and Web Platform WebSocket adapter for one replaceable Echo transport. */
export function create_echo_websocket_transport(options: EchoWebSocketTransportOptions): EchoWebSocketTransport {
  const WebSocketConstructor = options.WebSocketConstructor ?? browser_websocket_constructor();
  const listeners = new Set<(event: EchoAttachmentEvent) => void>();
  const pending = new Map<string, (result: EchoSubmission<EchoFiniteOperationOutcome>) => void>();
  let socket: EchoWebSocketLike | undefined;
  let opening: Promise<EchoWebSocketLike> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let currentSync: Readonly<{ id: string; observer: EchoSynchronizationObserver; socket: EchoWebSocketLike;
    signal?: EchoCancellationSignal; abort?: () => void }> | undefined;
  let syncOpeningGeneration = 0;
  let aggregateCodec: typeof import("./echo.aggregate-websocket.internal.js") | undefined;
  let syncTail = Promise.resolve();

  const emit = (event: EchoAttachmentEvent): void => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* One observer cannot block other semantic consumers. */ }
    }
  };
  const interruptPending = (cause?: unknown): void => {
    for (const settle of [...pending.values()]) settle(Object.freeze({ kind: "uncertain", cause }));
  };
  const endSync = (end: EchoSynchronizationEnd): void => {
    const active = currentSync;
    currentSync = undefined;
    syncTail = Promise.resolve();
    if (active?.signal !== undefined && active.abort !== undefined) active.signal.removeEventListener("abort", active.abort);
    try { active?.observer.onEnd(end); } catch { /* Adapter teardown must still complete. */ }
  };

  function scheduleReconnect(): void {
    if (disposed || listeners.size === 0 || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void ensureOpen().catch(() => { scheduleReconnect(); });
    }, 50);
  }

  function ensureOpen(): Promise<EchoWebSocketLike> {
    if (disposed) return Promise.reject(new Error("Echo WebSocket transport is disposed."));
    if (socket?.readyState === 1) return Promise.resolve(socket);
    if (opening !== undefined) return opening;
    if (retry !== undefined) { clearTimeout(retry); retry = undefined; }
    let created: EchoWebSocketLike;
    try { created = new WebSocketConstructor(options.url); }
    catch (cause) { return Promise.reject(cause); }
    socket = created;
    opening = new Promise<EchoWebSocketLike>((resolve, reject) => {
      let settled = false;
      const onOpen = (): void => {
        if (disposed || socket !== created) return;
        settled = true;
        opening = undefined;
        emit(Object.freeze({ kind: "available" }));
        resolve(created);
      };
      const onMessage = (event: Readonly<{ data: unknown }>): void => {
        if (disposed || socket !== created) return;
        if (typeof event.data !== "string") { created.close(1003, "Echo accepts text frames only."); return; }
        try {
          const control = decodeEndpointMessage(event.data, LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT);
          const parsed: unknown = JSON.parse(event.data);
          if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) throw new Error("Malformed Echo frame.");
          if ((parsed.type === "ack" || (parsed.type === "error" && "error" in parsed)
            || parsed.type === "action-status" || parsed.type === "session-created"
            || parsed.type === "session-attached" || parsed.type === "session-rejected" || parsed.type === "session-fenced"
            || parsed.type === "session-detached" || parsed.type === "session-ended") && control === undefined) {
            throw new Error("Malformed Echo finite outcome or attachment notice.");
          }
          if (control?.type === "session-fenced") {
            emit(Object.freeze({ kind: "fenced", sessionId: control.sessionId, epoch: control.epoch }));
          } else if (control !== undefined) {
            const id = outcome_id(control);
            const correlated = id !== undefined ? pending.get(id) : undefined;
            correlated?.(Object.freeze({ kind: "response", outcome: control }));
            if (control.type === "session-ended" && correlated === undefined) {
              emit(Object.freeze({ kind: "ended", sessionId: control.sessionId, epoch: control.epoch }));
            }
          }
          const output = aggregateCodec?.decode_echo_hosted_aggregate_synchronization_frame_internal(event.data);
          if (output !== undefined) {
            const active = currentSync;
            if (active?.socket !== created) return;
            if (output.id !== active.id) return;
            syncTail = syncTail.then(() => currentSync === active ? active.observer.onOutput(output) : undefined).then(() => undefined);
            void syncTail.catch((cause) => {
              if (currentSync === active) endSync(Object.freeze({ kind: "invalid", cause }));
            });
          }
        } catch (cause) {
          endSync(Object.freeze({ kind: "invalid", cause }));
          created.close(1003, "Malformed Echo frame.");
        }
      };
      const onClose = (): void => {
        created.removeEventListener("open", onOpen);
        created.removeEventListener("message", onMessage);
        created.removeEventListener("close", onClose);
        created.removeEventListener("error", onError);
        if (socket !== created) return;
        socket = undefined;
        opening = undefined;
        if (!settled) reject(new Error("Echo WebSocket closed before opening."));
        if (disposed) return;
        interruptPending(new Error("Echo WebSocket closed."));
        endSync(Object.freeze({ kind: "interrupted" }));
        emit(Object.freeze({ kind: "observation-interrupted" }));
        scheduleReconnect();
      };
      const onError = (): void => {
        if (socket !== created) return;
        if (created.readyState === 0 || created.readyState === 1) created.close(1011, "Echo WebSocket error.");
      };
      created.addEventListener("open", onOpen);
      created.addEventListener("message", onMessage);
      created.addEventListener("close", onClose);
      created.addEventListener("error", onError);
      if (created.readyState === 1) onOpen();
    });
    return opening;
  }

  const transport: EchoWebSocketTransport = Object.freeze({
    operations: Object.freeze({
      async submit(request: EchoFiniteOperationRequest, options?: Readonly<{ signal?: EchoCancellationSignal }>) {
        if (disposed || options?.signal?.aborted) {
          return Object.freeze({ kind: "not-submitted" as const, cause: options?.signal?.reason });
        }
        let current: EchoWebSocketLike;
        try { current = await ensureOpen(); }
        catch (cause) { return Object.freeze({ kind: "not-submitted" as const, cause }); }
        if (disposed || socket !== current || options?.signal?.aborted) {
          return Object.freeze({ kind: "not-submitted" as const, cause: options?.signal?.reason });
        }
        const id = request_id(request);
        if (pending.has(id)) return Object.freeze({ kind: "not-submitted" as const, cause: new Error("Duplicate operation correlation ID.") });
        let frame: string;
        try {
          frame = encodeEndpointMessage(request);
          if (new TextEncoder().encode(frame).byteLength > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) {
            throw new Error("Hosted aggregate Echo message exceeds the live wire byte limit.");
          }
        } catch (cause) { return Object.freeze({ kind: "not-submitted" as const, cause }); }
        if (options?.signal?.aborted) return Object.freeze({ kind: "not-submitted" as const, cause: options.signal.reason });
        return new Promise<EchoSubmission<EchoFiniteOperationOutcome>>((resolve) => {
          const abort = (): void => {
            if (pending.get(id) !== settle) return;
            settle(Object.freeze({ kind: "uncertain", cause: options?.signal?.reason }));
          };
          const settle = (result: EchoSubmission<EchoFiniteOperationOutcome>): void => {
            if (pending.get(id) !== settle) return;
            pending.delete(id);
            options?.signal?.removeEventListener("abort", abort);
            resolve(result);
          };
          pending.set(id, settle);
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted) {
            settle(Object.freeze({ kind: "not-submitted", cause: options.signal.reason }));
            return;
          }
          try { current.send(frame); }
          catch (cause) { settle(Object.freeze({ kind: "uncertain", cause })); }
        });
      },
    }),
    attachment: Object.freeze({
      observe(listener: (event: EchoAttachmentEvent) => void) {
        if (disposed) { listener(Object.freeze({ kind: "observation-interrupted" })); return () => {}; }
        listeners.add(listener);
        if (socket?.readyState === 1) listener(Object.freeze({ kind: "available" }));
        else void ensureOpen().catch(() => { scheduleReconnect(); });
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0 && retry !== undefined) { clearTimeout(retry); retry = undefined; }
          if (listeners.size === 0 && pending.size === 0 && currentSync === undefined && socket?.readyState === 1) {
            socket.close(1000, "Echo observation ended.");
          }
        };
      },
    }),
    synchronization: Object.freeze({
      async open(request: EchoSynchronizationRequest, observer: EchoSynchronizationObserver,
        options?: Readonly<{ signal?: EchoCancellationSignal }>) {
        if (disposed || options?.signal?.aborted) throw options?.signal?.reason ?? new Error("Echo synchronization opening is unavailable.");
        const generation = ++syncOpeningGeneration;
        if (currentSync !== undefined) endSync(Object.freeze({ kind: "cancelled" }));
        aggregateCodec ??= await await_opening(import("./echo.aggregate-websocket.internal.js"), options?.signal);
        if (disposed || generation !== syncOpeningGeneration) throw new Error("Echo synchronization opening was displaced.");
        const current = await await_opening(ensureOpen(), options?.signal);
        if (disposed || generation !== syncOpeningGeneration || options?.signal?.aborted) {
          throw options?.signal?.reason ?? new Error("Echo synchronization opening was displaced.");
        }
        const abort = (): void => {
          if (currentSync !== active) return;
          endSync(Object.freeze({ kind: "cancelled" }));
          if (socket === current && current.readyState === 1) current.close(1000, "Echo synchronization cancelled.");
        };
        const active = Object.freeze({ id: request.id, observer, socket: current,
          ...(options?.signal === undefined ? {} : { signal: options.signal, abort }) });
        currentSync = active;
        options?.signal?.addEventListener("abort", abort, { once: true });
        if (options?.signal?.aborted) { abort(); throw options.signal.reason ?? new Error("Echo synchronization opening was cancelled."); }
        try { current.send(aggregateCodec.encode_echo_hosted_aggregate_request_frame_internal(request)); }
        catch (cause) {
          if (currentSync === active) endSync(Object.freeze({ kind: "interrupted", cause }));
          throw cause;
        }
        return Object.freeze({ cancel() {
          if (currentSync !== active) return;
          endSync(Object.freeze({ kind: "cancelled" }));
          // The current WebSocket protocol has no recovery-cancel frame.
          // Closing this physical adapter binding resets its server subscription.
          if (socket === current && current.readyState === 1) current.close(1000, "Echo synchronization cancelled.");
        } });
      },
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      syncOpeningGeneration += 1;
      if (retry !== undefined) { clearTimeout(retry); retry = undefined; }
      interruptPending(new Error("Echo WebSocket transport was disposed."));
      endSync(Object.freeze({ kind: "interrupted", cause: new Error("Echo WebSocket transport was disposed.") }));
      emit(Object.freeze({ kind: "observation-interrupted", cause: new Error("Echo WebSocket transport was disposed.") }));
      listeners.clear();
      if (socket !== undefined && socket.readyState !== 3) socket.close(1000, "Echo transport disposed.");
    },
  });
  return transport;
}

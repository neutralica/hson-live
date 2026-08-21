import type { LocusSocketLike } from "../../types/locus.types.js";

export type BrowserLocusSocketStatus = "connecting" | "open" | "closed";

export type BrowserWebSocketLike = Readonly<{
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

export type BrowserWebSocketConstructor = new (url: string) => BrowserWebSocketLike;

export type BrowserLocusSocket = Readonly<{
  socket: LocusSocketLike;
  ready: Promise<void>;
  readonly status: BrowserLocusSocketStatus;
  dispose(): void;
}>;

function default_browser_websocket_constructor(): BrowserWebSocketConstructor {
  const candidate = Reflect.get(globalThis, "WebSocket");
  if (typeof candidate !== "function") {
    throw new Error("A browser WebSocket constructor is required.");
  }
  return candidate as BrowserWebSocketConstructor;
}

/** @experimental Concrete browser transport adapter for Locus. */
export function create_browser_locus_socket(
  url: string,
  WebSocketConstructor: BrowserWebSocketConstructor = default_browser_websocket_constructor(),
): BrowserLocusSocket {
  const websocket = new WebSocketConstructor(url);
  const messageListeners = new Set<(message: string) => void>();
  const closeListeners = new Set<() => void>();
  let status: BrowserLocusSocketStatus = "connecting";
  let disposed = false;
  let settled = false;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const resolve_ready = (): void => {
    if (settled) return;
    settled = true;
    resolveReady();
  };
  const reject_ready = (message: string): void => {
    if (settled) return;
    settled = true;
    rejectReady(new Error(message));
  };
  const onOpen = (): void => {
    if (disposed) return;
    status = "open";
    resolve_ready();
  };
  const onMessage = (event: Readonly<{ data: unknown }>): void => {
    if (disposed) return;
    if (typeof event.data !== "string") {
      websocket.close(1003, "Locus accepts text messages only.");
      return;
    }
    for (const listener of [...messageListeners]) listener(event.data);
  };
  const onClose = (): void => {
    if (disposed) return;
    if (status === "connecting") reject_ready("Locus WebSocket closed before opening.");
    status = "closed";
    for (const listener of [...closeListeners]) listener();
  };
  const onError = (): void => {
    if (disposed) return;
    if (status === "connecting") {
      reject_ready(`Unable to connect Locus WebSocket at ${url}.`);
      return;
    }
    if (status === "open") websocket.close(1011, "Locus WebSocket error.");
  };

  websocket.addEventListener("open", onOpen);
  websocket.addEventListener("message", onMessage);
  websocket.addEventListener("close", onClose);
  websocket.addEventListener("error", onError);

  const socket: LocusSocketLike = Object.freeze({
    send(message) {
      if (status !== "open") throw new Error("Locus WebSocket is not open.");
      websocket.send(message);
    },
    close(code, reason) {
      websocket.close(code, reason);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        messageListeners.delete(listener);
      };
    },
    onClose(listener) {
      if (status === "closed") {
        listener();
        return;
      }
      closeListeners.add(listener);
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        closeListeners.delete(listener);
      };
    },
  });

  return Object.freeze({
    socket,
    ready,
    get status() { return status; },
    dispose() {
      if (disposed) return;
      if (status === "connecting") reject_ready("Locus WebSocket disposed before opening.");
      disposed = true;
      messageListeners.clear();
      closeListeners.clear();
      websocket.removeEventListener("open", onOpen);
      websocket.removeEventListener("message", onMessage);
      websocket.removeEventListener("close", onClose);
      websocket.removeEventListener("error", onError);
      if (status !== "closed") websocket.close(1000, "Locus client disposed.");
      status = "closed";
    },
  });
}

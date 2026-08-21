import type { LocusSocketLike } from "../../../types/locus.types.js";
import WebSocket from "ws";

export type NodeLocusSocketOptions = Readonly<{
  onSend?: (message: string) => void;
  maxBufferedAmount?: number;
  onBackpressure?: () => void;
}>;

/** @experimental Concrete Node `ws` transport adapter for Locus. */
export function create_node_locus_socket(
  websocket: WebSocket,
  optionsOrOnSend?: NodeLocusSocketOptions | ((message: string) => void),
): LocusSocketLike {
  const options: NodeLocusSocketOptions = typeof optionsOrOnSend === "function"
    ? { onSend: optionsOrOnSend }
    : optionsOrOnSend ?? {};
  let backpressureClosed = false;
  const close_after_error = (): void => {
    if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
      websocket.close(1011, "Locus WebSocket error.");
    }
  };
  const stop_error_handling = (): void => {
    websocket.off("error", close_after_error);
  };
  websocket.once("error", close_after_error);
  websocket.once("close", stop_error_handling);

  return Object.freeze({
    send(message) {
      if (websocket.readyState !== WebSocket.OPEN) return;
      if (
        options.maxBufferedAmount !== undefined
        && websocket.bufferedAmount > options.maxBufferedAmount
      ) {
        if (!backpressureClosed) {
          backpressureClosed = true;
          options.onBackpressure?.();
          websocket.close(1013, "Locus transport backpressure limit exceeded.");
        }
        return;
      }
      options.onSend?.(message);
      try {
        websocket.send(message);
      } catch {
        close_after_error();
      }
    },
    close(code, reason) {
      if (websocket.readyState === WebSocket.CLOSED) return;
      websocket.close(code, reason);
    },
    onMessage(listener) {
      const handle = (data: WebSocket.RawData, isBinary: boolean): void => {
        if (isBinary) {
          websocket.close(1003, "Locus accepts text messages only.");
          return;
        }
        listener(data.toString("utf8"));
      };
      websocket.on("message", handle);
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        websocket.off("message", handle);
      };
    },
    onClose(listener) {
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

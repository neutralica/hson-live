import type { LocusConnectionContext, LocusDisposer } from "../../../types/locus.types.js";
import { bind_locus_websocket, type LocusWebSocketLike } from "../locus.websocket.js";
import WebSocket from "ws";

export type NodeLocusWebSocketOptions = Readonly<{
  onSend?: (message: string) => void;
  maxBufferedAmount?: number;
  onBackpressure?: () => void;
}>;

/** @experimental Concrete Node `ws` transport adapter for Locus. */
export function bind_node_locus_websocket(
  locus: object,
  websocket: WebSocket,
  context?: LocusConnectionContext,
  options: NodeLocusWebSocketOptions = {},
): LocusDisposer {
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

  const socket: LocusWebSocketLike = Object.freeze({
    send(message) {
      if (websocket.readyState !== WebSocket.OPEN) throw new Error("Locus WebSocket is not open.");
      if (
        options.maxBufferedAmount !== undefined
        && websocket.bufferedAmount > options.maxBufferedAmount
      ) {
        if (!backpressureClosed) {
          backpressureClosed = true;
          options.onBackpressure?.();
          websocket.close(1013, "Locus transport backpressure limit exceeded.");
        }
        throw new Error("Locus WebSocket backpressure limit exceeded.");
      }
      options.onSend?.(message);
      try {
        websocket.send(message);
      } catch {
        close_after_error();
        throw new Error("Locus WebSocket send failed.");
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
  return bind_locus_websocket(locus, socket, context);
}

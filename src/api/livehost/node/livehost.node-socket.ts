import type { LiveHostSocketLike } from "../../../types/livehost.types.js";
import WebSocket from "ws";

/** @experimental Concrete Node `ws` transport adapter for LiveHost. */
export function create_node_livehost_socket(
  websocket: WebSocket,
  onSend?: (message: string) => void,
): LiveHostSocketLike {
  const close_after_error = (): void => {
    if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
      websocket.close(1011, "LiveHost WebSocket error.");
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
      onSend?.(message);
      websocket.send(message);
    },
    close(code, reason) {
      if (websocket.readyState === WebSocket.CLOSED) return;
      websocket.close(code, reason);
    },
    onMessage(listener) {
      const handle = (data: WebSocket.RawData, isBinary: boolean): void => {
        if (isBinary) {
          websocket.close(1003, "LiveHost accepts text messages only.");
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

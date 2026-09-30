import { create_echo_websocket_transport, type EchoWebSocketLike } from "../../src/api/echo/echo.websocket.ts";
import type { LocusWebSocketLike } from "../../src/api/locus/locus.websocket.ts";

/** Bridge deterministic text-frame fixtures through the concrete WebSocket adapter. */
export function test_echo_transport(physical: LocusWebSocketLike) {
  class FixtureWebSocket implements EchoWebSocketLike {
    readyState = 1;
    private readonly listeners = new Map<string, Set<(...args: never[]) => void>>();
    private readonly stopMessage: (() => void) | void;
    private readonly stopClose: (() => void) | void;

    constructor(_url: string) {
      this.stopMessage = physical.onMessage((data) => this.emit("message", { data }));
      try { this.stopClose = physical.onClose(() => this.close()); }
      catch (cause) { this.stopMessage?.(); throw cause; }
    }
    private emit(type: string, event?: unknown): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event as never);
    }
    send(data: string): void { physical.send(data); }
    close(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.stopMessage?.();
      this.stopClose?.();
      physical.close();
      this.emit("close");
    }
    addEventListener(type: string, listener: (...args: never[]) => void): void {
      const members = this.listeners.get(type) ?? new Set();
      members.add(listener);
      this.listeners.set(type, members);
    }
    removeEventListener(type: string, listener: (...args: never[]) => void): void {
      this.listeners.get(type)?.delete(listener);
    }
  }
  return create_echo_websocket_transport({ url: "fixture://echo", WebSocketConstructor: FixtureWebSocket });
}

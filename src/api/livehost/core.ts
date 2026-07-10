// livehost/core.ts

import { hson } from "../../hson.js";
import type {
  LiveHost,
  LiveHostActionContext,
  LiveHostClientActionMessage,
  LiveHostOptions,
  LiveHostServerMessage,
  LiveHostSessionId,
  LiveHostSocketLike,
} from "./livehost.types.js";
import { decode_livehost_message, encode_livehost_message } from "./protocol.js";

let livehost_session_inc = 0;

function make_livehost_session_id(): LiveHostSessionId {
  livehost_session_inc += 1;
  return `lhs-${Date.now().toString(36)}-${livehost_session_inc.toString(36)}`;
}

function resolve_session_id(option: LiveHostOptions["sessionId"]): LiveHostSessionId {
  if (typeof option === "function") return option();
  return option ?? make_livehost_session_id();
}

export function create_livehost(options: LiveHostOptions = {}): LiveHost {
  const map = hson.liveMap.fromJson(options.state ?? {});
  const actions = options.actions ?? {};
  const sessionId = resolve_session_id(options.sessionId);
  let seq = 0;

  function next_seq(): number {
    seq += 1;
    return seq;
  }

  function action_context(): LiveHostActionContext {
    return { map, seq };
  }

  async function dispatch_action(message: LiveHostClientActionMessage): Promise<LiveHostServerMessage> {
    const handler = actions[message.name];
    if (!handler) {
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        error: {
          message: `Unknown LiveHost action: ${message.name}`,
          code: "LIVEHOST_UNKNOWN_ACTION",
        },
      };
    }

    try {
      await handler(action_context(), message.payload, message);
      return {
        type: "ack",
        id: message.id,
        ok: true,
        seq: next_seq(),
      };
    } catch (cause) {
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        error: {
          message: cause instanceof Error ? cause.message : "LiveHost action failed.",
          code: "LIVEHOST_ACTION_FAILED",
          cause,
        },
      };
    }
  }

  function connect(socket: LiveHostSocketLike): () => void {
    const disposers: Array<() => void> = [];

    function send(message: LiveHostServerMessage): void {
      socket.send(encode_livehost_message(message));
    }

    const stopMessage = socket.onMessage(async (raw) => {
      const decoded = decode_livehost_message(raw);
      if (!decoded.ok) {
        send({ type: "error", seq, error: decoded.error });
        return;
      }

      const message = decoded.value;
      if (message.type === "hello") {
        send({ type: "hello", sessionId, seq, snapshot: map.snap() });
        return;
      }

      if (message.type === "action") {
        send(await dispatch_action(message));
        return;
      }

      if (message.type === "subscribe" || message.type === "unsubscribe") {
        send({
          type: "error",
          seq,
          error: {
            message: `LiveHost ${message.type} is not implemented yet.`,
            code: "LIVEHOST_NOT_IMPLEMENTED",
            path: message.path,
          },
        });
      }
    });

    const stopClose = socket.onClose(() => {
      while (disposers.length) disposers.pop()?.();
    });

    if (stopMessage) disposers.push(stopMessage);
    if (stopClose) disposers.push(stopClose);

    return () => {
      while (disposers.length) disposers.pop()?.();
    };
  }

  return {
    map,
    get seq() { return seq; },
    dispatch_action,
    connect,
  };
}
// livehost/core.ts

import { hson } from "../../hson.js";
import type { JsonValue, LiveMap } from "../../types/index.js";
import type {
  LiveHost,
  LiveHostActionContext,
  LiveHostActionPayloads,
  LiveHostActions,
  LiveHostClientActionMessage,
  LiveHostOptions,
  LiveHostSchemaDecoder,
  LiveHostSchemaResult,
  LiveHostSeq,
  LiveHostServerMessage,
  LiveHostSessionId,
  LiveHostSocketLike,
  LiveHostValidator,
} from "./livehost.types.js";
import { decode_livehost_message, encode_livehost_message } from "./livehost.protocol.js";
import { make_livehost_sync_manager } from "./livehost.sync.js";

let livehost_session_inc = 0;

function make_livehost_session_id(): LiveHostSessionId {
  livehost_session_inc += 1;
  return `lhs-${Date.now().toString(36)}-${livehost_session_inc.toString(36)}`;
}

function resolve_session_id(option: LiveHostOptions["sessionId"]): LiveHostSessionId {
  if (typeof option === "function") return option();
  return option ?? make_livehost_session_id();
}

function is_schema_result<TValue>(value: unknown): value is LiveHostSchemaResult<TValue> {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && typeof (value as { ok?: unknown }).ok === "boolean";
}

function decode_with_schema<TValue>(
  schema: LiveHostValidator<TValue> | LiveHostSchemaDecoder<TValue> | undefined,
  value: unknown,
): LiveHostSchemaResult<TValue> {
  if (!schema) return { ok: true, value: value as TValue };

  const result = schema(value);
  if (is_schema_result<TValue>(result)) return result;
  if (result === true) return { ok: true, value: value as TValue };

  return {
    ok: false,
    issues: ["Value failed LiveHost schema validation."],
  };
}

function schema_error_message(issues: readonly string[]): string {
  return issues.length ? issues.join("; ") : "Value failed LiveHost schema validation.";
}

export function create_livehost<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: LiveHostOptions<TState, TActions> = {}): LiveHost<TState, TActions> {
  const stateResult = decode_with_schema(options.schema?.state, options.state ?? {});
  const initialState: JsonValue = (stateResult.ok ? stateResult.value : options.state) ?? {};
  const map = hson.liveMap.fromJson(initialState) as unknown as LiveHost<TState, TActions>["map"];
  const sync = make_livehost_sync_manager(map as unknown as LiveMap<JsonValue | undefined>);
  const actions: Partial<LiveHostActions<TActions, TState>> = options.actions ?? {};
  let seq = 0;

  function next_seq(): LiveHostSeq {
    seq += 1;
    return seq;
  }

  function action_context(): LiveHostActionContext<TState> {
    return { map, seq };
  }

  async function dispatch_action(message: LiveHostClientActionMessage<TActions>): Promise<LiveHostServerMessage<TState>> {
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

    const actionSchema = options.schema?.actions?.[message.name];
    const payloadResult = decode_with_schema(actionSchema?.payload, message.payload);
    if (!payloadResult.ok) {
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        error: {
          message: schema_error_message(payloadResult.issues),
          code: "LIVEHOST_SCHEMA_INVALID_PAYLOAD",
        },
      };
    }

    try {
      await handler(action_context(), payloadResult.value, message);
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

    const sessionId = resolve_session_id(options.sessionId);
    const disposers: Array<() => void> = [];

    function send(message: LiveHostServerMessage<TState>): void {
      socket.send(encode_livehost_message(message));
    }

    const sessionResult = sync.add_session(sessionId, send);
    if (!sessionResult.ok) {
      send({ type: "error", seq, error: sessionResult.error });
    }

    const stopMessage = socket.onMessage(async (raw) => {
      const decoded = decode_livehost_message<TActions>(raw);
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
        const response = await dispatch_action(message);
        send(response);
        if (response.type === "ack") sync.sync_all(response.seq);
        return;
      }

      if (message.type === "subscribe") {
        const result = sync.subscribe(sessionId, message.path, seq);
        if (!result.ok) send({ type: "error", seq, error: result.error });
        return;
      }

      if (message.type === "unsubscribe") {
        const result = sync.unsubscribe(sessionId, message.path);
        if (!result.ok) send({ type: "error", seq, error: result.error });
      }
    });

    const stopClose = socket.onClose(() => {
      sync.remove_session(sessionId);
      while (disposers.length) disposers.pop()?.();
    });

    if (stopMessage) disposers.push(stopMessage);
    if (stopClose) disposers.push(stopClose);

    return () => {
      sync.remove_session(sessionId);
      while (disposers.length) disposers.pop()?.();
    };
  }

  return {
    map,
    get seq() { return seq; },
    schema: options.schema,
    dispatch_action,
    connect,
  };
}
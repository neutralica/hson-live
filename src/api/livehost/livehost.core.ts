// livehost/core.ts

import { hson } from "../../hson.js";
import type { JsonValue, LiveMap } from "../../types/index.js";
import type {
  LiveHost,
  LiveHostActionContext,
  LiveHostActionPayloads,
  LiveHostActions,
  LiveHostClientActionMessage,
  LiveHostConnection,
  LiveHostOptions,
  LiveHostSchemaDecoder,
  LiveHostSchemaResult,
  LiveHostSeq,
  LiveHostServerMessage,
  LiveHostSessionId,
  LiveHostSocketLike,
  LiveHostValidator,
} from "../../types/livehost.types.js";
import { decode_livehost_message, encode_livehost_message, is_livehost_json_value } from "./livehost.protocol.js";
import { make_livehost_resume_log } from "./livehost.resume.js";
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
  const resume = make_livehost_resume_log();
  const actions: Partial<LiveHostActions<TActions, TState>> = options.actions ?? {};
  let seq = 0;

  function next_seq(): LiveHostSeq {
    seq += 1;
    return seq;
  }

  function action_context(emitEvent: LiveHostActionContext<TState>["emit_event"]): LiveHostActionContext<TState> {
    return { map, seq, emit_event: emitEvent };
  }

  async function dispatch_action_scoped(
    message: LiveHostClientActionMessage<TActions>,
    emitEvent: LiveHostActionContext<TState>["emit_event"],
  ): Promise<LiveHostServerMessage<TState>> {
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
      const result = await handler(action_context(emitEvent), payloadResult.value, message);
      if (result !== undefined && !is_livehost_json_value(result)) {
        throw new Error("LiveHost action result must be JSON-serializable.");
      }
      return {
        type: "ack",
        id: message.id,
        ok: true,
        seq: next_seq(),
        ...(result !== undefined ? { result } : {}),
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
        },
      };
    }
  }

  function dispatch_action(message: LiveHostClientActionMessage<TActions>): Promise<LiveHostServerMessage<TState>> {
    return dispatch_action_scoped(message, () => false);
  }

  function connect(socket: LiveHostSocketLike): LiveHostConnection {

    const sessionId = resolve_session_id(options.sessionId);
    const disposers: Array<() => void> = [];
    let active = true;

    function send_encoded(message: LiveHostServerMessage<TState>): void {
      socket.send(encode_livehost_message(message));
    }

    function send(message: LiveHostServerMessage<TState>): void {
      if (message.type === "sync") resume.record_sync(message);
      send_encoded(message);
    }

    function send_without_record(message: LiveHostServerMessage<TState>): void {
      send_encoded(message);
    }

    function emit_connection_event(event: string, payload: JsonValue): boolean {
      if (!active) return false;
      send_without_record({ type: "event", event, payload });
      return true;
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
        send_without_record({ type: "hello", sessionId, seq, snapshot: map.snap() });
        if (message.lastSeq !== undefined && resume.can_replay_after(message.lastSeq)) {
          for (const replay of resume.replay_after(message.lastSeq)) send_without_record(replay);
        }
        return;
      }

      if (message.type === "action") {
        const response = await dispatch_action_scoped(message, emit_connection_event);
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
      active = false;
      sync.remove_session(sessionId);
      while (disposers.length) disposers.pop()?.();
    });

    if (stopMessage) disposers.push(stopMessage);
    if (stopClose) disposers.push(stopClose);

    const disconnect = () => {
      active = false;
      sync.remove_session(sessionId);
      while (disposers.length) disposers.pop()?.();
    };

    return Object.assign(disconnect, {
      emit_event(event: string, payload: JsonValue): void {
        emit_connection_event(event, payload);
      },
    });
  }

  return {
    map,
    get seq() { return seq; },
    schema: options.schema,
    dispatch_action,
    connect,
  };
}

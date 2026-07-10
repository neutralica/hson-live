// livehost/sync.ts

import type { JsonValue, LiveMap, LivePath } from "../../types/index.js";
import type {
  LiveHostError,
  LiveHostResult,
  LiveHostSeq,
  LiveHostServerSyncMessage,
  LiveHostSessionId,
} from "../../types/livehost.types.js";

export type LiveHostSyncSend = (message: LiveHostServerSyncMessage) => void;

export type LiveHostSyncSession = Readonly<{
  sessionId: LiveHostSessionId;
  paths: readonly LivePath[];
}>;

export type LiveHostSyncManager = Readonly<{
  add_session: (sessionId: LiveHostSessionId, send: LiveHostSyncSend) => LiveHostResult<void>;
  remove_session: (sessionId: LiveHostSessionId) => void;
  subscribe: (sessionId: LiveHostSessionId, path: LivePath, seq: LiveHostSeq) => LiveHostResult<void>;
  unsubscribe: (sessionId: LiveHostSessionId, path: LivePath) => LiveHostResult<void>;
  sync_session_path: (sessionId: LiveHostSessionId, path: LivePath, seq: LiveHostSeq) => LiveHostResult<void>;
  sync_all: (seq: LiveHostSeq) => void;
  debug_sessions: () => readonly LiveHostSyncSession[];
}>;

type LiveHostSyncSessionState = {
  readonly sessionId: LiveHostSessionId;
  readonly send: LiveHostSyncSend;
  readonly paths: Map<string, LivePath>;
};

function ok<T>(value: T): LiveHostResult<T> {
  return { ok: true, value };
}

function fail(message: string, extra?: Omit<LiveHostError, "message">): LiveHostResult<never> {
  return { ok: false, error: { message, ...extra } };
}

function clone_json_value<TValue>(value: TValue): TValue {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as TValue;
}

function clone_live_path(path: LivePath): LivePath {
  return [...path];
}

function live_path_key(path: LivePath): string {
  return JSON.stringify(path);
}

function sync_value_for_path<TState extends JsonValue | undefined>(
  map: LiveMap<TState>,
  path: LivePath,
): JsonValue | undefined {
  return clone_json_value(map.at(path).snap());
}

function send_sync<TState extends JsonValue | undefined>(
  map: LiveMap<TState>,
  session: LiveHostSyncSessionState,
  path: LivePath,
  seq: LiveHostSeq,
): void {
  session.send({
    type: "sync",
    seq,
    path: clone_live_path(path),
    value: sync_value_for_path(map, path),
  });
}

export function make_livehost_sync_manager<TState extends JsonValue | undefined>(
  map: LiveMap<TState>,
): LiveHostSyncManager {
  const sessions = new Map<LiveHostSessionId, LiveHostSyncSessionState>();

  function add_session(sessionId: LiveHostSessionId, send: LiveHostSyncSend): LiveHostResult<void> {
    if (sessions.has(sessionId)) {
      return fail(`LiveHost sync session already exists: ${sessionId}`, {
        code: "LIVEHOST_DUPLICATE_SESSION",
      });
    }

    sessions.set(sessionId, {
      sessionId,
      send,
      paths: new Map(),
    });

    return ok(undefined);
  }

  function remove_session(sessionId: LiveHostSessionId): void {
    sessions.delete(sessionId);
  }

  function session_or_error(sessionId: LiveHostSessionId): LiveHostResult<LiveHostSyncSessionState> {
    const session = sessions.get(sessionId);
    if (session) return ok(session);

    return fail(`Unknown LiveHost sync session: ${sessionId}`, {
      code: "LIVEHOST_UNKNOWN_SESSION",
    });
  }

  function sync_session_path(sessionId: LiveHostSessionId, path: LivePath, seq: LiveHostSeq): LiveHostResult<void> {
    const sessionResult = session_or_error(sessionId);
    if (!sessionResult.ok) return sessionResult;

    send_sync(map, sessionResult.value, path, seq);
    return ok(undefined);
  }

  function subscribe(sessionId: LiveHostSessionId, path: LivePath, seq: LiveHostSeq): LiveHostResult<void> {
    const sessionResult = session_or_error(sessionId);
    if (!sessionResult.ok) return sessionResult;

    const stablePath = clone_live_path(path);
    sessionResult.value.paths.set(live_path_key(stablePath), stablePath);
    send_sync(map, sessionResult.value, stablePath, seq);

    return ok(undefined);
  }

  function unsubscribe(sessionId: LiveHostSessionId, path: LivePath): LiveHostResult<void> {
    const sessionResult = session_or_error(sessionId);
    if (!sessionResult.ok) return sessionResult;

    sessionResult.value.paths.delete(live_path_key(path));
    return ok(undefined);
  }

  function sync_all(seq: LiveHostSeq): void {
    for (const session of sessions.values()) {
      for (const path of session.paths.values()) {
        send_sync(map, session, path, seq);
      }
    }
  }

  function debug_sessions(): readonly LiveHostSyncSession[] {
    return Array.from(sessions.values(), (session) => Object.freeze({
      sessionId: session.sessionId,
      paths: Array.from(session.paths.values(), clone_live_path),
    }));
  }

  return Object.freeze({
    add_session,
    remove_session,
    subscribe,
    unsubscribe,
    sync_session_path,
    sync_all,
    debug_sessions,
  });
}
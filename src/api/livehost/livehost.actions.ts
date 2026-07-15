import type { JsonValue } from "../../types/index.js";
import type {
  LiveHostActionDedupeDiagnostics,
  LiveHostActionDedupeOptions,
  LiveHostActionDelivery,
  LiveHostActionRequestErrorCode,
  LiveHostActionRequestId,
  LiveHostActionStatusState,
  LiveHostActionTerminalOutcome,
  LiveHostDisposer,
  LiveHostId,
} from "../../types/livehost.types.js";

const DEFAULT_MAX_TERMINAL_RECORDS = 1_024;
const DEFAULT_MAX_TERMINAL_BYTES = 4 * 1_024 * 1_024;
const DEFAULT_TERMINAL_RETENTION_MS = 5 * 60_000;
const DEFAULT_MAX_EXPIRED_TOMBSTONES = 1_024;
const textEncoder = new TextEncoder();

type PendingRecord = {
  readonly state: "pending";
  readonly key: string;
  readonly fingerprint: string;
  readonly promise: Promise<LiveHostActionTerminalOutcome | undefined>;
  readonly resolve: (outcome: LiveHostActionTerminalOutcome | undefined) => void;
  waiterCount: number;
};

type TerminalRecord = {
  readonly state: "succeeded" | "failed";
  readonly key: string;
  readonly fingerprint: string;
  readonly outcome: LiveHostActionTerminalOutcome;
  readonly encodedBytes: number;
  readonly completedAt: number;
  stopExpiry: LiveHostDisposer;
};

type ActionRecord = PendingRecord | TerminalRecord;

export type LiveHostActionExecuteRequest = Readonly<{
  clientId: LiveHostId;
  requestId: LiveHostActionRequestId;
  actionName: string;
  payload: JsonValue | undefined;
  retry: boolean;
  run: () => Promise<LiveHostActionTerminalOutcome>;
}>;

export type LiveHostActionExecuteResult =
  | Readonly<{
    ok: true;
    outcome: LiveHostActionTerminalOutcome;
    delivery: Exclude<LiveHostActionDelivery, "rejected">;
  }>
  | Readonly<{
    ok: false;
    code: LiveHostActionRequestErrorCode;
    message: string;
  }>;

export type LiveHostActionStatusResult = Readonly<{
  state: LiveHostActionStatusState;
  outcome?: LiveHostActionTerminalOutcome;
}>;

export type LiveHostActionDedupeStore = Readonly<{
  execute: (request: LiveHostActionExecuteRequest) => Promise<LiveHostActionExecuteResult>;
  status: (clientId: LiveHostId, requestId: LiveHostActionRequestId) => LiveHostActionStatusResult;
  debug: () => LiveHostActionDedupeDiagnostics;
  dispose: LiveHostDisposer;
}>;

function bound(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return Math.trunc(value);
  throw new Error(`LiveHost action dedupe ${name} must be a non-negative finite number.`);
}

function default_schedule(delayMs: number, callback: () => void): LiveHostDisposer {
  const timer = setTimeout(callback, delayMs);
  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
  return () => clearTimeout(timer);
}

function clone_json(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone = value.map(clone_json);
    Object.freeze(clone);
    return clone;
  }
  const clone: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) clone[key] = clone_json(value[key]);
  return Object.freeze(clone);
}

function clone_outcome(outcome: LiveHostActionTerminalOutcome): LiveHostActionTerminalOutcome {
  if (outcome.state === "succeeded") {
    return Object.freeze({
      state: "succeeded",
      seq: outcome.seq,
      completionRev: outcome.completionRev,
      ...(outcome.result !== undefined ? { result: clone_json(outcome.result) } : {}),
    });
  }
  return Object.freeze({
    state: "failed",
    seq: outcome.seq,
    completionRev: outcome.completionRev,
    error: Object.freeze({
      message: outcome.error.message,
      ...(outcome.error.code ? { code: outcome.error.code } : {}),
      ...(outcome.error.path ? { path: Object.freeze([...outcome.error.path]) } : {}),
    }),
  });
}

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function fingerprint(namespace: string, actionName: string, payload: JsonValue | undefined): string {
  return `${canonical(namespace)}|${canonical(actionName)}|${payload === undefined ? "absent" : `present:${canonical(payload)}`}`;
}

function request_key(clientId: LiveHostId, requestId: LiveHostActionRequestId): string {
  return `${clientId.length}:${clientId}${requestId}`;
}

function valid_identity(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

function encoded_bytes(outcome: LiveHostActionTerminalOutcome): number {
  return textEncoder.encode(JSON.stringify(outcome)).byteLength;
}

export function make_livehost_action_dedupe_store(
  headRev: () => number,
  currentSeq: () => number,
  options: LiveHostActionDedupeOptions = {},
): LiveHostActionDedupeStore {
  const namespace = options.namespace ?? "livehost-action-v1";
  const maxTerminalRecords = bound(options.maxTerminalRecords, DEFAULT_MAX_TERMINAL_RECORDS, "maxTerminalRecords");
  const maxTerminalBytes = bound(options.maxTerminalBytes, DEFAULT_MAX_TERMINAL_BYTES, "maxTerminalBytes");
  const terminalRetentionMs = bound(options.terminalRetentionMs, DEFAULT_TERMINAL_RETENTION_MS, "terminalRetentionMs");
  const maxExpiredTombstones = bound(options.maxExpiredTombstones, DEFAULT_MAX_EXPIRED_TOMBSTONES, "maxExpiredTombstones");
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? default_schedule;
  const records = new Map<string, ActionRecord>();
  const terminalOrder: string[] = [];
  const tombstones = new Set<string>();
  const tombstoneOrder: string[] = [];
  let terminalBytes = 0;
  let disposed = false;
  let joinedPendingDuplicateCount = 0;
  let cachedOutcomeResponseCount = 0;
  let requestIdConflictCount = 0;
  let expiredRecordCount = 0;
  let unknownStatusQueryCount = 0;
  let executionsStarted = 0;
  let executionsSucceeded = 0;
  let executionsFailed = 0;
  let outcomeNormalizationFailureCount = 0;

  function add_tombstone(key: string): void {
    if (maxExpiredTombstones === 0 || tombstones.has(key)) return;
    tombstones.add(key);
    tombstoneOrder.push(key);
    while (tombstoneOrder.length > maxExpiredTombstones) {
      const removed = tombstoneOrder.shift();
      if (removed) tombstones.delete(removed);
    }
  }

  function remove_terminal(record: TerminalRecord): void {
    if (records.get(record.key) !== record) return;
    records.delete(record.key);
    record.stopExpiry();
    terminalBytes -= record.encodedBytes;
    const index = terminalOrder.indexOf(record.key);
    if (index >= 0) terminalOrder.splice(index, 1);
    add_tombstone(record.key);
    expiredRecordCount += 1;
  }

  function trim_terminals(): void {
    while (terminalOrder.length > maxTerminalRecords || terminalBytes > maxTerminalBytes) {
      const key = terminalOrder[0];
      const record = key ? records.get(key) : undefined;
      if (!record || record.state === "pending") {
        terminalOrder.shift();
        continue;
      }
      remove_terminal(record);
    }
  }

  function infrastructure_outcome(): LiveHostActionTerminalOutcome {
    return Object.freeze({
      state: "failed",
      seq: currentSeq(),
      completionRev: headRev(),
      error: Object.freeze({
        code: "LIVEHOST_ACTION_OUTCOME_NORMALIZATION_FAILED",
        message: "LiveHost could not normalize the terminal action outcome.",
      }),
    });
  }

  function settle(pending: PendingRecord, candidate: LiveHostActionTerminalOutcome): void {
    if (records.get(pending.key) !== pending) return;
    let outcome: LiveHostActionTerminalOutcome;
    try {
      outcome = clone_outcome(candidate);
      encoded_bytes(outcome);
    } catch {
      outcome = infrastructure_outcome();
    }
    const completedAt = now();
    if (outcome.state === "failed" && outcome.error.code === "LIVEHOST_ACTION_OUTCOME_NORMALIZATION_FAILED") {
      outcomeNormalizationFailureCount += 1;
    }
    const terminal: TerminalRecord = {
      state: outcome.state,
      key: pending.key,
      fingerprint: pending.fingerprint,
      outcome,
      encodedBytes: encoded_bytes(outcome),
      completedAt,
      stopExpiry: () => {},
    };
    records.set(pending.key, terminal);
    terminalOrder.push(pending.key);
    terminalBytes += terminal.encodedBytes;
    terminal.stopExpiry = schedule(terminalRetentionMs, () => remove_terminal(terminal));
    if (outcome.state === "succeeded") executionsSucceeded += 1;
    else executionsFailed += 1;
    trim_terminals();
    pending.resolve(outcome);
  }

  async function execute(request: LiveHostActionExecuteRequest): Promise<LiveHostActionExecuteResult> {
    if (disposed) {
      return { ok: false, code: "LIVEHOST_ACTION_DEDUPE_STORE_UNAVAILABLE", message: "LiveHost action dedupe store is unavailable." };
    }
    if (!valid_identity(request.clientId) || !valid_identity(request.requestId)) {
      return { ok: false, code: "LIVEHOST_ACTION_REQUEST_ID_MALFORMED", message: "LiveHost action request identity is malformed." };
    }
    const key = request_key(request.clientId, request.requestId);
    const requestFingerprint = fingerprint(namespace, request.actionName, request.payload);
    const existing = records.get(key);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        requestIdConflictCount += 1;
        return { ok: false, code: "LIVEHOST_ACTION_REQUEST_ID_CONFLICT", message: "LiveHost action request ID was reused with different content." };
      }
      if (existing.state === "pending") {
        joinedPendingDuplicateCount += 1;
        existing.waiterCount += 1;
        const outcome = await existing.promise;
        if (!outcome) return { ok: false, code: "LIVEHOST_ACTION_DEDUPE_STORE_UNAVAILABLE", message: "LiveHost action dedupe store was disposed while the request was pending." };
        return { ok: true, outcome, delivery: "joined" };
      }
      cachedOutcomeResponseCount += 1;
      return { ok: true, outcome: existing.outcome, delivery: "cached" };
    }
    if (tombstones.has(key)) {
      return { ok: false, code: "LIVEHOST_ACTION_REQUEST_EXPIRED", message: "LiveHost action request outcome has expired." };
    }
    if (request.retry) {
      return { ok: false, code: "LIVEHOST_ACTION_REQUEST_UNKNOWN", message: "LiveHost cannot prove a prior execution for this retry request." };
    }

    let resolveOutcome: (outcome: LiveHostActionTerminalOutcome | undefined) => void = () => {};
    const promise = new Promise<LiveHostActionTerminalOutcome | undefined>((resolve) => { resolveOutcome = resolve; });
    const pending: PendingRecord = {
      state: "pending",
      key,
      fingerprint: requestFingerprint,
      promise,
      resolve: resolveOutcome,
      waiterCount: 1,
    };
    records.set(key, pending);
    executionsStarted += 1;
    void (async () => {
      try {
        settle(pending, await request.run());
      } catch {
        settle(pending, infrastructure_outcome());
      }
    })();
    const outcome = await promise;
    if (!outcome) return { ok: false, code: "LIVEHOST_ACTION_DEDUPE_STORE_UNAVAILABLE", message: "LiveHost action dedupe store was disposed while the request was pending." };
    return { ok: true, outcome, delivery: "executed" };
  }

  function status(clientId: LiveHostId, requestId: LiveHostActionRequestId): LiveHostActionStatusResult {
    if (!valid_identity(clientId) || !valid_identity(requestId)) return Object.freeze({ state: "unknown" });
    const key = request_key(clientId, requestId);
    const record = records.get(key);
    if (record?.state === "pending") return Object.freeze({ state: "pending" });
    if (record) return Object.freeze({ state: record.state, outcome: record.outcome });
    if (tombstones.has(key)) return Object.freeze({ state: "expired" });
    unknownStatusQueryCount += 1;
    return Object.freeze({ state: "unknown" });
  }

  function debug(): LiveHostActionDedupeDiagnostics {
    const pending = [...records.values()].filter((record): record is PendingRecord => record.state === "pending");
    const terminals = terminalOrder.map((key) => records.get(key)).filter((record): record is TerminalRecord => record !== undefined && record.state !== "pending");
    const oldest = terminals[0];
    return Object.freeze({
      pendingRequestCount: pending.length,
      pendingWaiterCount: pending.reduce((total, record) => total + record.waiterCount, 0),
      retainedTerminalCount: terminals.length,
      retainedTerminalBytes: terminalBytes,
      expiredTombstoneCount: tombstones.size,
      joinedPendingDuplicateCount,
      cachedOutcomeResponseCount,
      requestIdConflictCount,
      expiredRecordCount,
      unknownStatusQueryCount,
      executionsStarted,
      executionsSucceeded,
      executionsFailed,
      outcomeNormalizationFailureCount,
      ...(oldest ? { oldestRetainedTerminalCompletedAt: oldest.completedAt, oldestRetainedTerminalCompletionRev: oldest.outcome.completionRev } : {}),
      disposed,
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const record of records.values()) {
      if (record.state === "pending") record.resolve(undefined);
      else record.stopExpiry();
    }
    records.clear();
    terminalOrder.length = 0;
    terminalBytes = 0;
    tombstones.clear();
    tombstoneOrder.length = 0;
  }

  return Object.freeze({ execute, status, debug, dispose });
}

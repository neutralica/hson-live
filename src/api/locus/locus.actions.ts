import type { JsonValue } from "../../core/types.js";
import type {
  LocusActionDedupeDiagnostics,
  LocusActionDedupeOptions,
  LocusActionDelivery,
  LocusActionRequestErrorCode,
  LocusActionRequestId,
  LocusActionStatusState,
  LocusActionTerminalOutcome,
  LocusDisposer,
  LocusClientId,
} from "../../types/locus.types.js";

// `LocusClientId` is the retry-safe client identity, never an authority or map ID.
type ClientIdentity = LocusClientId;

const DEFAULT_MAX_TERMINAL_RECORDS = 1_024;
const DEFAULT_MAX_TERMINAL_BYTES = 4 * 1_024 * 1_024;
const DEFAULT_TERMINAL_RETENTION_MS = 5 * 60_000;
const DEFAULT_MAX_EXPIRED_TOMBSTONES = 1_024;
const textEncoder = new TextEncoder();

type PendingRecord = {
  readonly state: "pending";
  readonly key: string;
  readonly fingerprint: string;
  readonly sourceTraceId?: string;
  readonly promise: Promise<LocusActionTerminalOutcome | undefined>;
  readonly resolve: (outcome: LocusActionTerminalOutcome | undefined) => void;
  waiterCount: number;
};

type TerminalRecord = {
  readonly state: "succeeded" | "failed";
  readonly key: string;
  readonly fingerprint: string;
  readonly sourceTraceId?: string;
  readonly outcome: LocusActionTerminalOutcome;
  readonly encodedBytes: number;
  readonly completedAt: number;
  stopExpiry: LocusDisposer;
};

type ActionRecord = PendingRecord | TerminalRecord;

export type LocusActionExecuteRequest = Readonly<{
  clientId: ClientIdentity;
  requestId: LocusActionRequestId;
  actionName: string;
  payload: JsonValue | undefined;
  retry: boolean;
  sourceTraceId?: string;
  acquireExecutionActivity?: () => LocusDisposer;
  run: () => Promise<LocusActionTerminalOutcome>;
}>;

export type LocusActionExecuteResult =
  | Readonly<{
    ok: true;
    outcome: LocusActionTerminalOutcome;
    delivery: Exclude<LocusActionDelivery, "rejected">;
    sourceTraceId?: string;
  }>
  | Readonly<{
    ok: false;
    code: LocusActionRequestErrorCode;
    message: string;
  }>;

export type LocusActionStatusResult = Readonly<{
  state: LocusActionStatusState;
  outcome?: LocusActionTerminalOutcome;
}>;

export type LocusActionDedupeStore = Readonly<{
  execute: (request: LocusActionExecuteRequest) => Promise<LocusActionExecuteResult>;
  status: (clientId: ClientIdentity, requestId: LocusActionRequestId) => LocusActionStatusResult;
  debug: () => LocusActionDedupeDiagnostics;
  dispose: LocusDisposer;
}>;

function bound(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return Math.trunc(value);
  throw new Error(`Locus action dedupe ${name} must be a non-negative finite number.`);
}

function default_schedule(delayMs: number, callback: () => void): LocusDisposer {
  const timer = setTimeout(callback, delayMs);
  const scheduled = timer as unknown as {
    unref?: () => void;
  };

  scheduled.unref?.();

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

function clone_outcome(outcome: LocusActionTerminalOutcome): LocusActionTerminalOutcome {
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

function client_request_key(clientId: ClientIdentity, requestId: LocusActionRequestId): string {
  return `${clientId.length}:${clientId}${requestId}`;
}

function valid_identity(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

function encoded_bytes(outcome: LocusActionTerminalOutcome): number {
  return textEncoder.encode(JSON.stringify(outcome)).byteLength;
}

export function make_locus_action_dedupe_store(
  headRev: () => number,
  currentSeq: () => number,
  options: LocusActionDedupeOptions = {},
): LocusActionDedupeStore {
  const namespace = options.namespace ?? "locus-action";
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

  function infrastructure_outcome(): LocusActionTerminalOutcome {
    return Object.freeze({
      state: "failed",
      seq: currentSeq(),
      completionRev: headRev(),
      error: Object.freeze({
        code: "LOCUS_ACTION_OUTCOME_NORMALIZATION_FAILED",
        message: "Locus could not normalize the terminal action outcome.",
      }),
    });
  }

  function settle(pending: PendingRecord, candidate: LocusActionTerminalOutcome): void {
    if (records.get(pending.key) !== pending) return;
    let outcome: LocusActionTerminalOutcome;
    try {
      outcome = clone_outcome(candidate);
      encoded_bytes(outcome);
    } catch {
      outcome = infrastructure_outcome();
    }
    const completedAt = now();
    if (outcome.state === "failed" && outcome.error.code === "LOCUS_ACTION_OUTCOME_NORMALIZATION_FAILED") {
      outcomeNormalizationFailureCount += 1;
    }
    const terminal: TerminalRecord = {
      state: outcome.state,
      key: pending.key,
      fingerprint: pending.fingerprint,
      ...(pending.sourceTraceId !== undefined ? { sourceTraceId: pending.sourceTraceId } : {}),
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

  async function execute(request: LocusActionExecuteRequest): Promise<LocusActionExecuteResult> {
    if (disposed) {
      return { ok: false, code: "LOCUS_ACTION_DEDUPE_STORE_UNAVAILABLE", message: "Locus action dedupe store is unavailable." };
    }
    if (!valid_identity(request.clientId) || !valid_identity(request.requestId)) {
      return { ok: false, code: "LOCUS_ACTION_REQUEST_ID_MALFORMED", message: "Locus action request identity is malformed." };
    }
    const key = client_request_key(request.clientId, request.requestId);
    const requestFingerprint = fingerprint(namespace, request.actionName, request.payload);
    const existing = records.get(key);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        requestIdConflictCount += 1;
        return { ok: false, code: "LOCUS_ACTION_REQUEST_ID_CONFLICT", message: "Locus action request ID was reused with different content." };
      }
      if (existing.state === "pending") {
        joinedPendingDuplicateCount += 1;
        existing.waiterCount += 1;
        const outcome = await existing.promise;
        if (!outcome) return { ok: false, code: "LOCUS_ACTION_DEDUPE_STORE_UNAVAILABLE", message: "Locus action dedupe store was disposed while the request was pending." };
        return {
          ok: true,
          outcome,
          delivery: "joined",
          ...(existing.sourceTraceId !== undefined ? { sourceTraceId: existing.sourceTraceId } : {}),
        };
      }
      cachedOutcomeResponseCount += 1;
      return {
        ok: true,
        outcome: existing.outcome,
        delivery: "cached",
        ...(existing.sourceTraceId !== undefined ? { sourceTraceId: existing.sourceTraceId } : {}),
      };
    }
    if (tombstones.has(key)) {
      return { ok: false, code: "LOCUS_ACTION_REQUEST_EXPIRED", message: "Locus action request outcome has expired." };
    }
    if (request.retry) {
      return { ok: false, code: "LOCUS_ACTION_REQUEST_UNKNOWN", message: "Locus cannot prove a prior execution for this retry request." };
    }

    let resolveOutcome: (outcome: LocusActionTerminalOutcome | undefined) => void = () => {};
    const promise = new Promise<LocusActionTerminalOutcome | undefined>((resolve) => { resolveOutcome = resolve; });
    const pending: PendingRecord = {
      state: "pending",
      key,
      fingerprint: requestFingerprint,
      ...(request.sourceTraceId !== undefined ? { sourceTraceId: request.sourceTraceId } : {}),
      promise,
      resolve: resolveOutcome,
      waiterCount: 1,
    };
    records.set(key, pending);
    executionsStarted += 1;
    const releaseExecutionActivity = request.acquireExecutionActivity?.();
    void (async () => {
      try {
        settle(pending, await request.run());
      } catch {
        settle(pending, infrastructure_outcome());
      } finally {
        releaseExecutionActivity?.();
      }
    })();
    const outcome = await promise;
    if (!outcome) return { ok: false, code: "LOCUS_ACTION_DEDUPE_STORE_UNAVAILABLE", message: "Locus action dedupe store was disposed while the request was pending." };
    return {
      ok: true,
      outcome,
      delivery: "executed",
      ...(pending.sourceTraceId !== undefined ? { sourceTraceId: pending.sourceTraceId } : {}),
    };
  }

  function status(clientId: ClientIdentity, requestId: LocusActionRequestId): LocusActionStatusResult {
    if (!valid_identity(clientId) || !valid_identity(requestId)) return Object.freeze({ state: "unknown" });
    const key = client_request_key(clientId, requestId);
    const record = records.get(key);
    if (record?.state === "pending") return Object.freeze({ state: "pending" });
    if (record) return Object.freeze({ state: record.state, outcome: record.outcome });
    if (tombstones.has(key)) return Object.freeze({ state: "expired" });
    unknownStatusQueryCount += 1;
    return Object.freeze({ state: "unknown" });
  }

  function debug(): LocusActionDedupeDiagnostics {
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

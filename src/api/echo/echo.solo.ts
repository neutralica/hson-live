// echo/echo.solo.ts

import type { JsonValue } from "../../core/types.js";
import type {
  ClassifiedLiveMap,
  LiveMap,
  LiveMapAuthority,
  LiveMapDocumentContent,
  LiveMapGraphCommit,
  LiveMapProjectedGraphEnsureQuidOp,
} from "../../types/livemap.types.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { make_classified_livemap } from "../livemap/livemap.core.js";
import { make_canonical_livemap_projected_capture } from "../livemap/livemap.projected.capture.js";
import {
  make_echo_document_authority,
  register_echo_document_authority,
  unregister_echo_document_authority,
  type EchoDocumentAction,
  type EchoDocumentAuthority,
} from "./echo.document-authority.js";
import type {
  LocusActionPayloads,
  LocusCanonicalCommit,
  Echo,
  LocusClientActionResult,
  LocusDocumentActionFn,
  LocusDocumentActionPromise,
  LocusDocumentActionRequest,
  LocusDocumentRetryActionFn,
  LocusClientMessage,
  EchoOptions,
  EchoRecoveryChange,
  EchoRecoveryChangeListener,
  EchoRecoveryDiagnostics,
  EchoRecoveryFailure,
  EchoRecoveryOptions,
  EchoRecoveryResult,
  EchoRecoveryStatus,
  EchoRecoveryStrategy,
  LocusDisposer,
  LocusRecoveryId,
  LocusServerMessage,
  LocusServerRecoveryPlanMessage,
  LocusSnapshotCapabilities,
  LocusSnapshotEncodingSelection,
} from "../../types/locus.types.js";
import { LocusDisconnectedError } from "../locus/locus.error.js";
import { EchoRecoveryError } from "./echo.error.js";
import { create_echo_endpoint_internal, type EchoEndpointIdFactories } from "./echo.endpoint.js";
import { create_echo_solo_replica_capability_internal } from "./echo.solo-replica.js";
import {
  decode_locus_server_message,
  replay_locus_document_commit,
  is_locus_json_value,
} from "../locus/locus.protocol.js";
import {
  encode_locus_graph_content,
} from "../locus/locus.graph-content-codec.js";
import { create_live_trace_context, type LiveTraceContext } from "../locus/locus.trace.js";
import {
  decode_locus_document_snapshot,
  LocusDocumentSnapshotDecodeError,
  type LocusDecodedServerMessage,
  type LocusValidatedSnapshotEnvelope,
} from "../locus/locus.document-snapshot.js";

let nextRecoveryId = 0;

const CLIENT_SNAPSHOT_CAPABILITIES: LocusSnapshotCapabilities = Object.freeze({
  hson: true,
  viewState: true,
});

function make_recovery_id(): LocusRecoveryId {
  nextRecoveryId += 1;
  return `lhr-${nextRecoveryId}`;
}


function recovery_trace_strategy(strategy: EchoRecoveryStrategy | undefined): string {
  if (strategy === "current") return "already-current";
  if (strategy === "replay") return "incremental-replay";
  return strategy ?? "unavailable";
}

function encode_client_message<TActions extends LocusActionPayloads>(message: LocusClientMessage<TActions>): string {
  if (message.type !== "action" || message.payload === undefined) return JSON.stringify(message);
  if (message.name !== "document.content.insert" && message.name !== "document.content.replace") {
    return JSON.stringify(message);
  }
  if (typeof message.payload !== "object" || message.payload === null || Array.isArray(message.payload)) {
    return JSON.stringify(message);
  }
  const field = message.name === "document.content.insert" ? "content" : "replacement";
  if (!Object.prototype.hasOwnProperty.call(message.payload, field)) return JSON.stringify(message);
  let encodedContent;
  try {
    encodedContent = encode_locus_graph_content(message.payload[field] as LiveMapDocumentContent);
  } catch {
    // Preserve the established asynchronous structured action rejection path
    // without ever falling back to a raw node-shaped wire payload.
    encodedContent = { format: "hson-graph", payload: "" } as const;
  }
  return JSON.stringify({
    ...message,
    payload: {
      ...message.payload,
      [field]: encodedContent,
    },
  });
}

/** @internal Deterministic correlation seam used only by repository proof fixtures. */
type EchoInternalIdFactories = EchoEndpointIdFactories;

type PendingRecovery = {
  id: LocusRecoveryId;
  resolve: (result: EchoRecoveryResult) => void;
  reject: (error: EchoRecoveryError) => void;
  trace?: LiveTraceContext;
  startedAt: number;
  localRevBefore: number;
  requestedRev?: number;
  commitCount: number;
  operationCount: number;
  operationKinds: string[];
  snapshotRev?: number;
};

type ClientRecoveryLifecycle =
  | Readonly<{ phase: "disconnected" | "idle" | "failed" }>
  | Readonly<{ phase: "awaiting-plan"; requestId: LocusRecoveryId }>
  | Readonly<{
    phase: "consuming";
    requestId: LocusRecoveryId;
    plan: Exclude<LocusServerRecoveryPlanMessage, { outcome: "reject" }>;
    snapshotReceived: boolean;
    tailStarted: boolean;
  }>
  | Readonly<{ phase: "caught-up"; requestId: LocusRecoveryId }>;


function projected_identity_replay(
  commit: LocusCanonicalCommit,
  prevRev: number,
): LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp> | undefined {
  const operations: LiveMapProjectedGraphEnsureQuidOp[] = [];
  for (const op of commit.ops) {
    if (!("domain" in op)
      || op.op !== "ensure-quid"
      || !("projected" in op.target)
      || op.target.projected !== true) return undefined;
    operations.push(Object.freeze({
      domain: "graph",
      op: "ensure-quid",
      target: Object.freeze({ kind: "path", path: Object.freeze([...op.target.path]), projected: true }),
      quid: op.quid,
    }));
  }
  return Object.freeze({
    changed: true,
    prevRev,
    rev: prevRev + 1,
    ops: Object.freeze(operations),
  });
}

export function create_solo_echo_internal<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<TMap> & Readonly<{ map: TMap; recovery: EchoRecoveryOptions }>): Echo<TMap, TActions> {

  const internalOptions = options as EchoOptions<LiveMapAuthority> & EchoInternalIdFactories;
  const map: ClassifiedLiveMap = classified_live_map(options.map);
  const initialRecoveryCursor = options.recovery.cursor;
  if (initialRecoveryCursor !== undefined && initialRecoveryCursor.lastAppliedRev !== map.rev) {
    throw new EchoRecoveryError(
      "LOCUS_RECOVERY_CURSOR_MISMATCH",
      `Locus recovery cursor revision ${initialRecoveryCursor.lastAppliedRev} does not match mirror revision ${map.rev}.`,
    );
  }
  const replica = create_echo_solo_replica_capability_internal(map, false);
  let echoDisposed = false;
  let documentAuthority: EchoDocumentAuthority | undefined;
  const run_echo_owned = <T>(operation: () => T): T => replica.runManaged(operation);
  const recoveryListeners = new Set<EchoRecoveryChangeListener<ClassifiedLiveMap>>();
  const disposers: LocusDisposer[] = [];
  const readyWaiters = new Set<() => void>();
  let isConnected = false;
  let recoveryDisposed = false;
  let recoveryStatus: EchoRecoveryStatus = "idle";
  let recoveryStrategy: EchoRecoveryStrategy | undefined;
  let incarnationId = options.recovery.cursor?.incarnationId;
  let lastAppliedRev = options.recovery.cursor?.lastAppliedRev;
  let firstFailure: EchoRecoveryFailure | undefined;
  let pendingRecovery: PendingRecovery | undefined;
  let recoveryLifecycle: ClientRecoveryLifecycle = Object.freeze({ phase: "disconnected" });
  let stopRecoveryMessages: LocusDisposer | undefined;
  let negotiatedSnapshotEncoding: LocusSnapshotEncodingSelection | undefined;
  let bodyCommitsApplied = 0;
  let snapshotInstalls = 0;
  let duplicateCommitsIgnored = 0;
  let gapsDetected = 0;
  let replayConflicts = 0;
  let tailCommitsApplied = 0;
  let liveCommitsApplied = 0;
  let recoveryFailures = 0;
  let consumerNotifications = 0;
  let observerFailures = 0;
  const endpoint = create_echo_endpoint_internal<TActions>({
    transport: {
      send: (message) => options.socket.send(encode_client_message(message)),
    },
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    sessionRequired: true,
    ...(options.session?.credential === undefined ? {} : { credential: options.session.credential }),
    ids: internalOptions,
    onReadyChange: notify_echo_ready,
    onAttachmentLost: (reason, error) => {
      if (reason !== "ended" && (recoveryStatus === "recovering" || recoveryStatus === "caught_up")) {
        fail_recovery(
          reason === "fenced" ? "LOCUS_SESSION_ATTACHMENT_FENCED" : "LOCUS_RECOVERY_DISCONNECTED",
          reason === "fenced" ? "Locus session attachment was fenced." : "Locus recovery transport disconnected.",
          error,
        );
      }
    },
  });
  const clientId = endpoint.clientId;

  function echo_ready(): boolean {
    return !echoDisposed
      && endpoint.ready
      && replica.ready;
  }

  function notify_echo_ready(): void {
    if (!echo_ready() && !echoDisposed) return;
    const waiters = [...readyWaiters];
    readyWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  function wait_until_echo_ready(): Promise<void> {
    if (echo_ready()) return Promise.resolve();
    if (echoDisposed) return Promise.reject(new LocusDisconnectedError());
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        if (echoDisposed) reject(new LocusDisconnectedError());
        else resolve();
      };
      readyWaiters.add(finish);
    });
  }

  function send(message: LocusClientMessage<TActions>): void {
    options.socket.send(encode_client_message(message));
  }

  function fail_recovery(code: string, message: string, cause?: unknown): void {
    if (recoveryStatus === "disposed" || recoveryStatus === "failed") return;
    const pending = pendingRecovery;
    const failure = Object.freeze({ code, message, ...(cause !== undefined ? { cause } : {}) });
    firstFailure ??= failure;
    recoveryFailures += 1;
    recoveryStatus = "failed";
    replica.markFailed(failure);
    recoveryStrategy = recoveryStrategy ?? "reject";
    recoveryLifecycle = Object.freeze({ phase: "failed" });
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    pendingRecovery = undefined;
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.apply",
      status: "failure",
      details: () => ({
        requestId: pending.id,
        strategy: recovery_trace_strategy(recoveryStrategy),
        localRevBefore: pending.localRevBefore,
        ...(pending.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        commitCount: pending.commitCount,
        operationCount: pending.operationCount,
        localRevAfter: map.rev,
        outcome: "failed",
        errorCode: code,
      }),
    });
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.complete",
      status: "failure",
      durationMs: pending === undefined ? 0 : Math.max(0, Date.now() - pending.startedAt),
      details: () => ({
        requestId: pending?.id ?? "unknown",
        strategy: recovery_trace_strategy(recoveryStrategy),
        ...(pending?.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        finalRev: map.rev,
        commitCount: pending?.commitCount ?? 0,
        outcome: "failed",
        errorCode: code,
      }),
    });
    pending?.reject(new EchoRecoveryError(code, message, cause));
  }

  function notify(change: EchoRecoveryChange<ClassifiedLiveMap>): void {
    consumerNotifications += 1;
    try {
      for (const listener of [...recoveryListeners]) listener(change);
    } catch (cause) {
      observerFailures += 1;
      fail_recovery("LOCUS_RECOVERY_OBSERVER_FAILED", "Locus recovery observer failed after state application.", cause);
    }
  }

  function require_plan(messageId: string): LocusServerRecoveryPlanMessage | undefined {
    if (recoveryLifecycle.phase !== "consuming" || recoveryLifecycle.requestId !== messageId) return undefined;
    return recoveryLifecycle.plan;
  }

  function validate_snapshot_encoding_acknowledgment(
    selected: LocusSnapshotEncodingSelection | undefined,
  ): boolean {
    if (selected === undefined) {
      fail_recovery(
        "LOCUS_SNAPSHOT_NEGOTIATION_MISSING",
        "Locus recovery plan omitted the snapshot encoding acknowledgment.",
      );
      return false;
    }
    if (selected.format === "view-state" && CLIENT_SNAPSHOT_CAPABILITIES.viewState !== true) {
      fail_recovery(
        "LOCUS_SNAPSHOT_NEGOTIATION_UNSUPPORTED",
        "Locus selected an unsupported view-state snapshot format.",
      );
      return false;
    }
    if (negotiatedSnapshotEncoding !== undefined
      && negotiatedSnapshotEncoding.format !== selected.format) {
      fail_recovery(
        "LOCUS_SNAPSHOT_NEGOTIATION_CHANGED",
        "Locus changed the selected snapshot encoding during one connection.",
      );
      return false;
    }
    negotiatedSnapshotEncoding = selected;
    return true;
  }

  function apply_commit(commit: LocusCanonicalCommit, phase: "body" | "tail" | "live"): void {
    if (recoveryStatus === "failed" || recoveryStatus === "disposed") return;
    const logicalMapId = options.recovery.logicalMapId;
    if (!logicalMapId || commit.logicalMapId !== logicalMapId || commit.incarnationId !== incarnationId) {
      fail_recovery("LOCUS_RECOVERY_STREAM_MISMATCH", "Canonical commit does not match the active recovery stream.");
      return;
    }
    if (lastAppliedRev === undefined) {
      fail_recovery("LOCUS_RECOVERY_CURSOR_MISSING", "Canonical commit arrived before a mirror cursor was installed.");
      return;
    }
    if (commit.rev <= lastAppliedRev) {
      duplicateCommitsIgnored += 1;
      return;
    }
    if (commit.rev !== commit.prevRev + 1) {
      fail_recovery("LOCUS_RECOVERY_INVALID_REVISION_DELTA", "Canonical commit revision delta is invalid.");
      return;
    }
    if (commit.prevRev !== lastAppliedRev) {
      if (commit.prevRev > lastAppliedRev) gapsDetected += 1;
      fail_recovery(
        commit.prevRev > lastAppliedRev ? "LOCUS_RECOVERY_COMMIT_GAP" : "LOCUS_RECOVERY_COMMIT_OVERLAP",
        `Canonical commit expected prevRev ${lastAppliedRev}, received ${commit.prevRev}.`,
      );
      return;
    }
    if (commit.mode !== map.mode) {
      fail_recovery(
        "LOCUS_RECOVERY_MAP_MODE_MISMATCH",
        `Canonical commit mode ${commit.mode} does not match mirror mode ${map.mode}.`,
      );
      return;
    }

    const localRevBefore = map.rev;
    try {
      const applied = run_echo_owned(() => map.mode === "document"
        ? replay_locus_document_commit(map, commit)
        : projected_identity_replay(commit, localRevBefore) !== undefined
          ? map.replay(projected_identity_replay(commit, localRevBefore)!)
        : commit.format === "structural-json"
          && typeof commit.payload === "string"
          ? map.replay({
            prevRev: localRevBefore,
            format: commit.format,
            payload: commit.payload,
          })
          : (() => { throw new Error("Canonical data commit is missing structural transport."); })());
      if (!applied.changed || map.rev !== localRevBefore + 1) {
        throw new Error("Canonical changed commit did not advance the Echo replica exactly once.");
      }
    } catch (cause) {
      if (map.rev === localRevBefore + 1) {
        lastAppliedRev = commit.rev;
        observerFailures += 1;
        fail_recovery("LOCUS_RECOVERY_OBSERVER_FAILED", "A mirror observer failed after canonical state application.", cause);
      } else {
        replayConflicts += 1;
        fail_recovery("LOCUS_RECOVERY_REPLAY_CONFLICT", "Canonical commit conflicts with the Echo replica.", cause);
      }
      return;
    }

    lastAppliedRev = commit.rev;
    if (pendingRecovery !== undefined && phase !== "live") {
      pendingRecovery.commitCount += 1;
      pendingRecovery.operationCount += commit.ops.length;
      pendingRecovery.operationKinds.push(...commit.ops.map((operation) =>
        "domain" in operation ? operation.op : operation.kind));
    }
    if (phase === "body") bodyCommitsApplied += 1;
    if (phase === "tail") tailCommitsApplied += 1;
    if (phase === "live") liveCommitsApplied += 1;
    notify({ kind: "commit", logicalMapId, incarnationId: commit.incarnationId, rev: commit.rev, map });
  }

  function install_snapshot(messageId: string, snapshot: LocusValidatedSnapshotEnvelope): void {
    const plan = require_plan(messageId);
    if (!plan || plan.outcome !== "snapshot") return;
    if (snapshot.logicalMapId !== plan.logicalMapId || snapshot.incarnationId !== plan.incarnationId || snapshot.rev !== plan.headRev) {
      fail_recovery("LOCUS_RECOVERY_INVALID_SNAPSHOT", "Snapshot identity or revision does not match its recovery plan.");
      return;
    }
    const snapshotFormat = "hson" in snapshot ? "hson" : "view-state";
    if (negotiatedSnapshotEncoding?.format !== snapshotFormat) {
      fail_recovery(
        "LOCUS_SNAPSHOT_NEGOTIATION_MISMATCH",
        "Locus recovery snapshot does not match the negotiated encoding.",
      );
      return;
    }
    try {
      if (is_projected_live_map(map)) {
        if (!("hson" in snapshot)) {
          throw new LocusDocumentSnapshotDecodeError(
            "LOCUS_RECOVERY_SNAPSHOT_MODE_MISMATCH",
            "Canonical document snapshot cannot restore a projected-data mirror.",
          );
        }
        const staged = make_classified_livemap(parse_hson(snapshot.hson));
        if (staged.mode !== snapshot.mode || staged.mode !== map.mode || !is_projected_live_map(staged)) {
          throw new Error(`Recovery snapshot mode ${snapshot.mode} does not match mirror mode ${map.mode}.`);
        }
        const schema = map.schema.get();
        const capture = staged.capture();
        run_echo_owned(() => map.restore(make_canonical_livemap_projected_capture(
          snapshot.rev,
          capture.format,
          capture.payload,
          capture.root,
        )));
        if (schema) run_echo_owned(() => map.schema.use(schema));
      } else if (is_document_live_map(map)) {
        const capture = decode_locus_document_snapshot(snapshot);
        if (capture.mode !== map.mode) {
          throw new LocusDocumentSnapshotDecodeError(
            "LOCUS_RECOVERY_SNAPSHOT_MODE_MISMATCH",
            "Locus document snapshot mode does not match the mirror mode.",
          );
        }
        run_echo_owned(() => map.restore(capture, { identity: "preserve-metadata" }));
      } else {
        throw new Error("Recovery snapshot reconstructed an incompatible map mode.");
      }
      incarnationId = snapshot.incarnationId;
      lastAppliedRev = snapshot.rev;
      if (pendingRecovery !== undefined) pendingRecovery.snapshotRev = snapshot.rev;
      snapshotInstalls += 1;
      if (recoveryLifecycle.phase === "consuming" && recoveryLifecycle.requestId === messageId) {
        recoveryLifecycle = Object.freeze({ ...recoveryLifecycle, snapshotReceived: true });
      }
      notify({ kind: "snapshot", logicalMapId: snapshot.logicalMapId, incarnationId: snapshot.incarnationId, rev: snapshot.rev, map });
    } catch (cause) {
      if (cause instanceof LocusDocumentSnapshotDecodeError) {
        fail_recovery(cause.code, cause.message, cause.cause);
        return;
      }
      fail_recovery("LOCUS_RECOVERY_INVALID_SNAPSHOT", "Snapshot replacement mirror could not be constructed.", cause);
    }
  }

  function handle_recovery_message(message: LocusDecodedServerMessage): boolean {
    if (message.type !== "recovery-plan" && message.type !== "recovery-commit" && message.type !== "recovery-snapshot" && message.type !== "recovery-caught-up" && message.type !== "commit" && message.type !== "recovery-error") return false;
    if (recoveryStatus === "failed" || recoveryStatus === "disposed") return true;
    const activeRequestId = recoveryLifecycle.phase === "awaiting-plan"
      || recoveryLifecycle.phase === "consuming"
      || recoveryLifecycle.phase === "caught-up"
      ? recoveryLifecycle.requestId
      : undefined;
    if (message.id !== activeRequestId) return true;

    if (message.type === "recovery-plan") {
      if (recoveryLifecycle.phase !== "awaiting-plan") {
        fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus sent more than one recovery plan for one recovery lifecycle.");
        return true;
      }
      if (message.logicalMapId !== options.recovery.logicalMapId
        || message.logicalMapId !== endpoint.session.logicalMapId
        || message.incarnationId !== endpoint.session.incarnationId) {
        fail_recovery("LOCUS_RECOVERY_STREAM_MISMATCH", "Recovery plan targets a different logical map.");
        return true;
      }
      if (!validate_snapshot_encoding_acknowledgment(message.snapshotEncoding)) return true;
      recoveryStrategy = message.outcome;
      if (message.outcome === "reject") {
        fail_recovery(message.error.code, message.error.message);
        return true;
      }
      if (message.outcome !== "snapshot" && (incarnationId !== message.incarnationId || lastAppliedRev === undefined)) {
        fail_recovery("LOCUS_RECOVERY_CURSOR_MISMATCH", "Recovery plan requires a matching complete mirror cursor.");
        return true;
      }
      recoveryLifecycle = Object.freeze({
        phase: "consuming",
        requestId: message.id,
        plan: message,
        snapshotReceived: false,
        tailStarted: false,
      });
      return true;
    }

    if (message.type === "recovery-error") {
      fail_recovery(message.error.code ?? "LOCUS_RECOVERY_FAILED", message.error.message, message.error.cause);
      return true;
    }

    if (recoveryLifecycle.phase === "awaiting-plan") {
      fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus recovery material arrived before its recovery plan.");
      return true;
    }
    if (recoveryLifecycle.phase === "caught-up") {
      if (message.type === "commit") {
        apply_commit(message.commit, "live");
        return true;
      }
      fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus recovery material arrived after caught-up.");
      return true;
    }
    const plan = require_plan(message.id);
    if (!plan || plan.outcome === "reject" || recoveryLifecycle.phase !== "consuming") return true;
    if (message.type === "recovery-snapshot") {
      if (plan.outcome !== "snapshot" || recoveryLifecycle.snapshotReceived || recoveryLifecycle.tailStarted) {
        fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus recovery snapshot order is invalid.");
        return true;
      }
      install_snapshot(message.id, message.snapshot);
      return true;
    }
    if (message.type === "recovery-commit") {
      if (message.phase === "body") {
        if (plan.outcome !== "replay" || recoveryLifecycle.tailStarted) {
          fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus recovery body commit order is invalid.");
          return true;
        }
      } else {
        if (plan.outcome === "snapshot" && !recoveryLifecycle.snapshotReceived) {
          fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus recovery tail arrived before its snapshot.");
          return true;
        }
        if (!recoveryLifecycle.tailStarted) {
          recoveryLifecycle = Object.freeze({ ...recoveryLifecycle, tailStarted: true });
        }
      }
      apply_commit(message.commit, message.phase);
      return true;
    }
    if (message.type === "commit") {
      fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus live commit arrived before caught-up.");
      return true;
    }

    const caught = message.caughtUp;
    if (plan.outcome === "snapshot" && !recoveryLifecycle.snapshotReceived) {
      fail_recovery("LOCUS_RECOVERY_MESSAGE_OUT_OF_ORDER", "Locus caught-up arrived before its snapshot.");
      return true;
    }
    if (caught.logicalMapId !== plan.logicalMapId
      || caught.incarnationId !== plan.incarnationId
      || caught.throughRev < plan.headRev
      || incarnationId !== caught.incarnationId
      || map.rev !== lastAppliedRev
      || lastAppliedRev !== caught.throughRev) {
      fail_recovery("LOCUS_RECOVERY_CAUGHT_UP_MISMATCH", "Caught-up boundary does not match the installed mirror cursor.");
      return true;
    }
    recoveryStatus = "caught_up";
    replica.markReady();
    recoveryLifecycle = Object.freeze({ phase: "caught-up", requestId: message.id });
    const pending = pendingRecovery;
    pendingRecovery = undefined;
    const previousIncarnation = options.recovery?.cursor?.incarnationId;
    const strategy = recovery_trace_strategy(plan.outcome);
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.apply",
      status: "success",
      details: () => ({
        requestId: pending.id,
        logicalMapId: plan.logicalMapId,
        incarnationId: plan.incarnationId,
        strategy,
        localRevBefore: pending.localRevBefore,
        ...(pending.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        ...(pending.snapshotRev !== undefined ? { snapshotRev: pending.snapshotRev } : {}),
        commitCount: pending.commitCount,
        operationCount: pending.operationCount,
        operationKinds: pending.operationKinds,
        localRevAfter: map.rev,
        outcome: plan.outcome === "current" ? "already-current" : "applied",
      }),
    });
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.complete",
      status: "success",
      durationMs: Math.max(0, Date.now() - pending.startedAt),
      details: () => ({
        requestId: pending.id,
        logicalMapId: plan.logicalMapId,
        incarnationId: plan.incarnationId,
        strategy,
        ...(pending.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        targetRev: caught.throughRev,
        finalRev: map.rev,
        commitCount: pending.commitCount,
        outcome: plan.outcome === "current" ? "already-current" : "synchronized",
      }),
    });
    pending?.resolve({
      strategy: plan.outcome,
      sessionId: plan.sessionId,
      logicalMapId: plan.logicalMapId,
      incarnationId: plan.incarnationId,
      headRev: caught.throughRev,
      incarnationChanged: previousIncarnation !== undefined && previousIncarnation !== plan.incarnationId,
    });
    notify_echo_ready();
    return true;
  }

  function is_recovery_message(message: LocusDecodedServerMessage): boolean {
    return message.type === "recovery-plan"
      || message.type === "recovery-commit"
      || message.type === "recovery-snapshot"
      || message.type === "recovery-caught-up"
      || message.type === "commit"
      || message.type === "recovery-error";
  }

  function is_session_message(
    message: LocusDecodedServerMessage,
  ): message is Extract<LocusServerMessage, { type: "session-created" | "session-attached" | "session-rejected" | "session-fenced" | "session-ended" }> {
    return message.type === "session-created"
      || message.type === "session-attached"
      || message.type === "session-rejected"
      || message.type === "session-fenced"
      || message.type === "session-ended";
  }

  function install_recovery_messages(): void {
    if (stopRecoveryMessages || recoveryDisposed) return;
    stopRecoveryMessages = options.socket.onMessage((raw) => {
      const decoded = decode_locus_server_message(raw);
      if (!decoded.ok) {
        if (recoveryStatus === "recovering" || recoveryStatus === "caught_up") {
          fail_recovery(
            decoded.error.code ?? "LOCUS_RECOVERY_PROTOCOL_DECODE_FAILED",
            decoded.error.message,
            decoded.error.cause,
          );
        }
        return;
      }
      if (is_recovery_message(decoded.value)) handle_recovery_message(decoded.value);
    }) ?? (() => { });
  }

  function handle_server_message(message: LocusDecodedServerMessage): void {
    if (handle_recovery_message(message)) return;
    if (is_session_message(message)) {
      endpoint.receive(message);
      return;
    }
    if (message.type === "action-status") {
      endpoint.receive(message);
      return;
    }
    if (message.type === "ack" || message.type === "error") {
      endpoint.receive(message);
    }
  }

  function connect(): LocusDisposer {
    if (isConnected) return disconnect;
    isConnected = true;
    if (!recoveryDisposed) {
      recoveryLifecycle = Object.freeze({ phase: "idle" });
      if (recoveryStatus === "failed" || recoveryStatus === "caught_up") {
        recoveryStatus = "idle";
        recoveryStrategy = undefined;
        firstFailure = undefined;
      }
    }
    const stopMessage = options.socket.onMessage((raw) => {
      const decoded = decode_locus_server_message(raw);
      if (!decoded.ok || is_recovery_message(decoded.value)) return;
      handle_server_message(decoded.value);
    });
    if (stopMessage) disposers.push(stopMessage);
    const stopClose = options.socket.onClose(disconnect);
    if (stopClose) disposers.push(stopClose);
    endpoint.connect();
    install_recovery_messages();
    notify_echo_ready();
    return disconnect;
  }

  function disconnect(): void {
    if (!isConnected) return;
    isConnected = false;
    negotiatedSnapshotEncoding = undefined;
    while (disposers.length) disposers.pop()?.();
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    endpoint.disconnect();
    recoveryLifecycle = Object.freeze({ phase: "disconnected" });
  }

  function dispose(): void {
    if (echoDisposed) return;
    echoDisposed = true;
    disconnect();
    dispose_recovery();
    endpoint.dispose();
    if (documentAuthority !== undefined) {
      documentAuthority.dispose();
      unregister_echo_document_authority(map, documentAuthority);
    }
    replica.dispose();
    notify_echo_ready();
  }

  function recover(): Promise<EchoRecoveryResult> {
    if (recoveryDisposed) return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_DISPOSED", "Echo recovery is disposed."));
    if (!isConnected) return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_DISCONNECTED", "Locus recovery requires a connected transport."));
    if (endpoint.session.status !== "attached") return Promise.reject(new EchoRecoveryError("LOCUS_SESSION_NOT_ATTACHED", "Locus recovery requires an attached session."));
    if (endpoint.session.logicalMapId !== options.recovery.logicalMapId) {
      const error = new EchoRecoveryError("LOCUS_SESSION_AUTHORITY_MISMATCH", "Locus session authority does not match the configured recovery target.");
      fail_recovery(error.code, error.message, error);
      return Promise.reject(error);
    }
    if (pendingRecovery) return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_IN_PROGRESS", "Locus recovery is already in progress."));
    if (recoveryStatus === "failed") return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_LIFECYCLE_INVALID", "Locus recovery requires a reconnect after failure."));
    const id = make_recovery_id();
    install_recovery_messages();
    recoveryLifecycle = Object.freeze({ phase: "awaiting-plan", requestId: id });
    recoveryStatus = "recovering";
    replica.markRecovering();
    recoveryStrategy = undefined;
    const recoveryOptions = options.recovery;
    const startedAt = Date.now();
    const trace = options.trace === undefined
      ? undefined
      : create_live_trace_context(options.trace, `locus-client-recovery-${id}`);
    trace?.emit({
      subsystem: "client",
      phase: "recovery.request",
      status: "event",
      details: () => ({
        requestId: id,
        logicalMapId: recoveryOptions.logicalMapId,
        mapMode: map.mode,
        reason: "explicit-recover",
        ...(lastAppliedRev !== undefined ? { requestedRev: lastAppliedRev } : {}),
        currentRev: map.rev,
      }),
    });
    const promise = new Promise<EchoRecoveryResult>((resolve, reject) => {
      pendingRecovery = {
        id,
        resolve,
        reject,
        ...(trace !== undefined ? { trace } : {}),
        startedAt,
        localRevBefore: map.rev,
        ...(lastAppliedRev !== undefined ? { requestedRev: lastAppliedRev } : {}),
        commitCount: 0,
        operationCount: 0,
        operationKinds: [],
      };
    });
    send({
      type: "recover",
      id,
      logicalMapId: recoveryOptions.logicalMapId,
      ...(incarnationId !== undefined && lastAppliedRev !== undefined ? { incarnationId, lastAppliedRev } : {}),
      snapshotCapabilities: CLIENT_SNAPSHOT_CAPABILITIES,
    });
    return promise;
  }

  function dispose_recovery(): void {
    if (recoveryDisposed) return;
    recoveryDisposed = true;
    const pending = pendingRecovery;
    pendingRecovery = undefined;
    recoveryLifecycle = Object.freeze({ phase: "failed" });
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    recoveryStatus = "disposed";
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.complete",
      status: "failure",
      durationMs: Math.max(0, Date.now() - pending.startedAt),
      details: () => ({
        requestId: pending.id,
        strategy: recovery_trace_strategy(recoveryStrategy),
        finalRev: map.rev,
        commitCount: pending.commitCount,
        outcome: "cancelled",
        errorCode: "LOCUS_RECOVERY_DISPOSED",
      }),
    });
    pending?.reject(new EchoRecoveryError("LOCUS_RECOVERY_DISPOSED", "Echo recovery was disposed."));
    recoveryListeners.clear();
  }

  function onChange(listener: EchoRecoveryChangeListener<ClassifiedLiveMap>): LocusDisposer {
    if (recoveryDisposed) return () => { };
    recoveryListeners.add(listener);
    return () => recoveryListeners.delete(listener);
  }

  function debug(): EchoRecoveryDiagnostics {
    return Object.freeze({
      status: recoveryStatus,
      ...(recoveryStrategy ? { strategy: recoveryStrategy } : {}),
      logicalMapId: options.recovery.logicalMapId,
      ...(incarnationId ? { incarnationId } : {}),
      ...(lastAppliedRev !== undefined ? { lastAppliedRev } : {}),
      bodyCommitsApplied,
      snapshotInstalls,
      duplicateCommitsIgnored,
      gapsDetected,
      replayConflicts,
      tailCommitsApplied,
      liveCommitsApplied,
      recoveryFailures,
      consumerNotifications,
      observerFailures,
    });
  }

  const action = endpoint.action;
  const retryAction = endpoint.retryAction;
  const actionStatus = endpoint.actionStatus;

  const recovery = Object.freeze({
    get status() { return recoveryStatus; },
    get logicalMapId() { return options.recovery.logicalMapId; },
    get incarnationId() { return incarnationId; },
    get lastAppliedRev() { return lastAppliedRev; },
    get map() { return map; },
    get failure() { return firstFailure; },
    get strategy() { return recoveryStrategy; },
    recover,
    onChange,
    dispose: dispose_recovery,
    debug,
  });

  const session = endpoint.session;

  if (is_document_live_map(map)) {
    const documentAction = action as LocusDocumentActionFn;
    const documentRetryAction = retryAction as LocusDocumentRetryActionFn;
    const send_document_action = (request: EchoDocumentAction): LocusDocumentActionPromise => {
      switch (request.name) {
        case "document.attrs.set": return documentAction(request.name, request.payload);
        case "document.attrs.drop": return documentAction(request.name, request.payload);
        case "document.attrs.setMany": return documentAction(request.name, request.payload);
        case "document.attrs.dropMany": return documentAction(request.name, request.payload);
        case "document.attrs.clear": return documentAction(request.name, request.payload);
        case "document.attrs.replace": return documentAction(request.name, request.payload);
        case "document.content.replace": return documentAction(request.name, request.payload);
        case "document.content.insert": return documentAction(request.name, request.payload);
        case "document.content.remove": return documentAction(request.name, request.payload);
        case "document.content.move": return documentAction(request.name, request.payload);
      }
    };
    const retry_document_action = (request: LocusDocumentActionRequest): LocusDocumentActionPromise => {
      switch (request.name) {
        case "document.attrs.set": return documentRetryAction(request);
        case "document.attrs.drop": return documentRetryAction(request);
        case "document.attrs.setMany": return documentRetryAction(request);
        case "document.attrs.dropMany": return documentRetryAction(request);
        case "document.attrs.clear": return documentRetryAction(request);
        case "document.attrs.replace": return documentRetryAction(request);
        case "document.content.replace": return documentRetryAction(request);
        case "document.content.insert": return documentRetryAction(request);
        case "document.content.remove": return documentRetryAction(request);
        case "document.content.move": return documentRetryAction(request);
      }
    };
    const dispatch_document_action = async (request: EchoDocumentAction): Promise<Readonly<{
      accepted: boolean;
      completionRev?: number;
    }>> => {
      let pending = send_document_action(request);
      let result: LocusClientActionResult;
      while (true) {
        try {
          result = await pending;
          break;
        } catch (cause) {
          if (!(cause instanceof LocusDisconnectedError)) throw cause;
          const stableRequest = pending.request;
          await wait_until_echo_ready();
          pending = retry_document_action(stableRequest);
        }
      }
      return Object.freeze({
        accepted: result.type === "ack" && result.ok === true,
        ...(result.completionRev === undefined ? {} : { completionRev: result.completionRev }),
      });
    };
    documentAuthority = make_echo_document_authority(
      dispatch_document_action,
      () => map.rev,
      (listener) => map.commits.observe(listener),
      () => replica.ready,
      replica.onDispose,
      replica.waitUntilReady,
    );
    register_echo_document_authority(map, documentAuthority);
  }

  return Object.freeze({
    get map() { return map; },
    clientId,
    recovery,
    session,
    connect,
    disconnect,
    action,
    retryAction,
    actionStatus,
    dispose,
  }) as unknown as Echo<TMap, TActions>;
}

function is_projected_live_map(map: LiveMapAuthority): map is LiveMap {
  return (map.mode === "data-object" || map.mode === "data-array")
    && "replace" in map
    && typeof map.replace === "function";
}

function is_document_live_map(map: LiveMapAuthority): map is Extract<ClassifiedLiveMap, { mode: "document" }> {
  return (map.mode === "document")
    && "replay" in map
    && typeof map.replay === "function";
}

function classified_live_map(map: LiveMapAuthority): ClassifiedLiveMap {
  if (is_projected_live_map(map) || is_document_live_map(map)) return map;
  throw new Error("Echo map is not a classified LiveMap authority.");
}

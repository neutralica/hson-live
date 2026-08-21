import type {
  DocumentLiveMap,
  LiveMapAnyOp,
  LiveMapCommit,
} from "../../types/livemap.types.js";
import type {
  LiveHostForMap,
} from "../../types/livehost.core.types.js";
import type { LiveHostActionPayloads } from "../../types/livehost.protocol.types.js";
import type {
  LiveHostPersistenceAdapter,
  LiveHostPersistedCommit,
  LiveHostPersistedDocumentCheckpoint,
  LiveHostPersistedMapState,
  PersistentDocumentLiveHostOptions,
  PersistentLiveHostForMap,
} from "../../types/livehost.persistence.types.js";
import type { LiveHostCanonicalCommit } from "../../types/livehost.representation.types.js";
import type { LiveHostDisposer } from "../../types/livehost.shared.types.js";
import type { LiveTraceSink } from "../../types/livehost.trace.types.js";
import {
  create_livehost_internal,
  run_livehost_exclusive_task,
  wait_livehost_exclusive_closed,
} from "./locus.core.js";
import { make_livehost_canonical_commit } from "./locus.history.js";
import {
  decode_livehost_canonical_commit_compat,
  replay_livehost_document_commit_compat,
} from "./locus.protocol.js";
import { create_live_trace_context } from "./locus.trace.js";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../livemap/livemap.document.view-state-codec.js";
import { LiveHostPersistenceError } from "./locus.persistence.error.js";
import { make_classified_livemap } from "../livemap/livemap.core.js";
import { acquire_livehost_internal_activity } from "./locus.activity.js";
import type { PreparedLiveMapTransition } from "../livemap/livemap.authority.js";
export { LiveHostPersistenceError } from "./locus.persistence.error.js";

type PersistentHostInternals = Readonly<{ authorityHost: object }>;
/** Shared one-map persistence tracing contract for residency services. */
export type PersistenceTraceOptions = Readonly<{ trace?: LiveTraceSink }>;

const persistentHostInternals = new WeakMap<object, PersistentHostInternals>();
let persistenceTraceIncrement = 0;

/** @internal */
export function persistence_trace(
  options: PersistenceTraceOptions,
  phase: string,
  status: "event" | "success" | "failure",
  details: Readonly<Record<string, string | number | boolean>>,
): void {
  if (options.trace === undefined) return;
  persistenceTraceIncrement += 1;
  const trace = create_live_trace_context(
    options.trace,
    `lht-persistence-${persistenceTraceIncrement.toString(36)}`,
  );
  trace.emit({ subsystem: "livehost", phase: `persistence.${phase}`, status, details: () => details });
}

function document_checkpoint(
  map: DocumentLiveMap,
  logicalMapId: string,
  incarnationId: string,
): LiveHostPersistedDocumentCheckpoint {
  const capture = map.capture({ identity: "preserve-metadata" });
  return Object.freeze({
    logicalMapId,
    incarnationId,
    mapKind: "document",
    mode: capture.mode,
    rev: capture.rev,
    snapshot: encode_view_state_snapshot(capture),
  });
}

function persisted_commit(
  map: DocumentLiveMap,
  logicalMapId: string,
  incarnationId: string,
  commit: LiveMapCommit<LiveMapAnyOp>,
): LiveHostPersistedCommit {
  return Object.freeze({
    logicalMapId,
    incarnationId,
    mapKind: "document",
    commit: make_livehost_canonical_commit(map, commit, logicalMapId, incarnationId, commit.prevRev),
  });
}

function make_persistence_gate(
  map: DocumentLiveMap,
  adapter: LiveHostPersistenceAdapter,
  identity: () => Readonly<{ logicalMapId: string; incarnationId: string }>,
  options: PersistenceTraceOptions,
  authority: () => object | undefined,
): (input: Readonly<{ commit: LiveMapCommit<LiveMapAnyOp> }>) => Promise<void> {
  return async ({ commit }) => {
    const release = authority() === undefined
      ? () => {}
      : acquire_livehost_internal_activity(authority() as object, "persistence");
    const current = identity();
    const record = persisted_commit(map, current.logicalMapId, current.incarnationId, commit);
    persistence_trace(options, "append.started", "event", {
      logicalMapId: current.logicalMapId,
      mapKind: "document",
      prevRev: commit.prevRev,
      rev: commit.rev,
    });
    try {
      await adapter.appendCommit(record);
    } catch (cause) {
      persistence_trace(options, "append.failed", "failure", {
        logicalMapId: current.logicalMapId,
        mapKind: "document",
        prevRev: commit.prevRev,
        rev: commit.rev,
        errorCode: "LIVEHOST_PERSISTENCE_APPEND_FAILED",
      });
      throw new LiveHostPersistenceError(
        "LIVEHOST_PERSISTENCE_APPEND_FAILED",
        "LiveHost could not durably append the prepared commit.",
        { cause },
      );
    } finally {
      release();
    }
    persistence_trace(options, "append.completed", "success", {
      logicalMapId: current.logicalMapId,
      mapKind: "document",
      prevRev: commit.prevRev,
      rev: commit.rev,
    });
  };
}

function persistent_host_view<TMap extends DocumentLiveMap, TActions extends LiveHostActionPayloads>(
  authorityHost: LiveHostForMap<TMap, TActions>,
  map: TMap,
  adapter: LiveHostPersistenceAdapter,
  options: PersistenceTraceOptions,
): PersistentLiveHostForMap<TMap, TActions> {
  const checkpoint = (): Promise<void> => run_livehost_exclusive_task(authorityHost, async () => {
    const release = acquire_livehost_internal_activity(authorityHost, "persistence");
    const record = document_checkpoint(
      map,
      authorityHost.stream.logicalMapId,
      authorityHost.stream.incarnationId,
    );
    persistence_trace(options, "checkpoint.started", "event", {
      logicalMapId: record.logicalMapId,
      mapKind: record.mapKind,
      revision: record.rev,
    });
    try {
      await adapter.replaceCheckpoint(record);
    } catch (cause) {
      persistence_trace(options, "checkpoint.failed", "failure", {
        logicalMapId: record.logicalMapId,
        mapKind: record.mapKind,
        revision: record.rev,
        errorCode: "LIVEHOST_PERSISTENCE_CHECKPOINT_FAILED",
      });
      throw new LiveHostPersistenceError(
        "LIVEHOST_PERSISTENCE_CHECKPOINT_FAILED",
        "LiveHost could not replace its persisted checkpoint.",
        { cause },
      );
    } finally {
      release();
    }
    persistence_trace(options, "checkpoint.completed", "success", {
      logicalMapId: record.logicalMapId,
      mapKind: record.mapKind,
      revision: record.rev,
    });
  });

  const host = Object.freeze({ ...authorityHost, checkpoint });
  persistentHostInternals.set(host, { authorityHost });
  return host;
}

/** Create a document authority only after its exact initial checkpoint is durable. */
export async function create_persistent_livehost<
  TMap extends DocumentLiveMap,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(
  options: PersistentDocumentLiveHostOptions<TMap, TActions>,
): Promise<PersistentLiveHostForMap<TMap, TActions>> {
  return create_persistent_livehost_internal(options);
}

/** @internal Synthetic post-append failure seam for authority invariant tests. */
export async function create_persistent_livehost_internal<
  TMap extends DocumentLiveMap,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(
  options: PersistentDocumentLiveHostOptions<TMap, TActions>,
  internal: Readonly<{
    afterDurableAppend?: (transition: PreparedLiveMapTransition) => void;
  }> = {},
): Promise<PersistentLiveHostForMap<TMap, TActions>> {
  if (options.map.mode !== "element" && options.map.mode !== "fragment") {
    throw new LiveHostPersistenceError(
      "LIVEHOST_PERSISTENCE_MAP_KIND_UNSUPPORTED",
      "LiveHost persistence currently supports document maps only.",
    );
  }

  let identity: Readonly<{ logicalMapId: string; incarnationId: string }> | undefined;
  let activityHost: object | undefined;
  const authorityHost = create_livehost_internal(options, {
    authorityGate: make_persistence_gate(options.map, options.persistence, () => {
      if (identity === undefined) throw new Error("Persistent LiveHost identity is unavailable.");
      return identity;
    }, options, () => activityHost),
    ...(internal.afterDurableAppend === undefined
      ? {}
      : { afterAuthorityGate: internal.afterDurableAppend }),
  }) as LiveHostForMap<TMap, TActions>;
  activityHost = authorityHost;
  identity = Object.freeze({
    logicalMapId: authorityHost.stream.logicalMapId,
    incarnationId: authorityHost.stream.incarnationId,
  });

  const checkpoint = document_checkpoint(options.map, identity.logicalMapId, identity.incarnationId);
  persistence_trace(options, "initialization.started", "event", {
    logicalMapId: identity.logicalMapId,
    mapKind: checkpoint.mapKind,
    revision: checkpoint.rev,
  });
  try {
    await options.persistence.replaceCheckpoint(checkpoint);
  } catch (cause) {
    authorityHost.dispose();
    await wait_livehost_exclusive_closed(authorityHost);
    persistence_trace(options, "initialization.failed", "failure", {
      logicalMapId: identity.logicalMapId,
      mapKind: checkpoint.mapKind,
      revision: checkpoint.rev,
      errorCode: "LIVEHOST_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
    });
    throw new LiveHostPersistenceError(
      "LIVEHOST_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
      "LiveHost initial persisted checkpoint could not be stored.",
      { cause },
    );
  }
  persistence_trace(options, "initialization.completed", "success", {
    logicalMapId: identity.logicalMapId,
    mapKind: checkpoint.mapKind,
    revision: checkpoint.rev,
  });
  return persistent_host_view(authorityHost, options.map, options.persistence, options);
}

function exact_keys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

type ValidatedPersistentState = Readonly<{
  checkpoint: LiveHostPersistedDocumentCheckpoint;
  commits: readonly LiveHostPersistedCommit[];
  canonicalCommits: readonly LiveHostCanonicalCommit[];
  map: DocumentLiveMap;
}>;

function invalid_state(cause?: unknown): LiveHostPersistenceError {
  return new LiveHostPersistenceError(
    "LIVEHOST_PERSISTED_STATE_INVALID",
    "LiveHost persisted state is invalid.",
    cause === undefined ? undefined : { cause },
  );
}

function validate_persisted_state(
  requestedLogicalMapId: string,
  value: unknown,
): ValidatedPersistentState {
  try {
    const state = record(value);
    if (state === undefined || !exact_keys(state, ["checkpoint", "commits"])) throw invalid_state();
    const checkpointValue = record(state.checkpoint);
    if (checkpointValue === undefined || !exact_keys(checkpointValue, [
      "logicalMapId", "incarnationId", "mapKind", "mode", "rev", "snapshot",
    ])) throw invalid_state();
    if (checkpointValue.logicalMapId !== requestedLogicalMapId
      || typeof checkpointValue.logicalMapId !== "string"
      || typeof checkpointValue.incarnationId !== "string"
      || checkpointValue.incarnationId.length === 0
      || checkpointValue.mapKind !== "document"
      || (checkpointValue.mode !== "element" && checkpointValue.mode !== "fragment")
      || !Number.isInteger(checkpointValue.rev)
      || (checkpointValue.rev as number) < 0) throw invalid_state();
    const snapshot = record(checkpointValue.snapshot);
    if (snapshot === undefined
      || !exact_keys(snapshot, ["format", "payload"])
      || snapshot.format !== "view-state"
      || typeof snapshot.payload !== "string") throw invalid_state();

    const checkpoint = checkpointValue as unknown as LiveHostPersistedDocumentCheckpoint;
    const capture = decode_view_state_snapshot(checkpoint.snapshot);
    if (capture.rev !== checkpoint.rev || capture.mode !== checkpoint.mode) throw invalid_state();
    const map = make_classified_livemap(capture.root);
    if (map.mode !== capture.mode) throw invalid_state();
    map.restore(capture, { identity: "preserve-metadata" });

    if (!Array.isArray(state.commits)) throw invalid_state();
    const commits: LiveHostPersistedCommit[] = [];
    const canonicalCommits: LiveHostCanonicalCommit[] = [];
    let expectedPrevRev = checkpoint.rev;
    for (const item of state.commits) {
      const persisted = record(item);
      if (persisted === undefined || !exact_keys(persisted, ["logicalMapId", "incarnationId", "mapKind", "commit"])) {
        throw invalid_state();
      }
      if (persisted.logicalMapId !== checkpoint.logicalMapId
        || persisted.incarnationId !== checkpoint.incarnationId
        || persisted.mapKind !== "document") throw invalid_state();
      const decoded = decode_livehost_canonical_commit_compat(persisted.commit);
      if (decoded === undefined
        || decoded.logicalMapId !== checkpoint.logicalMapId
        || decoded.incarnationId !== checkpoint.incarnationId
        || decoded.mode !== checkpoint.mode
        || decoded.prevRev !== expectedPrevRev
        || decoded.rev !== expectedPrevRev + 1) throw invalid_state();
      const applied = replay_livehost_document_commit_compat(map, decoded);
      const canonical = make_livehost_canonical_commit(
        map,
        applied,
        checkpoint.logicalMapId,
        checkpoint.incarnationId,
        expectedPrevRev,
      );
      const persistedCommit = Object.freeze({
        logicalMapId: checkpoint.logicalMapId,
        incarnationId: checkpoint.incarnationId,
        mapKind: "document" as const,
        commit: canonical,
      });
      commits.push(persistedCommit);
      canonicalCommits.push(canonical);
      expectedPrevRev = canonical.rev;
    }
    if (map.rev !== expectedPrevRev) throw invalid_state();
    return Object.freeze({
      checkpoint,
      commits: Object.freeze(commits),
      canonicalCommits: Object.freeze(canonicalCommits),
      map,
    });
  } catch (cause) {
    if (cause instanceof LiveHostPersistenceError) throw cause;
    throw invalid_state(cause);
  }
}

/** @internal Rebuild one persistent authority from one validated persisted state. */
export async function restore_persistent_livehost(
  logicalMapId: string,
  state: LiveHostPersistedMapState,
  adapter: LiveHostPersistenceAdapter,
  traceOptions: PersistenceTraceOptions = {},
): Promise<PersistentLiveHostForMap> {
  const validated = validate_persisted_state(logicalMapId, state);
  let identity: Readonly<{ logicalMapId: string; incarnationId: string }> | undefined;
  let activityHost: object | undefined;
  const options: PersistentDocumentLiveHostOptions = {
    map: validated.map,
    persistence: adapter,
    logicalMapId: validated.checkpoint.logicalMapId,
    incarnationId: validated.checkpoint.incarnationId,
    ...(traceOptions.trace !== undefined ? { trace: traceOptions.trace } : {}),
  };
  const authorityHost = create_livehost_internal(options, {
    authorityGate: make_persistence_gate(validated.map, adapter, () => {
      if (identity === undefined) throw new Error("Restored persistent LiveHost identity is unavailable.");
      return identity;
    }, options, () => activityHost),
    initialHistory: {
      baseRevision: validated.checkpoint.rev,
      commits: validated.canonicalCommits,
    },
  }) as LiveHostForMap<DocumentLiveMap>;
  activityHost = authorityHost;
  identity = Object.freeze({
    logicalMapId: authorityHost.stream.logicalMapId,
    incarnationId: authorityHost.stream.incarnationId,
  });
  return persistent_host_view(authorityHost, validated.map, adapter, options);
}

/** @internal Destroy one persistent authority and wait for managed authority release. */
export async function unload_persistent_livehost(host: PersistentLiveHostForMap): Promise<void> {
  const internals = persistentHostInternals.get(host);
  host.dispose();
  if (internals !== undefined) await wait_livehost_exclusive_closed(internals.authorityHost);
}

import type {
  DocumentLiveMap,
  LiveMapAnyOp,
  LiveMapCommit,
} from "../../types/livemap.types.js";
import { is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import type {
  Locus,
} from "../../types/locus.core.types.js";
import type { LocusActionPayloads } from "../../types/locus.protocol.types.js";
import type {
  LocusPersistenceAdapter,
  LocusPersistedCommit,
  LocusPersistedDocumentCheckpoint,
  LocusPersistedMapState,
  PersistentDocumentLocusOptions,
  PersistentLocus,
} from "../../types/locus.persistence.types.js";
import type { LocusCanonicalCommit } from "../../types/locus.representation.types.js";
import type { LocusDisposer } from "../../types/locus.shared.types.js";
import type { LiveTraceSink } from "../../types/live.trace.types.js";
import {
  create_locus_internal,
  run_locus_exclusive_task,
  wait_locus_exclusive_closed,
} from "./locus.core.js";
import { make_locus_canonical_commit } from "./locus.history.js";
import {
  decode_locus_canonical_commit,
  replay_locus_document_commit,
} from "./locus.protocol.js";
import { create_live_trace_context } from "./locus.trace.js";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../livemap/livemap.document.view-state-codec.js";
import { LocusPersistenceError } from "./locus.persistence.error.js";
import { make_classified_livemap } from "../livemap/livemap.core.js";
import { acquire_locus_internal_activity } from "./locus.activity.js";
import type { PreparedLiveMapTransition } from "../livemap/livemap.authority.js";
import type {
  PersistentLocusMultiLibrary,
  PersistentLocusMultiLibraryOptions,
} from "../../types/locus.types.js";
import { create_persistent_multi_library_locus } from "./locus.multi-library.persistence.js";
export { LocusPersistenceError } from "./locus.persistence.error.js";

type PersistentLocusInternals = Readonly<{ authorityLocus: object }>;
/** Shared one-map persistence tracing contract for residency services. */
export type PersistenceTraceOptions = Readonly<{ trace?: LiveTraceSink }>;

const persistentLocusInternals = new WeakMap<object, PersistentLocusInternals>();
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
    `locus-persistence-${persistenceTraceIncrement.toString(36)}`,
  );
  trace.emit({ subsystem: "locus", phase: `persistence.${phase}`, status, details: () => details });
}

function document_checkpoint(
  map: DocumentLiveMap,
  logicalMapId: string,
  incarnationId: string,
): LocusPersistedDocumentCheckpoint {
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
): LocusPersistedCommit {
  return Object.freeze({
    logicalMapId,
    incarnationId,
    mapKind: "document",
    commit: make_locus_canonical_commit(map, commit, logicalMapId, incarnationId, commit.prevRev),
  });
}

function make_persistence_gate(
  map: DocumentLiveMap,
  adapter: LocusPersistenceAdapter,
  identity: () => Readonly<{ logicalMapId: string; incarnationId: string }>,
  options: PersistenceTraceOptions,
  authority: () => object | undefined,
): (input: Readonly<{ commit: LiveMapCommit<LiveMapAnyOp> }>) => Promise<void> {
  return async ({ commit }) => {
    const release = authority() === undefined
      ? () => {}
      : acquire_locus_internal_activity(authority() as object, "persistence");
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
        errorCode: "LOCUS_PERSISTENCE_APPEND_FAILED",
      });
      throw new LocusPersistenceError(
        "LOCUS_PERSISTENCE_APPEND_FAILED",
        "Locus could not durably append the prepared commit.",
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

function persistent_locus_view<TMap extends DocumentLiveMap, TActions extends LocusActionPayloads>(
  authorityLocus: Locus<TMap, TActions>,
  map: TMap,
  adapter: LocusPersistenceAdapter,
  options: PersistenceTraceOptions,
): PersistentLocus<TMap, TActions> {
  const checkpoint = (): Promise<void> => run_locus_exclusive_task(authorityLocus, async () => {
    const release = acquire_locus_internal_activity(authorityLocus, "persistence");
    const record = document_checkpoint(
      map,
      authorityLocus.stream.logicalMapId,
      authorityLocus.stream.incarnationId,
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
        errorCode: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED",
      });
      throw new LocusPersistenceError(
        "LOCUS_PERSISTENCE_CHECKPOINT_FAILED",
        "Locus could not replace its persisted checkpoint.",
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

  const locus = Object.freeze({ ...authorityLocus, checkpoint });
  persistentLocusInternals.set(locus, { authorityLocus });
  return locus;
}

/** Create an authority only after its exact initial checkpoint is durable. */
export async function create_persistent_locus<
  TMap extends import("../../types/livemap.types.js").LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: PersistentLocusMultiLibraryOptions<TMap, TActions>,
): Promise<PersistentLocusMultiLibrary<TMap, TActions>>;
export async function create_persistent_locus<
  TMap extends DocumentLiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: PersistentDocumentLocusOptions<TMap, TActions>,
): Promise<PersistentLocus<TMap, TActions>>;
export async function create_persistent_locus(
  options: unknown,
): Promise<unknown> {
  if (typeof options === "object" && options !== null && "map" in options && is_public_multi_library_livemap(options.map)) {
    return create_persistent_multi_library_locus(options as never);
  }
  return create_persistent_locus_internal(options as PersistentDocumentLocusOptions);
}

/** @internal Synthetic post-append failure seam for authority invariant tests. */
export async function create_persistent_locus_internal<
  TMap extends DocumentLiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: PersistentDocumentLocusOptions<TMap, TActions>,
  internal: Readonly<{
    afterDurableAppend?: (transition: PreparedLiveMapTransition) => void;
  }> = {},
): Promise<PersistentLocus<TMap, TActions>> {
  if (options.map.mode !== "document") {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTENCE_MAP_KIND_UNSUPPORTED",
      "Locus persistence currently supports document maps only.",
    );
  }

  let identity: Readonly<{ logicalMapId: string; incarnationId: string }> | undefined;
  let activityLocus: object | undefined;
  const authorityLocus = create_locus_internal(options, {
    authorityGate: make_persistence_gate(options.map, options.persistence, () => {
      if (identity === undefined) throw new Error("Persistent Locus identity is unavailable.");
      return identity;
    }, options, () => activityLocus),
    ...(internal.afterDurableAppend === undefined
      ? {}
      : { afterAuthorityGate: internal.afterDurableAppend }),
  }) as Locus<TMap, TActions>;
  activityLocus = authorityLocus;
  identity = Object.freeze({
    logicalMapId: authorityLocus.stream.logicalMapId,
    incarnationId: authorityLocus.stream.incarnationId,
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
    authorityLocus.dispose();
    await wait_locus_exclusive_closed(authorityLocus);
    persistence_trace(options, "initialization.failed", "failure", {
      logicalMapId: identity.logicalMapId,
      mapKind: checkpoint.mapKind,
      revision: checkpoint.rev,
      errorCode: "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
    });
    throw new LocusPersistenceError(
      "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
      "Locus initial persisted checkpoint could not be stored.",
      { cause },
    );
  }
  persistence_trace(options, "initialization.completed", "success", {
    logicalMapId: identity.logicalMapId,
    mapKind: checkpoint.mapKind,
    revision: checkpoint.rev,
  });
  return persistent_locus_view(authorityLocus, options.map, options.persistence, options);
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
  checkpoint: LocusPersistedDocumentCheckpoint;
  commits: readonly LocusPersistedCommit[];
  canonicalCommits: readonly LocusCanonicalCommit[];
  map: DocumentLiveMap;
}>;

function invalid_state(cause?: unknown): LocusPersistenceError {
  return new LocusPersistenceError(
    "LOCUS_PERSISTED_STATE_INVALID",
    "Locus persisted state is invalid.",
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
      || (checkpointValue.mode !== "document")
      || !Number.isInteger(checkpointValue.rev)
      || (checkpointValue.rev as number) < 0) throw invalid_state();
    const snapshot = record(checkpointValue.snapshot);
    if (snapshot === undefined
      || !exact_keys(snapshot, ["format", "payload"])
      || snapshot.format !== "view-state"
      || typeof snapshot.payload !== "string") throw invalid_state();

    const checkpoint = checkpointValue as unknown as LocusPersistedDocumentCheckpoint;
    const capture = decode_view_state_snapshot(checkpoint.snapshot);
    if (capture.rev !== checkpoint.rev || capture.mode !== checkpoint.mode) throw invalid_state();
    const map = make_classified_livemap(capture.root);
    if (map.mode !== capture.mode) throw invalid_state();
    map.restore(capture, { identity: "preserve-metadata" });

    if (!Array.isArray(state.commits)) throw invalid_state();
    const commits: LocusPersistedCommit[] = [];
    const canonicalCommits: LocusCanonicalCommit[] = [];
    let expectedPrevRev = checkpoint.rev;
    for (const item of state.commits) {
      const persisted = record(item);
      if (persisted === undefined || !exact_keys(persisted, ["logicalMapId", "incarnationId", "mapKind", "commit"])) {
        throw invalid_state();
      }
      if (persisted.logicalMapId !== checkpoint.logicalMapId
        || persisted.incarnationId !== checkpoint.incarnationId
        || persisted.mapKind !== "document") throw invalid_state();
      const decoded = decode_locus_canonical_commit(persisted.commit);
      if (decoded === undefined
        || decoded.logicalMapId !== checkpoint.logicalMapId
        || decoded.incarnationId !== checkpoint.incarnationId
        || decoded.mode !== checkpoint.mode
        || decoded.prevRev !== expectedPrevRev
        || decoded.rev !== expectedPrevRev + 1) throw invalid_state();
      const applied = replay_locus_document_commit(map, decoded);
      const canonical = make_locus_canonical_commit(
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
    if (cause instanceof LocusPersistenceError) throw cause;
    throw invalid_state(cause);
  }
}

/** @internal Rebuild one persistent authority from one validated persisted state. */
export async function restore_persistent_locus(
  logicalMapId: string,
  state: LocusPersistedMapState,
  adapter: LocusPersistenceAdapter,
  traceOptions: PersistenceTraceOptions = {},
): Promise<PersistentLocus> {
  const validated = validate_persisted_state(logicalMapId, state);
  let identity: Readonly<{ logicalMapId: string; incarnationId: string }> | undefined;
  let activityLocus: object | undefined;
  const options: PersistentDocumentLocusOptions = {
    map: validated.map,
    persistence: adapter,
    logicalMapId: validated.checkpoint.logicalMapId,
    incarnationId: validated.checkpoint.incarnationId,
    ...(traceOptions.trace !== undefined ? { trace: traceOptions.trace } : {}),
  };
  const authorityLocus = create_locus_internal(options, {
    authorityGate: make_persistence_gate(validated.map, adapter, () => {
      if (identity === undefined) throw new Error("Restored persistent Locus identity is unavailable.");
      return identity;
    }, options, () => activityLocus),
    initialHistory: {
      baseRevision: validated.checkpoint.rev,
      commits: validated.canonicalCommits,
    },
  }) as Locus<DocumentLiveMap>;
  activityLocus = authorityLocus;
  identity = Object.freeze({
    logicalMapId: authorityLocus.stream.logicalMapId,
    incarnationId: authorityLocus.stream.incarnationId,
  });
  return persistent_locus_view(authorityLocus, validated.map, adapter, options);
}

/** @internal Destroy one persistent authority and wait for managed authority release. */
export async function unload_persistent_locus(locus: PersistentLocus): Promise<void> {
  const internals = persistentLocusInternals.get(locus);
  locus.dispose();
  if (internals !== undefined) await wait_locus_exclusive_closed(internals.authorityLocus);
}

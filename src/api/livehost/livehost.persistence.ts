import { hson } from "../../hson.js";
import type {
  DocumentLiveMap,
  LiveMapAnyOp,
  LiveMapCommit,
  LiveMapGraphOp,
} from "../../types/livemap.types.js";
import type {
  ExclusiveLiveHostForMap,
  LiveHostActionPayloads,
  LiveHostCanonicalCommit,
  LiveHostDisposer,
  LiveHostPersistenceAdapter,
  LiveHostPersistentStore,
  LiveHostPersistentStoreEntry,
  LiveHostPersistedCommit,
  LiveHostPersistedDocumentCheckpoint,
  LiveHostPersistedMapState,
  LiveHostResult,
  LiveHostSocketLike,
  LiveHostStoreId,
  LiveTraceSink,
  PersistentDocumentLiveHostOptions,
  PersistentLiveHostForMap,
} from "../../types/livehost.types.js";
import {
  create_livehost_internal,
  run_livehost_exclusive_task,
  wait_livehost_exclusive_closed,
} from "./livehost.core.js";
import { make_livehost_canonical_commit } from "./livehost.history.js";
import { decode_livehost_canonical_commit } from "./livehost.protocol.js";
import { create_live_trace_context } from "./livehost.trace.js";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../livemap/livemap.document.view-state-codec.js";
import { LiveHostPersistenceError } from "./livehost.persistence.error.js";
export { LiveHostPersistenceError } from "./livehost.persistence.error.js";

type PersistentHostInternals = Readonly<{ authorityHost: object }>;
type PersistenceTraceOptions = Readonly<{ trace?: LiveTraceSink }>;

const persistentHostInternals = new WeakMap<object, PersistentHostInternals>();
let persistenceTraceIncrement = 0;

function persistence_trace(
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
  const capture = map.capture();
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
): (input: Readonly<{ commit: LiveMapCommit<LiveMapAnyOp> }>) => Promise<void> {
  return async ({ commit }) => {
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
  authorityHost: ExclusiveLiveHostForMap<TMap, TActions>,
  map: TMap,
  adapter: LiveHostPersistenceAdapter,
  options: PersistenceTraceOptions,
): PersistentLiveHostForMap<TMap, TActions> {
  const checkpoint = (): Promise<void> => run_livehost_exclusive_task(authorityHost, async () => {
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
  if (options.authority !== "exclusive") {
    throw new LiveHostPersistenceError(
      "LIVEHOST_PERSISTENCE_REQUIRES_EXCLUSIVE",
      "LiveHost persistence requires exclusive authority.",
    );
  }
  if (options.map.mode !== "element" && options.map.mode !== "fragment") {
    throw new LiveHostPersistenceError(
      "LIVEHOST_PERSISTENCE_MAP_KIND_UNSUPPORTED",
      "LiveHost persistence currently supports document maps only.",
    );
  }

  let identity: Readonly<{ logicalMapId: string; incarnationId: string }> | undefined;
  const authorityHost = create_livehost_internal(options, {
    authorityGate: make_persistence_gate(options.map, options.persistence, () => {
      if (identity === undefined) throw new Error("Persistent LiveHost identity is unavailable.");
      return identity;
    }, options),
  }) as ExclusiveLiveHostForMap<TMap, TActions>;
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
      || !exact_keys(snapshot, ["format", "formatVersion", "payload"])
      || snapshot.format !== "view-state"
      || snapshot.formatVersion !== 1
      || typeof snapshot.payload !== "string") throw invalid_state();

    const checkpoint = checkpointValue as unknown as LiveHostPersistedDocumentCheckpoint;
    const capture = decode_view_state_snapshot(checkpoint.snapshot);
    if (capture.rev !== checkpoint.rev || capture.mode !== checkpoint.mode) throw invalid_state();
    const map = hson.liveMap.fromNode(capture.root);
    if (map.mode !== capture.mode) throw invalid_state();
    map.restore(capture);

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
      const canonical = decode_livehost_canonical_commit(persisted.commit);
      if (canonical === undefined
        || canonical.logicalMapId !== checkpoint.logicalMapId
        || canonical.incarnationId !== checkpoint.incarnationId
        || canonical.mode !== checkpoint.mode
        || canonical.prevRev !== expectedPrevRev
        || canonical.rev !== expectedPrevRev + 1) throw invalid_state();
      const persistedCommit = Object.freeze({
        logicalMapId: checkpoint.logicalMapId,
        incarnationId: checkpoint.incarnationId,
        mapKind: "document" as const,
        commit: canonical,
      });
      map.replay(Object.freeze({
        changed: true,
        prevRev: canonical.prevRev,
        rev: canonical.rev,
        ops: canonical.ops as readonly LiveMapGraphOp[],
      }));
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

async function restore_persistent_livehost(
  logicalMapId: string,
  state: LiveHostPersistedMapState,
  adapter: LiveHostPersistenceAdapter,
  traceOptions: PersistenceTraceOptions = {},
): Promise<PersistentLiveHostForMap> {
  const validated = validate_persisted_state(logicalMapId, state);
  let identity: Readonly<{ logicalMapId: string; incarnationId: string }> | undefined;
  const options: PersistentDocumentLiveHostOptions = {
    map: validated.map,
    authority: "exclusive",
    persistence: adapter,
    logicalMapId: validated.checkpoint.logicalMapId,
    incarnationId: validated.checkpoint.incarnationId,
    ...(traceOptions.trace !== undefined ? { trace: traceOptions.trace } : {}),
  };
  const authorityHost = create_livehost_internal(options, {
    authorityGate: make_persistence_gate(validated.map, adapter, () => {
      if (identity === undefined) throw new Error("Restored persistent LiveHost identity is unavailable.");
      return identity;
    }, options),
    initialHistory: {
      baseRevision: validated.checkpoint.rev,
      commits: validated.canonicalCommits,
    },
  }) as ExclusiveLiveHostForMap<DocumentLiveMap>;
  identity = Object.freeze({
    logicalMapId: authorityHost.stream.logicalMapId,
    incarnationId: authorityHost.stream.incarnationId,
  });
  return persistent_host_view(authorityHost, validated.map, adapter, options);
}

/** Destroy one resident persistent host and wait for managed authority release. */
export async function unload_persistent_livehost(host: PersistentLiveHostForMap): Promise<void> {
  const internals = persistentHostInternals.get(host);
  host.dispose();
  if (internals !== undefined) await wait_livehost_exclusive_closed(internals.authorityHost);
}

function ok<T>(value: T): LiveHostResult<T> {
  return Object.freeze({ ok: true, value });
}

function fail<T = never>(message: string, code: string): LiveHostResult<T> {
  return Object.freeze({ ok: false, error: Object.freeze({ message, code }) });
}

/** Async document-only registry with coalesced persistence misses. */
export function create_livehost_persistent_store(
  adapter: LiveHostPersistenceAdapter,
  options: PersistenceTraceOptions = {},
): LiveHostPersistentStore {
  const hosts = new Map<LiveHostStoreId, PersistentLiveHostForMap>();
  const inflight = new Map<LiveHostStoreId, Promise<PersistentLiveHostForMap | undefined>>();

  async function get_or_load(id: LiveHostStoreId): Promise<PersistentLiveHostForMap | undefined> {
    const resident = hosts.get(id);
    if (resident !== undefined) return resident;
    const existing = inflight.get(id);
    if (existing !== undefined) {
      persistence_trace(options, "load.coalesced", "event", { logicalMapId: id, mapKind: "document" });
      return existing;
    }
    const loading = (async () => {
      persistence_trace(options, "load.started", "event", { logicalMapId: id, mapKind: "document" });
      try {
        const state = await adapter.load(id);
        if (state === undefined) {
          persistence_trace(options, "load.completed", "success", {
            logicalMapId: id,
            mapKind: "document",
            found: false,
          });
          return undefined;
        }
        const host = await restore_persistent_livehost(id, state, adapter, options);
        if (hosts.has(id)) {
          await unload_persistent_livehost(host);
          throw new LiveHostPersistenceError(
            "LIVEHOST_PERSISTENCE_REGISTRY_CONFLICT",
            "LiveHost registry changed while persisted state was loading.",
          );
        }
        hosts.set(id, host);
        persistence_trace(options, "load.completed", "success", {
          logicalMapId: id,
          mapKind: "document",
          found: true,
          revision: host.stream.headRev,
        });
        persistence_trace(options, "map.restored", "success", {
          logicalMapId: id,
          mapKind: "document",
          revision: host.stream.headRev,
        });
        return host;
      } catch (cause) {
        const failure = cause instanceof LiveHostPersistenceError
          ? cause
          : new LiveHostPersistenceError(
            "LIVEHOST_PERSISTENCE_LOAD_FAILED",
            "LiveHost persisted state could not be loaded.",
            { cause },
          );
        persistence_trace(options, "load.failed", "failure", {
          logicalMapId: id,
          mapKind: "document",
          errorCode: failure.code,
        });
        throw failure;
      }
    })();
    inflight.set(id, loading);
    try {
      return await loading;
    } finally {
      if (inflight.get(id) === loading) inflight.delete(id);
    }
  }

  return Object.freeze({
    has: (id: LiveHostStoreId) => hosts.has(id),
    get: (id: LiveHostStoreId) => hosts.get(id),
    async create<TMap extends DocumentLiveMap, TActions extends LiveHostActionPayloads = LiveHostActionPayloads>(
      id: LiveHostStoreId,
      options: Omit<PersistentDocumentLiveHostOptions<TMap, TActions>, "logicalMapId" | "persistence">,
    ): Promise<LiveHostResult<PersistentLiveHostForMap<TMap, TActions>>> {
      if (hosts.has(id) || inflight.has(id)) {
        return fail("LiveHost persistent store entry already exists.", "LIVEHOST_PERSISTENCE_REGISTRY_CONFLICT");
      }
      const creating = create_persistent_livehost({ ...options, logicalMapId: id, persistence: adapter });
      const storedCreating = creating as unknown as Promise<PersistentLiveHostForMap | undefined>;
      inflight.set(id, storedCreating);
      try {
        const host = await creating;
        hosts.set(id, host as unknown as PersistentLiveHostForMap);
        return ok(host);
      } catch (cause) {
        return fail(
          cause instanceof Error ? cause.message : "LiveHost persistent store creation failed.",
          cause instanceof LiveHostPersistenceError ? cause.code : "LIVEHOST_PERSISTENCE_LOAD_FAILED",
        );
      } finally {
        if (inflight.get(id) === storedCreating) inflight.delete(id);
      }
    },
    async load(id: LiveHostStoreId): Promise<LiveHostResult<PersistentLiveHostForMap | undefined>> {
      try {
        return ok(await get_or_load(id));
      } catch (cause) {
        return fail(
          cause instanceof Error ? cause.message : "LiveHost persisted state could not be loaded.",
          cause instanceof LiveHostPersistenceError ? cause.code : "LIVEHOST_PERSISTENCE_LOAD_FAILED",
        );
      }
    },
    async unload(id: LiveHostStoreId): Promise<boolean> {
      const host = hosts.get(id);
      if (host === undefined) return false;
      hosts.delete(id);
      const unloading = unload_persistent_livehost(host).then(() => undefined);
      inflight.set(id, unloading);
      try {
        await unloading;
        return true;
      } finally {
        if (inflight.get(id) === unloading) inflight.delete(id);
      }
    },
    list(): readonly LiveHostPersistentStoreEntry[] {
      return Object.freeze(Array.from(hosts, ([id, host]) => Object.freeze({ id, host })));
    },
    async connect(id: LiveHostStoreId, socket: LiveHostSocketLike): Promise<LiveHostResult<LiveHostDisposer>> {
      try {
        const loaded = await get_or_load(id);
        return loaded === undefined
          ? fail("Unknown LiveHost persistent store entry.", "LIVEHOST_STORE_UNKNOWN_ID")
          : ok(loaded.connect(socket));
      } catch (cause) {
        return fail(
          cause instanceof Error ? cause.message : "LiveHost persisted state could not be loaded.",
          cause instanceof LiveHostPersistenceError ? cause.code : "LIVEHOST_PERSISTENCE_LOAD_FAILED",
        );
      }
    },
  });
}

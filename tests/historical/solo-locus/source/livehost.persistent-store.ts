import type {
  DocumentLiveMap,
} from "../../../types/livemap.types.js";
import type {
  LocusActionPayloads,
  LocusConnectionContext,
  LocusSocketLike,
} from "../../../types/locus.protocol.types.js";
import type {
  LocusPersistenceAdapter,
  PersistentDocumentLocusOptions,
  PersistentLocus,
} from "../../../types/locus.persistence.types.js";
import type { LiveHostPersistentStore, LiveHostPersistentStoreEntry, LiveHostStoreId } from "../../../types/livehost.services.types.js";
import type { LocusDisposer, LocusLogicalMapId, LocusResult } from "../../../types/locus.shared.types.js";
import {
  create_persistent_locus,
  LocusPersistenceError,
  persistence_trace,
  restore_persistent_locus,
  type PersistenceTraceOptions,
  unload_persistent_locus,
} from "../../locus/locus.persistence.js";

// Persistent residency and adapter lookup are both keyed by this map identity.
type PersistentStoreKey = LocusLogicalMapId;
function ok<T>(value: T): LocusResult<T> {
  return Object.freeze({ ok: true, value });
}

function fail<T = never>(message: string, code: string): LocusResult<T> {
  return Object.freeze({ ok: false, error: Object.freeze({ message, code }) });
}

/** Async document-only registry with coalesced persistence misses. */
export function create_livehost_persistent_store(
  adapter: LocusPersistenceAdapter,
  options: PersistenceTraceOptions = {},
): LiveHostPersistentStore {
  const hosts = new Map<PersistentStoreKey, PersistentLocus>();
  const inflight = new Map<PersistentStoreKey, Promise<PersistentLocus | undefined>>();

  async function get_or_load(logicalMapId: PersistentStoreKey): Promise<PersistentLocus | undefined> {
    const resident = hosts.get(logicalMapId);
    if (resident !== undefined) return resident;
    const existing = inflight.get(logicalMapId);
    if (existing !== undefined) {
      persistence_trace(options, "load.coalesced", "event", { logicalMapId, mapKind: "document" });
      return existing;
    }
    const loading = (async () => {
      persistence_trace(options, "load.started", "event", { logicalMapId, mapKind: "document" });
      try {
        const state = await adapter.load(logicalMapId);
        if (state === undefined) {
          persistence_trace(options, "load.completed", "success", {
            logicalMapId,
            mapKind: "document",
            found: false,
          });
          return undefined;
        }
        const host = await restore_persistent_locus(logicalMapId, state, adapter, options);
        if (hosts.has(logicalMapId)) {
          await unload_persistent_locus(host);
          throw new LocusPersistenceError(
            "LOCUS_PERSISTENCE_REGISTRY_CONFLICT",
            "Locus registry changed while persisted state was loading.",
          );
        }
        hosts.set(logicalMapId, host);
        persistence_trace(options, "load.completed", "success", {
          logicalMapId,
          mapKind: "document",
          found: true,
          revision: host.stream.headRev,
        });
        persistence_trace(options, "map.restored", "success", {
          logicalMapId,
          mapKind: "document",
          revision: host.stream.headRev,
        });
        return host;
      } catch (cause) {
        const failure = cause instanceof LocusPersistenceError
          ? cause
          : new LocusPersistenceError(
            "LOCUS_PERSISTENCE_LOAD_FAILED",
            "Locus persisted state could not be loaded.",
            { cause },
          );
        persistence_trace(options, "load.failed", "failure", {
          logicalMapId,
          mapKind: "document",
          errorCode: failure.code,
        });
        throw failure;
      }
    })();
    inflight.set(logicalMapId, loading);
    try {
      return await loading;
    } finally {
      if (inflight.get(logicalMapId) === loading) inflight.delete(logicalMapId);
    }
  }

  return Object.freeze({
    has: (id: LiveHostStoreId) => hosts.has(id),
    get: (id: LiveHostStoreId) => hosts.get(id),
    async create<TMap extends DocumentLiveMap, TActions extends LocusActionPayloads = LocusActionPayloads>(
      id: LiveHostStoreId,
      options: Omit<PersistentDocumentLocusOptions<TMap, TActions>, "logicalMapId" | "persistence">,
    ): Promise<LocusResult<PersistentLocus<TMap, TActions>>> {
      const logicalMapId: PersistentStoreKey = id;
      if (hosts.has(logicalMapId) || inflight.has(logicalMapId)) {
        return fail("LiveHost persistent store entry already exists.", "LOCUS_PERSISTENCE_REGISTRY_CONFLICT");
      }
      const creating = create_persistent_locus({ ...options, logicalMapId, persistence: adapter });
      const storedCreating = creating as unknown as Promise<PersistentLocus | undefined>;
      inflight.set(logicalMapId, storedCreating);
      try {
        const host = await creating;
        hosts.set(logicalMapId, host as unknown as PersistentLocus);
        return ok(host);
      } catch (cause) {
        return fail(
          cause instanceof Error ? cause.message : "LiveHost persistent store creation failed.",
          cause instanceof LocusPersistenceError ? cause.code : "LOCUS_PERSISTENCE_LOAD_FAILED",
        );
      } finally {
        if (inflight.get(logicalMapId) === storedCreating) inflight.delete(logicalMapId);
      }
    },
    async load(id: LiveHostStoreId): Promise<LocusResult<PersistentLocus | undefined>> {
      try {
        const logicalMapId: PersistentStoreKey = id;
        return ok(await get_or_load(logicalMapId));
      } catch (cause) {
        return fail(
          cause instanceof Error ? cause.message : "Locus persisted state could not be loaded.",
          cause instanceof LocusPersistenceError ? cause.code : "LOCUS_PERSISTENCE_LOAD_FAILED",
        );
      }
    },
    async unload(id: LiveHostStoreId): Promise<boolean> {
      const logicalMapId: PersistentStoreKey = id;
      const host = hosts.get(logicalMapId);
      if (host === undefined) return false;
      hosts.delete(logicalMapId);
      const unloading = unload_persistent_locus(host).then(() => undefined);
      inflight.set(logicalMapId, unloading);
      try {
        await unloading;
        return true;
      } finally {
        if (inflight.get(logicalMapId) === unloading) inflight.delete(logicalMapId);
      }
    },
    list(): readonly LiveHostPersistentStoreEntry[] {
      return Object.freeze(Array.from(hosts, ([id, host]) => Object.freeze({ id, host })));
    },
    async connect(
      id: LiveHostStoreId,
      socket: LocusSocketLike,
      context?: LocusConnectionContext,
    ): Promise<LocusResult<LocusDisposer>> {
      try {
        const logicalMapId: PersistentStoreKey = id;
        const loaded = await get_or_load(logicalMapId);
        return loaded === undefined
          ? fail("Unknown LiveHost persistent store entry.", "LIVEHOST_STORE_UNKNOWN_ID")
          : ok(loaded.connect(socket, context));
      } catch (cause) {
        return fail(
          cause instanceof Error ? cause.message : "Locus persisted state could not be loaded.",
          cause instanceof LocusPersistenceError ? cause.code : "LOCUS_PERSISTENCE_LOAD_FAILED",
        );
      }
    },
  });
}

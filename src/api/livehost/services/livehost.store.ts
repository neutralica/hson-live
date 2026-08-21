// livehost.store.ts

import { JsonValue } from "../../../core/types.js";
import type { LiveMap } from "../../../types/livemap.types.js";
import type { Locus } from "../../../types/locus.core.types.js";
import type { LocusActionPayloads, LocusConnectionContext, LocusSocketLike } from "../../../types/locus.protocol.types.js";
import type { LocusResult, LocusDisposer } from "../../../types/locus.shared.types.js";
import type { LiveHostStore, LiveHostStoreCreateOptions, LiveHostStoreEntry, LiveHostStoreId } from "../../../types/livehost.services.types.js";
import { create_locus } from "../../locus/locus.core.js";

// Application-owned lookup key; it is intentionally independent of logicalMapId.
type RuntimeStoreLookupKey = LiveHostStoreId;

function ok<T>(value: T): LocusResult<T> {
  return { ok: true, value };
}

function fail(message: string, code: string): LocusResult<never> {
  return { ok: false, error: { message, code } };
}

export function create_livehost_store(): LiveHostStore {
  const hosts = new Map<RuntimeStoreLookupKey, Locus>();

  function has(storeKey: RuntimeStoreLookupKey): boolean {
    return hosts.has(storeKey);
  }

  function get(storeKey: RuntimeStoreLookupKey): Locus | undefined {
    return hosts.get(storeKey);
  }

  function create<
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LocusActionPayloads = LocusActionPayloads,
  >(storeKey: RuntimeStoreLookupKey, options: LiveHostStoreCreateOptions<TState, TActions> = {}): LocusResult<Locus<LiveMap<TState>, TActions>> {
    if (hosts.has(storeKey)) {
      return fail(`LiveHost store entry already exists: ${storeKey}`, "LIVEHOST_STORE_DUPLICATE_ID");
    }

    const host = create_locus<TState, TActions>(options);
    hosts.set(storeKey, host as unknown as Locus);
    return ok(host);
  }

  function set<
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LocusActionPayloads = LocusActionPayloads,
  >(storeKey: RuntimeStoreLookupKey, host: Locus<LiveMap<TState>, TActions>): LocusResult<Locus<LiveMap<TState>, TActions>> {
    if (hosts.has(storeKey)) {
      return fail(`LiveHost store entry already exists: ${storeKey}`, "LIVEHOST_STORE_DUPLICATE_ID");
    }

    hosts.set(storeKey, host as unknown as Locus);
    return ok(host);
  }

  function delete_host(storeKey: RuntimeStoreLookupKey): boolean {
    return hosts.delete(storeKey);
  }

  function list(): readonly LiveHostStoreEntry[] {
    return Array.from(hosts.entries(), ([storeKey, host]) => Object.freeze({ id: storeKey, host }));
  }

  function connect(
    storeKey: RuntimeStoreLookupKey,
    socket: LocusSocketLike,
    context?: LocusConnectionContext,
  ): LocusResult<LocusDisposer> {
    const host = hosts.get(storeKey);
    if (!host) {
      return fail(`Unknown LiveHost store entry: ${storeKey}`, "LIVEHOST_STORE_UNKNOWN_ID");
    }

    return ok(host.connect(socket, context));
  }

  return Object.freeze({
    has,
    get,
    create,
    set,
    delete: delete_host,
    list,
    connect,
  });
}

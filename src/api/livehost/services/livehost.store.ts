// livehost.store.ts

import { JsonValue } from "../../../core/types.js";
import type { LiveHost } from "../../../types/livehost.core.types.js";
import type { LiveHostActionPayloads, LiveHostConnectionContext, LiveHostSocketLike } from "../../../types/livehost.protocol.types.js";
import type { LiveHostResult, LiveHostStoreId, LiveHostDisposer } from "../../../types/livehost.shared.types.js";
import type { LiveHostStore, LiveHostStoreCreateOptions, LiveHostStoreEntry } from "../../../types/livehost.services.types.js";
import { create_livehost } from "../livehost.core.js";

// Application-owned lookup key; it is intentionally independent of logicalMapId.
type RuntimeStoreLookupKey = LiveHostStoreId;

function ok<T>(value: T): LiveHostResult<T> {
  return { ok: true, value };
}

function fail(message: string, code: string): LiveHostResult<never> {
  return { ok: false, error: { message, code } };
}

export function create_livehost_store(): LiveHostStore {
  const hosts = new Map<RuntimeStoreLookupKey, LiveHost>();

  function has(storeKey: RuntimeStoreLookupKey): boolean {
    return hosts.has(storeKey);
  }

  function get(storeKey: RuntimeStoreLookupKey): LiveHost | undefined {
    return hosts.get(storeKey);
  }

  function create<
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(storeKey: RuntimeStoreLookupKey, options: LiveHostStoreCreateOptions<TState, TActions> = {}): LiveHostResult<LiveHost<TState, TActions>> {
    if (hosts.has(storeKey)) {
      return fail(`LiveHost store entry already exists: ${storeKey}`, "LIVEHOST_STORE_DUPLICATE_ID");
    }

    const host = create_livehost<TState, TActions>(options);
    hosts.set(storeKey, host as unknown as LiveHost);
    return ok(host);
  }

  function set<
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(storeKey: RuntimeStoreLookupKey, host: LiveHost<TState, TActions>): LiveHostResult<LiveHost<TState, TActions>> {
    if (hosts.has(storeKey)) {
      return fail(`LiveHost store entry already exists: ${storeKey}`, "LIVEHOST_STORE_DUPLICATE_ID");
    }

    hosts.set(storeKey, host as unknown as LiveHost);
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
    socket: LiveHostSocketLike,
    context?: LiveHostConnectionContext,
  ): LiveHostResult<LiveHostDisposer> {
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

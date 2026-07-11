// livehost.store.ts

import { JsonValue } from "../../core/types.js";
import { LiveHostResult, LiveHostStore, LiveHostStoreId, LiveHost, LiveHostActionPayloads, LiveHostStoreCreateOptions, LiveHostStoreEntry, LiveHostSocketLike, LiveHostDisposer } from "../../types/livehost.types.js";
import { create_livehost } from "./livehost.core.js";


function ok<T>(value: T): LiveHostResult<T> {
  return { ok: true, value };
}

function fail(message: string, code: string): LiveHostResult<never> {
  return { ok: false, error: { message, code } };
}

export function create_livehost_store(): LiveHostStore {
  const hosts = new Map<LiveHostStoreId, LiveHost>();

  function has(id: LiveHostStoreId): boolean {
    return hosts.has(id);
  }

  function get(id: LiveHostStoreId): LiveHost | undefined {
    return hosts.get(id);
  }

  function create<
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(id: LiveHostStoreId, options: LiveHostStoreCreateOptions<TState, TActions> = {}): LiveHostResult<LiveHost<TState, TActions>> {
    if (hosts.has(id)) {
      return fail(`LiveHost store entry already exists: ${id}`, "LIVEHOST_STORE_DUPLICATE_ID");
    }

    const host = create_livehost<TState, TActions>(options);
    hosts.set(id, host as unknown as LiveHost);
    return ok(host);
  }

  function set<
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(id: LiveHostStoreId, host: LiveHost<TState, TActions>): LiveHostResult<LiveHost<TState, TActions>> {
    if (hosts.has(id)) {
      return fail(`LiveHost store entry already exists: ${id}`, "LIVEHOST_STORE_DUPLICATE_ID");
    }

    hosts.set(id, host as unknown as LiveHost);
    return ok(host);
  }

  function delete_host(id: LiveHostStoreId): boolean {
    return hosts.delete(id);
  }

  function list(): readonly LiveHostStoreEntry[] {
    return Array.from(hosts.entries(), ([id, host]) => Object.freeze({ id, host }));
  }

  function connect(id: LiveHostStoreId, socket: LiveHostSocketLike): LiveHostResult<LiveHostDisposer> {
    const host = hosts.get(id);
    if (!host) {
      return fail(`Unknown LiveHost store entry: ${id}`, "LIVEHOST_STORE_UNKNOWN_ID");
    }

    return ok(host.connect(socket));
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

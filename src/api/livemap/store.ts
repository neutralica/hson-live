// store.ts

/**
 * Store-style subscription amenities for LiveMap.
 *
 * This module intentionally keeps LiveMap as the public noun. It provides the
 * reusable implementation for snapshot, diff, selector, and path subscriptions;
 * the public surface can expose those amenities directly on a LiveMap without
 * requiring callers to treat the map as a separate store object.
 */

import type { JsonValue } from "../../core/types.js";
import type {
  LiveMap,
  LiveMapDisposer,
  LiveMapFeedEvent,
  LiveMapPathValue,
  LiveMapStoreApi,
  LiveMapStoreDiffListener,
  LiveMapStoreEqual,
  LiveMapStoreListener,
  LiveMapStorePathListener,
  LiveMapStoreSelectedListener,
  LiveMapStoreSubscribeOptions,
  LivePath,
} from "./livemap.types.js";

function clone_json_value<TValue>(value: TValue): TValue {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as TValue;
}

function json_signature(value: unknown): string {
  return JSON.stringify(value);
}

function values_equal<TValue>(
  next: TValue,
  prev: TValue,
  options: LiveMapStoreSubscribeOptions<TValue> | undefined,
): boolean {
  return options?.equal === undefined ? Object.is(next, prev) : options.equal(next, prev);
}

function json_values_equal<TValue>(
  next: TValue,
  prev: TValue,
  options: LiveMapStoreSubscribeOptions<TValue> | undefined,
): boolean {
  return options?.equal === undefined
    ? json_signature(next) === json_signature(prev)
    : options.equal(next, prev);
}

export function make_livemap_store_api<TValue = JsonValue | undefined>(map: LiveMap<TValue>): LiveMapStoreApi<TValue> {
  const snapshot = (): TValue => clone_json_value(map.snap());

  const subscribe = (listener: LiveMapStoreListener<TValue>): LiveMapDisposer => {
    return map.feed([], () => {
      listener(snapshot());
    });
  };

  const subscribeDiff = (listener: LiveMapStoreDiffListener<TValue>): LiveMapDisposer => {
    let prev = snapshot();
    let prevSignature = json_signature(prev);

    return map.feed([], () => {
      const next = snapshot();
      const nextSignature = json_signature(next);
      if (nextSignature === prevSignature) return;

      const old = prev;
      prev = next;
      prevSignature = nextSignature;
      listener(next, old);
    });
  };

  const subscribeSel = <TSelected>(
    selector: (state: TValue) => TSelected,
    listener: LiveMapStoreSelectedListener<TSelected, TValue>,
    options?: LiveMapStoreSubscribeOptions<TSelected>,
  ): LiveMapDisposer => {
    let prev = selector(snapshot());

    return map.feed([], () => {
      const state = snapshot();
      const next = selector(state);
      if (values_equal(next, prev, options)) return;

      const old = prev;
      prev = next;
      listener(next, old, state);
    });
  };

  const subscribePath = <const TPath extends LivePath>(
    path: TPath,
    listener: LiveMapStorePathListener<TValue, TPath>,
    options?: LiveMapStoreSubscribeOptions<LiveMapPathValue<TValue, TPath>>,
  ): LiveMapDisposer => {
    const readPath = (): LiveMapPathValue<TValue, TPath> => clone_json_value(map.at(path).snap());
    let prev = readPath();

    return map.feed(path, (event: LiveMapFeedEvent) => {
      const next = readPath();
      if (json_values_equal(next, prev, options)) return;

      const old = prev;
      prev = next;
      listener(next, old, event);
    });
  };

  return Object.freeze({
    snapshot,
    subscribe,
    subscribeDiff,
    subscribeSel,
    subscribePath,
  });
}
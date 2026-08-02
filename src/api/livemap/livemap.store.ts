// store.ts

/**
 * Store-style subscription amenities for LiveMap.
 *
 * This module intentionally keeps LiveMap as the public noun. It provides the
 * reusable implementation for snapshot, diff, selector, and path subscriptions;
 * the public surface can expose those amenities directly on a LiveMap without
 * requiring callers to treat the map as a separate store object.
 *
 * Store snapshots are detached projected values. Subscribers cannot mutate LiveMap by
 * mutating a received snapshot, and path subscribers receive the same cloned
 * value shape they would get from `map.at(path).snap()`.
 */

import type { JsonValue } from "../../core/types.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { json_values_equal as projected_json_values_equal } from "./livemap-helpers.js";
import type {
  LiveMapCore,
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
} from "../../types/livemap.types.js";

function clone_selector_value<TValue>(value: TValue): TValue {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as TValue;
}

function copy_projected_store_value<TValue>(value: TValue): TValue {
  if (value === undefined) return value;
  return materialize_projected_value(admit_projected_value(value)) as TValue;
}

function values_equal<TValue>(
  next: TValue,
  prev: TValue,
  options: LiveMapStoreSubscribeOptions<TValue> | undefined,
): boolean {
  return options?.equal === undefined
    ? Object.is(next, prev)
    : options.equal(clone_selector_value(next), clone_selector_value(prev));
}

function projected_values_equal<TValue>(
  next: TValue,
  prev: TValue,
  options: LiveMapStoreSubscribeOptions<TValue> | undefined,
): boolean {
  return options?.equal === undefined
    ? projected_json_values_equal(
      next as JsonValue | undefined,
      prev as JsonValue | undefined,
    )
    : options.equal(copy_projected_store_value(next), copy_projected_store_value(prev));
}

/**
 * Create the subscription surface for one LiveMap.
 *
 * - `subscribe` notifies after any root feed event.
 * - `subscribeDiff` notifies only when ordered projected root identity changes.
 * - `subscribeSel` notifies when the selected value changes by `Object.is` or a
 *   caller-provided equality function.
 * - `subscribePath` listens to one LivePath and compares detached path snapshots
 *   by ordered projected equality unless a caller-provided function is supplied.
 */
export function make_livemap_store_api<TValue = JsonValue | undefined>(
  map: Pick<LiveMapCore<TValue>, "snap" | "feed" | "at">,
): LiveMapStoreApi<TValue> {
  const snapshot = (): TValue => copy_projected_store_value(map.snap());

  const subscribe = (listener: LiveMapStoreListener<TValue>): LiveMapDisposer => {
    return map.feed([], () => {
      listener(snapshot());
    });
  };

  const subscribeDiff = (listener: LiveMapStoreDiffListener<TValue>): LiveMapDisposer => {
    let prev = snapshot();

    return map.feed([], () => {
      const next = snapshot();
      if (projected_values_equal(next, prev, undefined)) return;

      const old = prev;
      prev = copy_projected_store_value(next);
      listener(copy_projected_store_value(next), copy_projected_store_value(old));
    });
  };

  const subscribeSel = <TSelected>(
    selector: (state: TValue) => TSelected,
    listener: LiveMapStoreSelectedListener<TSelected, TValue>,
    options?: LiveMapStoreSubscribeOptions<TSelected>,
  ): LiveMapDisposer => {
    let prev = clone_selector_value(selector(snapshot()));

    return map.feed([], () => {
      const state = snapshot();
      const next = selector(state);
      if (values_equal(next, prev, options)) return;

      const old = prev;
      prev = clone_selector_value(next);
      listener(clone_selector_value(next), clone_selector_value(old), state);
    });
  };

  const subscribePath = <const TPath extends LivePath>(
    path: TPath,
    listener: LiveMapStorePathListener<TValue, TPath>,
    options?: LiveMapStoreSubscribeOptions<LiveMapPathValue<TValue, TPath>>,
  ): LiveMapDisposer => {
    const readPath = (): LiveMapPathValue<TValue, TPath> => copy_projected_store_value(map.at(path).snap());
    let prev = readPath();

    return map.feed(path, (event: LiveMapFeedEvent) => {
      const next = readPath();
      if (projected_values_equal(next, prev, options)) return;

      const old = prev;
      prev = copy_projected_store_value(next);
      listener(copy_projected_store_value(next), copy_projected_store_value(old), event);
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

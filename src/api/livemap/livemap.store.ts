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
import {
  optional_ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { livemap_projected_propagation } from "./livemap.projected-propagation.js";
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

// Selector results intentionally remain a separate compatibility domain. This
// JSON clone is not used for LiveMap projected state, commits, paths, or
// transport and must not be substituted for the ordered carrier machinery.
function clone_selector_value<TValue>(value: TValue): TValue {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as TValue;
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
  const propagation = livemap_projected_propagation(map as object);
  const read_projected = (path: LivePath): OrderedProjectedValue | undefined => {
    const exact = propagation?.read(path);
    if (exact !== undefined) return exact;
    const publicValue = path.length === 0 ? map.snap() : map.at(path).snap();
    return publicValue === undefined ? undefined : admit_projected_value(publicValue);
  };
  const materialize = <TOutput>(value: OrderedProjectedValue | undefined): TOutput => {
    return (value === undefined ? undefined : materialize_projected_value(value)) as TOutput;
  };
  const snapshot = (): TValue => materialize<TValue>(read_projected([]));

  const subscribe = (listener: LiveMapStoreListener<TValue>): LiveMapDisposer => {
    return map.feed([], () => {
      listener(snapshot());
    });
  };

  const subscribeDiff = (listener: LiveMapStoreDiffListener<TValue>): LiveMapDisposer => {
    let prev = read_projected([]);

    return map.feed([], () => {
      const next = read_projected([]);
      if (optional_ordered_projected_value_equal(next, prev)) return;

      const old = prev;
      prev = next;
      listener(materialize<TValue>(next), materialize<TValue>(old));
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
    let prev = read_projected(path);

    return map.feed(path, (event: LiveMapFeedEvent) => {
      const next = read_projected(path);
      const equal = options?.equal === undefined
        ? optional_ordered_projected_value_equal(next, prev)
        : options.equal(
          materialize<LiveMapPathValue<TValue, TPath>>(next),
          materialize<LiveMapPathValue<TValue, TPath>>(prev),
        );
      if (equal) return;

      const old = prev;
      prev = next;
      listener(
        materialize<LiveMapPathValue<TValue, TPath>>(next),
        materialize<LiveMapPathValue<TValue, TPath>>(old),
        event,
      );
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

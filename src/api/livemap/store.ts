// store.ts

/**
 * LiveMap store-amenity notes.
 *
 * This module is intentionally a design stub for now. The demo migration has
 * shown a repeated need for store-like behavior around a LiveMap: snapshots,
 * selected subscriptions, path subscriptions, and domain facades. The important
 * naming/design point is that this should not make users feel like they are
 * leaving LiveMap and receiving some separate "store" object as the primary
 * noun. LiveMap remains the thing. Store behavior is an amenity layer around a
 * map, not a replacement concept.
 *
 * Current design bias
 * -------------------
 *
 * Prefer APIs where the caller still thinks in terms of a map:
 *
 * ```ts
 * const map = hson.liveMap
 *   .fromJson(initial)
 *   .schema.use(schema);
 *
 * map.at(["ui", "currentView"]).set("test");
 * map.subscribePath(["ui", "currentView"], () => { ... });
 * map.subscribeSel((state) => state.ui.currentView, () => { ... });
 * ```
 *
 * rather than APIs that visually imply LiveMap is just a constructor for a
 * different state-store abstraction:
 *
 * ```ts
 * const store = hson.liveMap.store(map);
 * ```
 *
 * The implementation may still live in `livemap/store.ts`, and the internal
 * helper may still be named like `make_livemap_store_api(...)`, but the public
 * surface should keep `map` as the natural variable name.
 *
 * Why this exists
 * ---------------
 *
 * The demo currently has a domain store facade over a LiveMap-backed state
 * graph. That facade does useful application-specific work:
 *
 * - `get_view`, `set_view`, `toggle_view`,
 * - `get_widgets`, `activate_widget`, `deactivate_widget`,
 * - `get_color_token`, `set_color_value`, `reset_color_values`,
 * - domain-specific subscriptions such as `demo_subscribe_view_state(...)`.
 *
 * Those domain methods should remain application code. LiveMap should not know
 * about demo views, widgets, OKLCH color tokens, or panel semantics.
 *
 * What is generic is the layer underneath:
 *
 * - snapshot the current projected root,
 * - read a projected path,
 * - write a projected path,
 * - subscribe to any map change,
 * - subscribe with previous/next snapshots,
 * - subscribe to a selected derived value,
 * - subscribe to a projected path,
 * - expose the root HSON node for inspection.
 *
 * That generic layer is the candidate for this module.
 *
 * Public-surface possibilities
 * ----------------------------
 *
 * There are three plausible shapes. None is chosen yet.
 *
 * 1. Methods directly on LiveMap.
 *
 * ```ts
 * map.subscribe((next) => { ... });
 * map.subscribeDiff((next, prev) => { ... });
 * map.subscribeSel((state) => state.ui.currentView, (next) => { ... });
 * map.subscribePath(["ui", "currentView"], () => { ... });
 * ```
 *
 * This is the most ergonomic and keeps LiveMap as the noun. The risk is that it
 * widens the core LiveMap API with store-specific conveniences.
 *
 * 2. A `map.store` namespace.
 *
 * ```ts
 * map.store.subscribe((next) => { ... });
 * map.store.subscribeDiff((next, prev) => { ... });
 * map.store.subscribeSel((state) => state.ui.currentView, (next) => { ... });
 * map.store.subscribePath(["ui", "currentView"], () => { ... });
 * ```
 *
 * This keeps the core map surface smaller, but it may feel like one namespace
 * too many. It also makes `store` feel like a peer to `schema`, even though
 * schema binding is usually a startup concern while subscriptions may be common
 * runtime work.
 *
 * 3. A separate adapter function.
 *
 * ```ts
 * const mapStore = hson.liveMap.store(map);
 * mapStore.subscribePath(["ui", "currentView"], () => { ... });
 * ```
 *
 * This is clean internally but weak ergonomically. It nudges users toward naming
 * the primary object `store`, when the intended mental model is still LiveMap.
 * This shape should probably remain an implementation detail unless a strong use
 * case appears.
 *
 * Current likely direction
 * ------------------------
 *
 * The likely first public surface is either direct LiveMap methods or a small
 * `map.store` namespace. The implementation can be shared either way.
 *
 * The local-first LiveMap idiom remains unchanged:
 *
 * ```ts
 * const pickerMap = hson.liveMap.fromJson({
 *   current: initialPickerState,
 * });
 * ```
 *
 * A map is standalone by default. There is no need for a separate
 * `hson.liveMap.local(...)` constructor. Shared/global behavior is a usage
 * convention or future relationship layer, not a different construction mode.
 *
 * Minimal generic behavior
 * ------------------------
 *
 * A first implementation should probably support only these generic pieces:
 *
 * ```ts
 * type LiveMapStoreLike<TValue> = Readonly<{
 *   snapshot: () => TValue;
 *   subscribe: (listener: (next: TValue) => void) => () => void;
 *   subscribeDiff: (listener: (next: TValue, prev: TValue) => void) => () => void;
 *   subscribeSel: <TSelected>(
 *     selector: (state: TValue) => TSelected,
 *     listener: (next: TSelected, prev: TSelected, state: TValue) => void,
 *   ) => () => void;
 *   subscribePath: (
 *     path: readonly (string | number)[],
 *     listener: () => void,
 *   ) => () => void;
 * }>;
 * ```
 *
 * `get` and `set` are less urgent because LiveMap already has:
 *
 * ```ts
 * map.snap(path);
 * map.at(path).snap();
 * map.set(path, value);
 * map.at(path).set(value);
 * ```
 *
 * The store amenity layer should avoid duplicating core map path APIs unless a
 * shorter alias proves genuinely useful.
 *
 * Emission model
 * --------------
 *
 * The demo store currently emits by wrapping writes:
 *
 * 1. snapshot before write,
 * 2. perform path write,
 * 3. snapshot after write,
 * 4. compare root snapshots,
 * 5. notify listeners only if the projected root changed.
 *
 * LiveMap already has lower-level feeds and commits. A store amenity layer could
 * eventually build on those instead of wrapping writes. For a first pass, though,
 * it may be simpler to subscribe to root/feed events and recompute selected
 * values from `map.snap()`.
 *
 * Selector subscriptions
 * ----------------------
 *
 * `subscribeSel` is valuable because most UI does not want every map change. It
 * wants a selected value and a stable equality rule.
 *
 * First-pass equality can be `Object.is`, matching the demo store. For object or
 * array selections, callers can return a signature string if they want cheap
 * structural comparison:
 *
 * ```ts
 * map.subscribeSel(
 *   (state) => state.ui.activeWidgets.join("\u001f"),
 *   () => syncWidgets(),
 * );
 * ```
 *
 * A later version might accept an equality option:
 *
 * ```ts
 * map.subscribeSel(selector, listener, { equal: json_equal });
 * ```
 *
 * Path subscriptions
 * ------------------
 *
 * `subscribePath(path, listener)` should mean: run the listener when the
 * projected value at `path` changes. It should not require the caller to know
 * commit internals.
 *
 * Internally, it can begin as:
 *
 * - subscribe to map changes,
 * - read `map.snap(path)`,
 * - compare a stable signature.
 *
 * Later, it can become feed/commit-aware:
 *
 * - subscribe only to overlapping path commits,
 * - avoid recomputing unrelated paths,
 * - support better array/object path invalidation.
 *
 * Root replacement
 * ----------------
 *
 * Do not include a root `replace(...)` store amenity until LiveMap editor itself
 * supports root replacement. The current editor rejects `map.set([], value)`.
 * The demo migration exposed this in the test logger. Until root replacement is
 * supported, reset-style logic should write top-level fields or use explicit
 * domain actions.
 *
 * Non-goals for this module
 * -------------------------
 *
 * This module should not include:
 *
 * - domain state helpers,
 * - schema inference from example data,
 * - map-to-map interop/linking,
 * - global registry behavior,
 * - state graph / inspector behavior,
 * - root replacement before the editor supports it.
 *
 * Map interop remains a separate future relationship layer. Two maps using the
 * same schema are compatible, but not automatically linked. For now, map-to-map
 * communication should remain explicit application code.
 *
 * Relation to the old demo state engine
 * -------------------------------------
 *
 * This module is the spiritual replacement for the generic useful parts of the
 * old demo `state.ts`, not a port of that file. The old state engine mixed path
 * editing, schema validation, subscriptions, source registration, and inspector
 * support. LiveMap already owns path editing and schema validation. This module
 * should only add the store-like subscription amenities that remain useful once
 * LiveMap is the backing graph.
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
// livemap-helpers.ts

import type { JsonValue } from "../../core/types.js";

/** A cleanup function returned by subscription-style helpers. */
export type LiveMapDisposer = () => void;

/** Generic path shape used by helper experiments before final LiveMap API induction. */
export type LiveMapHelperPath = readonly unknown[];

/** Generic path subscriber shape used by helper experiments. */
export type LiveMapPathSubscriber<TPath extends LiveMapHelperPath = LiveMapHelperPath> = (
    path: TPath,
    listener: () => void,
) => LiveMapDisposer;

/** A function that wraps a run callback in a scheduling policy. */
export type LiveMapSchedulerFactory = (run: () => void) => () => void;

export type BindPathOptions<TPath extends LiveMapHelperPath, TValue> = Readonly<{
    path: TPath;
    subscribePath: LiveMapPathSubscriber<TPath>;
    read: () => TValue;
    render: (value: TValue) => void;
    schedule?: LiveMapSchedulerFactory;
    immediate?: boolean;
}>;

export type BindPathsOptions<TPath extends LiveMapHelperPath, TValue> = Readonly<{
    paths: readonly TPath[];
    subscribePath: LiveMapPathSubscriber<TPath>;
    read: () => TValue;
    render: (value: TValue) => void;
    schedule?: LiveMapSchedulerFactory;
    immediate?: boolean;
}>;

export type DeriveFromPathsOptions<TPath extends LiveMapHelperPath> = Readonly<{
    paths: readonly TPath[];
    subscribePath: LiveMapPathSubscriber<TPath>;
    derive: () => void;
    schedule?: LiveMapSchedulerFactory;
    immediate?: boolean;
}>;

/**
 * Scratchpad for LiveMap helper candidates.
 *
 * Likely candidates for eventual API induction:
 *
 * - `make_microtask_scheduler(fn)`
 *   Coalesces many synchronous LiveMap subscription events into one queued run.
 *   Useful for derived-state evaluation and render passes.
 *
 * - `stop_all(disposers)`
 *   Collapses several subscription cleanup functions into one idempotent disposer.
 *
 * - `subscribe_paths(subscribePath, paths, listener)`
 *   Composes multiple path subscriptions into one cleanup function. This is the
 *   experimental shape behind a possible future `map.sub.paths(...)` surface.
 *
 * - `bind_path(...)`
 *   Projects one subscribed path through `read()` into a render/update function.
 *   This is deliberately UI-agnostic for now, but it is the experimental shape
 *   behind a possible LiveMap/LiveTree bridge helper.
 *
 * - `bind_paths(...)`
 *   Multi-path form of `bind_path(...)` for render/update work that depends on
 *   several subscribed paths but should still render from one fresh `read()`.
 *
 * - `derive_from_paths(...)`
 *   Higher-level authored-to-derived orchestration: subscribe to input paths,
 *   coalesce updates, and write derived paths without subscribing to the outputs.
 *   This should stay experimental until at least one more demo repeats the same
 *   pattern.
 *
 * - `read_path(...)`
 *   Snapshot path reader with fallback. Useful if the existing LiveMap read
 *   surface does not already cover this case cleanly.
 */

/**
 * Returns a scheduler that runs `fn` at most once per microtask turn.
 *
 * Synchronous calls are coalesced. Calls made while `fn` is running can schedule
 * a later microtask run, but never recurse synchronously.
 */
export function make_microtask_scheduler(fn: () => void): () => void {
    let queued = false;

    return () => {
        if (queued) return;
        queued = true;

        queueMicrotask(() => {
            queued = false;
            fn();
        });
    };
}

/**
 * Combines many disposer functions into one idempotent disposer.
 *
 * Disposers run in insertion order. Later calls are ignored.
 */
export function stop_all(disposers: Iterable<LiveMapDisposer>): LiveMapDisposer {
    const stops = Array.from(disposers);
    let stopped = false;

    return () => {
        if (stopped) return;
        stopped = true;

        for (const stop of stops.splice(0)) stop();
    };
}

/**
 * Subscribes the same listener to several paths and returns one disposer.
 *
 * This intentionally accepts the path subscription function as an argument so the
 * helper can live here before its final home/API shape is settled.
 */
export function subscribe_paths<TPath extends LiveMapHelperPath>(
    subscribePath: LiveMapPathSubscriber<TPath>,
    paths: readonly TPath[],
    listener: () => void,
): LiveMapDisposer {
    return stop_all(paths.map((path) => subscribePath(path, listener)));
}

/**
 * Subscribes one path and renders the current value from `read()` when the path changes.
 *
 * `bind_path` intentionally does not know about LiveTree. The caller owns the
 * rendering side effect, so this can bind to text, CSS, derived caches, debug
 * panels, or future LiveTree bridge helpers without changing this primitive.
 */
export function bind_path<TPath extends LiveMapHelperPath, TValue>(options: BindPathOptions<TPath, TValue>): LiveMapDisposer {
    const run = (): void => {
        options.render(options.read());
    };
    const listener = options.schedule ? options.schedule(run) : run;

    if (options.immediate !== false) run();

    return options.subscribePath(options.path, listener);
}

/**
 * Subscribes several paths and renders the current value from `read()` when any path changes.
 *
 * This is the multi-path form of `bind_path`. It is useful when one render pass
 * depends on several LiveMap paths and should be coalesced into one fresh read.
 */
export function bind_paths<TPath extends LiveMapHelperPath, TValue>(options: BindPathsOptions<TPath, TValue>): LiveMapDisposer {
    const run = (): void => {
        options.render(options.read());
    };
    const listener = options.schedule ? options.schedule(run) : run;

    if (options.immediate !== false) run();

    return subscribe_paths(options.subscribePath, options.paths, listener);
}

/**
 * Subscribes input paths and runs a derived-state pass when any input changes.
 *
 * This is a small orchestration helper for the common authored-state -> derived-state
 * pattern. It does not know where the derived state is written; the caller's
 * `derive()` function owns that policy.
 */
export function derive_from_paths<TPath extends LiveMapHelperPath>(options: DeriveFromPathsOptions<TPath>): LiveMapDisposer {
    const listener = options.schedule ? options.schedule(options.derive) : options.derive;

    if (options.immediate === true) listener();

    return subscribe_paths(options.subscribePath, options.paths, listener);
}
export function json_values_equal(
  left: JsonValue | undefined,
  right: JsonValue | undefined): boolean {
  if (left === right) return true;

  if (left === undefined
    || right === undefined) {
    return false;
  }

  if (left === null
    || right === null) {
    return false;
  }

  if (typeof left !== typeof right) {
    return false;
  }

  if (Array.isArray(left)) {
    if (!Array.isArray(right)
      || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => {
      return json_values_equal(
        value,
        right[index]
      );
    });
  }

  if (typeof left === "object") {
    if (typeof right !== "object"
      || Array.isArray(right)) {
      return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => {
      return Object.prototype.hasOwnProperty.call(
        right,
        key
      ) && json_values_equal(
        left[key],
        right[key]
      );
    });
  }

  return false;
}

// animate.ts

import { AnimAdapters, AnimApi, AnimApiCore, AnimSpec, AnimationName, AnimationEndMode } from "./animate.types";

// CHANGED: single type parameter; output API matches the core + target type
export function bind_anim_api<TTarget>(
  target: TTarget,
  core: AnimApiCore<TTarget>,
): AnimApi<TTarget> {
  return {
    begin: (spec) => core.begin(target, spec),
    restart: (spec) => core.restart(target, spec),

    beginName: (name) => core.beginName(target, name),
    restartName: (name) => core.restartName(target, name),

    end: (mode) => core.end(target, mode),

    setPlayState: (state) => core.setPlayState(target, state),
    pause: () => core.pause(target),
    resume: () => core.resume(target),
  };
}

/**
 * Normalize and validate an animation/keyframes name.
 *
 * Trims surrounding whitespace and rejects the empty string. This is used as a
 * boundary guard for APIs that set `animation-name` or refer to named
 * `@keyframes` blocks.
 *
 * @param name
 *   The raw name from user input.
 *
 * @returns
 *   The trimmed, non-empty name.
 *
 * @throws {Error}
 *   If the trimmed name is empty.
 */
export function normalizeName(name: string): string {
  const n = name.trim();
  if (n === "") throw new Error(`animation name cannot be empty.`);
  return n;
}

/**
 * Apply only the `animation-name` property to a tree scope via adapters.
 *
 * This is the smallest possible “start animation” operation: it does not set
 * duration, timing function, etc. It’s useful when the caller wants to manage
 * other `animation-*` properties elsewhere (or rely on CSS defaults).
 *
 * @typeParam TTree
 *   The caller’s “scope” type (e.g., a QUID selection object).
 *
 * @param tree
 *   The target scope to modify.
 *
 * @param name
 *   The animation/keyframes name. Will be normalized/validated.
 *
 * @param a
 *   Adapter surface used to apply `animation-name` to the scope.
 *
 * @returns
 *   The updated scope (usually the same reference, depending on adapters).
 */
function applyNameOnly<TTree>(tree: TTree, name: string, a: AnimAdapters<TTree>): TTree {
  return a.setStyleProp(tree, "animation-name", normalizeName(name));
}

/**
 * Normalize and validate an `AnimationSpec` at the boundary.
 *
 * This function enforces invariants that make downstream operations predictable:
 * - `spec.name` is trimmed and must be non-empty
 * - `spec.duration` is required and must be non-empty after trim
 * - all optional string fields are trimmed (or remain `undefined`)
 *
 * The returned object is safe to feed into `applyAnimationProps()` without
 * repeating validation and trim logic.
 *
 * @param spec
 *   The raw animation specification from the caller.
 *
 * @returns
 *   A normalized spec with required fields validated and optional fields trimmed.
 *
 * @throws {Error}
 *   If `name` is empty after trimming, or if `duration` is empty after trimming.
 */
function normalizeSpec(spec: AnimSpec): AnimSpec {
  const name = normalizeName(spec.name);

  const duration = spec.duration.trim();
  if (duration === "") {
    throw new Error(`begin_animation: spec.duration cannot be empty.`);
  }

  return {
    ...spec,
    name,
    duration,
    timingFunction: spec.timingFunction?.trim(),
    delay: spec.delay?.trim(),
    iterationCount: spec.iterationCount?.trim(),
    direction: spec.direction?.trim(),
    fillMode: spec.fillMode?.trim(),
    playState: spec.playState?.trim(),
  };
}

/**
 * Apply an `AnimationSpec` to a tree scope by expanding it into explicit
 * `animation-*` properties.
 *
 * Notes:
 * - This intentionally does **not** set the `animation` shorthand; it writes
 *   explicit longhand properties for clarity and easier incremental updates.
 * - Only properties present in `spec` are applied (except `animation-name`,
 *   which is always set).
 * - `spec` is expected to be pre-normalized (see `normalizeSpec()`).
 *
 * @typeParam TTree
 *   The caller’s “scope” type (e.g., a QUID selection object).
 *
 * @param tree
 *   The target scope to modify.
 *
 * @param spec
 *   The normalized animation spec to apply.
 *
 * @param a
 *   Adapter surface used to write style properties to the scope.
 *
 * @returns
 *   The updated scope (usually the same reference, depending on adapters).
 */
function applyAnimationProps<TTree>(
  tree: TTree,
  spec: AnimSpec,
  a: AnimAdapters<TTree>,
): TTree {
  //  apply only properties present in spec.
  // NOTE: we DO NOT set shorthand; we expand to explicit animation-* props.

  //  always set name.
  tree = a.setStyleProp(tree, "animation-name", spec.name);

  if (spec.duration !== undefined) {
    tree = a.setStyleProp(tree, "animation-duration", spec.duration.trim());
  }

  if (spec.timingFunction !== undefined) {
    tree = a.setStyleProp(tree, "animation-timing-function", spec.timingFunction.trim());
  }

  if (spec.delay !== undefined) {
    tree = a.setStyleProp(tree, "animation-delay", spec.delay.trim());
  }

  if (spec.iterationCount !== undefined) {
    tree = a.setStyleProp(tree, "animation-iteration-count", spec.iterationCount.trim());
  }

  if (spec.direction !== undefined) {
    tree = a.setStyleProp(tree, "animation-direction", spec.direction.trim());
  }

  if (spec.fillMode !== undefined) {
    tree = a.setStyleProp(tree, "animation-fill-mode", spec.fillMode.trim());
  }

  if (spec.playState !== undefined) {
    tree = a.setStyleProp(tree, "animation-play-state", spec.playState.trim());
  }

  return tree;
}

/**
 * Force a layout read to make CSS animation restarts take effect.
 *
 * Many “restart animation” recipes rely on:
 *   1) setting `animation-name: none`
 *   2) forcing a layout flush (a read that requires layout)
 *   3) re-applying the animation properties
 *
 * This helper performs the layout read using `HTMLElement.offsetHeight` when
 * available, and falls back to `getBoundingClientRect()` otherwise.
 *
 * @param tree
 *   Unused by this implementation, but kept for signature symmetry and future
 *   adapter designs where the scope might influence the reflow strategy.
 *
 * @param el
 *   A real DOM element associated with the scope (typically the first match).
 */
function forceReflow(tree: unknown, el: Element): void {
  //  the “restart” trick requires a layout read.
  // We use HTMLElement.offsetHeight where possible; fallback to getBoundingClientRect.
  const h = el as HTMLElement;

  if (typeof h.offsetHeight === "number") {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    h.offsetHeight;
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.getBoundingClientRect().height;
}

/**
 * Create a small, framework-agnostic animation API over an arbitrary “tree scope”
 * using adapters.
 *
 * This factory does not know about LiveTree, QUIDs, DOM selection, or CSS rule
 * storage. Instead, it delegates all mutation and DOM access to `AnimAdapters`.
 *
 * The returned API supports four main operations:
 * - `begin(spec)`: apply a normalized spec as explicit `animation-*` properties
 * - `beginName(name)`: set only `animation-name` (minimal entry)
 * - `end(mode)`: stop animations by setting `animation-name: none` (optionally clear all)
 * - `restart(spec|name)`: stop, force reflow, then re-apply (common “restart trick”)
 *
 * Important semantics:
 * - `duration` is required for `begin()`/`restart()` (enforced by `normalizeSpec()`).
 * - Restart uses a single DOM element from the scope (`getFirstDomElement`) to
 *   trigger layout flush; if none exists, restart degrades to “re-apply props”
 *   without forcing reflow.
 *
 * @typeParam TTree
 *   The caller’s “scope” type (e.g., `{ quids: string[] }`, or a DOM collection).
 *
 * @param adapters
 *   Adapter functions that define how to:
 *   - set a style property on the scope (`setStyleProp`)
 *   - find DOM elements for the scope (`getFirstDomElement`, etc.)
 *
 * @returns
 *   An `AnimApi<TTree>` implementing begin/restart/end operations over the scope.
 */
// CHANGED: return core for the same TTarget the adapters operate on
export function apply_animation<TTarget>(
  adapters: AnimAdapters<TTarget>,
): AnimApiCore<TTarget> {
  return {
    begin(target: TTarget, spec: AnimSpec): TTarget {
      const s = normalizeSpec(spec);
      return applyAnimationProps(target, s, adapters);
    },

    beginName(target: TTarget, name: AnimationName): TTarget {
      return applyNameOnly(target, name, adapters);
    },

    end(target: TTarget, mode: AnimationEndMode = "name-only"): TTarget {
      target = adapters.setStyleProp(target, "animation-name", "none");

      if (mode === "clear-all") {
        target = adapters.setStyleProp(target, "animation-duration", "");
        target = adapters.setStyleProp(target, "animation-timing-function", "");
        target = adapters.setStyleProp(target, "animation-delay", "");
        target = adapters.setStyleProp(target, "animation-iteration-count", "");
        target = adapters.setStyleProp(target, "animation-direction", "");
        target = adapters.setStyleProp(target, "animation-fill-mode", "");
        target = adapters.setStyleProp(target, "animation-play-state", "");
      }

      return target;
    },

    restart(target: TTarget, spec: AnimSpec): TTarget {
      const s = normalizeSpec(spec);

      target = adapters.setStyleProp(target, "animation-name", "none");

      const first = adapters.getFirstDomElement(target);
      if (first) forceReflow(target, first);

      return applyAnimationProps(target, s, adapters);
    },

    restartName(target: TTarget, name: AnimationName): TTarget {
      target = adapters.setStyleProp(target, "animation-name", "none");

      const first = adapters.getFirstDomElement(target);
      if (first) forceReflow(target, first);

      return applyNameOnly(target, name, adapters);
    },

    setPlayState(target: TTarget, state: "running" | "paused"): TTarget {
      return adapters.setStyleProp(target, "animation-play-state", state);
    },

    pause(target: TTarget): TTarget {
      return adapters.setStyleProp(target, "animation-play-state", "paused");
    },

    resume(target: TTarget): TTarget {
      return adapters.setStyleProp(target, "animation-play-state", "running");
    },
  };
}
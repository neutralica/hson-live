// listener-builder.ts

import { ListenerBuilder, ListenOpts, MissingPolicy, ListenerSub, ElemMap } from "../../../types-consts/listen.types";
import { LiveTree } from "../livetree";

type Q = { type: string; handler: EventListener };
type QueuedListener = {
  id: number;
  sub: ListenerSub | null;
  type: string;
  handler: EventListener;
  cancelled: boolean;
  offs: Array<() => void> | null; // filled after attach
};

/**
 * Internal registry mapping EventTargets → Sets of "off" callbacks.
 *
 * LiveTree uses this to provide reliable teardown for any listeners it creates.
 * Each target holds a Set of functions that, when called, remove exactly the
 * listener that was added. This allows bulk-cleanup without needing to track
 * the original handlers or options externally.
 */
const REG = new WeakMap<EventTarget, Set<() => void>>();


/**
 * Adds an event listener and returns an `off()` function that removes it.
 *
 * The returned callback is stored in a WeakMap registry keyed by the target.
 * This enables:
 *   • one-shot detaching of a specific listener (`off()`),
 *   • or grouped teardown of *all* listeners for a target
 *     via `_listeners_off_for_target()`.
 *
 * The target → off-callbacks relationship is ephemeral and garbage-collectable
 * because the registry uses a WeakMap.
 *
 * @param target - The DOM EventTarget to attach to.
 * @param type - Event type (e.g. `"click"`).
 * @param handler - Listener function or object.
 * @param opts - Standard `addEventListener` options.
 * @returns A function that removes the registered listener.
 */
function addWithOff(
  target: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  opts: AddEventListenerOptions
): () => void {
  target.addEventListener(type, handler, opts);
  const off = () => target.removeEventListener(type, handler, opts);
  let set = REG.get(target);
  if (!set) { set = new Set(); REG.set(target, set); }
  set.add(off);
  return off;
}

/**
 * Removes *all* listeners previously attached to a target via `addWithOff()`.
 *
 * This walks the stored off-callbacks for the given target, calls each one,
 * and then clears the registry entry. If the target has no registered
 * listeners, the function does nothing.
 *
 * This is the internal mechanism LiveTree uses when:
 *   • cleaning up listeners during node removal,
 *   • re-grafting,
 *   • or explicitly flushing listeners created by the `.listen` builder.
 *
 * @param target - The EventTarget whose listeners should be removed.
 */
export function _listeners_off_for_target(target: EventTarget): void {
  const set = REG.get(target);
  if (!set) return;
  for (const off of set) off();
  REG.delete(target);
}

/**
 * Constructs a ListenerBuilder for a given LiveTree selection.
 *
 * The builder accumulates listener declarations (event type, handler,
 * options) and attaches them either:
 *   - automatically in a microtask (default), or
 *   - manually via `.attach()`.
 *
 * Implementation details:
 * - `queue`: holds pending listener specs until attachment.
 * - `opts`: per-listener options (`{ capture, once, passive }`, etc.).
 * - prevent / stop / stopImmediate: convenience flags that wrap the
 *   handler to call `preventDefault()`, `stopPropagation()`,
 *   or `stopImmediatePropagation()`.
 * - Listeners always resolve their DOM targets lazily using the LiveTree’s
 *   current selection and QUID → Element mapping.
 * - `missingPolicy`: controls what happens if a selected node is not yet
 *   mounted in the DOM (`'ignore' | 'warn' | 'throw'`).
 *
 * Returns a fluent API for describing one or many listeners and then
 * attaching them in a controlled, predictable way.
 */
export function build_listener(tree: LiveTree): ListenerBuilder {


  let nextId = 1;
  const queue: QueuedListener[] = [];

  let opts: ListenOpts = {};
  let each = false;
  let missingPolicy: MissingPolicy = "warn";
  let _prevent = false;
  let _stop = false;
  let _stopImmediate = false;

  // auto-attach scheduling
  let autoEnabled = true;
  let lastHandle: ListenerSub | null = null;

  const schedule = () => {
    if (!autoEnabled) return;
    lastHandle = attach(); // perform real attach immediately so handlers fire in same tick
  };

  const resolveTarget = (el: Element): EventTarget =>
    opts.target === "window" ? window :
      opts.target === "document" ? document :
        el;

  const collectTargets = (): Element[] => {
    const el = tree.asDomElement();
    return el ? [el] : [];
  };
  const on = <K extends keyof ElemMap>(
    type: K,
    handler: (ev: ElemMap[K]) => void
  ): ListenerSub => {
    // wrap once, read flags at dispatch so end-of-chain calls work
    const wrapped: EventListener = (ev: Event) => {
      // enforce in this exact order
      if (_stopImmediate) ev.stopImmediatePropagation();
      if (_stop) ev.stopPropagation();
      if (_prevent && !opts.passive) ev.preventDefault(); // passive forbids preventDefault()

      handler(ev as ElemMap[K]);

      // optional: belt-and-suspenders once — harmless if DOM once already removed it
      if (opts.once) {
        const tgt =
          opts.target === "window" ? window :
            opts.target === "document" ? document :
              // same element resolved at attach time via resolveTarget(); this is for safety
              (ev.currentTarget as EventTarget | null) ?? document;
        tgt.removeEventListener(String(type), wrapped, { capture: !!opts.capture });
      }
    };

    // queue this binding; attach() will call addEventListener with current opts
    const job: QueuedListener = {
      id: nextId++,
      sub: null,
      type: String(type),
      handler: wrapped,
      cancelled: false,
      offs: null,
    };

    queue.push(job);
    schedule();

    //  return a per-call subscription handle
    const sub: ListenerSub = {
      off(): void {
        // cancel if not yet attached
        job.cancelled = true;

        // detach immediately if already attached
        if (job.offs) {
          for (const f of job.offs) f();
          job.offs = null;
        }

        //  keep handle state honest
        sub.count = 0;
        sub.ok = false;
      },
      count: 0,   // updated after attach flush
      ok: false,  //  nothing attached yet
    };
    job.sub = sub;
    return sub;
  };
  const attach = (): ListenerSub => {
    // INVARIANT (ListenerBuilder.attach):
    // attach() must be an edge-trigger: it attaches ONLY the jobs currently queued.
    // Jobs are snapshotted and the queue cleared so schedule() / subsequent ticks
    // cannot reattach old jobs, which causes duplicate listeners and “haunting” behavior.
    // If attach() is called with an empty selection, jobs are finalized as unattached.

    const targets = collectTargets();

    // Optional sanity check (no process.env, and doesn't assume QUID exists):
    for (const el of targets) {
      if (!(el instanceof Element)) {
        throw new Error("listen.attach(): non-Element target in selection");
      }
    }

    if (targets.length === 0) {
      const msg = `listen.attach(): no targets in selection`;
      if (missingPolicy === "throw") throw new Error(msg);
      if (missingPolicy === "warn") console.warn(msg, { tree });

      //  if no targets, mark all queued jobs as “done but unattached”
      for (const job of queue) {
        job.offs = null;
        if (job.sub) {
          job.sub.count = 0;
          job.sub.ok = false;
        }
      }
      queue.length = 0;
      return { off: () => void 0, count: 0, ok: false };
    }

    const aelo: AddEventListenerOptions = {
      capture: !!opts.capture,
      once: !!opts.once,
      passive: !!opts.passive,
    };

    //  snapshot and clear queue so future schedule() ticks don’t reattach old jobs
    const jobs = queue.splice(0, queue.length);

    const offsAll: Array<() => void> = [];

    for (const job of jobs) {
      if (job.cancelled) {
        job.offs = null;

        if (job.sub) {
          job.sub.count = 0;
          job.sub.ok = false;
        }

        continue;
      }

      const jobOffs: Array<() => void> = [];

      for (const el of targets) {
        const tgt = resolveTarget(el);
        jobOffs.push(addWithOff(tgt, job.type, job.handler, aelo));
      }

      job.offs = jobOffs;
      if (job.sub) {
        job.sub.count = jobOffs.length;
        job.sub.ok = jobOffs.length > 0;
      }
      for (const f of jobOffs) offsAll.push(f);
    }

    const handle: ListenerSub = {
      off: () => { for (const f of offsAll) f(); },
      count: offsAll.length,
      ok: offsAll.length > 0,
    };

    return handle;
  };
  let api: ListenerBuilder;
  // NEW: internal helper: allow string event types for custom events without
  // weakening the typed `on<K extends keyof ElemMap>()`.
  const onAny = <E extends Event>(type: string, handler: (ev: E) => void): ListenerSub => {
    // NOTE: this is the same as `on`, but without keyof ElemMap constraint.
    return on(type as keyof ElemMap, handler as (ev: any) => void);
    // CHANGED: we deliberately reuse `on(...)` so queue/attach logic stays 1-source-of-truth.
  };

  // CHANGED: add convenience wrappers so api satisfies ListenerBuilder
  api = {
    on,

    // Form / input
    onInput: (fn) => on("input", (ev) => fn(ev as InputEvent)),
    onChange: (fn) => on("change", (ev) => fn(ev as Event)),
    onSubmit: (fn) => on("submit", (ev) => fn(ev as SubmitEvent)),

    // Mouse
    onClick: (fn) => on("click", (ev) => fn(ev as MouseEvent)),
    // ADDED
    onDblClick: (fn) => on("dblclick", (ev) => fn(ev as MouseEvent)),
    // ADDED
    onContextMenu: (fn) => on("contextmenu", (ev) => fn(ev as MouseEvent)),
    onMouseMove: (fn) => on("mousemove", (ev) => fn(ev as MouseEvent)),
    onMouseDown: (fn) => on("mousedown", (ev) => fn(ev as MouseEvent)),
    onMouseUp: (fn) => on("mouseup", (ev) => fn(ev as MouseEvent)),
    // ADDED (note: non-bubbling)
    onMouseEnter: (fn) => on("mouseenter", (ev) => fn(ev as MouseEvent)),
    // ADDED (note: non-bubbling)
    onMouseLeave: (fn) => on("mouseleave", (ev) => fn(ev as MouseEvent)),

    // Pointer
    onPointerDown: (fn) => on("pointerdown", (ev) => fn(ev as PointerEvent)),
    onPointerMove: (fn) => on("pointermove", (ev) => fn(ev as PointerEvent)),
    onPointerUp: (fn) => on("pointerup", (ev) => fn(ev as PointerEvent)),
    // ADDED
    onPointerEnter: (fn) => on("pointerenter", (ev) => fn(ev as PointerEvent)),
    // ADDED
    onPointerLeave: (fn) => on("pointerleave", (ev) => fn(ev as PointerEvent)),
    // ADDED
    onPointerCancel: (fn) => on("pointercancel", (ev) => fn(ev as PointerEvent)),

    // Touch (ADDED)
    onTouchStart: (fn) => on("touchstart", (ev) => fn(ev as TouchEvent)),
    onTouchMove: (fn) => on("touchmove", (ev) => fn(ev as TouchEvent)),
    onTouchEnd: (fn) => on("touchend", (ev) => fn(ev as TouchEvent)),
    onTouchCancel: (fn) => on("touchcancel", (ev) => fn(ev as TouchEvent)),

    // Wheel / scroll (ADDED)
    onWheel: (fn) => on("wheel", (ev) => fn(ev as WheelEvent)),
    onScroll: (fn) => on("scroll", (ev) => fn(ev as Event)),

    // Focus
    // ADDED (non-bubbling)
    onFocus: (fn) => on("focus", (ev) => fn(ev as FocusEvent)),
    // ADDED (non-bubbling)
    onBlur: (fn) => on("blur", (ev) => fn(ev as FocusEvent)),
    onFocusIn: (fn) => on("focusin", (ev) => fn(ev as FocusEvent)),
    onFocusOut: (fn) => on("focusout", (ev) => fn(ev as FocusEvent)),

    // Keyboard
    onKeyDown: (fn) => on("keydown", (ev) => fn(ev as KeyboardEvent)),
    onKeyUp: (fn) => on("keyup", (ev) => fn(ev as KeyboardEvent)),

    // Drag & drop (ADDED)
    onDragStart: (fn) => on("dragstart", (ev) => fn(ev as DragEvent)),
    onDragOver: (fn) => on("dragover", (ev) => fn(ev as DragEvent)),
    onDrop: (fn) => on("drop", (ev) => fn(ev as DragEvent)),
    onDragEnd: (fn) => on("dragend", (ev) => fn(ev as DragEvent)),

    // Animation lifecycle (ADDED)
    onAnimationStart: (fn) => on("animationstart", (ev) => fn(ev as AnimationEvent)),
    onAnimationIteration: (fn) => on("animationiteration", (ev) => fn(ev as AnimationEvent)),
    onAnimationEnd: (fn) => on("animationend", (ev) => fn(ev as AnimationEvent)),
    onAnimationCancel: (fn) => on("animationcancel", (ev) => fn(ev as AnimationEvent)),

    // Transition lifecycle (ADDED)
    onTransitionStart: (fn) => on("transitionstart", (ev) => fn(ev as TransitionEvent)),
    onTransitionEnd: (fn) => on("transitionend", (ev) => fn(ev as TransitionEvent)),
    onTransitionCancel: (fn) => on("transitioncancel", (ev) => fn(ev as TransitionEvent)),
    onTransitionRun: (fn) => on("transitionrun", (ev) => fn(ev as TransitionEvent)),

    // Clipboard (ADDED)
    onCopy: (fn) => on("copy", (ev) => fn(ev as ClipboardEvent)),
    onCut: (fn) => on("cut", (ev) => fn(ev as ClipboardEvent)),
    onPaste: (fn) => on("paste", (ev) => fn(ev as ClipboardEvent)),

    // Custom events / escape hatches
    onCustom: <E extends Event = Event>(type: string, handler: (ev: E) => void) => {
      return on(type as unknown as keyof ElemMap, handler as unknown as (ev: Event) => void);
    },
    onCustomDetail: <D>(type: string, handler: (ev: CustomEvent<D>) => void) => {
      return api.onCustom<CustomEvent<D>>(type, handler);
    },

    // options chain (unchanged)
    once: () => { opts = { ...opts, once: true }; return api; },
    passive: () => { opts = { ...opts, passive: true }; return api; },
    capture: () => { opts = { ...opts, capture: true }; return api; },
    toWindow: () => { opts = { ...opts, target: "window" }; return api; },
    toDocument: () => { opts = { ...opts, target: "document" }; return api; },

    strict(policy: MissingPolicy = "warn") { missingPolicy = policy; return api; },

    preventDefault(): ListenerBuilder { _prevent = true; return api; },
    stopProp(): ListenerBuilder { _stop = true; return api; },
    stopImmediateProp(): ListenerBuilder { _stopImmediate = true; return api; },
    stopAll(): ListenerBuilder { _stopImmediate = _stop = _prevent = true; return api; },
    clearStops(): ListenerBuilder { _stopImmediate = _stop = _prevent = false; return api; },
  };

  return api;
}

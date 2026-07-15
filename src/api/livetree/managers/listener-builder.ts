// listener-builder.ts

import { ListenerBuilder, ListenOpts, MissingPolicy, ListenerSub, ElemMap } from "../../../types/listen.types.js";
import { LiveTree } from "../livetree.js";
import { own_disposable_for_owner } from "./lifecycle-registry.js";


type QueuedListener = {
  id: number;
  sub: ListenerSub | null;
  type: string;
  handler: EventListener;
  cancelled: boolean;
  offs: Array<() => void> | null; // filled after attach
};

const TARGET_LISTENER_REG = new WeakMap<EventTarget, Set<() => void>>();

class ListenerSubscription implements ListenerSub {
  public count = 0;
  public ok = false;

  public constructor(private readonly release: () => void) {}

  public off(): void {
    this.release();
  }
}

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
  handler: EventListener,
  opts: AddEventListenerOptions,
  ownerQuid: string,
  onOff: () => void,
): () => void {
  let off: () => void = () => undefined;
  const nativeHandler: EventListener = (event) => {
    try {
      handler(event);
    } finally {
      if (opts.once) off();
    }
  };

  target.addEventListener(type, nativeHandler, opts);
  let set = TARGET_LISTENER_REG.get(target);
  if (!set) { set = new Set(); TARGET_LISTENER_REG.set(target, set); }

  off = own_disposable_for_owner(ownerQuid, () => {
    target.removeEventListener(type, nativeHandler, opts);
    set?.delete(off);
    if (set?.size === 0) TARGET_LISTENER_REG.delete(target);
    onOff();
  }, "listener");

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
  const set = TARGET_LISTENER_REG.get(target);
  if (!set) return;

  for (const off of [...set]) off();
  TARGET_LISTENER_REG.delete(target);
}

export function _listeners_debug_hard_reset(): void {
  if (typeof document !== "undefined") {
    _listeners_off_for_target(document);
  }

  if (typeof window !== "undefined") {
    _listeners_off_for_target(window);
  }
}

/**
 * Construct the `ListenerBuilder` used by `LiveTree.listen`.
 *
 * The builder accumulates one registration at a time and attaches it
 * immediately when an `on...` method is called. By default the target is the
 * tree's current DOM element; `.document`, `.window`, and `.element` switch
 * the target for the next registration.
 *
 * Supported builder concerns include:
 * - native listener options: `once`, `capture`, `passive`
 * - event-flow modifiers: `preventDefault`, `stopProp`, `stopImmediateProp`
 * - missing-target handling via `strict('ignore' | 'warn' | 'throw')`
 *
 * Ambient `document` and `window` listeners are tracked by owner QUID so they
 * can be removed automatically when the owning tree is removed.
 *
 * @param tree - The owning `LiveTree`.
 * @returns A fluent listener-registration surface.
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

  const resolveAmbientTarget = (): EventTarget | null => {
    try {
      if (opts.target === "window") {
        return typeof window !== "undefined" ? window : null;
      }

      if (opts.target === "document") {
        return typeof document !== "undefined" ? document : null;
      }

      return null;
    } catch {
      return null;
    }
  };

  const collectTargets = (): EventTarget[] => {
    if (opts.target === "window" || opts.target === "document") {
      const tgt = resolveAmbientTarget();
      return tgt ? [tgt] : [];
    }

    const el = tree.dom.el();
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
    let sub: ListenerSubscription;
    sub = new ListenerSubscription(() => {
      // cancel if not yet attached
      job.cancelled = true;

      // detach immediately if already attached
      if (job.offs) {
        for (const f of [...job.offs]) f();
        job.offs = null;
      }

      //  keep handle state honest
      sub.count = 0;
      sub.ok = false;
    });
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

    for (const tgt of targets) {
      if (!(tgt instanceof EventTarget)) {
        throw new Error("listen.attach(): non-EventTarget in selection");
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
      return new ListenerSubscription(() => undefined);
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

      for (const tgt of targets) {
        let off: () => void = () => undefined;
        off = addWithOff(tgt, job.type, job.handler, aelo, tree.quid, () => {
          if (!job.offs) return;
          const index = job.offs.indexOf(off);
          if (index >= 0) job.offs.splice(index, 1);
          if (job.offs.length === 0) job.offs = null;
          if (job.sub) {
            job.sub.count = job.offs?.length ?? 0;
            job.sub.ok = (job.offs?.length ?? 0) > 0;
          }
        });
        jobOffs.push(off);
      }

      job.offs = jobOffs;
      if (job.sub) {
        job.sub.count = jobOffs.length;
        job.sub.ok = jobOffs.length > 0;
      }
      for (const f of jobOffs) offsAll.push(f);
    }
    const handle = new ListenerSubscription(() => {
      for (const job of jobs) {
        if (!job.offs) continue;

        for (const f of [...job.offs]) f();

        job.offs = null;

        if (job.sub) {
          job.sub.count = 0;
          job.sub.ok = false;
        }
      }
    });
    handle.count = offsAll.length;
    handle.ok = offsAll.length > 0;

    return handle;
  };
  let api: ListenerBuilder;
  // NEW: internal helper: allow string event types for custom events without
  // weakening the typed `on<K extends keyof ElemMap>()`.
  const onAny = <E extends Event>(type: string, handler: (ev: E) => void): ListenerSub => {
    // NOTE: this is the same as `on`, but without keyof ElemMap constraint.
    return on(type as keyof ElemMap, handler as (ev: any) => void);
    // we deliberately reuse `on(...)` so queue/attach logic stays 1-source-of-truth.
  };

  // add convenience wrappers so api satisfies ListenerBuilder
  api = {
    on,

    // target selection
    get document() {
      opts.target = "document";
      return api;
    },

    get window() {
      opts.target = "window";
      return api;
    },

    get element() {
      opts.target = undefined;
      return api;
    },

    // Form / input
    onInput: (fn) => on("input", (ev) => fn(ev as InputEvent)),
    onChange: (fn) => on("change", (ev) => fn(ev as Event)),
    onSubmit: (fn) => on("submit", (ev) => fn(ev as SubmitEvent)),

    // Mouse
    onClick: (fn) => on("click", (ev) => fn(ev as MouseEvent)),

    onDblClick: (fn) => on("dblclick", (ev) => fn(ev as MouseEvent)),

    onContextMenu: (fn) => on("contextmenu", (ev) => fn(ev as MouseEvent)),
    onMouseMove: (fn) => on("mousemove", (ev) => fn(ev as MouseEvent)),
    onMouseDown: (fn) => on("mousedown", (ev) => fn(ev as MouseEvent)),
    onMouseUp: (fn) => on("mouseup", (ev) => fn(ev as MouseEvent)),
    // (non-bubbling)
    onMouseEnter: (fn) => on("mouseenter", (ev) => fn(ev as MouseEvent)),
    // ( non-bubbling)
    onMouseLeave: (fn) => on("mouseleave", (ev) => fn(ev as MouseEvent)),

    // Pointer
    onPointerDown: (fn) => on("pointerdown", (ev) => fn(ev as PointerEvent)),
    onPointerMove: (fn) => on("pointermove", (ev) => fn(ev as PointerEvent)),
    onPointerUp: (fn) => on("pointerup", (ev) => fn(ev as PointerEvent)),

    onPointerEnter: (fn) => on("pointerenter", (ev) => fn(ev as PointerEvent)),

    onPointerLeave: (fn) => on("pointerleave", (ev) => fn(ev as PointerEvent)),

    onPointerCancel: (fn) => on("pointercancel", (ev) => fn(ev as PointerEvent)),

    // Touch
    onTouchStart: (fn) => on("touchstart", (ev) => fn(ev as TouchEvent)),
    onTouchMove: (fn) => on("touchmove", (ev) => fn(ev as TouchEvent)),
    onTouchEnd: (fn) => on("touchend", (ev) => fn(ev as TouchEvent)),
    onTouchCancel: (fn) => on("touchcancel", (ev) => fn(ev as TouchEvent)),

    // Wheel / scroll 
    onWheel: (fn) => on("wheel", (ev) => fn(ev as WheelEvent)),
    onScroll: (fn) => on("scroll", (ev) => fn(ev as Event)),

    // Focus
    // (non-bubbling)
    onFocus: (fn) => on("focus", (ev) => fn(ev as FocusEvent)),
    // (non-bubbling)
    onBlur: (fn) => on("blur", (ev) => fn(ev as FocusEvent)),
    onFocusIn: (fn) => on("focusin", (ev) => fn(ev as FocusEvent)),
    onFocusOut: (fn) => on("focusout", (ev) => fn(ev as FocusEvent)),

    // Keyboard
    onKeyDown: (fn) => on("keydown", (ev) => fn(ev as KeyboardEvent)),
    onKeyUp: (fn) => on("keyup", (ev) => fn(ev as KeyboardEvent)),

    // Drag & drop 
    onDragStart: (fn) => on("dragstart", (ev) => fn(ev as DragEvent)),
    onDragOver: (fn) => on("dragover", (ev) => fn(ev as DragEvent)),
    onDrop: (fn) => on("drop", (ev) => fn(ev as DragEvent)),
    onDragEnd: (fn) => on("dragend", (ev) => fn(ev as DragEvent)),

    // Animation lifecycle 
    onAnimationStart: (fn) => on("animationstart", (ev) => fn(ev as AnimationEvent)),
    onAnimationIteration: (fn) => on("animationiteration", (ev) => fn(ev as AnimationEvent)),
    onAnimationEnd: (fn) => on("animationend", (ev) => fn(ev as AnimationEvent)),
    onAnimationCancel: (fn) => on("animationcancel", (ev) => fn(ev as AnimationEvent)),

    // Transition lifecycle 
    onTransitionStart: (fn) => on("transitionstart", (ev) => fn(ev as TransitionEvent)),
    onTransitionEnd: (fn) => on("transitionend", (ev) => fn(ev as TransitionEvent)),
    onTransitionCancel: (fn) => on("transitioncancel", (ev) => fn(ev as TransitionEvent)),
    onTransitionRun: (fn) => on("transitionrun", (ev) => fn(ev as TransitionEvent)),

    // Clipboard
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

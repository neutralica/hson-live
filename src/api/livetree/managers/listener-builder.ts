// listener-builder.ts

import { ListenerBuilder, ListenOpts, MissingPolicy, ListenerSub, ElemMap } from "../../../types/listen.types.js";
import { LiveTree } from "../livetree.js";
import { own_disposable_for_owner } from "./lifecycle-registry.js";
import { runtime_for_tree } from "../runtime/livetree-runtime.js";


type RegistrationConfig = Readonly<{
  opts: Readonly<ListenOpts>;
  missingPolicy: MissingPolicy;
  preventDefault: boolean;
  stopPropagation: boolean;
  stopImmediatePropagation: boolean;
}>;

const TARGET_LISTENER_REG = new WeakMap<EventTarget, Set<() => void>>();

function is_event_target(value: unknown): value is EventTarget {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { addEventListener?: unknown; removeEventListener?: unknown };
  return typeof candidate.addEventListener === "function"
    && typeof candidate.removeEventListener === "function";
}

class ListenerSubscription implements ListenerSub {
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
  tree: LiveTree,
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
  }, "listener", runtime_for_tree(tree));

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
  let opts: ListenOpts = {};
  let missingPolicy: MissingPolicy = "warn";
  let _prevent = false;
  let _stop = false;
  let _stopImmediate = false;

  const takeRegistrationConfig = (): RegistrationConfig => {
    // Snapshot all registration behavior, then retire it before resolution can fail.
    const config: RegistrationConfig = Object.freeze({
      opts: Object.freeze({ ...opts }),
      missingPolicy,
      preventDefault: _prevent,
      stopPropagation: _stop,
      stopImmediatePropagation: _stopImmediate,
    });
    opts = {};
    missingPolicy = "warn";
    _prevent = false;
    _stop = false;
    _stopImmediate = false;
    return config;
  };

  const resolveAmbientTarget = (target: ListenOpts["target"]): EventTarget | null => {
    try {
      const mappedElement = tree.dom.el();
      const ownerDocument = mappedElement?.ownerDocument;
      if (target === "window") {
        if (ownerDocument !== undefined) return ownerDocument.defaultView;
        return typeof window !== "undefined" ? window : null;
      }

      if (target === "document") {
        if (ownerDocument !== undefined) return ownerDocument;
        return typeof document !== "undefined" ? document : null;
      }

      return null;
    } catch {
      return null;
    }
  };

  const collectTargets = (target: ListenOpts["target"]): EventTarget[] => {
    if (target === "window" || target === "document") {
      const tgt = resolveAmbientTarget(target);
      return tgt ? [tgt] : [];
    }

    const el = tree.dom.el();
    return el ? [el] : [];
  };

  const on = <K extends keyof ElemMap>(
    type: K,
    handler: (ev: ElemMap[K]) => void
  ): ListenerSub => {
    const config = takeRegistrationConfig();
    const wrapped: EventListener = (ev: Event) => {
      if (config.stopImmediatePropagation) ev.stopImmediatePropagation();
      if (config.stopPropagation) ev.stopPropagation();
      if (config.preventDefault && !config.opts.passive) ev.preventDefault();

      handler(ev as ElemMap[K]);
    };

    const targets = collectTargets(config.opts.target);

    for (const tgt of targets) {
      if (!is_event_target(tgt)) {
        throw new Error("listen.attach(): non-EventTarget in selection");
      }
    }

    if (targets.length === 0) {
      const msg = `listen.attach(): no targets in selection`;
      if (config.missingPolicy === "throw") throw new Error(msg);
      if (config.missingPolicy === "warn") console.warn(msg, { tree });
      return new ListenerSubscription(() => undefined);
    }

    const aelo: AddEventListenerOptions = Object.freeze({
      capture: !!config.opts.capture,
      once: !!config.opts.once,
      passive: !!config.opts.passive,
    });
    const offs: Array<() => void> = [];
    const sub = new ListenerSubscription(() => {
      for (const off of [...offs]) off();
      offs.length = 0;
    });

    try {
      for (const tgt of targets) {
        let off: () => void = () => undefined;
        off = addWithOff(tgt, String(type), wrapped, aelo, tree.quid, tree, () => {
          const index = offs.indexOf(off);
          if (index >= 0) offs.splice(index, 1);
        });
        offs.push(off);
      }
    } catch (error) {
      sub.off();
      throw error;
    }

    return sub;
  };
  let api: ListenerBuilder;

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

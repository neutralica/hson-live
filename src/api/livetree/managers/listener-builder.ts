import { listener_conveniences } from "../../../internal/listener-conveniences.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";
import { assert_mutation_publication_available } from "../lifecycle/mutation-publication.js";
// listener-builder.ts

import { ListenerBuilder, ListenOpts, MissingPolicy, ListenerSub, ElemMap } from "../../../types/listen.types.js";
import type { HsonNode } from "../../../core/types.js";
import type { InteractionListener } from "../../../types/interaction.descriptor.types.js";
import type { LiveTree } from "../livetree.js";
import { parse_livetree_authored_event } from "../livetree.actions.js";
import { assert_livetree_node_active, is_livetree_node_disposed } from "../livetree-state.js";
import { disposable_add_for_subject, disposable_remove_for_subject, type DocumentListenerBinding, type LifecycleOwner } from "./lifecycle-registry.js";
import {
  type LiveTreeRuntime,
  runtime_for_tree,
  active_subject_for_tree,
} from "../runtime/livetree-runtime.js";


export type NativeListenerSubject = LiveTree | DocumentListenerBinding;
export function is_document_listener_binding(subject: NativeListenerSubject): subject is DocumentListenerBinding {
  return "kind" in subject && subject.kind === "document";
}
function listener_owner(subject: NativeListenerSubject): LifecycleOwner {
  return is_document_listener_binding(subject) ? subject : active_subject_for_tree(subject);
}
function assert_listener_owner(owner: LifecycleOwner): void {
  if ("kind" in owner) owner.assertActive();
  else assert_livetree_node_active(owner, "install listener");
}
function assert_listener_subject(subject: NativeListenerSubject): void {
  if (is_document_listener_binding(subject)) subject.assertActive();
  else assert_mutation_publication_available(active_subject_for_tree(subject));
}

type RegistrationConfig = Readonly<{
  opts: Readonly<ListenOpts>;
  missingPolicy: MissingPolicy;
  preventDefault: boolean;
  stopPropagation: boolean;
  stopImmediatePropagation: boolean;
  actionOwner?: HsonNode;
  onNativeOnce?: () => void;
}>;

const TARGET_LISTENER_REG = new WeakMap<EventTarget, Set<() => void>>();
type NativeListenerRelease = {
  type: string;
  detached: boolean;
  retired: boolean;
  remove: () => void;
  restore: () => void;
};
const NATIVE_RELEASE_FOR_OFF = new WeakMap<() => void, NativeListenerRelease>();

/** Stage native release before terminal acceptance. Rollback restores active
 * registrations. A target that removes and then throws can change their order:
 * EventTarget can re-add a listener only at the end of its listener list. @internal */
export function prepare_native_listener_release(nodes: readonly HsonNode[], runtime: LiveTreeRuntime): () => void {
  // An authored listener can be indexed by both its subject and its action owner.
  const disposers = new Set(nodes.flatMap(node => [...(runtime.ownerDisposables.get(node) ?? [])]));
  const releases = [...disposers]
    .flatMap(off => { const release = NATIVE_RELEASE_FOR_OFF.get(off); return release && !release.detached ? [release] : []; });
  const completed = new Set<NativeListenerRelease>();
  const restore = (): void => { for (const release of completed) release.restore(); completed.clear(); };
  try { for (const release of releases) { completed.add(release); release.remove(); } }
  catch (cause) { restore(); throw cause; }
  return restore;
}

function is_event_target(value: unknown): value is EventTarget {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { addEventListener?: unknown; removeEventListener?: unknown };
  return typeof candidate.addEventListener === "function"
    && typeof candidate.removeEventListener === "function";
}

/** Discover the realm from actual realization mappings, including a synthetic graph root. */
export function realized_document_for_listener(tree: LiveTree): Document | undefined {
  for (const node of collect_subtree_nodes(active_subject_for_tree(tree))) {
    const element = get_el_for_node(node);
    if (element !== undefined) return element.ownerDocument;
  }
  return undefined;
}

/** Resolve the exact targets selected by one normalized listener target. @internal */
export function resolve_livetree_listener_targets_internal(
  tree: NativeListenerSubject,
  target: ListenOpts["target"],
): readonly EventTarget[] {
  if (is_document_listener_binding(tree)) {
    tree.assertActive();
    if (target === "element") throw new TypeError("A Document interaction subject cannot use element listener placement.");
    const nativeTarget = target === "window" ? tree.document?.defaultView : tree.document;
    return nativeTarget === null || nativeTarget === undefined ? [] : [nativeTarget];
  }
  if (target === "window" || target === "document") {
    try {
      const mappedElement = tree.dom.el();
      const ownerDocument = mappedElement?.ownerDocument;
      const nativeTarget = target === "window" ? ownerDocument?.defaultView : ownerDocument;
      return nativeTarget === null || nativeTarget === undefined ? [] : [nativeTarget];
    } catch { return []; }
  }
  const element = tree.dom.el();
  return element === null || element === undefined ? [] : [element];
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
  owner: LifecycleOwner,
  tree: NativeListenerSubject,
  owningListeners: Set<() => void> | undefined,
  onOff: (release: () => void) => void,
  actionOwner?: HsonNode,
  onNativeOnce?: () => void,
): (() => void) | undefined {
  const runtime = is_document_listener_binding(tree) ? tree.runtime : runtime_for_tree(tree);
  const additionalOwner = actionOwner === owner ? undefined : actionOwner;
  const bindingListeners = "kind" in owner ? owner.listeners : undefined;
  // A failed install has no subscription to retry. Clear retired wrappers for
  // this target and event before adding another one.
  for (const off of [...(TARGET_LISTENER_REG.get(target) ?? [])]) {
    const release = NATIVE_RELEASE_FOR_OFF.get(off);
    if (release?.retired && release.type === type) {
      off();
      if (NATIVE_RELEASE_FOR_OFF.has(off)) throw new Error("LiveTree native listener removal is already in progress.");
    }
  }

  const addNative = target.addEventListener.bind(target);
  let installing = true;
  let removing = false;
  let released = false;
  const nativeHandler: EventListener = (event) => {
    if (opts.once) {
      // Native once removes the wrapper before invoking it.
      nativeRelease.detached = true;
      onNativeOnce?.();
    }
    if (nativeRelease.retired || (installing && actionOwner !== undefined)) return;
    try {
      handler(event);
    } finally {
      if (opts.once && !installing) off();
    }
  };

  const nativeRelease: NativeListenerRelease = {
    type,
    detached: false,
    retired: false,
    remove() {
      if (nativeRelease.detached) return;
      if (removing) throw new Error("LiveTree native listener removal is already in progress.");
      removing = true;
      try {
        target.removeEventListener(type, nativeHandler, opts);
        nativeRelease.detached = true;
      } finally { removing = false; }
    },
    restore() {
      if (nativeRelease.retired) return;
      nativeRelease.detached = false;
      addNative(type, nativeHandler, opts);
    },
  };
  const off = (): void => {
    nativeRelease.retired = true;
    if (released || removing) return;
    // Keep every cleanup entry until native removal has completed.
    nativeRelease.remove();
    released = true;
    disposable_remove_for_subject(owner, off, runtime);
    if (additionalOwner !== undefined) disposable_remove_for_subject(additionalOwner, off, runtime);
    NATIVE_RELEASE_FOR_OFF.delete(off);
    const set = TARGET_LISTENER_REG.get(target);
    set?.delete(off);
    if (set?.size === 0) TARGET_LISTENER_REG.delete(target);
    bindingListeners?.delete(off);
    owningListeners?.delete(off);
    onOff(off);
  };
  const track = (): void => {
    let set = TARGET_LISTENER_REG.get(target);
    if (!set) { set = new Set(); TARGET_LISTENER_REG.set(target, set); }
    set.add(off);
    NATIVE_RELEASE_FOR_OFF.set(off, nativeRelease);
    if ("kind" in owner || !is_livetree_node_disposed(owner)) disposable_add_for_subject(owner, off, "listener", runtime);
    if (additionalOwner !== undefined && !is_livetree_node_disposed(additionalOwner)) {
      disposable_add_for_subject(additionalOwner, off, "listener", runtime);
    }
    bindingListeners?.add(off);
    owningListeners?.add(off);
  };

  try {
    addNative(type, nativeHandler, opts);
    assert_listener_owner(owner);
    if (actionOwner !== undefined) {
      assert_livetree_node_active(actionOwner, "install authored listener");
      if (nativeRelease.detached) throw new Error("Authored once listener was consumed during native installation.");
    }
  } catch (cause) {
    try { off(); }
    catch {
      // Native rollback may reenter teardown. Publish the same pending release
      // to both owners even if installation could not return a subscription.
      track();
    }
    throw cause;
  } finally { installing = false; }
  if (nativeRelease.detached) return undefined;
  track();
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
}

export function _listeners_debug_hard_reset(): void {
  if (typeof document !== "undefined") {
    _listeners_off_for_target(document);
  }

  if (typeof window !== "undefined") {
    _listeners_off_for_target(window);
  }
}

/** Authored and canonical listeners use the same normalized native registration. @internal */
export function install_livetree_listener(
  tree: NativeListenerSubject, listener: InteractionListener, handler: EventListener,
  { actionOwner, owningListeners, onNativeOnce }: {
    actionOwner?: HsonNode;
    owningListeners?: Set<() => void>;
    onNativeOnce?: () => void;
  } = {},
): ListenerSub {
  assert_listener_subject(tree);
  if (actionOwner !== undefined) assert_livetree_node_active(actionOwner, "install authored listener");
  return attachListener(tree, listener.event, handler, {
    opts: listener,
    missingPolicy: listener.missingTarget,
    preventDefault: listener.preventDefault,
    stopPropagation: listener.stopPropagation,
    stopImmediatePropagation: listener.stopImmediatePropagation,
    actionOwner,
    onNativeOnce,
  }, owningListeners);
}

function attachListener(
  tree: NativeListenerSubject, type: string, handler: EventListener, config: RegistrationConfig, owningListeners?: Set<() => void>,
): ListenerSub {
  const wrapped: EventListener = event => {
    if (config.stopImmediatePropagation) event.stopImmediatePropagation();
    if (config.stopPropagation) event.stopPropagation();
    if (config.preventDefault) event.preventDefault();
    handler(event);
  };

  const targets = resolve_livetree_listener_targets_internal(tree, config.opts.target);
  for (const target of targets) {
    if (!is_event_target(target)) throw new Error("listen.attach(): non-EventTarget in selection");
  }
  if (targets.length === 0) {
    const message = "listen.attach(): no targets in selection";
    const missingPolicy = config.missingPolicy;
    if (missingPolicy === "throw") throw new Error(message);
    if (missingPolicy === "warn") console.warn(message, { tree });
    return new ListenerSubscription(() => undefined);
  }

  const options: AddEventListenerOptions = Object.freeze({
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
    for (const target of targets) {
      const off = addWithOff(target, String(type), wrapped, options, listener_owner(tree), tree, owningListeners, release => {
        const index = offs.indexOf(release);
        if (index >= 0) offs.splice(index, 1);
      }, config.actionOwner, config.onNativeOnce);
      if (off !== undefined) offs.push(off);
    }
  } catch (error) {
    try { sub.off(); }
    catch { /* Preserve the installation failure. Pending removal is still tracked. */ }
    throw error;
  }
  return sub;
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
 * Ambient `document` and `window` listeners follow the exact realized subject
 * so cleanup never demands canonical QUID identity.
 *
 * @param tree - The owning `LiveTree`.
 * @param owningListeners - Optional binding scope that shares the native release functions.
 * @returns A fluent listener-registration surface.
 */
export function build_listener(tree: NativeListenerSubject, owningListeners: Set<() => void> | undefined = undefined): ListenerBuilder {
  let opts: ListenOpts = {};
  let missingPolicy: MissingPolicy = "warn";
  let hasMissingPolicy = false;
  let stops: Partial<Pick<RegistrationConfig, "preventDefault" | "stopPropagation" | "stopImmediatePropagation">> = {};

  const reset = (): void => {
    opts = {};
    missingPolicy = "warn";
    hasMissingPolicy = false;
    stops = {};
  };

  const takeRegistrationConfig = (): RegistrationConfig => {
    // Snapshot all registration behavior, then retire it before resolution can fail.
    const config: RegistrationConfig = Object.freeze({
      opts: Object.freeze({ ...opts }),
      missingPolicy,
      preventDefault: stops.preventDefault ?? false,
      stopPropagation: stops.stopPropagation ?? false,
      stopImmediatePropagation: stops.stopImmediatePropagation ?? false,
    });
    reset();
    return config;
  };

  const on = <K extends keyof ElemMap>(
    type: K,
    handler: (ev: ElemMap[K]) => void
  ): ListenerSub => {
    assert_listener_subject(tree);
    const config = takeRegistrationConfig();
    return attachListener(tree, type, event => handler(event as ElemMap[K]), config, owningListeners);
  };
  const onCustom = <E extends Event = Event>(type: string, handler: (ev: E) => void): ListenerSub =>
    on(type as unknown as keyof ElemMap, handler as unknown as (ev: Event) => void);
  let api: ListenerBuilder;

  api = {
    on,
    event(source) {
      const hasPending = Object.keys(opts).length !== 0 || hasMissingPolicy || Object.keys(stops).length !== 0;
      reset();
      if (hasPending) throw new TypeError("listen.event() cannot combine fluent listener options with an authored declaration.");
      if (is_document_listener_binding(tree)) throw new TypeError("Document authored Events require canonical admission.");
      const { listener, bind } = parse_livetree_authored_event(source);
      const { actionOwner, handler } = bind(tree);
      return install_livetree_listener(tree, listener, handler, { actionOwner, owningListeners });
    },

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

    ...listener_conveniences(onCustom),

    // Custom events / escape hatches
    onCustom,
    onCustomDetail: <D>(type: string, handler: (ev: CustomEvent<D>) => void) => {
      return api.onCustom<CustomEvent<D>>(type, handler);
    },

    // options chain (unchanged)
    once: () => { opts = { ...opts, once: true }; return api; },
    passive: () => { opts = { ...opts, passive: true }; return api; },
    capture: () => { opts = { ...opts, capture: true }; return api; },
    toWindow: () => { opts = { ...opts, target: "window" }; return api; },
    toDocument: () => { opts = { ...opts, target: "document" }; return api; },

    strict(policy: MissingPolicy = "warn") { missingPolicy = policy; hasMissingPolicy = true; return api; },

    preventDefault(): ListenerBuilder { stops = { ...stops, preventDefault: true }; return api; },
    stopProp(): ListenerBuilder { stops = { ...stops, stopPropagation: true }; return api; },
    stopImmediateProp(): ListenerBuilder { stops = { ...stops, stopImmediatePropagation: true }; return api; },
    stopAll(): ListenerBuilder { stops = { stopImmediatePropagation: true, stopPropagation: true, preventDefault: true }; return api; },
    clearStops(): ListenerBuilder { stops = { stopImmediatePropagation: false, stopPropagation: false, preventDefault: false }; return api; },
  };

  return api;
}

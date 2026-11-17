// listen.types.ts

import type { NativeListenerOptions, NativeListenerSub } from "./native-listener.types.js";
export type { MissingPolicy } from "./native-listener.types.js";

/**************************************************************
 * Typed alias for DOM event mapping on `HTMLElement`.
 *
 * This mirrors `HTMLElementEventMap` from the DOM lib so the
 * listener API can:
 *   - offer strongly-typed `ev` objects per event type
 *   - constrain `on<K>()` calls to real event names only
 *
 * All higher-level listener helpers (onClick, onKeyDown, etc.)
 * are defined in terms of this underlying map.
 **************************************************************/
export type ElemMap = HTMLElementEventMap;

/**
 * Typed handler signature for `CustomEvent` payloads.
 */
export type CustomEventHandler<D = unknown> = (ev: CustomEvent<D>) => void;

/**************************************************************
 * Per-listener configuration options.
 *
 * These flags mirror native `addEventListener` options, plus
 * a `target` selector that steers *where* the listener attaches:
 *
 *   - `capture`  → use capture phase instead of bubble
 *   - `once`     → auto-remove after the first event fires
 *   - `passive`  → hint that the handler never calls preventDefault
 *   - `target`   → which EventTarget to bind:
 *                    • "element"  (default) → the bound DOM element
 *                    • "window"            → global window
 *                    • "document"          → global document
 *
 * The builder snapshots these options when the listener is
 * attached, so later mutations do not retroactively affect
 * already-registered handlers.
 **************************************************************/
export type ListenOpts = {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  target?: "element" | "window" | "document";
};

/** Idempotently remove the native registration from its event target. */
export interface ListenerSub extends NativeListenerSub {}

export interface ListenerBuilder extends NativeListenerOptions<ListenerBuilder> {
  on<K extends keyof ElemMap>(type: K, handler: (ev: ElemMap[K]) => void): ListenerSub;
  /** Attach one authored Hson click declaration using a registered local action. */
  event(source: string): ListenerSub;

  // Form / input
  onInput(fn: (ev: InputEvent) => void): ListenerSub;
  onChange(fn: (ev: Event) => void): ListenerSub;
  onSubmit(fn: (ev: SubmitEvent) => void): ListenerSub;

  // Mouse
  onClick(fn: (ev: MouseEvent) => void): ListenerSub;
  onDblClick(fn: (ev: MouseEvent) => void): ListenerSub;
  onContextMenu(fn: (ev: MouseEvent) => void): ListenerSub;
  onMouseMove(fn: (ev: MouseEvent) => void): ListenerSub;
  onMouseDown(fn: (ev: MouseEvent) => void): ListenerSub;
  onMouseUp(fn: (ev: MouseEvent) => void): ListenerSub;
  onMouseEnter(fn: (ev: MouseEvent) => void): ListenerSub;
  onMouseLeave(fn: (ev: MouseEvent) => void): ListenerSub;

  // Pointer (preferred modern input)
  onPointerDown(fn: (ev: PointerEvent) => void): ListenerSub;
  onPointerMove(fn: (ev: PointerEvent) => void): ListenerSub;
  onPointerUp(fn: (ev: PointerEvent) => void): ListenerSub;
  onPointerEnter(fn: (ev: PointerEvent) => void): ListenerSub;
  onPointerLeave(fn: (ev: PointerEvent) => void): ListenerSub;
  onPointerCancel(fn: (ev: PointerEvent) => void): ListenerSub;

  // Touch (optional; pointer events often cover it, but nice to have)
  onTouchStart(fn: (ev: TouchEvent) => void): ListenerSub;
  onTouchMove(fn: (ev: TouchEvent) => void): ListenerSub;
  onTouchEnd(fn: (ev: TouchEvent) => void): ListenerSub;
  onTouchCancel(fn: (ev: TouchEvent) => void): ListenerSub;

  // Wheel / scroll
  onWheel(fn: (ev: WheelEvent) => void): ListenerSub;
  onScroll(fn: (ev: Event) => void): ListenerSub;

  // Keyboard
  onKeyDown(fn: (ev: KeyboardEvent) => void): ListenerSub;
  onKeyUp(fn: (ev: KeyboardEvent) => void): ListenerSub;

  // Focus
  onFocus(fn: (ev: FocusEvent) => void): ListenerSub;
  onBlur(fn: (ev: FocusEvent) => void): ListenerSub;
  onFocusIn(fn: (ev: FocusEvent) => void): ListenerSub;
  onFocusOut(fn: (ev: FocusEvent) => void): ListenerSub;

  // Drag & drop (very commonly needed unexpectedly)
  onDragStart(fn: (ev: DragEvent) => void): ListenerSub;
  onDragOver(fn: (ev: DragEvent) => void): ListenerSub;
  onDrop(fn: (ev: DragEvent) => void): ListenerSub;
  onDragEnd(fn: (ev: DragEvent) => void): ListenerSub;

  // CSS animation lifecycle
  onAnimationStart(fn: (ev: AnimationEvent) => void): ListenerSub;
  onAnimationIteration(fn: (ev: AnimationEvent) => void): ListenerSub;
  onAnimationEnd(fn: (ev: AnimationEvent) => void): ListenerSub;
  onAnimationCancel(fn: (ev: AnimationEvent) => void): ListenerSub;

  // CSS transition lifecycle (pairs well with animation; comes up a lot)
  onTransitionStart(fn: (ev: TransitionEvent) => void): ListenerSub;
  onTransitionEnd(fn: (ev: TransitionEvent) => void): ListenerSub;
  onTransitionCancel(fn: (ev: TransitionEvent) => void): ListenerSub;
  onTransitionRun(fn: (ev: TransitionEvent) => void): ListenerSub;

  // Clipboard (surprisingly common in apps)
  onCopy(fn: (ev: ClipboardEvent) => void): ListenerSub;
  onCut(fn: (ev: ClipboardEvent) => void): ListenerSub;
  onPaste(fn: (ev: ClipboardEvent) => void): ListenerSub;

  // Custom events / escape hatches
  onCustom<E extends Event = Event>(type: string, handler: (ev: E) => void): ListenerSub;
  onCustomDetail<D>(type: string, handler: (ev: CustomEvent<D>) => void): ListenerSub;
}

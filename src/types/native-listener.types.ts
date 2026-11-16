/** The shared shape of a native listener subscription. */
export interface NativeListenerSub {
  off(): void;
}

/** Policy for a native builder whose configured event target is missing. */
export type MissingPolicy = "ignore" | "warn" | "throw";

export interface NativeListenerOptions<TBuilder> {
  document: TBuilder;
  window: TBuilder;
  element: TBuilder;
  once(): TBuilder;
  passive(): TBuilder;
  capture(): TBuilder;
  toWindow(): TBuilder;
  toDocument(): TBuilder;
  strict(policy?: MissingPolicy): TBuilder;
  preventDefault(): TBuilder;
  stopProp(): TBuilder;
  stopImmediateProp(): TBuilder;
  stopAll(): TBuilder;
  clearStops(): TBuilder;
}

type NativeEventOf<TName extends string> = typeof globalThis extends { [K in TName]: { prototype: infer TEvent } } ? TEvent : unknown;
type NativeEvent = NativeEventOf<"Event">;
type NativeCustomEvent<D> = Omit<NativeEventOf<"CustomEvent">, "detail"> & Readonly<{ detail: D }>;
/** Derive browser event properties without importing ambient DOM declarations into portable entrypoints. */
type NativeElementEvents = typeof globalThis extends { HTMLElement: { prototype: infer TElement } }
  ? { [K in keyof TElement as K extends `on${infer Name}` ? Name : never]:
      NonNullable<TElement[K]> extends (this: infer _This, event: infer E) => unknown ? E : NativeEvent }
  : Record<string, unknown>;

/** Browser-local callbacks on the current realization of a Document subject. */
export interface DocumentCallbackListener extends NativeListenerOptions<DocumentCallbackListener> {
  on<K extends keyof NativeElementEvents>(type: K, handler: (event: NativeElementEvents[K]) => void): NativeListenerSub;
  // Form / input
  onInput(fn: (ev: NativeEventOf<"InputEvent">) => void): NativeListenerSub;
  onChange(fn: (ev: NativeEventOf<"Event">) => void): NativeListenerSub;
  onSubmit(fn: (ev: NativeEventOf<"SubmitEvent">) => void): NativeListenerSub;

  // Mouse
  onClick(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;
  onDblClick(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;
  onContextMenu(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;
  onMouseMove(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;
  onMouseDown(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;
  onMouseUp(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;
  onMouseEnter(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;
  onMouseLeave(fn: (ev: NativeEventOf<"MouseEvent">) => void): NativeListenerSub;

  // Pointer (preferred modern input)
  onPointerDown(fn: (ev: NativeEventOf<"PointerEvent">) => void): NativeListenerSub;
  onPointerMove(fn: (ev: NativeEventOf<"PointerEvent">) => void): NativeListenerSub;
  onPointerUp(fn: (ev: NativeEventOf<"PointerEvent">) => void): NativeListenerSub;
  onPointerEnter(fn: (ev: NativeEventOf<"PointerEvent">) => void): NativeListenerSub;
  onPointerLeave(fn: (ev: NativeEventOf<"PointerEvent">) => void): NativeListenerSub;
  onPointerCancel(fn: (ev: NativeEventOf<"PointerEvent">) => void): NativeListenerSub;

  // Touch (optional; pointer events often cover it, but nice to have)
  onTouchStart(fn: (ev: NativeEventOf<"TouchEvent">) => void): NativeListenerSub;
  onTouchMove(fn: (ev: NativeEventOf<"TouchEvent">) => void): NativeListenerSub;
  onTouchEnd(fn: (ev: NativeEventOf<"TouchEvent">) => void): NativeListenerSub;
  onTouchCancel(fn: (ev: NativeEventOf<"TouchEvent">) => void): NativeListenerSub;

  // Wheel / scroll
  onWheel(fn: (ev: NativeEventOf<"WheelEvent">) => void): NativeListenerSub;
  onScroll(fn: (ev: NativeEventOf<"Event">) => void): NativeListenerSub;

  // Keyboard
  onKeyDown(fn: (ev: NativeEventOf<"KeyboardEvent">) => void): NativeListenerSub;
  onKeyUp(fn: (ev: NativeEventOf<"KeyboardEvent">) => void): NativeListenerSub;

  // Focus
  onFocus(fn: (ev: NativeEventOf<"FocusEvent">) => void): NativeListenerSub;
  onBlur(fn: (ev: NativeEventOf<"FocusEvent">) => void): NativeListenerSub;
  onFocusIn(fn: (ev: NativeEventOf<"FocusEvent">) => void): NativeListenerSub;
  onFocusOut(fn: (ev: NativeEventOf<"FocusEvent">) => void): NativeListenerSub;

  // Drag & drop (very commonly needed unexpectedly)
  onDragStart(fn: (ev: NativeEventOf<"DragEvent">) => void): NativeListenerSub;
  onDragOver(fn: (ev: NativeEventOf<"DragEvent">) => void): NativeListenerSub;
  onDrop(fn: (ev: NativeEventOf<"DragEvent">) => void): NativeListenerSub;
  onDragEnd(fn: (ev: NativeEventOf<"DragEvent">) => void): NativeListenerSub;

  // CSS animation lifecycle
  onAnimationStart(fn: (ev: NativeEventOf<"AnimationEvent">) => void): NativeListenerSub;
  onAnimationIteration(fn: (ev: NativeEventOf<"AnimationEvent">) => void): NativeListenerSub;
  onAnimationEnd(fn: (ev: NativeEventOf<"AnimationEvent">) => void): NativeListenerSub;
  onAnimationCancel(fn: (ev: NativeEventOf<"AnimationEvent">) => void): NativeListenerSub;

  // CSS transition lifecycle (pairs well with animation; comes up a lot)
  onTransitionStart(fn: (ev: NativeEventOf<"TransitionEvent">) => void): NativeListenerSub;
  onTransitionEnd(fn: (ev: NativeEventOf<"TransitionEvent">) => void): NativeListenerSub;
  onTransitionCancel(fn: (ev: NativeEventOf<"TransitionEvent">) => void): NativeListenerSub;
  onTransitionRun(fn: (ev: NativeEventOf<"TransitionEvent">) => void): NativeListenerSub;

  // Clipboard (surprisingly common in apps)
  onCopy(fn: (ev: NativeEventOf<"ClipboardEvent">) => void): NativeListenerSub;
  onCut(fn: (ev: NativeEventOf<"ClipboardEvent">) => void): NativeListenerSub;
  onPaste(fn: (ev: NativeEventOf<"ClipboardEvent">) => void): NativeListenerSub;

  // Custom events / escape hatches
  onCustom<E extends NativeEventOf<"Event"> = NativeEventOf<"Event">>(type: string, handler: (ev: E) => void): NativeListenerSub;
  onCustomDetail<D>(type: string, handler: (ev: NativeCustomEvent<D>) => void): NativeListenerSub;
}

/** A Library supplies Document placement, with Window available explicitly. */
export interface DocumentLibraryCallbackListener extends Omit<DocumentCallbackListener, keyof NativeListenerOptions<unknown>>,
  Omit<NativeListenerOptions<DocumentLibraryCallbackListener>, "element" | "document"> {}

// listen.types.ts



// CHANGED: one canonical map for convenience methods -> DOM event name
const LISTEN_CONVENIENCE = {
  // Form
  onInput: "input",
  onChange: "change",
  onSubmit: "submit",

  // Mouse
  onClick: "click",
  onDblClick: "dblclick",
  onContextMenu: "contextmenu",
  onMouseMove: "mousemove",
  onMouseDown: "mousedown",
  onMouseUp: "mouseup",
  onMouseEnter: "mouseenter",
  onMouseLeave: "mouseleave",

  // Pointer
  onPointerDown: "pointerdown",
  onPointerMove: "pointermove",
  onPointerUp: "pointerup",
  onPointerEnter: "pointerenter",
  onPointerLeave: "pointerleave",
  onPointerCancel: "pointercancel",

  // Touch
  onTouchStart: "touchstart",
  onTouchMove: "touchmove",
  onTouchEnd: "touchend",
  onTouchCancel: "touchcancel",

  // Wheel / scroll
  onWheel: "wheel",
  onScroll: "scroll",

  // Keyboard
  onKeyDown: "keydown",
  onKeyUp: "keyup",

  // Focus
  onFocus: "focus",
  onBlur: "blur",
  onFocusIn: "focusin",
  onFocusOut: "focusout",

  // Drag & drop
  onDragStart: "dragstart",
  onDragOver: "dragover",
  onDrop: "drop",
  onDragEnd: "dragend",

  // Animation
  onAnimationStart: "animationstart",
  onAnimationIteration: "animationiteration",
  onAnimationEnd: "animationend",
  onAnimationCancel: "animationcancel",

  // Transition
  onTransitionStart: "transitionstart",
  onTransitionEnd: "transitionend",
  onTransitionCancel: "transitioncancel",
  onTransitionRun: "transitionrun",

  // Clipboard
  onCopy: "copy",
  onCut: "cut",
  onPaste: "paste",
} as const;

type ConvenienceName = keyof typeof LISTEN_CONVENIENCE;

export function attachConvenience(api: ListenerBuilder): ListenerBuilder {
  (Object.keys(LISTEN_CONVENIENCE) as ConvenienceName[]).forEach((name) => {
    const evt = LISTEN_CONVENIENCE[name];
    // @ts-expect-error - we’re assigning known keys dynamically
    api[name] = (fn: (ev: Event) => void) => api.onCustom(evt, fn);
  });
  return api;
}
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

// TODO - doc
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

/**************************************************************
 * Policy for how to react when the intended EventTarget cannot
 * be resolved at attach time.
 *
 *   - "ignore" → silently skip attachment; `ListenerSub.ok`
 *                will be false and `count` will remain 0.
 *   - "warn"   → log a console warning but continue running.
 *   - "throw"  → throw immediately, treating missing targets
 *                as a hard configuration error.
 *
 * Used by `.strict(...)` on the ListenerBuilder to control
 * how brittle or forgiving listener setup should be.
 **************************************************************/
export type MissingPolicy = "ignore" | "warn" | "throw";

/**************************************************************
 * Handle returned by `.attach()` (or auto-attach).
 *
 * Represents the concrete attachment(s) made from a builder:
 *
 *   - `off()`   → idempotently remove all underlying listeners
 *                 from their EventTargets.
 *   - `count`  → number of actual `addEventListener` calls that
 *                 succeeded (e.g., 0 if target was missing).
 *   - `ok`     → shorthand for `count > 0`, useful in tests and
 *                 for defensive runtime checks.
 *
 * This is the low-level, side-effectful counterpart to the
 * fluent ListenerBuilder configuration surface.
 **************************************************************/
export interface ListenerSub {
  off(): void;
  /** number of concrete EventTarget attachments performed */
  count: number;
  /** true iff count > 0 */
  ok: boolean;
}

// export interface ListenerBuilder {
// //   /*----- typed events */
// //   on<K extends keyof ElemMap>(type: K, handler: (ev: ElemMap[K]) => void): ListenerBuilder;
// //   onClick(h: (ev: MouseEvent) => void): ListenerBuilder;
// //   onMouseMove(h: (ev: MouseEvent) => void): ListenerBuilder;
// //   onMouseDown(h: (ev: MouseEvent) => void): ListenerBuilder;
// //   onMouseUp(h: (ev: MouseEvent) => void): ListenerBuilder;
// //   onKeyDown(h: (ev: KeyboardEvent) => void): ListenerBuilder;
// //   onKeyUp(h: (ev: KeyboardEvent) => void): ListenerBuilder;

// //   /*----- options */
// //   once(): ListenerBuilder;
// //   passive(): ListenerBuilder;
// //   capture(): ListenerBuilder;
// //   toWindow(): ListenerBuilder;
// //   toDocument(): ListenerBuilder;

// //   /*----- validation / scheduling */
// //   strict(policy?: MissingPolicy): ListenerBuilder; // default "warn"
// //   defer(): ListenerBuilder; // cancel auto-attach for manual attach()

// //   // may remove some day, seeing if this ubreaks something
// //  attach(): ListenerSub;
// //   /* Auto-attach will also return a handle. */
// //   preventDefault(): ListenerBuilder;
// //   stopProp(): ListenerBuilder;
// //   stopImmediateProp(): ListenerBuilder;
// //   stopAll(): ListenerBuilder;
// //   clearStops(): ListenerBuilder;
// }
export interface ListenerBuilder {
  on<K extends keyof ElemMap>(type: K, handler: (ev: ElemMap[K]) => void): ListenerSub;

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
  onMouseEnter(fn: (ev: MouseEvent) => void): ListenerSub;       // ADDED (non-bubbling but still useful)
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
  onDragStart(fn: (ev: DragEvent) => void): ListenerSub;         // ADDED
  onDragOver(fn: (ev: DragEvent) => void): ListenerSub;          // ADDED
  onDrop(fn: (ev: DragEvent) => void): ListenerSub;              // ADDED
  onDragEnd(fn: (ev: DragEvent) => void): ListenerSub;           // ADDED

  // CSS animation lifecycle
  onAnimationStart(fn: (ev: AnimationEvent) => void): ListenerSub;      // ADDED (typed)
  onAnimationIteration(fn: (ev: AnimationEvent) => void): ListenerSub;  // ADDED
  onAnimationEnd(fn: (ev: AnimationEvent) => void): ListenerSub;        // ADDED
  onAnimationCancel(fn: (ev: AnimationEvent) => void): ListenerSub;     // ADDED

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

  // option modifiers: these return a configured builder for the next registration
  once(): ListenerBuilder;
  passive(): ListenerBuilder;
  capture(): ListenerBuilder;
  toWindow(): ListenerBuilder;
  toDocument(): ListenerBuilder;

  strict(policy?: MissingPolicy): ListenerBuilder;

  preventDefault(): ListenerBuilder;
  stopProp(): ListenerBuilder;
  stopImmediateProp(): ListenerBuilder;
  stopAll(): ListenerBuilder;
  clearStops(): ListenerBuilder;
}
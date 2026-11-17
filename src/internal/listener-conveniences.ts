/** Shared convenience vocabulary; each adapter retains its own registration and ownership. */
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

// Callbacks are forwarded, never invoked here, so no ambient DOM types are needed.
type ListenerCallback = (event: never) => void;
type ListenerConveniences<Sub> = {
  [Name in keyof typeof LISTEN_CONVENIENCE]: (handler: ListenerCallback) => Sub;
};

export function listener_conveniences<Sub>(
  register: (event: string, handler: ListenerCallback) => Sub,
): ListenerConveniences<Sub> {
  // Object.fromEntries loses the exact keys supplied by this closed catalogue.
  return Object.fromEntries(Object.entries(LISTEN_CONVENIENCE).map(([name, event]) =>
    [name, (handler: ListenerCallback) => register(event, handler)],
  )) as ListenerConveniences<Sub>;
}

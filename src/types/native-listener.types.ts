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

type NativeMouseEvent = typeof globalThis extends { MouseEvent: { prototype: infer TEvent } } ? TEvent : unknown;

/** Browser-local callbacks on a selected Document element. */
export interface DocumentCallbackListener extends NativeListenerOptions<DocumentCallbackListener> {
  /** Attach to the current realization, or throw if the Document has no current realized subject. */
  onClick(callback: (event: NativeMouseEvent) => void): NativeListenerSub;
}

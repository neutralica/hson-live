import type { LocusDisposer } from "../../types/locus.types.js";

// Bridge the existing endpoint's terminal evidence to its resource owner.
const observers = new WeakMap<object, (listener: () => void) => LocusDisposer>();
export function register_echo_terminal_observer_internal(echo: object, observe: (listener: () => void) => LocusDisposer): void {
  observers.set(echo, observe);
}
export function observe_echo_terminal_internal(echo: object, listener: () => void): LocusDisposer {
  const observe = observers.get(echo);
  if (observe === undefined) throw new Error("Terminal observation requires an owned Echo replica.");
  return observe(listener);
}

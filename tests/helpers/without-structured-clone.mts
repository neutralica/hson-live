/** Synchronous, process-local simulation; always restore the original descriptor. */
export function without_structured_clone<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
  Object.defineProperty(globalThis, "structuredClone", { value: undefined, writable: true, configurable: true });
  try { return run(); }
  finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "structuredClone");
    else Object.defineProperty(globalThis, "structuredClone", descriptor);
  }
}

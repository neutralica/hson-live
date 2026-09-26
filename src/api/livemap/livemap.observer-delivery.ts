/** One bounded platform report for a failure after LiveMap state acceptance. */
export function report_livemap_observer_failure(phase: string, cause: unknown): void {
  const error = new Error(`LiveMap ${phase} observer failed after state acceptance.`, { cause });
  const reporter = (globalThis as typeof globalThis & {
    reportError?: (error: unknown) => void;
  }).reportError;
  if (typeof reporter === "function") {
    try {
      Reflect.apply(reporter, globalThis, [error]);
      return;
    } catch (reportingFailure) {
      queueMicrotask(() => { throw reportingFailure; });
      return;
    }
  }
  // `reportError` is the browser/runtime reporting seam. Older runtimes still
  // surface the failure as uncaught, but never through the accepted operation.
  queueMicrotask(() => { throw error; });
}

/** Snapshot, isolate, and fairly attempt one complete observer fan-out. */
export function deliver_livemap_observers<T>(
  observers: readonly T[],
  deliver: (observer: T) => void,
  phase: string,
): number {
  let failures = 0;
  for (const observer of [...observers]) {
    try {
      deliver(observer);
    } catch (cause) {
      failures += 1;
      report_livemap_observer_failure(phase, cause);
    }
  }
  return failures;
}

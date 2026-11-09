/** One bounded platform report for a failure after LiveMap state acceptance. */
export function report_livemap_observer_failure(phase: string, cause: unknown): void {
  let diagnostic: unknown = new Error(`LiveMap ${phase} observer failed after state acceptance.`, { cause });
  try {
    const reporter = (globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    }).reportError;
    if (typeof reporter === "function") {
      Reflect.apply(reporter, globalThis, [diagnostic]);
      return;
    }
  } catch (reportingFailure) {
    diagnostic = reportingFailure;
  }
  // An unavailable or failing reporter falls back to an uncaught diagnostic
  // outside the accepted operation.
  queueMicrotask(() => { throw diagnostic; });
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

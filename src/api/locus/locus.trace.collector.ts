import type {
  LiveTraceCollector,
  LiveTraceCollectorOptions,
  LiveTraceEvent,
} from "../../types/livehost.types.js";

/** Create bounded newest-event storage. Overflow evicts the oldest event. */
export function create_live_trace_collector(
  options: LiveTraceCollectorOptions,
): LiveTraceCollector {
  if (!Number.isInteger(options.capacity) || options.capacity <= 0) {
    throw new Error("Live trace collector capacity must be a positive finite integer.");
  }
  const retained: LiveTraceEvent[] = [];

  return Object.freeze({
    capacity: options.capacity,
    emit(event: LiveTraceEvent): void {
      retained.push(detach_event(event));
      if (retained.length > options.capacity) retained.splice(0, retained.length - options.capacity);
    },
    events: (): readonly LiveTraceEvent[] => Object.freeze([...retained]),
    clear(): void {
      retained.length = 0;
    },
  });
}

function detach_event(event: LiveTraceEvent): LiveTraceEvent {
  return Object.freeze({
    ...event,
    ...(event.details !== undefined
      ? {
        details: Object.freeze(Object.fromEntries(
          Object.entries(event.details).map(([key, value]) => [
            key,
            Array.isArray(value) ? Object.freeze([...value]) : value,
          ]),
        )),
      }
      : {}),
  });
}

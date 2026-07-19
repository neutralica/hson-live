import type {
  LiveTraceConsoleSinkOptions,
  LiveTraceDetailValue,
  LiveTraceEvent,
  LiveTraceSink,
} from "../../types/livehost.types.js";

const SAFE_TEXT_KEYS = new Set([
  "action",
  "delivery",
  "errorCode",
  "operationDomain",
  "operationKinds",
  "origin",
  "responseType",
]);

/** Explicitly opt-in compact console rendering with defensive detail summaries. */
export function create_live_trace_console_sink(
  options: LiveTraceConsoleSinkOptions = {},
): LiveTraceSink {
  const write = options.write ?? ((line: string) => console.log(line));
  return Object.freeze({
    emit(event: LiveTraceEvent): void {
      try {
        write(render_event(event));
      } catch {
        // Writer failures are diagnostic failures, never operation failures.
      }
    },
  });
}

function render_event(event: LiveTraceEvent): string {
  const duration = event.durationMs === undefined ? "" : ` ${event.durationMs.toFixed(1)}ms`;
  const details = summarize_details(event);
  return `[trace ${event.traceId} #${String(event.sequence).padStart(2, "0")}] ${event.subsystem} ${event.phase} ${event.status}${duration}${details}`;
}

function summarize_details(event: LiveTraceEvent): string {
  if (event.details === undefined) return "";
  const parts = Object.entries(event.details).map(([key, value]) => `${key}=${summarize_value(key, value)}`);
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function summarize_value(key: string, value: LiveTraceDetailValue): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return SAFE_TEXT_KEYS.has(key) ? value : `[text:${value.length}]`;
  return SAFE_TEXT_KEYS.has(key) ? value.map(String).join(",") : `[${value.length} items]`;
}

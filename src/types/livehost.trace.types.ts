// Generic tracing contracts; one-map payloads remain in their owning modules.

/** Initial, intentionally narrow subsystem vocabulary for local LiveHost tracing. */
export type LiveTraceSubsystem = "client" | "transport" | "livehost" | "livemap";

export type LiveTraceStatus = "event" | "begin" | "success" | "failure" | "skip";

/** Allowlisted scalar summaries only; trace details never carry domain objects. */
export type LiveTraceDetailValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

export type LiveTraceDetails = Readonly<Record<string, LiveTraceDetailValue>>;

/** One immutable observational event. Sequence is authoritative within a trace. */
export type LiveTraceEvent = Readonly<{
  traceId: string;
  sequence: number;
  subsystem: LiveTraceSubsystem;
  phase: string;
  status: LiveTraceStatus;
  timestamp: number;
  spanId?: string;
  parentSpanId?: string;
  durationMs?: number;
  details?: LiveTraceDetails;
}>;

/** Synchronous by design; LiveHost safely isolates every sink invocation. */
export type LiveTraceSink = Readonly<{
  emit: (event: LiveTraceEvent) => void;
}>;

export type LiveTraceCollectorOptions = Readonly<{
  capacity: number;
}>;

export type LiveTraceCollector = LiveTraceSink & Readonly<{
  capacity: number;
  events: () => readonly LiveTraceEvent[];
  clear: () => void;
}>;

export type LiveTraceConsoleWriter = (line: string) => void;

export type LiveTraceConsoleSinkOptions = Readonly<{
  write?: LiveTraceConsoleWriter;
}>;

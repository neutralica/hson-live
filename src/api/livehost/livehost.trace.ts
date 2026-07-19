import type {
  LiveTraceDetails,
  LiveTraceEvent,
  LiveTraceSink,
  LiveTraceStatus,
  LiveTraceSubsystem,
} from "../../types/livehost.types.js";

type LiveTraceDetailsFactory = () => LiveTraceDetails;

type LiveTraceEmission = Readonly<{
  subsystem: LiveTraceSubsystem;
  phase: string;
  status: LiveTraceStatus;
  spanId?: string;
  parentSpanId?: string;
  durationMs?: number;
  details?: LiveTraceDetailsFactory;
}>;

export type LiveTraceSpan = Readonly<{
  spanId: string;
  success: (details?: LiveTraceDetailsFactory) => void;
  failure: (details?: LiveTraceDetailsFactory) => void;
  skip: (details?: LiveTraceDetailsFactory) => void;
}>;

export type LiveTraceContext = Readonly<{
  traceId: string;
  emit: (emission: LiveTraceEmission) => void;
  beginSpan: (
    subsystem: LiveTraceSubsystem,
    phase: string,
    parentSpanId?: string,
    details?: LiveTraceDetailsFactory,
  ) => LiveTraceSpan;
}>;

/** Create one host-local causal trace. Sequence numbers begin at one. */
export function create_live_trace_context(
  sink: LiveTraceSink,
  traceId: string,
  now: () => number = Date.now,
): LiveTraceContext {
  let nextSequence = 1;
  let nextSpan = 1;

  function emit(emission: LiveTraceEmission): void {
    const sequence = nextSequence;
    nextSequence += 1;
    const timestamp = safe_now(now);
    const details = safe_details(emission.details);
    const event: LiveTraceEvent = Object.freeze({
      traceId,
      sequence,
      subsystem: emission.subsystem,
      phase: emission.phase,
      status: emission.status,
      timestamp,
      ...(emission.spanId !== undefined ? { spanId: emission.spanId } : {}),
      ...(emission.parentSpanId !== undefined ? { parentSpanId: emission.parentSpanId } : {}),
      ...(emission.durationMs !== undefined ? { durationMs: emission.durationMs } : {}),
      ...(details !== undefined ? { details } : {}),
    });

    try {
      sink.emit(event);
    } catch {
      // Tracing is observational. A sink can never participate in semantics.
    }
  }

  function beginSpan(
    subsystem: LiveTraceSubsystem,
    phase: string,
    parentSpanId?: string,
    details?: LiveTraceDetailsFactory,
  ): LiveTraceSpan {
    const spanId = `span-${nextSpan}`;
    nextSpan += 1;
    const startedAt = safe_now(now);
    emit({
      subsystem,
      phase,
      status: "begin",
      spanId,
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      ...(details !== undefined ? { details } : {}),
    });
    let terminal = false;

    function finish(status: "success" | "failure" | "skip", finalDetails?: LiveTraceDetailsFactory): void {
      if (terminal) return;
      terminal = true;
      emit({
        subsystem,
        phase,
        status,
        spanId,
        ...(parentSpanId !== undefined ? { parentSpanId } : {}),
        durationMs: Math.max(0, safe_now(now) - startedAt),
        ...(finalDetails !== undefined ? { details: finalDetails } : {}),
      });
    }

    return Object.freeze({
      spanId,
      success: (finalDetails?: LiveTraceDetailsFactory) => finish("success", finalDetails),
      failure: (finalDetails?: LiveTraceDetailsFactory) => finish("failure", finalDetails),
      skip: (finalDetails?: LiveTraceDetailsFactory) => finish("skip", finalDetails),
    });
  }

  return Object.freeze({ traceId, emit, beginSpan });
}

function safe_now(now: () => number): number {
  try {
    const value = now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function safe_details(factory: LiveTraceDetailsFactory | undefined): LiveTraceDetails | undefined {
  if (factory === undefined) return undefined;
  try {
    const source = factory();
    const detached: Record<string, LiveTraceDetails[string]> = {};
    for (const [key, value] of Object.entries(source)) {
      detached[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
    }
    return Object.freeze(detached);
  } catch {
    return undefined;
  }
}

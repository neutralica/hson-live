import { LiveMapReplayInputError } from "./livemap.error.js";
import {
  decode_livemap_replay_payload,
  LIVEMAP_STRUCTURAL_JSON_FORMAT,
  LiveMapTransportCodecError,
  type LiveMapProjectedDataOp,
} from "./livemap.transport.js";

export type AdmittedLiveMapReplay = Readonly<{
  prevRev: number;
  ops: readonly LiveMapProjectedDataOp[];
}>;

/** Validate and defensively snapshot the canonical structural replay input. */
export function must_livemap_replay(input: unknown): AdmittedLiveMapReplay {
  if (!is_plain_object(input)) {
    throw new LiveMapReplayInputError("envelope is not an object");
  }

  if (!Number.isInteger(input.prevRev) || (input.prevRev as number) < 0) {
    throw new LiveMapReplayInputError("prevRev is not a non-negative integer");
  }

  if (Object.hasOwn(input, "formatVersion") || !has_transport_field(input)) {
    throw new LiveMapReplayInputError("envelope is not the canonical structural representation");
  }
  return must_exact_replay(input);
}

function must_exact_replay(input: Readonly<Record<string, unknown>>): AdmittedLiveMapReplay {
  if (input.format !== LIVEMAP_STRUCTURAL_JSON_FORMAT) {
    throw new LiveMapReplayInputError("format is not supported");
  }
  if (typeof input.payload !== "string") {
    throw new LiveMapReplayInputError("payload is not a string");
  }
  try {
    return Object.freeze({
      prevRev: input.prevRev as number,
      ops: decode_livemap_replay_payload(input.payload),
    });
  } catch (error) {
    if (error instanceof LiveMapTransportCodecError) {
      throw new LiveMapReplayInputError(error.reason, error.opIndex);
    }
    throw error;
  }
}

function has_transport_field(value: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(value, "format")
    || Object.hasOwn(value, "payload");
}

function is_plain_object(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

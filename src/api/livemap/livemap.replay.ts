import type { LivePath } from "../../types/livemap.types.js";
import { LiveMapReplayInputError } from "./livemap.error.js";
import { must_live_path, must_ordered_projected_value } from "./livemap.guard.js";
import {
  decode_livemap_replay_payload,
  LIVEMAP_STRUCTURAL_JSON_FORMAT,
  LIVEMAP_STRUCTURAL_JSON_FORMAT_VERSION,
  LiveMapTransportCodecError,
  type LiveMapProjectedDataOp,
} from "./livemap.transport.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";

export type AdmittedLiveMapReplay = Readonly<{
  prevRev: number;
  ops: readonly LiveMapProjectedDataOp[];
}>;

/** Validate and defensively snapshot either exact-v1 or bounded legacy replay input. */
export function must_livemap_replay(input: unknown): AdmittedLiveMapReplay {
  if (!is_plain_object(input)) {
    throw new LiveMapReplayInputError("envelope is not an object");
  }

  if (!Number.isInteger(input.prevRev) || (input.prevRev as number) < 0) {
    throw new LiveMapReplayInputError("prevRev is not a non-negative integer");
  }

  if (has_transport_field(input)) {
    return must_exact_replay(input);
  }

  if (!Array.isArray(input.ops)) {
    throw new LiveMapReplayInputError("ops is not an array");
  }

  return Object.freeze({
    prevRev: input.prevRev as number,
    ops: Object.freeze(input.ops.map(must_legacy_replay_op)),
  });
}

function must_exact_replay(input: Readonly<Record<string, unknown>>): AdmittedLiveMapReplay {
  if (input.format !== LIVEMAP_STRUCTURAL_JSON_FORMAT) {
    throw new LiveMapReplayInputError("format is not supported");
  }
  if (input.formatVersion !== LIVEMAP_STRUCTURAL_JSON_FORMAT_VERSION) {
    throw new LiveMapReplayInputError("formatVersion is not supported");
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

function must_legacy_replay_op(value: unknown, opIndex: number): LiveMapProjectedDataOp {
  if (!is_plain_object(value)) {
    throw new LiveMapReplayInputError("operation is not an object", opIndex);
  }

  const kind = value.kind;
  if (kind !== "set" && kind !== "delete" && kind !== "replace" && kind !== "splice") {
    throw new LiveMapReplayInputError("kind is not supported", opIndex);
  }

  const path = must_replay_path(value.path, opIndex);
  must_own_field(value, "prev", opIndex);
  must_own_field(value, "next", opIndex);
  const prev = must_optional_projected(value.prev, "prev", opIndex);

  if (kind === "delete") {
    if (value.next !== undefined) {
      throw new LiveMapReplayInputError("delete next must be undefined", opIndex);
    }
    return Object.freeze({ kind, path, prev, next: undefined });
  }

  if (kind === "splice") {
    if (!Number.isInteger(value.start) || (value.start as number) < 0) {
      throw new LiveMapReplayInputError("splice start is not a non-negative integer", opIndex);
    }
    if (!Array.isArray(value.removed)) {
      throw new LiveMapReplayInputError("splice removed is not an array", opIndex);
    }
    if (!Array.isArray(value.inserted)) {
      throw new LiveMapReplayInputError("splice inserted is not an array", opIndex);
    }

    return Object.freeze({
      kind,
      path,
      start: value.start as number,
      removed: must_projected_array(value.removed, "removed", opIndex),
      inserted: must_projected_array(value.inserted, "inserted", opIndex),
      prev: must_projected_array(value.prev, "prev", opIndex),
      next: must_projected_array(value.next, "next", opIndex),
    });
  }

  const next = must_projected(value.next, "next", opIndex);
  return Object.freeze({ kind, path, prev, next });
}

function must_replay_path(value: unknown, opIndex: number): LivePath {
  try {
    return Object.freeze(must_live_path(value));
  } catch {
    throw new LiveMapReplayInputError("path is not valid", opIndex);
  }
}

function must_optional_projected(
  value: unknown,
  field: string,
  opIndex: number,
): OrderedProjectedValue | undefined {
  return value === undefined ? undefined : must_projected(value, field, opIndex);
}

function must_projected(value: unknown, field: string, opIndex: number): OrderedProjectedValue {
  try {
    return must_ordered_projected_value(value, []);
  } catch {
    throw new LiveMapReplayInputError(`${field} is not JSON`, opIndex);
  }
}

function must_projected_array(
  value: unknown,
  field: string,
  opIndex: number,
): readonly OrderedProjectedValue[] {
  const projected = must_projected(value, field, opIndex);
  if (!Array.isArray(projected)) {
    throw new LiveMapReplayInputError(`${field} is not an array`, opIndex);
  }
  return projected;
}

function must_own_field(
  value: Readonly<Record<string, unknown>>,
  field: string,
  opIndex: number,
): void {
  if (Object.hasOwn(value, field)) return;
  throw new LiveMapReplayInputError(`${field} is missing`, opIndex);
}

function has_transport_field(value: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(value, "format")
    || Object.hasOwn(value, "formatVersion")
    || Object.hasOwn(value, "payload");
}

function is_plain_object(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

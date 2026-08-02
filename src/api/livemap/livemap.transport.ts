import type { JsonValue } from "../../core/types.js";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type {
  LiveMapDataOp,
  LiveMapSpliceOp,
  LiveMapStructuralJsonEnvelope,
  LivePath,
} from "../../types/livemap.types.js";
import {
  emit_ordered_json,
  parse_ordered_json_text,
} from "../transform/utils/json-utils/ordered-json.js";

export const LIVEMAP_STRUCTURAL_JSON_FORMAT = "structural-json" as const;
export const LIVEMAP_STRUCTURAL_JSON_FORMAT_VERSION = 1 as const;

type ProjectedSetOrReplaceOp = Readonly<{
  kind: "set" | "replace";
  path: LivePath;
  prev: OrderedProjectedValue | undefined;
  next: OrderedProjectedValue;
}>;

type ProjectedDeleteOp = Readonly<{
  kind: "delete";
  path: LivePath;
  prev: OrderedProjectedValue | undefined;
  next: undefined;
}>;

type ProjectedSpliceOp = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  removed: readonly OrderedProjectedValue[];
  inserted: readonly OrderedProjectedValue[];
  prev: readonly OrderedProjectedValue[];
  next: readonly OrderedProjectedValue[];
}>;

export type LiveMapProjectedDataOp =
  | ProjectedSetOrReplaceOp
  | ProjectedDeleteOp
  | ProjectedSpliceOp;

export class LiveMapTransportCodecError extends Error {
  readonly reason: string;
  readonly opIndex: number | undefined;

  constructor(reason: string, opIndex?: number, options?: ErrorOptions) {
    super(reason, options);
    this.name = "LiveMapTransportCodecError";
    this.reason = reason;
    this.opIndex = opIndex;
  }
}

/** Emit one immutable carrier directly as an exact versioned JSON-text envelope. */
export function encode_projected_value_transport(
  value: OrderedProjectedValue,
): LiveMapStructuralJsonEnvelope {
  return Object.freeze({
    format: LIVEMAP_STRUCTURAL_JSON_FORMAT,
    formatVersion: LIVEMAP_STRUCTURAL_JSON_FORMAT_VERSION,
    payload: emit_ordered_json(value),
  });
}

/** Parse an exact structural payload directly into the immutable carrier. */
export function decode_projected_value_payload(payload: string): OrderedProjectedValue {
  try {
    return parse_ordered_json_text(payload);
  } catch (cause) {
    throw new LiveMapTransportCodecError("payload is not valid structural JSON", undefined, { cause });
  }
}

/** Emit one carrier-native operation sequence without materializing object values. */
export function encode_livemap_replay_transport(
  ops: readonly LiveMapProjectedDataOp[],
): LiveMapStructuralJsonEnvelope {
  return encode_projected_value_transport(ordered_projected_array(ops.map(projected_op_to_carrier)));
}

/** Parse and validate one exact operation sequence entirely in carrier space. */
export function decode_livemap_replay_payload(payload: string): readonly LiveMapProjectedDataOp[] {
  const decoded = decode_projected_value_payload(payload);
  if (!Array.isArray(decoded)) {
    throw new LiveMapTransportCodecError("payload root is not an operation array");
  }
  return Object.freeze(decoded.map(carrier_to_projected_op));
}

/** Materialize one public compatibility operation from its exact carrier witness. */
export function materialize_livemap_projected_op(op: LiveMapProjectedDataOp): LiveMapDataOp {
  if (op.kind === "delete") {
    return Object.freeze({
      kind: op.kind,
      path: Object.freeze([...op.path]),
      prev: materialize_optional(op.prev),
      next: undefined,
    });
  }
  if (op.kind === "splice") {
    const splice: LiveMapSpliceOp = Object.freeze({
      kind: op.kind,
      path: Object.freeze([...op.path]),
      start: op.start,
      removed: Object.freeze(op.removed.map(materialize_projected_value)),
      inserted: Object.freeze(op.inserted.map(materialize_projected_value)),
      prev: materialize_projected_value(op.prev),
      next: materialize_projected_value(op.next),
    });
    return splice;
  }
  return Object.freeze({
    kind: op.kind,
    path: Object.freeze([...op.path]),
    prev: materialize_optional(op.prev),
    next: materialize_projected_value(op.next),
  });
}

function projected_op_to_carrier(op: LiveMapProjectedDataOp): OrderedProjectedObject {
  if (op.kind === "splice") {
    return ordered_projected_object([
      ["kind", op.kind],
      ["path", ordered_projected_array(op.path)],
      ["start", op.start],
      ["removed", ordered_projected_array(op.removed)],
      ["inserted", ordered_projected_array(op.inserted)],
      ["prev", ordered_projected_array(op.prev)],
      ["next", ordered_projected_array(op.next)],
    ]);
  }
  return ordered_projected_object([
    ["kind", op.kind],
    ["path", ordered_projected_array(op.path)],
    ["prev", optional_to_carrier(op.prev)],
    ["next", optional_to_carrier(op.next)],
  ]);
}

function carrier_to_projected_op(value: OrderedProjectedValue, opIndex: number): LiveMapProjectedDataOp {
  const record = must_record(value, opIndex);
  const kind = record_value(record, "kind");
  if (kind !== "set" && kind !== "replace" && kind !== "delete" && kind !== "splice") {
    throw new LiveMapTransportCodecError("kind is not supported", opIndex);
  }

  if (kind === "splice") {
    must_exact_keys(record, ["kind", "path", "start", "removed", "inserted", "prev", "next"], opIndex);
    const start = record_value(record, "start");
    if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
      throw new LiveMapTransportCodecError("splice start is not a non-negative integer", opIndex);
    }
    return Object.freeze({
      kind,
      path: must_path(record_value(record, "path"), opIndex),
      start,
      removed: must_array(record_value(record, "removed"), "removed", opIndex),
      inserted: must_array(record_value(record, "inserted"), "inserted", opIndex),
      prev: must_array(record_value(record, "prev"), "prev", opIndex),
      next: must_array(record_value(record, "next"), "next", opIndex),
    });
  }

  must_exact_keys(record, ["kind", "path", "prev", "next"], opIndex);
  const path = must_path(record_value(record, "path"), opIndex);
  const prev = must_optional(record_value(record, "prev"), "prev", opIndex);
  const next = must_optional(record_value(record, "next"), "next", opIndex);
  if (kind === "delete") {
    if (next !== undefined) {
      throw new LiveMapTransportCodecError("delete next must be absent", opIndex);
    }
    return Object.freeze({ kind, path, prev, next: undefined });
  }
  if (next === undefined) {
    throw new LiveMapTransportCodecError(`${kind} next is absent`, opIndex);
  }
  return Object.freeze({ kind, path, prev, next });
}

function optional_to_carrier(value: OrderedProjectedValue | undefined): readonly OrderedProjectedValue[] {
  return value === undefined
    ? ordered_projected_array([])
    : ordered_projected_array([value]);
}

function must_optional(
  value: OrderedProjectedValue | undefined,
  field: string,
  opIndex: number,
): OrderedProjectedValue | undefined {
  if (!Array.isArray(value) || value.length > 1) {
    throw new LiveMapTransportCodecError(`${field} presence is invalid`, opIndex);
  }
  return value[0];
}

function must_array(
  value: OrderedProjectedValue | undefined,
  field: string,
  opIndex: number,
): readonly OrderedProjectedValue[] {
  if (!Array.isArray(value)) {
    throw new LiveMapTransportCodecError(`${field} is not an array`, opIndex);
  }
  return value;
}

function must_path(value: OrderedProjectedValue | undefined, opIndex: number): LivePath {
  if (!Array.isArray(value)) {
    throw new LiveMapTransportCodecError("path is not valid", opIndex);
  }
  const path: Array<string | number> = [];
  for (const part of value) {
    if (typeof part === "string") {
      path.push(part);
      continue;
    }
    if (typeof part === "number" && Number.isInteger(part) && part >= 0) {
      path.push(part);
      continue;
    }
    throw new LiveMapTransportCodecError("path is not valid", opIndex);
  }
  return Object.freeze(path);
}

function must_record(value: OrderedProjectedValue, opIndex: number): OrderedProjectedObject {
  if (is_ordered_projected_object(value)) return value;
  throw new LiveMapTransportCodecError("operation is not an object", opIndex);
}

function must_exact_keys(
  value: OrderedProjectedObject,
  keys: readonly string[],
  opIndex: number,
): void {
  if (value.entries.length === keys.length
    && value.entries.every(([key], index) => key === keys[index])) return;
  throw new LiveMapTransportCodecError("operation fields are missing, unknown, or out of order", opIndex);
}

function record_value(
  value: OrderedProjectedObject,
  key: string,
): OrderedProjectedValue | undefined {
  return value.entries.find(([entryKey]) => entryKey === key)?.[1];
}

function materialize_optional(value: OrderedProjectedValue | undefined): JsonValue | undefined {
  return value === undefined ? undefined : materialize_projected_value(value);
}

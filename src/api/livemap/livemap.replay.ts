import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapOp,
  LiveMapReplay,
  LiveMapWriteOp,
  LivePath,
} from "../../types/livemap.types.js";
import { LiveMapReplayInputError } from "./livemap.error.js";
import { must_live_path } from "./livemap.guard.js";

/** Validate and defensively copy a replay envelope received at runtime. */
export function must_livemap_replay(input: unknown): LiveMapReplay {
  if (!is_plain_object(input)) {
    throw new LiveMapReplayInputError("envelope is not an object");
  }

  if (!Number.isInteger(input.prevRev) || (input.prevRev as number) < 0) {
    throw new LiveMapReplayInputError("prevRev is not a non-negative integer");
  }

  if (!Array.isArray(input.ops)) {
    throw new LiveMapReplayInputError("ops is not an array");
  }

  return Object.freeze({
    prevRev: input.prevRev as number,
    ops: Object.freeze(input.ops.map(must_livemap_replay_op)),
  });
}

/** Convert one validated public operation into an internal write intent. */
export function replay_write_op(op: LiveMapOp): LiveMapWriteOp {
  if (op.kind === "delete") {
    return Object.freeze({
      kind: "delete",
      path: op.path,
    });
  }

  if (op.kind === "splice") {
    return Object.freeze({
      kind: "splice",
      path: op.path,
      start: op.start,
      deleteCount: op.removed.length,
      items: op.inserted,
    });
  }

  if (op.kind === "set") {
    if (op.next === undefined) {
      throw new LiveMapReplayInputError("set next is missing");
    }
    return Object.freeze({
      kind: "set",
      path: op.path,
      value: op.next,
    });
  }

  if (op.next === undefined) {
    throw new LiveMapReplayInputError("replace next is missing");
  }
  return Object.freeze({
    kind: "replace",
    path: op.path,
    value: op.next,
  });
}

function must_livemap_replay_op(value: unknown, opIndex: number): LiveMapOp {
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
  const prev = must_optional_json(value.prev, "prev", opIndex);

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

    const removed = must_json_array(value.removed, "removed", opIndex);
    const inserted = must_json_array(value.inserted, "inserted", opIndex);
    const splicePrev = must_json_array(value.prev, "prev", opIndex);
    const next = must_json_array(value.next, "next", opIndex);

    return Object.freeze({
      kind,
      path,
      start: value.start as number,
      removed,
      inserted,
      prev: splicePrev,
      next,
    });
  }

  const next = must_json(value.next, "next", opIndex);
  return Object.freeze({ kind, path, prev, next });
}

function must_replay_path(value: unknown, opIndex: number): LivePath {
  try {
    return Object.freeze(must_live_path(value));
  } catch {
    throw new LiveMapReplayInputError("path is not valid", opIndex);
  }
}

function must_optional_json(
  value: unknown,
  field: string,
  opIndex: number,
): JsonValue | undefined {
  return value === undefined ? undefined : must_json(value, field, opIndex);
}

function must_json(value: unknown, field: string, opIndex: number): JsonValue {
  if (!is_json_value(value)) {
    throw new LiveMapReplayInputError(`${field} is not JSON`, opIndex);
  }
  return clone_replay_json(value);
}

function must_json_array(
  value: unknown,
  field: string,
  opIndex: number,
): JsonValue[] {
  const json = must_json(value, field, opIndex);
  if (!Array.isArray(json)) {
    throw new LiveMapReplayInputError(`${field} is not an array`, opIndex);
  }
  return Object.freeze(json) as unknown as JsonValue[];
}

function must_own_field(
  value: Readonly<Record<string, unknown>>,
  field: string,
  opIndex: number,
): void {
  if (Object.prototype.hasOwnProperty.call(value, field)) return;
  throw new LiveMapReplayInputError(`${field} is missing`, opIndex);
}

function is_plain_object(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function is_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_json_value);
  return is_plain_object(value) && Object.values(value).every(is_json_value);
}

function clone_replay_json(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone_replay_json);

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, clone_replay_json(item)]),
  );
}

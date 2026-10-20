import type { JsonValue } from "../../core/types.js";
import type { LiveMapPathKind } from "../../types/livemap.types.js";

export type DataLocationCheck = () => boolean;

export function data_path_kind(value: JsonValue | undefined): LiveMapPathKind {
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" && value !== null ? "object" : "scalar";
}

/** A check is relative to the retained path, not a cached value or an identity allocation. */
export function data_location_check(
  read: () => JsonValue | undefined,
  kind: Exclude<LiveMapPathKind, "missing"> | "present",
  parent?: DataLocationCheck,
): DataLocationCheck {
  return () => parent?.() !== false && (kind === "present" ? read() !== undefined : data_path_kind(read()) === kind);
}

export function require_data_location(check: DataLocationCheck | undefined): void {
  if (check?.() === false) throw new Error("Data location refinement no longer matches.");
}

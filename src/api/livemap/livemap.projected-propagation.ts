import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { LiveMapCoreCommit, LiveMapDisposer, LiveMapPathKind, LivePath } from "../../types/livemap.types.js";
import type { JsonValue } from "../../core/types.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { LiveMapProjectedDataOp } from "./livemap.transport.js";

export type LiveMapProjectedSetWrite = Readonly<{
  kind: "set";
  path: LivePath;
  value: OrderedProjectedValue;
}>;

/** Add or replace one member of an existing object without replacing its siblings. */
export type LiveMapProjectedSetKeyWrite = Readonly<{
  kind: "set-key";
  path: LivePath;
  key: string;
  value: OrderedProjectedValue;
}>;

export type LiveMapProjectedReplaceWrite = Readonly<{
  kind: "replace";
  path: LivePath;
  value: OrderedProjectedValue;
}>;

export type LiveMapProjectedDeleteWrite = Readonly<{
  kind: "delete";
  path: LivePath;
}>;

export type LiveMapProjectedSpliceWrite = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  deleteCount: number;
  items: readonly OrderedProjectedValue[];
}>;

export type LiveMapProjectedRenameWrite = Readonly<{
  kind: "rename";
  path: LivePath;
  from: string;
  to: string;
}>;

export type LiveMapProjectedMoveWrite = Readonly<{
  kind: "move";
  path: LivePath;
  from: number;
  to: number;
}>;

export type LiveMapProjectedPropagationWrite =
  | LiveMapProjectedSetWrite
  | LiveMapProjectedSetKeyWrite
  | LiveMapProjectedReplaceWrite
  | LiveMapProjectedDeleteWrite
  | LiveMapProjectedSpliceWrite
  | LiveMapProjectedRenameWrite
  | LiveMapProjectedMoveWrite;

export type LiveMapProjectedFeedEvent = Readonly<{
  commit: LiveMapCoreCommit;
  path: LivePath;
  value: OrderedProjectedValue | undefined;
  ops: readonly LiveMapProjectedDataOp[];
}>;

export type LiveMapDataReads = Readonly<{
  read: (path: LivePath) => OrderedProjectedValue | undefined;
  snap: (path: LivePath) => JsonValue | undefined;
  kind: (path: LivePath) => LiveMapPathKind;
  keys: (path: LivePath) => readonly string[] | undefined;
  arrayRange: (path: LivePath, bounds: (length: number) => readonly [number, number]) => JsonValue[] | undefined;
  length: (path: LivePath) => number | undefined;
}>;

/** Candidate-only adapter: installed readers supply graph-local implementations. */
export function ordered_candidate_reads(read: LiveMapDataReads["read"]): LiveMapDataReads {
  return {
    read,
    snap: path => { const value = read(path); return value === undefined ? undefined : materialize_projected_value(value); },
    kind: path => { const value = read(path); return value === undefined ? "missing" : is_ordered_projected_object(value) ? "object" : Array.isArray(value) ? "array" : "scalar"; },
    keys: path => { const value = read(path); return is_ordered_projected_object(value) ? value.entries.map(([key]) => key) : undefined; },
    arrayRange: (path, bounds) => {
      const value = read(path);
      if (!Array.isArray(value)) return undefined;
      const [start, end] = bounds(value.length);
      return value.slice(start, end).map(materialize_projected_value);
    },
    length: path => { const value = read(path); return Array.isArray(value) ? value.length : undefined; },
  };
}

export type LiveMapProjectedPropagation<TCommit = LiveMapCoreCommit> = LiveMapDataReads & Readonly<{
  feed: (
    path: LivePath,
    listener: (event: LiveMapProjectedFeedEvent) => void,
  ) => LiveMapDisposer;
  commit: (ops: readonly LiveMapProjectedPropagationWrite[]) => TCommit;
}>;

const projectedPropagation = new WeakMap<object, LiveMapProjectedPropagation>();

/** Register the private carrier capability for one completed LiveMap facade. */
export function register_livemap_projected_propagation(
  map: object,
  propagation: LiveMapProjectedPropagation,
): void {
  projectedPropagation.set(map, propagation);
}

/** Read the private carrier capability without widening the public LiveMap API. */
export function livemap_projected_propagation(
  map: object,
): LiveMapProjectedPropagation | undefined {
  return projectedPropagation.get(map);
}

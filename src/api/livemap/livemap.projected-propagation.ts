import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { LiveMapCommit, LiveMapDisposer, LivePath } from "../../types/livemap.types.js";
import type { LiveMapProjectedDataOp } from "./livemap.transport.js";

export type LiveMapProjectedSetWrite = Readonly<{
  kind: "set";
  path: LivePath;
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

export type LiveMapProjectedPropagationWrite =
  | LiveMapProjectedSetWrite
  | LiveMapProjectedReplaceWrite
  | LiveMapProjectedDeleteWrite
  | LiveMapProjectedSpliceWrite;

export type LiveMapProjectedFeedEvent = Readonly<{
  commit: LiveMapCommit;
  path: LivePath;
  value: OrderedProjectedValue | undefined;
  ops: readonly LiveMapProjectedDataOp[];
}>;

export type LiveMapProjectedPropagation = Readonly<{
  read: (path: LivePath) => OrderedProjectedValue | undefined;
  feed: (
    path: LivePath,
    listener: (event: LiveMapProjectedFeedEvent) => void,
  ) => LiveMapDisposer;
  commit: (ops: readonly LiveMapProjectedPropagationWrite[]) => LiveMapCommit;
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

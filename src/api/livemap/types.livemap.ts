// types.livemap.ts

import { HsonNode } from "../../types-consts/node.types";

/*************************** 
 * (CURRENTLY UNUSED, TBC)
 ***************************/


// === Identity + addressing ===
/** Stable identifier for a LiveMap data record. */
export type DataQuid = string;

/** A single segment in a path (object key or array index). */
export type PathSeg = string | number;
/** Immutable path into a JSON/HSON tree. */
export type Path = ReadonlyArray<PathSeg>;                 // ex: ['ingredients', 3, 'name']
/** Canonical string form of a Path (JSON Pointer). */
export type PathStr = string;                              // ex: "/ingredients/3/name"

/**
 * Convert a Path into a canonical JSON Pointer string.
 *
 * @param path - Path segments to encode.
 * @returns JSON Pointer string (e.g. "/items/0/name").
 */
export function toPointer(path: Path): PathStr {
  let out: string = "";
  for (const seg of path) {
    const s: string = typeof seg === "number" ? String(seg) : seg.replace(/~/g, "~0").replace(/\//g, "~1");
    out += "/" + s;
  }
  return out === "" ? "/" : out;
}

// === Patch grammar (discriminated union) ===
/** Patch origin tag used for routing and reentrancy guards. */
export type OriginTag =
  | "store"
  | "dom:tree"
  | "dom:map";

/** Opaque transaction identifier for a patch. */
export type TxId = string;

/** Patch op: set a value at a path. */
export type OpSetValue = {
  kind: "set:value";                // replace primitive or node payload
  path: Path;
  value: unknown;
};

/** Patch op: set/replace an attribute on a node. */
export type OpSetAttr = {
  kind: "set:attr";                 // set/replace attribute on a node
  path: Path;
  name: string;
  value: string | number | boolean | null;
};

/** Patch op: insert a node into an array at an index. */
export type OpInsert = {
  kind: "arr:insert";               // arrays only
  path: Path;                       // path to array
  index: number;
  node: HsonNode;                  
};

/** Patch op: remove an array item at an index. */
export type OpRemove = {
  kind: "arr:remove";               // arrays only
  path: Path;                       // path to array
  index: number;
};

/** Patch op: move an array item from one index to another. */
export type OpMove = {
  kind: "arr:move";                 // arrays only
  path: Path;                       // path to array
  from: number;
  to: number;
};

/** Discriminated union of patch operations. */
export type PatchOp =
  | OpSetValue
  | OpSetAttr
  | OpInsert
  | OpRemove
  | OpMove;

/** Patch envelope containing transaction metadata and operations. */
export type Patch = {
  tx: TxId;
  origin: OriginTag;
  ops: ReadonlyArray<PatchOp>;
};

// === Store interface (single source of truth) ===
/**
 * Store interface that provides read access and patch-based updates.
 */
export interface Store {
  /**
   * Read a JSON value at the given path.
   *
   * @param path - Path into the JSON view.
   * @returns The value at the path, or undefined if missing.
   */
  read(path: Path): unknown;          // JSON view
  /**
   * Read a HSON node view at the given path.
   *
   * @param path - Path into the node view.
   * @returns The HsonNode at the path.
   */
  readNode(path: Path): HsonNode;     // NEW/HSON node view
  /**
   * Apply a patch and notify subscribers.
   *
   * @param patch - Patch to apply.
   * @returns void
   */
  transact(patch: Patch): void;       // apply + notify
  /**
   * Subscribe to patch notifications.
   *
   * @param handler - Called for each applied patch.
   * @returns Unsubscribe function.
   */
  subscribe(handler: (patch: Patch) => void): () => void; // returns unsubscribe
}

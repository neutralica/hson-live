// store.ts

import { HsonNode } from "../../types/node.types.js";
import { Patch, Store, Path, PatchOp, PathSeg } from "../livemap/types.livemap.js";

/*************************** 
 * (CURRENTLY UNUSED, TBC)
 ***************************/

type Subscriber = (patch: Patch) => void;

/**
 * Simple in-memory Store implementation for development/testing.
 */
export class InMemoryStore implements Store {
  private rootJson: unknown;
  private subscribers: Subscriber[] = [];

  /**
   * @param initialJson - Initial JSON value for the root.
   */
  constructor(initialJson: unknown) {
    this.rootJson = initialJson;
  }

  // -- reads --

  /**
   * Read a JSON value at a path.
   *
   * @param path - Path into the JSON view.
   * @returns The value at the path, or undefined if missing.
   */
  read(path: Path): unknown {
    let cur: unknown = this.rootJson;
    for (const seg of path) {
      if (typeof seg === "number") {
        if (!Array.isArray(cur)) return undefined;
        cur = cur[seg];
      } else {
        if (cur === null || typeof cur !== "object") return undefined;
        const obj = cur as Record<string, unknown>;
        cur = obj[seg];
      }
    }
    return cur;
  }

  /**
   * Read an HSON node view at a path (placeholder stub).
   *
   * @param _path - Path into the node view.
   * @returns A placeholder root node.
   */
  readNode(_path: Path): HsonNode {
  
    // Placeholder to meet the interface:
    return {
      _tag: "_root",
      _content: [],
      _attrs: {},
      _meta: {}
    };
  }

  // -- write + notify --

  /**
   * Apply a patch and notify subscribers.
   *
   * @param patch - Patch to apply.
   * @returns void
   */
  transact(patch: Patch): void {
    // 1) Apply ops to the JSON view (or to Node, if canonical)
    for (const op of patch.ops) {
      this.applyOp(op);
    }

    // 2) Notify everyone (including displays)
    for (const fn of this.subscribers) {
      fn(patch);
    }
  }

  /**
   * Subscribe to patch notifications.
   *
   * @param handler - Callback invoked on each patch.
   * @returns Unsubscribe function.
   */
  subscribe(handler: Subscriber): () => void {
    this.subscribers.push(handler);
    return () => {
      const i = this.subscribers.indexOf(handler);
      if (i >= 0) this.subscribers.splice(i, 1);
    };
  }

  // --- op application: keep tiny, predictable, and total ---

  private applyOp(op: PatchOp): void {
    if (op.kind === "set:value") {
      this.setJsonValue(op.path, op.value);
      return;
    }
    if (op.kind === "set:attr") {
      // If JSON is canonical, attrs likely live under some object key;
      // if HsonNodes are canonical, set attrs on the NEW node instead.
      // This example assumes JSON carries a parallel structure like:
      // { _attrs: {class: "..."} } at the target object path.
      const node = this.ensureObjectAt(op.path);
      const attrs = (node._attrs ?? {}) as Record<string, unknown>;
      attrs[op.name] = op.value;
      node._attrs = attrs;
      return;
    }
    if (op.kind === "arr:insert") {
      const arr = this.ensureArrayAt(op.path);
      const idx = clampIndex(op.index, arr.length + 1);
      arr.splice(idx, 0, op.node); // if JSON is canonical, insert a JSON value instead
      return;
    }
    if (op.kind === "arr:remove") {
      const arr = this.ensureArrayAt(op.path);
      const idx = clampIndex(op.index, arr.length);
      if (idx < arr.length) arr.splice(idx, 1);
      return;
    }
    if (op.kind === "arr:move") {
      const arr = this.ensureArrayAt(op.path);
      const from = clampIndex(op.from, arr.length);
      const to = clampIndex(op.to, arr.length);
      if (from < arr.length && to < arr.length) {
        const [it] = arr.splice(from, 1);
        arr.splice(to, 0, it);
      }
      return;
    }
  }

  // --- helpers to mutate JSON safely ---

  private setJsonValue(path: Path, value: unknown): void {
    if (path.length === 0) {
      this.rootJson = value;
      return;
    }
    const parentPath = path.slice(0, -1);
    const key = path[path.length - 1];

    const parent = this.ensureContainerAt(parentPath, key);
    if (typeof key === "number") {
      const arr = parent as unknown[];
      const idx = clampIndex(key, arr.length + 1);
      arr[idx] = value;
    } else {
      const obj = parent as Record<string, unknown>;
      obj[key] = value;
    }
  }

  private ensureObjectAt(path: Path): Record<string, unknown> {
    const val = this.read(path);
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
    this.setJsonValue(path, {});
    return this.read(path) as Record<string, unknown>;
  }

  private ensureArrayAt(path: Path): unknown[] {
    const val = this.read(path);
    if (Array.isArray(val)) return val as unknown[];
    this.setJsonValue(path, []);
    return this.read(path) as unknown[];
  }

  private ensureContainerAt(parentPath: Path, finalKey: PathSeg): unknown {
    let cur = this.rootJson;

    for (let i = 0; i < parentPath.length; i++) {
      const seg = parentPath[i];
      if (typeof seg === "number") {
        if (!Array.isArray(cur)) {
          // promote to array if needed
          this.setJsonValue(parentPath.slice(0, i), []);
          cur = this.read(parentPath.slice(0, i));
        }
        cur = (cur as unknown[])[seg];
      } else {
        if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
          // promote to object if needed
          this.setJsonValue(parentPath.slice(0, i), {});
          cur = this.read(parentPath.slice(0, i));
        }
        cur = (cur as Record<string, unknown>)[seg];
      }
    }

    // Now ensure the final container exists and is shaped correctly for finalKey
    if (typeof finalKey === "number") {
      if (!Array.isArray(cur)) {
        this.setJsonValue(parentPath, []);
        return this.read(parentPath) as unknown[];
      }
      return cur as unknown[];
    } else {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
        this.setJsonValue(parentPath, {});
        return this.read(parentPath) as Record<string, unknown>;
      }
      return cur as Record<string, unknown>;
    }
  }
}

function clampIndex(i: number, len: number): number {
  const n = i < 0 ? 0 : i;
  return n > len ? len : n;
}

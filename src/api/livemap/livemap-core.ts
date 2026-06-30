// livemap-core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LiveMapCommit, LiveMapCore, LivePath } from "./livemap.types.js";
import { set_live_path, snap_live_path } from "./livemap-editor.js";

/**
 * Create the first Core facade for a LiveMap graph.
 *
 * Core owns the root HSON node and exposes graph-level operations in projected
 * JSON path terms. It is the layer that will coordinate editor mutations, commit
 * generation, feeds, links, batching, and later transport-compatible behavior.
 */
export function make_livemap_core(root: HsonNode): LiveMapCore {
  return {
    /** Return the live root node owned by this map core. */
    root: () => root,

    /** Read the current projected JSON value at a path, or the whole graph. */
    snap: (path = []) => snap_live_path(root, path),

    /** Mutate a projected path and return a normalized commit. */
    set: (path, value) => commit_set(root, path, value),
  };
}

/**
 * Apply a set mutation through the editor and wrap the result as a commit.
 *
 * The editor knows how to perform the graph surgery. Core is responsible for
 * turning that local edit result into a stable op record that feeds and future
 * sync/transport layers can consume.
 */
function commit_set(root: HsonNode, path: LivePath, value: JsonValue): LiveMapCommit {
  const edit = set_live_path(root, path, value);

  return {
    changed: edit.changed,
    ops: edit.changed
      ? [
          {
            kind: "set",
            path,
            prev: edit.prev,
            next: edit.next,
          },
        ]
      : [],
  };
}
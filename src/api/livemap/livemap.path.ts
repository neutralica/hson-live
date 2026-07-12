// livemap-path.ts

import type { LivePath, LivePathPart } from "../../types/livemap.types.js";

// CHANGED: shared pure helpers keep LivePath operations centralized.
export function clone_live_path(path: LivePath): LivePath {
  return [...path];
}

export function paths_equal(left: LivePath, right: LivePath): boolean {
  if (left.length !== right.length) return false;
  return left.every((part, index) => part === right[index]);
}

export function append_live_path(path: LivePath, part: LivePathPart): LivePath {
  return [...path, part];
}

export function parent_live_path(path: LivePath): LivePath | undefined {
  if (path.length === 0) return undefined;
  return path.slice(0, -1);
}

export function relative_live_path(prefix: LivePath, path: LivePath): LivePath | undefined {
  if (!path_is_prefix(prefix, path)) return undefined;
  return path.slice(prefix.length);
}

export function live_path_key(path: LivePath): string {
  return JSON.stringify(path);
}

/**
 * Format a LivePath for error messages and debug output.
 *
 * The output intentionally mirrors array path syntax because LivePath is the
 * canonical, unambiguous representation beneath later ergonomic surfaces.
 */
export function format_live_path(path: LivePath): string {
  return `[${path.map((part) => JSON.stringify(part)).join(", ")}]`;
}

/**
 * Return true when two projected paths can affect each other.
 *
 * The rule is intentionally symmetric:
 * - a parent path overlaps a child path: `["user"]` overlaps `["user", "name"]`
 * - a child path overlaps a parent path: `["user", "name"]` overlaps `["user"]`
 * - sibling paths do not overlap: `["user", "name"]` ignores `["user", "role"]`
 */
export function paths_overlap(a: LivePath, b: LivePath): boolean {
  return path_is_prefix(a, b) || path_is_prefix(b, a);
}

/**
 * Return true when `prefix` is an exact ancestor-or-self prefix of `path`.
 *
 * This is intentionally strict equality per path segment. No dot splitting,
 * coercion, stringification, or wildcard behavior happens here.
 */
export function path_is_prefix(prefix: LivePath, path: LivePath): boolean {
  if (prefix.length > path.length) return false;

  return prefix.every((part, index) => part === path[index]);
}

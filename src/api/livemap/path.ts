// livemap-path.ts

import type { LivePath } from "./livemap.types.js";

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

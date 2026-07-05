// livemap-link.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCore, LiveMapDisposer, LiveMapFeedEvent, LiveMapLinkOptions, LivePath } from "./livemap.types.js";
import { path_is_prefix } from "./path.js";

/**
 * Link one LiveMap core to another in one direction.
 *
 * This is still deliberately narrow:
 * - one-way only
 * - set-shaped, replace-shaped, and delete propagation only
 * - optional source-prefix to target-prefix path mapping
 * - no transforms
 * - no conflict resolution
 * - no bidirectional loop handling
 *
 * Same-path links use `{ path }`. Mapped links use `{ from, to }`.
 *
 * `setMany` and `write` reach links as shallow child set ops, preserving
 * unspecified siblings.
 *
 * Delete propagation follows link scope. Deleting the linked source path deletes
 * the target path. Deleting below the linked source path writes the updated
 * linked source value into the target path. Root replacement can still overlap
 * a linked source scope because feeds report the current scoped `event.value`.
 */
export function link_livemap(source: LiveMapCore, target: LiveMapCore, options: LiveMapLinkOptions): LiveMapDisposer {
  const linkPath = link_source_path(options);

  return source.feed(linkPath, (event) => {
    apply_link_event(target, event, options);
  });
}

/**
 * Return the source path this link should observe.
 *
 * Same-path links observe `path`. Mapped links observe `from`.
 */
function link_source_path(options: LiveMapLinkOptions): LivePath {
  return "path" in options ? options.path : options.from;
}

/**
 * Apply one source feed event to the target map.
 *
 * Feed events include both the subscribed path and the actual op path. Link uses
 * the actual op path, optionally translated through the link mapping, because
 * that is the precise location that changed in the source. Shallow `setMany`
 * and `write` calls propagate as child set ops. Replacement at or above the
 * linked source scope propagates the current linked source value into the
 * target source path. Replacement below the linked source scope is translated
 * to the corresponding target path.
 */
function apply_link_event(target: LiveMapCore, event: LiveMapFeedEvent, options: LiveMapLinkOptions): void {
  const sourcePath = link_source_path(options);
  const targetSourcePath = link_target_path(sourcePath, options);
  if (targetSourcePath === undefined) return;

  if (event.value === undefined) {
    target.delete(targetSourcePath);
    return;
  }

  if (event.ops.some((op) => op.kind === "delete")) {
    target.set(targetSourcePath, event.value);
    return;
  }

  if (event.ops.some((op) => op.kind === "replace" && path_is_prefix(op.path, sourcePath))) {
    target.replace(targetSourcePath, event.value);
    return;
  }

  for (const op of event.ops) {
    if (op.kind === "set") {
      const targetPath = link_target_path(op.path, options);
      if (targetPath === undefined) continue;

      const next = op.next;
      if (next === undefined) continue;

      target.set(targetPath, next as JsonValue);
      continue;
    }

    if (op.kind === "replace") {
      const targetPath = link_target_path(op.path, options);
      if (targetPath === undefined) continue;

      const next = op.next;
      if (next === undefined) continue;

      target.replace(targetPath, next as JsonValue);
    }
  }
}

/**
 * Translate a source op path into the target path for this link.
 *
 * Same-path links return the original op path. Mapped links replace the `from`
 * prefix with the `to` prefix and preserve the remaining path suffix.
 */
function link_target_path(sourcePath: LivePath, options: LiveMapLinkOptions): LivePath | undefined {
  if ("path" in options) return sourcePath;
  if (!path_is_prefix(options.from, sourcePath)) return undefined;

  return [
    ...options.to,
    ...sourcePath.slice(options.from.length),
  ];
}

// livemap-link.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCore, LiveMapDisposer, LiveMapFeedEvent, LiveMapLinkOptions, LivePath } from "./livemap.types.js";
import { path_is_prefix } from "./livemap-path.js";

/**
 * Link one LiveMap core to another in one direction.
 *
 * This is still deliberately narrow:
 * - one-way only
 * - set-op propagation only
 * - optional source-prefix to target-prefix path mapping
 * - no transforms
 * - no conflict resolution
 * - no bidirectional loop handling
 *
 * Same-path links use `{ path }`. Mapped links use `{ from, to }`.
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
 * that is the precise location that changed in the source.
 */
function apply_link_event(target: LiveMapCore, event: LiveMapFeedEvent, options: LiveMapLinkOptions): void {
  if (event.op.kind !== "set") return;

  const next = event.op.next;
  if (next === undefined) return;

  const targetPath = link_target_path(event.op.path, options);
  if (targetPath === undefined) return;

  target.set(targetPath, next as JsonValue);
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
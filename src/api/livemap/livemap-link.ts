// livemap-link.ts


// livemap-link.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCore, LiveMapDisposer, LiveMapFeedEvent, LivePath } from "./livemap.types.js";

/**
 * Options for the first one-way LiveMap link.
 *
 * `path` is the projected LivePath to observe on the source map. Any source op
 * whose path overlaps this path is forwarded to the target map.
 */
export type LiveMapLinkOptions = Readonly<{
  path: LivePath;
}>;

/**
 * Link one LiveMap core to another in one direction.
 *
 * This is intentionally the smallest useful Link slice:
 * - one-way only
 * - same-path propagation only
 * - set-op propagation only
 * - no transforms
 * - no conflict resolution
 * - no loop prevention beyond the fact that this function creates only one link
 *
 * Later Link can grow into bidirectional binding, mapped paths, transforms,
 * transactional replay, and remote transport. For now it proves that Core's
 * commit/feed surface is enough to drive another LiveMap graph.
 */
export function link_livemap(source: LiveMapCore, target: LiveMapCore, options: LiveMapLinkOptions): LiveMapDisposer {
  return source.feed(options.path, (event) => {
    apply_link_event(target, event);
  });
}

/**
 * Apply one source feed event to the target map.
 *
 * Feed events include both the subscribed path and the actual op path. Link uses
 * the op path because that is the precise location that changed in the source.
 */
function apply_link_event(target: LiveMapCore, event: LiveMapFeedEvent): void {
  if (event.op.kind !== "set") return;

  const next = event.op.next;
  if (next === undefined) return;

  target.set(event.op.path, next as JsonValue);
}
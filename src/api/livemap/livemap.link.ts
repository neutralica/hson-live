// livemap-link.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCore, LiveMapDisposer, LiveMapFeedEvent, LiveMapLinkOptions, LivePath } from "../../types/livemap.types.js";
import { schedule_livemap_managed_mutation } from "./livemap.authority.js";
import { path_is_prefix } from "./livemap.path.js";
import {
  livemap_projected_propagation,
  type LiveMapProjectedFeedEvent,
  type LiveMapProjectedPropagationWrite,
} from "./livemap.projected-propagation.js";
import { ordered_projected_value_equal } from "../../core/ordered-projected-value.js";

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
 * `setMany` and object-valued `set` reach links as shallow child set ops,
 * preserving unspecified siblings.
 *
 * Delete propagation follows link scope. Deleting the linked source path deletes
 * the target path. Deleting below the linked source path writes the updated
 * linked source value into the target path. Root replacement can still overlap
 * a linked source scope because feeds report the current scoped `event.value`.
 */
export function link_livemap(source: LiveMapCore, target: LiveMapCore, options: LiveMapLinkOptions): LiveMapDisposer {
  const linkPath = link_source_path(options);
  const sourceProjected = livemap_projected_propagation(source);
  const targetProjected = livemap_projected_propagation(target);

  if (sourceProjected !== undefined && targetProjected !== undefined) {
    return sourceProjected.feed(linkPath, (event) => {
      apply_projected_link_event(target, event, options);
    });
  }

  return source.feed(linkPath, (event) => {
    apply_link_event(target, event, options);
  });
}

function apply_projected_link_event(
  target: LiveMapCore,
  event: LiveMapProjectedFeedEvent,
  options: LiveMapLinkOptions,
): void {
  const sourcePath = link_source_path(options);
  const targetSourcePath = link_target_path(sourcePath, options);
  if (targetSourcePath === undefined) return;

  if (event.value === undefined) {
    commit_projected_link(target, [Object.freeze({ kind: "delete", path: targetSourcePath })]);
    return;
  }

  if (event.ops.some((op) => op.kind === "delete" || op.kind === "splice")
    || event.ops.some((op) => op.kind === "replace" && path_is_prefix(op.path, sourcePath))
    || event.ops.some((op) => (
      (op.kind === "rename" || op.kind === "move")
      && op.path.length < sourcePath.length
      && path_is_prefix(op.path, sourcePath)
    ))) {
    commit_projected_link(target, [Object.freeze({
      kind: "replace",
      path: targetSourcePath,
      value: event.value,
    })]);
    return;
  }

  const writes: LiveMapProjectedPropagationWrite[] = [];
  for (const op of event.ops) {
    if (op.kind === "rename") {
      const path = link_target_path(op.path, options);
      if (path === undefined) continue;
      const targetProjected = livemap_projected_propagation(target);
      const current = targetProjected?.read(path);
      if (current === undefined || !ordered_projected_value_equal(current, op.prev)) {
        commit_projected_link(target, [Object.freeze({ kind: "replace", path: targetSourcePath, value: event.value })]);
        return;
      }
      writes.push(Object.freeze({
        kind: op.kind,
        path,
        from: op.from,
        to: op.to,
      }));
      continue;
    }
    if (op.kind === "move") {
      const path = link_target_path(op.path, options);
      if (path === undefined) continue;
      const targetProjected = livemap_projected_propagation(target);
      const current = targetProjected?.read(path);
      if (current === undefined || !ordered_projected_value_equal(current, op.prev)) {
        commit_projected_link(target, [Object.freeze({ kind: "replace", path: targetSourcePath, value: event.value })]);
        return;
      }
      writes.push(Object.freeze({
        kind: op.kind,
        path,
        from: op.from,
        to: op.to,
      }));
      continue;
    }
    if (op.kind !== "set" && op.kind !== "replace") continue;
    const path = link_target_path(op.path, options);
    if (path === undefined) continue;
    writes.push(Object.freeze({ kind: op.kind, path, value: op.next }));
  }
  if (writes.length > 0) commit_projected_link(target, writes);
}

function commit_projected_link(
  target: LiveMapCore,
  writes: readonly LiveMapProjectedPropagationWrite[],
): void {
  const scheduled = schedule_livemap_managed_mutation(target, (draft) => {
    const projected = livemap_projected_propagation(draft);
    if (projected === undefined) throw new Error("Managed LiveMap draft has no projected propagation capability.");
    return projected.commit(writes);
  });
  if (scheduled !== undefined) {
    void scheduled.catch(() => undefined);
    return;
  }
  const projected = livemap_projected_propagation(target);
  if (projected === undefined) throw new Error("LiveMap target has no projected propagation capability.");
  projected.commit(writes);
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
 * and object-valued `set` calls propagate as child set ops. Replacement at or
 * above the linked source scope propagates the current linked source value into
 * the target source path. Replacement below the linked source scope is
 * translated to the corresponding target path.
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
    target.replace(targetSourcePath, event.value);
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

      apply_link_set(target, targetPath, next as JsonValue);
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

function apply_link_set(target: LiveMapCore, targetPath: LivePath, value: JsonValue): void {
  const [key] = targetPath.slice(-1);

  if (typeof key !== "string") {
    target.set(targetPath, value);
    return;
  }

  target.setMany(targetPath.slice(0, -1), { [key]: value });
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

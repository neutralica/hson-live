// handle-api.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCommit, LiveMapCore, LiveMapDisposer, LiveMapPathHandle, LivePath } from "../../types/livemap.types.js";
import { must_json_value, must_live_path, must_set_many_values } from "./livemap.guard.js";
import { make_livemap_array_api } from "./livemap.handle-array.js";
import { make_livemap_object_api } from "./livemap.handle-object.js";
import { clone_live_path, format_live_path, parent_live_path, path_is_prefix } from "./livemap.path.js";
import { schedule_livemap_managed_mutation } from "./livemap.authority.js";
import {
  livemap_projected_propagation,
  type LiveMapProjectedPropagationWrite,
} from "./livemap.projected-propagation.js";
import {
  is_ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";


type LiveMapPathHandleCore = Pick<LiveMapCore<JsonValue | undefined>, "snap" | "at" | "set" | "replace" | "setMany" | "delete" | "feed" | "batch" | "splice" | "rev">;

type LiveMapPathHandleInternals = Readonly<{
  core: LiveMapPathHandleCore;
  path: LivePath;
}>;

const pathHandleInternals = new WeakMap<object, LiveMapPathHandleInternals>();

/** Exact-object evidence for a data location created by LiveMap. @internal */
export function is_livemap_projected_location(value: unknown): boolean {
  return typeof value === "object" && value !== null && pathHandleInternals.has(value);
}

/**
 * Create a small ergonomic handle for one projected LiveMap path.
 *
 * The handle copies the path once at creation time. That keeps the handle stable
 * even if a caller passed a mutable array and later changes it at runtime.
 *
 * `update` is deliberately just read/compute/set. It does not introduce
 * derived state, async lifecycle, patch/merge semantics, or batching.
 *
 * `set` requires the handle path to resolve and assigns primitives, arrays,
 * and null exactly; plain objects are shallow child writes that preserve
 * unspecified siblings. `replace` is exact replacement at the handle path with
 * replace-shaped commit ops. `setMany`
 * writes object properties below the handle path without removing unspecified
 * siblings. None of these imply array append, array insert, or deep merge.
 *
 * `delete` delegates to Core delete for this handle path. Delete is distinct
 * from setting undefined because undefined is not a JSON value.
 *
 * `linkTo` is one-way and live-only. It does not perform initial sync, loop
 * protection, transforms, or conflict resolution. Writes normally target the
 * linked handle with the same set/replace flavor observed from the source. If
 * the target handle points at a missing object property whose parent exists,
 * link propagation creates that property with `setMany`.
 *
 * Delete propagation follows the handle scope: deleting the exact handle path
 * deletes the target handle, while deleting below the handle path writes the
 * updated source handle value.
 */
export function make_livemap_path_handle<TValue = JsonValue | undefined>(
  core: LiveMapPathHandleCore,
  path: LivePath,
  watch: (listener: (next: TValue) => void) => LiveMapDisposer,
): LiveMapPathHandle<TValue> {
  const handlePath = must_live_path(path);

  const handle: LiveMapPathHandle<TValue> = {
    get rev() { return core.rev; },
    path: () => clone_live_path(handlePath),
    snap: () => core.snap(handlePath) as TValue,
    at: ((path: LivePath) => core.at([...handlePath, ...must_live_path(path)])) as unknown as LiveMapPathHandle<TValue>["at"],
    set: (value) => core.set(handlePath, must_json_value(value, handlePath)),
    replace: (value) => core.replace(handlePath, must_json_value(value, handlePath)),
    setMany: (values) => core.setMany(handlePath, must_set_many_values(values, handlePath)),
    delete: () => core.delete(handlePath),
    update: (updater) => core.set(handlePath, must_json_value(updater(core.snap(handlePath) as TValue), handlePath)),
    array: make_livemap_array_api(core, handlePath),
    object: make_livemap_object_api<TValue>(core, handlePath),
    feed: (listener) => core.feed(handlePath, listener),
    watch,
    linkTo: (target) => {
      const targetInternals = pathHandleInternals.get(target);
      if (targetInternals !== undefined) {
        const sourceProjected = livemap_projected_propagation(core);
        if (sourceProjected !== undefined) {
          return sourceProjected.feed(handlePath, (event) => {
            const deletion = event.ops.find((op) => op.kind === "delete");
            if (deletion !== undefined && path_is_prefix(deletion.path, handlePath)) {
              commit_projected_handle_link(targetInternals, [{ kind: "delete", path: targetInternals.path }]);
              return;
            }
            if (event.value === undefined) return;
            if (event.ops.length > 0 && event.ops.every((op) => op.kind === "rename" || op.kind === "move")) {
              const targetProjected = livemap_projected_propagation(targetInternals.core);
              const supported = targetProjected !== undefined && event.ops.every((op) => {
                const path = Object.freeze([
                  ...targetInternals.path,
                  ...op.path.slice(handlePath.length),
                ]);
                const current = targetProjected.read(path);
                return current !== undefined && ordered_projected_value_equal(current, op.prev);
              });
              if (!supported) {
                write_projected_handle_link(targetInternals, event.value, "set");
                return;
              }
              const writes = event.ops.flatMap((op): readonly LiveMapProjectedPropagationWrite[] => {
                if (!path_is_prefix(handlePath, op.path)) return [];
                if (op.kind === "rename") return [Object.freeze({
                  kind: op.kind,
                  path: Object.freeze([
                    ...targetInternals.path,
                    ...op.path.slice(handlePath.length),
                  ]),
                  from: op.from,
                  to: op.to,
                })];
                return [Object.freeze({
                  kind: op.kind,
                  path: Object.freeze([
                    ...targetInternals.path,
                    ...op.path.slice(handlePath.length),
                  ]),
                  from: op.from,
                  to: op.to,
                })];
              });
              if (writes.length > 0) {
                commit_projected_handle_link(targetInternals, writes);
                return;
              }
            }
            write_projected_handle_link(
              targetInternals,
              event.value,
              event.ops[0]?.kind === "replace" ? "replace" : "set",
            );
          });
        }
      }
      return core.feed(handlePath, (event) => {
      if (event.op.kind === "delete") {
        propagate_delete_link(handlePath, event.op.path, event.value, target);
        return;
      }

      if (event.value === undefined) return;
      write_link_target(target, event.value, event.op.kind === "replace" ? "replace" : "set");
      });
    },
  };

  pathHandleInternals.set(handle, { core, path: handlePath });
  return handle;
}

function write_projected_handle_link(
  target: LiveMapPathHandleInternals,
  value: OrderedProjectedValue,
  mode: "replace" | "set",
): void {
  commit_projected_handle_link(target, [{ kind: mode, path: target.path, value }], true);
}

function commit_projected_handle_link(
  target: LiveMapPathHandleInternals,
  writes: readonly LiveMapProjectedPropagationWrite[],
  allowMissingChild = false,
): void {
  const run = (candidate: object): LiveMapCommit => {
    const projected = livemap_projected_propagation(candidate);
    if (projected === undefined) throw new Error("LiveMap handle link target has no projected propagation capability.");
    if (allowMissingChild) must_handle_link_target(projected, target.path);
    return projected.commit(writes);
  };
  const scheduled = schedule_livemap_managed_mutation(target.core, (draft) => run(draft));
  if (scheduled !== undefined) {
    void scheduled.catch(() => undefined);
    return;
  }
  run(target.core);
}

function must_handle_link_target(
  projected: NonNullable<ReturnType<typeof livemap_projected_propagation>>,
  path: LivePath,
): void {
  if (path.length === 0 || projected.read(path) !== undefined) return;
  const parent = parent_live_path(path);
  const key = path[path.length - 1];
  if (parent !== undefined && typeof key === "string" && is_ordered_projected_object(projected.read(parent))) return;
  throw new Error(`LiveMap set path does not resolve: ${format_live_path(path)}`);
}

/**
 * Write a propagated link value to a target handle.
 *
 * Normal handle writes remain strict, but link propagation may create a missing
 * object child when the target parent exists. This keeps `source.at(...).linkTo`
 * useful for object-field fan-out without weakening public `set` semantics.
 */
function write_link_target(target: LiveMapPathHandle, value: JsonValue, mode: "replace" | "set"): void {
  const internals = pathHandleInternals.get(target);

  if (internals === undefined) {
    if (mode === "replace") target.replace(value);
    else target.set(value);
    return;
  }

  const scheduled = schedule_livemap_managed_mutation(internals.core, (draft) =>
    write_link_core(draft as LiveMapPathHandleCore, internals.path, value, mode));
  if (scheduled !== undefined) {
    void scheduled.catch(() => undefined);
    return;
  }
  write_link_core(internals.core, internals.path, value, mode);
}

function write_link_core(
  core: LiveMapPathHandleCore,
  targetPath: LivePath,
  value: JsonValue,
  mode: "replace" | "set",
): LiveMapCommit {

  if (targetPath.length === 0 || core.snap(targetPath) !== undefined) {
    return mode === "replace" ? core.replace(targetPath, value) : core.set(targetPath, value);
  }

  const parentPath = parent_live_path(targetPath);

  if (parentPath === undefined) {
    return mode === "replace" ? core.replace(targetPath, value) : core.set(targetPath, value);
  }
  const key = targetPath[targetPath.length - 1];
  const parentValue = core.snap(parentPath);

  if (typeof key === "string" && is_object_value(parentValue)) {
    return core.setMany(parentPath, { [key]: value });
  }

  return mode === "replace" ? core.replace(targetPath, value) : core.set(targetPath, value);
}

/** True for resolved JSON object values that can receive linked child writes. */
function is_object_value(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Propagate a delete observed by a source handle to its target handle.
 *
 * If the delete removes the source handle itself, or one of its ancestors, the
 * target handle is deleted. If the delete happens below the source handle, the
 * target receives the updated source handle value instead.
 */
function propagate_delete_link(
  sourcePath: LivePath,
  deletePath: LivePath,
  sourceValue: JsonValue | undefined,
  target: LiveMapPathHandle,
): void {
  const internals = pathHandleInternals.get(target);
  if (internals !== undefined) {
    const scheduled = schedule_livemap_managed_mutation(internals.core, (draft) =>
      propagate_delete_core(
        draft as LiveMapPathHandleCore,
        internals.path,
        sourcePath,
        deletePath,
        sourceValue,
      ));
    if (scheduled !== undefined) {
      void scheduled.catch(() => undefined);
      return;
    }
    propagate_delete_core(internals.core, internals.path, sourcePath, deletePath, sourceValue);
    return;
  }
  if (path_is_prefix(deletePath, sourcePath)) {
    target.delete();
    return;
  }

  if (path_is_prefix(sourcePath, deletePath) && sourceValue !== undefined) {
    target.replace(sourceValue);
  }
}

function propagate_delete_core(
  core: LiveMapPathHandleCore,
  targetPath: LivePath,
  sourcePath: LivePath,
  deletePath: LivePath,
  sourceValue: JsonValue | undefined,
): LiveMapCommit {
  if (path_is_prefix(deletePath, sourcePath)) return core.delete(targetPath);
  if (path_is_prefix(sourcePath, deletePath) && sourceValue !== undefined) {
    return core.replace(targetPath, sourceValue);
  }
  return core.batch(() => {});
}

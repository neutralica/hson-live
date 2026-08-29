import { ARR_TAG, OBJ_TAG } from "../../core/constants.js";
import {
  assign_hson_node_quid,
  is_projected_container_quid_eligible,
  read_hson_node_quid,
  scan_hson_node_quids,
} from "../../core/hson-node-quid.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type { LivePath } from "../../types/livemap.types.js";
import { resolve_value_node } from "./livemap.editor.js";
import { clone_live_path, live_path_key } from "./livemap.path.js";
import type { LiveMapProjectedDataOp } from "./livemap.transport.js";

export type LiveMapProjectedIdentityOverlay = Readonly<{
  size: number;
  pathForQuid: (quid: string) => LivePath | undefined;
  quidAtPath: (path: LivePath) => string | undefined;
}>;

const entriesForOverlay = new WeakMap<LiveMapProjectedIdentityOverlay, ReadonlyMap<string, LivePath>>();
let completedBuilds = 0;
let completedReconciliations = 0;
let completedEntriesVisited = 0;

/** Build sparse identity correspondence from semantic data values only. */
export function build_livemap_projected_identity_overlay(root: HsonNode): LiveMapProjectedIdentityOverlay {
  const allClaims = scan_hson_node_quids(root);
  const byQuid = new Map<string, LivePath>();
  const byPath = new Map<string, string>();
  const stack: LivePath[] = [Object.freeze([])];

  while (stack.length > 0) {
    const path = stack.pop();
    if (path === undefined) continue;
    const node = resolve_value_node(root, path);
    if (node === undefined) throw new Error(`Data identity path ${JSON.stringify(path)} does not resolve.`);
    const quid = read_hson_node_quid(node);
    if (quid !== undefined) add_entry(byQuid, byPath, quid, path);

    if (node.$_tag === ARR_TAG) {
      for (let index = node.$_content.length - 1; index >= 0; index -= 1) {
        stack.push(clone_live_path([...path, index]));
      }
      continue;
    }
    if (node.$_tag === OBJ_TAG && is_projected_container_quid_eligible(node)) {
      for (let index = node.$_content.length - 1; index >= 0; index -= 1) {
        const child = node.$_content[index];
        if (is_Node(child) && !child.$_tag.startsWith("_hson_")) {
          stack.push(clone_live_path([...path, child.$_tag]));
        }
      }
    }
  }

  if (byQuid.size !== allClaims.size) {
    throw new Error("Projected LiveMap contains a QUID outside a semantic object/array value.");
  }
  completedBuilds += 1;
  return make_overlay(byQuid, byPath);
}

/** Transform sparse paths from the same semantic operations that change data. */
export function reconcile_livemap_projected_identity_overlay(
  current: LiveMapProjectedIdentityOverlay,
  ops: readonly LiveMapProjectedDataOp[],
): LiveMapProjectedIdentityOverlay {
  if (ops.length === 0 || current.size === 0) return current;
  const byQuid = new Map<string, LivePath>();
  const byPath = new Map<string, string>();
  completedReconciliations += 1;
  completedEntriesVisited += current.size;
  for (const [quid, initialPath] of require_entries(current)) {
    let path: LivePath | undefined = initialPath;
    for (const op of ops) {
      if (path === undefined) break;
      path = transform_path(path, op);
    }
    if (path !== undefined) add_entry(byQuid, byPath, quid, path);
  }
  return make_overlay(byQuid, byPath);
}

/** Register one already-validated supplied claim without scanning the graph. */
export function register_livemap_projected_identity_at_path(
  current: LiveMapProjectedIdentityOverlay,
  quid: string,
  path: LivePath,
): LiveMapProjectedIdentityOverlay {
  const existingPath = current.pathForQuid(quid);
  if (existingPath !== undefined && live_path_key(existingPath) !== live_path_key(path)) {
    throw new Error(`Projected QUID ${JSON.stringify(quid)} already exists at ${JSON.stringify(existingPath)}.`);
  }
  const existing = current.quidAtPath(path);
  if (existing !== undefined && existing !== quid) {
    throw new Error(`Data path ${JSON.stringify(path)} already carries a different QUID.`);
  }
  if (existing === quid) return current;
  const byQuid = new Map(require_entries(current));
  const byPath = new Map<string, string>();
  for (const [activeQuid, activePath] of byQuid) byPath.set(live_path_key(activePath), activeQuid);
  add_entry(byQuid, byPath, quid, path);
  completedReconciliations += 1;
  completedEntriesVisited += current.size;
  return make_overlay(byQuid, byPath);
}

/** Reinstall sparse metadata onto a freshly planned data graph. */
export function apply_livemap_projected_identity_overlay(
  root: HsonNode,
  overlay: LiveMapProjectedIdentityOverlay,
): void {
  for (const [quid, path] of require_entries(overlay)) {
    const node = resolve_value_node(root, path);
    if (node === undefined || !is_projected_container_quid_eligible(node)) {
      throw new Error(`Data identity path ${JSON.stringify(path)} no longer resolves to an eligible container.`);
    }
    assign_hson_node_quid(node, quid);
  }
}

export function livemap_projected_identity_accounting(): Readonly<{
  fullBuilds: number;
  reconciliations: number;
  overlayEntriesVisited: number;
}> {
  return Object.freeze({
    fullBuilds: completedBuilds,
    reconciliations: completedReconciliations,
    overlayEntriesVisited: completedEntriesVisited,
  });
}

/** Return detached active QUID bytes for owner-epoch ledger staging. @internal */
export function livemap_projected_identity_quids(
  overlay: LiveMapProjectedIdentityOverlay,
): readonly string[] {
  return Object.freeze([...require_entries(overlay).keys()]);
}

export function livemap_projected_identity_has_at_or_below(
  overlay: LiveMapProjectedIdentityOverlay,
  path: LivePath,
): boolean {
  for (const activePath of require_entries(overlay).values()) {
    if (path_is_prefix(path, activePath)) return true;
  }
  return false;
}

function transform_path(path: LivePath, op: LiveMapProjectedDataOp): LivePath | undefined {
  if (op.kind === "rename") return transform_rename(path, op.path, op.from, op.to);
  if (op.kind === "move") return transform_move(path, op.path, op.from, op.to);
  if (op.kind === "splice") return transform_splice(path, op.path, op.start, op.removed.length, op.inserted.length);
  return path_is_prefix(op.path, path) ? undefined : path;
}

function transform_rename(path: LivePath, parent: LivePath, from: string, to: string): LivePath | undefined {
  if (from === to || !path_is_prefix(parent, path) || path.length === parent.length) return path;
  const key = path[parent.length];
  if (key === from) return clone_live_path([...parent, to, ...path.slice(parent.length + 1)]);
  if (key === to) return undefined;
  return path;
}

function transform_move(path: LivePath, parent: LivePath, from: number, to: number): LivePath {
  if (from === to || !path_is_prefix(parent, path) || path.length === parent.length) return path;
  const index = path[parent.length];
  if (typeof index !== "number") return path;
  let next = index;
  if (index === from) next = to;
  else if (from < to && index > from && index <= to) next = index - 1;
  else if (to < from && index >= to && index < from) next = index + 1;
  return next === index ? path : clone_live_path([...parent, next, ...path.slice(parent.length + 1)]);
}

function transform_splice(
  path: LivePath,
  parent: LivePath,
  start: number,
  removed: number,
  inserted: number,
): LivePath | undefined {
  if (!path_is_prefix(parent, path) || path.length === parent.length) return path;
  const index = path[parent.length];
  if (typeof index !== "number") return path;
  if (index >= start && index < start + removed) return undefined;
  if (index < start + removed) return path;
  const next = index + inserted - removed;
  return next === index ? path : clone_live_path([...parent, next, ...path.slice(parent.length + 1)]);
}

function path_is_prefix(prefix: LivePath, path: LivePath): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => part === path[index]);
}

function add_entry(
  byQuid: Map<string, LivePath>,
  byPath: Map<string, string>,
  quid: string,
  pathInput: LivePath,
): void {
  const path = clone_live_path(pathInput);
  const priorPath = byQuid.get(quid);
  if (priorPath !== undefined && live_path_key(priorPath) !== live_path_key(path)) {
    throw new Error(`Duplicate projected QUID ${JSON.stringify(quid)}.`);
  }
  const key = live_path_key(path);
  const priorQuid = byPath.get(key);
  if (priorQuid !== undefined && priorQuid !== quid) throw new Error(`Data identity collision at ${key}.`);
  byQuid.set(quid, path);
  byPath.set(key, quid);
}

function make_overlay(
  byQuid: ReadonlyMap<string, LivePath>,
  byPath: ReadonlyMap<string, string>,
): LiveMapProjectedIdentityOverlay {
  const overlay = Object.freeze({
    size: byQuid.size,
    pathForQuid: (quid: string) => byQuid.get(quid),
    quidAtPath: (path: LivePath) => byPath.get(live_path_key(path)),
  });
  entriesForOverlay.set(overlay, byQuid);
  return overlay;
}

function require_entries(overlay: LiveMapProjectedIdentityOverlay): ReadonlyMap<string, LivePath> {
  const entries = entriesForOverlay.get(overlay);
  if (entries !== undefined) return entries;
  throw new Error("Data identity overlay is not owned by this implementation.");
}

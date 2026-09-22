import { is_Node } from "../core/node-guards.js";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../core/ordered-projected-value.js";
import type { HsonNode } from "../core/types.js";
import type { LiveMapGraphOp } from "../types/livemap.types.js";
import type { LiveMapDocumentIdentityOverlay } from "../api/livemap/livemap.document.identity.js";
import {
  document_path_effect_for_graph_operation,
  resolve_document_path,
  transform_document_path,
  validate_document_path,
} from "../api/livemap/livemap.document.path.js";

function field(value: OrderedProjectedObject, name: string): OrderedProjectedValue | undefined {
  return value.entries.find(([key]) => key === name)?.[1];
}

/** Check the portable coordinate against the fixed application registry. */
export function validate_interaction_subjects(
  descriptors: OrderedProjectedValue | undefined,
  isDocumentLibrary: (name: string) => boolean,
): void {
  if (!Array.isArray(descriptors)) throw new TypeError("Canonical interaction descriptors must be an array.");
  for (const entry of descriptors) {
    if (!is_ordered_projected_object(entry)) throw new TypeError("Canonical interaction descriptor is malformed.");
    const subject = field(entry, "subject");
    if (!is_ordered_projected_object(subject)) throw new TypeError("Canonical interaction subject is malformed.");
    const library = field(subject, "library");
    if (typeof library !== "string" || !isDocumentLibrary(library)) {
      throw new TypeError("Canonical interaction subject must name a document Library.");
    }
    validate_document_path(field(subject, "path"));
  }
}

/** Rewrite established subjects through the same path effect as the document overlay. */
export function rewrite_interaction_subjects(
  descriptors: OrderedProjectedValue,
  library: string,
  beforeRoot: HsonNode,
  beforeOverlay: LiveMapDocumentIdentityOverlay,
  afterOverlay: LiveMapDocumentIdentityOverlay,
  operation: LiveMapGraphOp,
): OrderedProjectedValue | undefined {
  const effect = document_path_effect_for_graph_operation(operation);
  if (effect === undefined || !Array.isArray(descriptors)) return undefined;
  let changed = false;
  const next: OrderedProjectedValue[] = [];
  for (const entry of descriptors) {
    if (!is_ordered_projected_object(entry)) throw new TypeError("Canonical interaction descriptor is malformed.");
    const subject = field(entry, "subject");
    if (!is_ordered_projected_object(subject) || field(subject, "library") !== library) {
      next.push(entry);
      continue;
    }
    const path = validate_document_path(field(subject, "path"));
    // An authored, as-yet-unrealized coordinate has no subject lifetime to move
    // or terminate. It can activate when a subject first appears at that path.
    let present = false;
    try { present = is_Node(resolve_document_path(beforeRoot, "document", path)); }
    catch { /* currently unresolved */ }
    if (!present) {
      next.push(entry);
      continue;
    }
    const priorQuid = beforeOverlay.quidAtPath(path);
    const continuedPath = priorQuid === undefined ? undefined : afterOverlay.pathForQuid(priorQuid);
    const transformed = transform_document_path(path, effect);
    if (transformed.kind === "invalid") throw new TypeError(transformed.reason);
    const targetPath = continuedPath ?? (transformed.kind === "retired" ? undefined : transformed.path);
    if (targetPath === undefined) {
      changed = true;
      continue;
    }
    if (transformed.kind === "unchanged" && continuedPath === undefined) {
      next.push(entry);
      continue;
    }
    if (targetPath.length === path.length && targetPath.every((part, index) => part === path[index])) {
      next.push(entry);
      continue;
    }
    changed = true;
    const rewrittenSubject = ordered_projected_object(subject.entries.map(([key, value]) =>
      [key, key === "path" ? ordered_projected_array([...targetPath]) : value] as const));
    next.push(ordered_projected_object(entry.entries.map(([key, value]) =>
      [key, key === "subject" ? rewrittenSubject : value] as const)));
  }
  return changed ? ordered_projected_array(next) : undefined;
}

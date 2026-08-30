import { STR_TAG } from "../../core/constants.js";
import type { HsonNode } from "../../core/types.js";
import {
  InternalDocumentTraversalError,
  resolve_internal_document_location,
  type InternalDocumentLogicalEdge,
  type InternalDocumentLogicalResolution,
  type InternalDocumentPhysicalAssociation,
} from "../../api/livemap/livemap.document.logical.js";
import type { LiveMapSchemaIssue } from "../../api/livemap/livemap.schema.js";
import type { DocumentLiveMapMode, LivePath } from "../../types/livemap.types.js";
import type {
  HsonAttributeSourceRole,
  HsonNodeSourceRole,
  HsonSourcePath,
  HsonSourceProvenance,
  HsonSourceRange,
} from "../hson-source-provenance/hson-source-provenance.js";

type DocumentSchemaSourceRole = HsonNodeSourceRole | HsonAttributeSourceRole;

export type DocumentSchemaSourceResolution =
  | Readonly<{
      kind: "exact";
      range: HsonSourceRange;
      issuePath: LivePath;
      physicalPath: HsonSourcePath;
      role: DocumentSchemaSourceRole;
      attributeName?: string;
    }>
  | Readonly<{
      kind: "anchor";
      range: HsonSourceRange;
      issuePath: LivePath;
      parentPath: LivePath;
      physicalPath: HsonSourcePath;
      role: HsonNodeSourceRole;
    }>
  | Readonly<{ kind: "unresolved"; issuePath: LivePath }>;

type DocumentSchemaSourceIssue = Pick<LiveMapSchemaIssue, "code" | "path" | "attributeName">;

/**
 * Lower one document-Schema issue through the canonical logical document
 * resolver and onto immutable authored-Hson provenance.
 */
export function resolve_document_schema_issue_source(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  provenance: HsonSourceProvenance,
  issue: DocumentSchemaSourceIssue,
): DocumentSchemaSourceResolution {
  const numericPath = numeric_document_path(issue.path);
  if (numericPath === undefined) return unresolved(issue.path);

  if (issue.attributeName !== undefined) {
    return resolve_attribute_issue(root, mode, provenance, issue, numericPath, issue.attributeName);
  }
  if (issue.code === "MISSING_REQUIRED") {
    return resolve_missing_anchor(root, mode, provenance, issue, numericPath);
  }

  const resolution = resolve_logical(root, mode, numericPath);
  if (resolution === undefined) return unresolved(issue.path);
  const physicalPath = provenance_path(mode, resolution.physical);
  if (physicalPath === undefined) return unresolved(issue.path);

  if (resolution.kind === "node" && resolution.value.$_tag === STR_TAG) {
    const payloadPath = Object.freeze([...physicalPath, 0]);
    const value = node_range(provenance, payloadPath, "value");
    if (value !== undefined) return exact(issue.path, payloadPath, "value", value);
  }

  const coverage = node_range(provenance, physicalPath, "coverage");
  if (coverage !== undefined) return exact(issue.path, physicalPath, "coverage", coverage);
  return unresolved(issue.path);
}

function resolve_attribute_issue(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  provenance: HsonSourceProvenance,
  issue: DocumentSchemaSourceIssue,
  numericPath: readonly number[],
  attributeName: string,
): DocumentSchemaSourceResolution {
  const owner = resolve_logical(root, mode, numericPath);
  if (owner === undefined) return unresolved(issue.path);
  const ownerPath = provenance_path(mode, owner.physical);
  if (ownerPath === undefined) return unresolved(issue.path);

  if (issue.code === "MISSING_REQUIRED") {
    return anchor_to_node(provenance, issue.path, issue.path, ownerPath);
  }

  const roles: readonly HsonAttributeSourceRole[] = issue.code === "UNKNOWN_KEY"
    ? ["name", "coverage"]
    : ["value", "coverage"];
  for (const role of roles) {
    const range = provenance.range({
      kind: "attribute",
      owner: ownerPath,
      name: attributeName,
      role,
    });
    if (range !== undefined) {
      return Object.freeze({
        kind: "exact",
        range,
        issuePath: issue.path,
        physicalPath: ownerPath,
        role,
        attributeName,
      });
    }
  }
  return unresolved(issue.path);
}

function resolve_missing_anchor(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  provenance: HsonSourceProvenance,
  issue: DocumentSchemaSourceIssue,
  numericPath: readonly number[],
): DocumentSchemaSourceResolution {
  if (numericPath.length === 0) return unresolved(issue.path);
  const parentPath = Object.freeze([...numericPath.slice(0, -1)]);
  const parent = resolve_logical(root, mode, parentPath);
  if (parent === undefined) return unresolved(issue.path);
  const physicalPath = provenance_path(mode, parent.physical);
  if (physicalPath === undefined) return unresolved(issue.path);
  return anchor_to_node(provenance, issue.path, parentPath, physicalPath);
}

function anchor_to_node(
  provenance: HsonSourceProvenance,
  issuePath: LivePath,
  parentPath: LivePath,
  physicalPath: HsonSourcePath,
): DocumentSchemaSourceResolution {
  for (const role of ["close", "name", "coverage"] as const) {
    const range = node_range(provenance, physicalPath, role);
    if (range !== undefined) {
      return Object.freeze({
        kind: "anchor",
        range,
        issuePath,
        parentPath,
        physicalPath,
        role,
      });
    }
  }
  return unresolved(issuePath);
}

function resolve_logical(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  path: readonly number[],
): InternalDocumentLogicalResolution | undefined {
  const edges: InternalDocumentLogicalEdge[] = path.map((index) => ({ kind: "content", index }));
  try {
    return resolve_internal_document_location(root, mode, edges);
  } catch (cause) {
    if (cause instanceof InternalDocumentTraversalError) return undefined;
    throw cause;
  }
}

function provenance_path(
  mode: DocumentLiveMapMode,
  physical: InternalDocumentPhysicalAssociation,
): HsonSourcePath | undefined {
  const path = physical.kind === "direct" || physical.kind === "carrier"
    ? physical.path
    : physical.kind === "facet"
      ? physical.ownerPath
      : physical.reason === "empty-element-content"
        ? physical.ownerPath
        : undefined;
  if (path === undefined) return undefined;
  return Object.freeze(mode === "element" ? [0, ...path] : [...path]);
}

function node_range(
  provenance: HsonSourceProvenance,
  path: HsonSourcePath,
  role: HsonNodeSourceRole,
): HsonSourceRange | undefined {
  return provenance.range({ kind: "node", path, role });
}

function exact(
  issuePath: LivePath,
  physicalPath: HsonSourcePath,
  role: HsonNodeSourceRole,
  range: HsonSourceRange,
): DocumentSchemaSourceResolution {
  return Object.freeze({ kind: "exact", range, issuePath, physicalPath, role });
}

function unresolved(issuePath: LivePath): DocumentSchemaSourceResolution {
  return Object.freeze({ kind: "unresolved", issuePath });
}

function numeric_document_path(path: LivePath): readonly number[] | undefined {
  const numeric: number[] = [];
  for (const part of path) {
    if (typeof part !== "number" || !Number.isSafeInteger(part) || part < 0) return undefined;
    numeric.push(part);
  }
  return Object.freeze(numeric);
}

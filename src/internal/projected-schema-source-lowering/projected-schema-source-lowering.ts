import type { HsonNode } from "../../core/types.js";
import {
  resolve_projected_hson_location,
  type InternalProjectedHsonLocation,
} from "../../api/livemap/livemap.editor.js";
import type { LiveMapSchemaIssue } from "../../api/livemap/livemap.schema.js";
import type { LivePath } from "../../types/livemap.types.js";
import type {
  HsonNodeSourceRole,
  HsonSourcePath,
  HsonSourceProvenance,
  HsonSourceRange,
} from "../hson-source-provenance/hson-source-provenance.js";

export type ProjectedSchemaSourceResolution =
  | Readonly<{
      kind: "exact";
      range: HsonSourceRange;
      issuePath: LivePath;
      physicalPath: HsonSourcePath;
      role: HsonNodeSourceRole;
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

/**
 * Lower a projected Schema issue onto immutable authored-Hson provenance.
 * Schema owns the logical issue path; this module owns wrapper/path lowering;
 * the provenance sidecar remains the only source-offset authority.
 */
export function resolve_projected_schema_issue_source(
  root: HsonNode,
  provenance: HsonSourceProvenance,
  issue: LiveMapSchemaIssue,
): ProjectedSchemaSourceResolution {
  if (issue.code === "MISSING_REQUIRED") {
    return resolve_missing_anchor(root, provenance, issue);
  }

  const location = resolve_projected_hson_location(root, issue.path);
  if (location === undefined) return unresolved(issue.path);

  if (issue.code === "UNKNOWN_KEY") {
    const name = range_at(provenance, location.wrapperPath, "name");
    if (name !== undefined) return exact(issue.path, location.wrapperPath, "name", name);
  }

  const value = range_for_value(provenance, location);
  if (value !== undefined) return exact(issue.path, value.path, value.role, value.range);

  const coverage = range_at(provenance, location.valuePath, "coverage");
  if (coverage !== undefined) return exact(issue.path, location.valuePath, "coverage", coverage);
  return unresolved(issue.path);
}

function resolve_missing_anchor(
  root: HsonNode,
  provenance: HsonSourceProvenance,
  issue: LiveMapSchemaIssue,
): ProjectedSchemaSourceResolution {
  const parentPath = Object.freeze([...issue.path.slice(0, -1)]);
  const parent = resolve_projected_hson_location(root, parentPath);
  if (parent === undefined) return unresolved(issue.path);

  for (const candidate of [
    { path: parent.valuePath, role: "close" as const },
    { path: parent.wrapperPath, role: "name" as const },
    { path: parent.valuePath, role: "coverage" as const },
  ]) {
    const range = range_at(provenance, candidate.path, candidate.role);
    if (range !== undefined) {
      return Object.freeze({
        kind: "anchor",
        range,
        issuePath: issue.path,
        parentPath,
        physicalPath: candidate.path,
        role: candidate.role,
      });
    }
  }
  return unresolved(issue.path);
}

function range_for_value(
  provenance: HsonSourceProvenance,
  location: InternalProjectedHsonLocation,
): Readonly<{ path: HsonSourcePath; role: HsonNodeSourceRole; range: HsonSourceRange }> | undefined {
  if (location.scalarValuePath !== undefined) {
    const range = range_at(provenance, location.scalarValuePath, "value");
    if (range !== undefined) return { path: location.scalarValuePath, role: "value", range };
  }
  return undefined;
}

function range_at(
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
): ProjectedSchemaSourceResolution {
  return Object.freeze({ kind: "exact", range, issuePath, physicalPath, role });
}

function unresolved(issuePath: LivePath): ProjectedSchemaSourceResolution {
  return Object.freeze({ kind: "unresolved", issuePath });
}

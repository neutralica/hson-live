import { STR_TAG, ELEM_TAG, ROOT_TAG } from "../../core/constants.js";
import type { HsonNode } from "../../core/types.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonSchemaIssue } from "../../api/livemap/livemap.error.js";
import type { LiveMapDocumentMode, LivePath } from "../../types/livemap.types.js";
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

type DocumentSchemaSourceIssue = Pick<HsonSchemaIssue, "code" | "path" | "attributeName">;

/**
 * Lower canonical evaluator paths (including the document item index) onto
 * the exact parsed root used to bind authored-Hson provenance.
 */
export function resolve_document_schema_issue_source(
  root: HsonNode,
  _mode: LiveMapDocumentMode,
  provenance: HsonSourceProvenance,
  issue: DocumentSchemaSourceIssue,
): DocumentSchemaSourceResolution {
  const numericPath = numeric_document_path(issue.path);
  if (numericPath === undefined) return unresolved(issue.path);

  if (issue.attributeName !== undefined) {
    return resolve_attribute_issue(root, provenance, issue, numericPath, issue.attributeName);
  }
  if (issue.code === "MISSING_REQUIRED") {
    return resolve_missing_anchor(root, provenance, issue, numericPath);
  }

  const resolution = resolve_candidate_location(root, numericPath);
  if (resolution === undefined) return unresolved(issue.path);
  const physicalPath = resolution.physical;

  if (resolution.value.$_tag === STR_TAG) {
    const payloadPath = Object.freeze([...physicalPath, 0]);
    const value = node_range(provenance, payloadPath, "value");
    if (value !== undefined) return exact(issue.path, payloadPath, "value", value);
  }

  if (issue.code === "INVALID_LITERAL") {
    const name = node_range(provenance, physicalPath, "name");
    if (name !== undefined) return exact(issue.path, physicalPath, "name", name);
  }

  const coverage = node_range(provenance, physicalPath, "coverage");
  if (coverage !== undefined) return exact(issue.path, physicalPath, "coverage", coverage);
  return unresolved(issue.path);
}

function resolve_attribute_issue(
  root: HsonNode,
  provenance: HsonSourceProvenance,
  issue: DocumentSchemaSourceIssue,
  numericPath: readonly number[],
  attributeName: string,
): DocumentSchemaSourceResolution {
  const owner = resolve_candidate_location(root, numericPath);
  if (owner === undefined) return unresolved(issue.path);
  const ownerPath = owner.physical;

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
  provenance: HsonSourceProvenance,
  issue: DocumentSchemaSourceIssue,
  numericPath: readonly number[],
): DocumentSchemaSourceResolution {
  if (numericPath.length === 0) return unresolved(issue.path);
  const parentPath = Object.freeze([...numericPath.slice(0, -1)]);
  const parent = resolve_candidate_location(root, parentPath);
  if (parent === undefined) return unresolved(issue.path);
  const physicalPath = parent.physical;
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

type CandidateLocation = Readonly<{ value: HsonNode; physical: HsonSourcePath }>;

function resolve_candidate_location(root: HsonNode, path: readonly number[]): CandidateLocation | undefined {
  let value = root;
  const physical: number[] = [];
  if (path.length === 0) return { value, physical: Object.freeze(physical) };
  if (value.$_tag === ROOT_TAG && value.$_content.length === 1 && is_Node(value.$_content[0]) && value.$_content[0].$_tag === ELEM_TAG) {
    value = value.$_content[0]; physical.push(0);
  }
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth]!;
    if (depth === 0 && value.$_tag !== ELEM_TAG && value.$_tag !== ROOT_TAG) {
      // An ordinary element is itself the sole document item.
      if (index !== 0) return undefined;
      continue;
    }
    if (depth > 0) {
      const cluster = value.$_content[0];
      if (value.$_content.length !== 1 || !is_Node(cluster) || cluster.$_tag !== ELEM_TAG) return undefined;
      value = cluster; physical.push(0);
    }
    const child = value.$_content[index];
    if (!is_Node(child)) return undefined;
    value = child; physical.push(index);
  }
  return { value, physical: Object.freeze(physical) };
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

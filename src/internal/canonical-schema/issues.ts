import type { LiveMapSchemaIssueCode, LivePath } from "../../types/livemap.types.js";
import type { CanonicalRefinementRule, CanonicalSchemaNodeRef } from "./graph.js";

export type CanonicalGraphIssueEvidence = Readonly<{
  kind:
    | "type-mismatch"
    | "missing-required"
    | "unknown-key"
    | "tuple-index-out-of-range"
    | "literal-mismatch"
    | "union-failure"
    | "document-tag-mismatch"
    | "attr-missing"
    | "attr-invalid"
    | "flag-mismatch"
    | "refinement-failure"
    | "invalid-graph"
    | "resource-limit";
  branches?: readonly CanonicalSchemaNodeRef[];
  detail?: string;
  refinement?: CanonicalRefinementRule;
  actualLength?: number;
}>;

export type CanonicalGraphIssue = Readonly<{
  code: LiveMapSchemaIssueCode;
  path: LivePath;
  schemaNode: CanonicalSchemaNodeRef;
  expected?: string;
  received?: string;
  attributeName?: string;
  evidence: CanonicalGraphIssueEvidence;
}>;

export type CanonicalGraphEvaluation = Readonly<{
  ok: boolean;
  issues: readonly CanonicalGraphIssue[];
}>;

export type CanonicalGraphVerificationIssue = Readonly<{
  code: "INVALID_GRAPH";
  path: readonly (string | number)[];
  message: string;
}>;

export type CanonicalGraphVerification =
  | Readonly<{ ok: true; graph: import("./graph.js").VerifiedCanonicalSchemaGraph }>
  | Readonly<{ ok: false; issues: readonly CanonicalGraphVerificationIssue[] }>;

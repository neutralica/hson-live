import type { CompiledHsonSchema } from "./compiler.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import { resolve_document_schema_issue_source } from "../document-schema-source-lowering/document-schema-source-lowering.js";
import { resolve_projected_schema_issue_source } from "../projected-schema-source-lowering/projected-schema-source-lowering.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import type { HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";

export type StaticSchemaCandidate = Readonly<{ source: string; family: "data" | "document" | "canonical" }> | Readonly<{ json: unknown }>;
export type StaticSchemaEvaluation = Readonly<{ kind: "valid" }> | Readonly<{ kind: "unknown"; error?: string }>
  | Readonly<{ kind: "invalid"; issue: CanonicalGraphIssue; range?: HsonSourceRange }>;

/** One context-aware canonical evaluation for annotation proof and relationships. */
export function evaluate_static_schema_candidate(compiled: CompiledHsonSchema, candidate: StaticSchemaCandidate): StaticSchemaEvaluation {
  try {
    const document = compiled.semantic.kind === "document" || compiled.semantic.kind === "document-element";
    // A different carrier family cannot establish this proof.
    const family = "json" in candidate ? "data" : candidate.family === "canonical" ? document ? "document" : "data" : candidate.family;
    if (family !== (document ? "document" : "data")) return { kind: "unknown" };
    const parsed = "source" in candidate ? parse_hson_with_provenance(candidate.source, { allowTopLevelDocumentText: family === "document" }) : undefined;
    const result = document && parsed !== undefined ? evaluate_canonical_document_schema(compiled.graph, parsed.value)
      : evaluate_canonical_projected_schema(compiled.graph, "json" in candidate ? admit_projected_value(candidate.json) : projected_value_from_hson_node(parsed!.value));
    if (result.ok) return { kind: "valid" };
    const issue = result.issues[0];
    if (issue === undefined || issue.evidence.kind === "resource-limit" || issue.code === "INVALID_SCHEMA") return { kind: "unknown" };
    const resolution = parsed === undefined ? undefined : document
      ? resolve_document_schema_issue_source(parsed.value, "document", parsed.provenance, issue)
      : resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue);
    return { kind: "invalid", issue, ...(resolution === undefined || resolution.kind === "unresolved" ? {} : { range: resolution.range }) };
  } catch (error) { return { kind: "unknown", ...(error instanceof Error ? { error: error.message } : {}) }; }
}

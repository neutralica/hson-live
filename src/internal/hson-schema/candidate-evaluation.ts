import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { CompiledHsonSchema } from "./compiler.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import { canonical_hson_data_from_node } from "../../core/hson-data-canonical-codec.js";
import { assert_canonical_hson_data_value } from "../../core/projected-value-graph.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import { resolve_document_schema_issue_source } from "../document-schema-source-lowering/document-schema-source-lowering.js";
import { resolve_projected_schema_issue_source } from "../projected-schema-source-lowering/projected-schema-source-lowering.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import type { HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import type { HsonNode } from "../../core/types.js";
import { expand_document_composition, document_composition_options, has_part_connector } from "../../api/livemap/livemap.document.composition.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { admit_public_livemap_root, qualify_livemap_document } from "../../api/livemap/livemap.node-admission.js";
import { validate_part_collection, type ValidatedPart } from "../../api/livemap/livemap.parts.js";

export type StaticSchemaCandidate = Readonly<{ source: string; family: "data" | "document" | "canonical" }> | Readonly<{ json: unknown }> | Readonly<{ data: OrderedProjectedValue }>;
export type StaticSchemaEvaluation = Readonly<{ kind: "valid" }> | Readonly<{ kind: "unknown"; error?: string }>
  | Readonly<{ kind: "invalid"; issue: CanonicalGraphIssue; range?: HsonSourceRange; relatedRange?: HsonSourceRange }>;

/** One context-aware canonical evaluation for annotation proof and relationships. */
export function evaluate_static_schema_candidate(compiled: CompiledHsonSchema, candidate: StaticSchemaCandidate,
  parts?: Pick<ReadonlyMap<string, unknown>, "get">): StaticSchemaEvaluation {
  try {
    const document = compiled.semantic.kind === "document" || compiled.semantic.kind === "document-element";
    // A different carrier family cannot establish this proof.
    const family = "json" in candidate || "data" in candidate ? "data" : candidate.family === "canonical" ? document ? "document" : "data" : candidate.family;
    if (family !== (document ? "document" : "data")) return { kind: "unknown" };
    const authored = document && "source" in candidate ? parse_authored_document_library(candidate.source) : undefined;
    let realized: HsonNode | undefined;
    if (authored !== undefined && has_part_connector(authored.root)) {
      // Every referenced collection needs an authoritative same-batch proof.
      // No receiving runtime, Part facade, identity overlay or publication is created.
      if (parts === undefined) return { kind: "unknown" };
      const collections = new Map<string, readonly ValidatedPart[]>();
      realized = expand_document_composition("static-candidate", () => ({
        root: admit_public_livemap_root(authored.root, "document", "Static document candidate"), quads: authored.declarations,
      }), document_composition_options(undefined), (collection, member) => {
        let validated = collections.get(collection);
        if (validated === undefined) {
          const value = parts.get(collection);
          if (value === undefined) throw new Error("Static Part inventory is unavailable.");
          validated = validate_part_collection(admit_projected_value(value));
          collections.set(collection, validated);
        }
        const selected = validated.find(part => part.key === member);
        if (selected === undefined) throw new Error("Static Part member is unavailable.");
        return selected;
      }).root;
      qualify_livemap_document(realized, "Static realized document candidate");
    }
    // Composition has no authored path sidecar. Retain the existing whole-candidate
    // diagnostic anchor instead of applying realized paths to unexpanded source.
    const parsed = realized === undefined && "source" in candidate
      ? parse_hson_with_provenance(candidate.source, { allowTopLevelDocumentText: family === "document" }) : undefined;
    const documentRoot = realized ?? (document ? parsed?.value : undefined);
    let result;
    if (documentRoot !== undefined) {
      result = evaluate_canonical_document_schema(compiled.graph, documentRoot);
    } else if ("json" in candidate || "data" in candidate) {
      const value = "json" in candidate ? admit_projected_value(candidate.json) : candidate.data;
      assert_canonical_hson_data_value(value);
      result = evaluate_canonical_projected_schema(compiled.graph, value);
    } else if (parsed !== undefined) {
      result = evaluate_canonical_projected_schema(compiled.graph, canonical_hson_data_from_node(parsed.value));
    } else {
      return { kind: "unknown" };
    }
    if (result.ok) return { kind: "valid" };
    const issue = result.issues[0];
    if (issue === undefined || issue.evidence.kind === "resource-limit" || issue.code === "INVALID_SCHEMA") return { kind: "unknown" };
    const resolution = parsed === undefined ? undefined : document
      ? resolve_document_schema_issue_source(parsed.value, "document", parsed.provenance, issue)
      : resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue);
    const related = parsed === undefined || document || issue.evidence.relatedPath === undefined ? undefined
      : resolve_projected_schema_issue_source(parsed.value, parsed.provenance, { code: issue.code, path: issue.evidence.relatedPath });
    return { kind: "invalid", issue,
      ...(resolution === undefined || resolution.kind === "unresolved" ? {} : { range: resolution.range }),
      ...(related === undefined || related.kind === "unresolved" ? {} : { relatedRange: related.range }),
    };
  } catch (error) { return { kind: "unknown", ...(error instanceof Error ? { error: error.message } : {}) }; }
}

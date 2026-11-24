import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { CompiledHsonSchema } from "./compiler.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import { canonical_hson_data_from_node } from "../../core/hson-data-canonical-codec.js";
import { assert_canonical_hson_data_value } from "../../core/projected-value-graph.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import { completed_document_source_provenance, resolve_document_schema_issue_source } from "../document-schema-source-lowering/document-schema-source-lowering.js";
import { resolve_projected_schema_issue_source } from "../projected-schema-source-lowering/projected-schema-source-lowering.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import { HsonSourceProvenanceBuilder, type HsonSourceRange, type ParsedHsonWithProvenance } from "../hson-source-provenance/hson-source-provenance.js";
import type { HsonNode } from "../../core/types.js";
import { assert_hson_identifier_name } from "../../core/hson-name.js";
import { qualify_hson_document_root } from "../../api/document/hson-document.js";
import { complete_document_source } from "../complete-document.js";
import { expand_document_composition, document_composition_options, has_part_connector } from "../../api/livemap/livemap.document.composition.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { classify_live_root_mode } from "../../api/livemap/livemap.document.js";
import { admit_authored_livemap_document, qualify_livemap_document } from "../../api/livemap/livemap.node-admission.js";
import { validate_part_collection, type ValidatedPart } from "../../api/livemap/livemap.parts.js";

export type StaticSchemaCandidate = Readonly<{ source: string; family: "data" | "document" | "canonical" }> | Readonly<{ json: unknown }> | Readonly<{ data: OrderedProjectedValue }>;
export type StaticDocumentLibraryContext = Readonly<{
  kind: "document-library";
  name: string;
  parts?: Pick<ReadonlyMap<string, unknown>, "get">;
}>;
export type StaticSchemaEvaluationContext = "data" | "detached-document" | StaticDocumentLibraryContext;
export type StaticSchemaEvaluation = Readonly<{ kind: "valid" }> | Readonly<{ kind: "unknown"; error?: string }>
  | Readonly<{ kind: "invalid"; issue: CanonicalGraphIssue; range?: HsonSourceRange; relatedRange?: HsonSourceRange }>;

/** One context-aware canonical evaluation for annotation proof and relationships. */
export function evaluate_static_schema_candidate(compiled: CompiledHsonSchema, candidate: StaticSchemaCandidate,
  context: StaticSchemaEvaluationContext): StaticSchemaEvaluation {
  try {
    const document = compiled.semantic.kind === "document" || compiled.semantic.kind === "document-element";
    if (document !== (context !== "data")) return { kind: "unknown" };
    let parsed: ParsedHsonWithProvenance | undefined;
    let library: ReturnType<typeof complete_static_document_library> | undefined;
    let result;
    if (context === "detached-document") {
      if (!("source" in candidate) || candidate.family === "data") return { kind: "unknown" };
      parsed = parse_hson_with_provenance(candidate.source, { allowTopLevelDocumentText: true });
      result = evaluate_canonical_document_schema(compiled.graph, qualify_hson_document_root(parsed.value));
    } else if (context !== "data") {
      if (!("source" in candidate) || candidate.family === "data") return { kind: "unknown" };
      library = complete_static_document_library(candidate.source, context);
      if (library === undefined) return { kind: "unknown" };
      qualify_livemap_document(library.root, "Static completed Document Library");
      classify_live_root_mode(library.root, "document");
      result = evaluate_canonical_document_schema(compiled.graph, library.root);
    } else if ("json" in candidate || "data" in candidate) {
      const value = "json" in candidate ? admit_projected_value(candidate.json) : candidate.data;
      assert_canonical_hson_data_value(value);
      result = evaluate_canonical_projected_schema(compiled.graph, value);
    } else {
      if (candidate.family === "document") return { kind: "unknown" };
      parsed = parse_hson_with_provenance(candidate.source);
      result = evaluate_canonical_projected_schema(compiled.graph, canonical_hson_data_from_node(parsed.value));
    }
    if (result.ok) return { kind: "valid" };
    const issue = result.issues[0];
    if (issue === undefined || issue.evidence.kind === "resource-limit" || issue.code === "INVALID_SCHEMA") return { kind: "unknown" };
    if (library?.authored !== undefined) {
      const { root, provenance } = library.authored;
      parsed = { value: library.root, provenance: completed_document_source_provenance(root, library.root, provenance) };
    }
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

function complete_static_document_library(source: string, context: StaticDocumentLibraryContext):
  Readonly<{ root: HsonNode; authored?: Readonly<{ root: HsonNode; provenance: ParsedHsonWithProvenance["provenance"] }> }> | undefined {
  assert_hson_identifier_name(context.name, "Library");
  const provenance = new HsonSourceProvenanceBuilder();
  const authored = parse_authored_document_library(source, provenance);
  const root = admit_authored_livemap_document(authored.root, `Library ${context.name}`);
  const quads = authored.declarations;
  if (!has_part_connector(root)) {
    const completed = complete_document_source({ root, quads }).root;
    // Authored capture preserves physical coordinates. Completion may relocate those subjects.
    return { root: completed, authored: { root, provenance: provenance.finalize(authored.root, source.length) } };
  }
  const { parts } = context;
  if (parts === undefined) return undefined;
  const collections = new Map<string, readonly ValidatedPart[]>();
  const completed = expand_document_composition(context.name, () => ({ root, quads }),
    document_composition_options(undefined), (collection, member) => {
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
    }, "document").root;
  // Composition supplies no authored path sidecar. The diagnostic uses the candidate anchor.
  return { root: completed };
}

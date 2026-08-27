import { performance } from "node:perf_hooks";
import { classify_live_root_mode } from "../../api/livemap/livemap.document.js";
import { require_document_root_schema, validate_livemap_document_schema_root } from "../../api/livemap/livemap.document.schema.js";
import { is_owned_projected_schema, type LiveMapSchemaIssue } from "../../api/livemap/livemap.schema.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { resolve_document_schema_issue_source } from "../document-schema-source-lowering/document-schema-source-lowering.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import { resolve_projected_schema_issue_source } from "../projected-schema-source-lowering/projected-schema-source-lowering.js";
import { consume_trusted_schema_development_registrations } from "./dev-registration.js";
import { consume_trusted_schema_attachments, type TrustedSchemaAttachment } from "./lifecycle-evidence.js";
import { is_owned_trusted_schema, is_trusted_schema_runtime } from "./runtime-origin.js";
import { TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION, type TrustedSchemaDiagnostic, type TrustedSchemaRequest, type TrustedSchemaResponse } from "./protocol.js";

export class TrustedSchemaDiagnosticRuntime {
  readonly #generation: number;
  readonly #schemas = new Map<string, object>();
  readonly #proposals = new Map<string, TrustedSchemaAttachment>();
  readonly #associations = new Map<string, TrustedSchemaAttachment>();
  #loadAttempted = false;

  constructor(generation: number) { this.#generation = generation; }

  async handle(request: TrustedSchemaRequest): Promise<TrustedSchemaResponse> {
    if (request.protocolVersion !== TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION) return this.error(request, "PROTOCOL_MISMATCH", "Unsupported trusted Schema diagnostics protocol.");
    if (request.runtimeGeneration !== this.#generation) return this.error(request, "ASSOCIATION_UNAVAILABLE", "Stale runtime generation.");
    if (request.type === "handshake") return this.reply(request, "ready");
    if (request.type === "ping") return this.reply(request, "pong");
    if (request.type === "shutdown") return this.reply(request, "disposed");
    if (request.type === "load") return this.load(request);
    if (request.type === "associate") return this.associate(request);
    if (request.type === "dispose") { if (request.associationId !== undefined) this.#associations.delete(request.associationId); return this.reply(request, "disposed"); }
    if (request.type === "validate") return this.validate(request);
    return this.error(request, "PROTOCOL_MISMATCH", "Unrecognized trusted Schema diagnostics request.");
  }

  private async load(request: Extract<TrustedSchemaRequest, { type: "load" }>): Promise<TrustedSchemaResponse> {
    if (this.#loadAttempted) return this.error(request, "MODULE_LOAD_FAILED", "D1 requires a new generation to load another project.");
    this.#loadAttempted = true;
    try {
      const configured = await import(request.hsonModuleUrl);
      if (!is_trusted_schema_runtime(configured.hson)) return this.error(request, "RUNTIME_MISMATCH", "Configured runtime is not the D1 validator's supported runtime instance.");
      const project = await import(request.moduleUrl);
      const registrations = consume_trusted_schema_development_registrations();
      const attachments = consume_trusted_schema_attachments();
      if (project.hson !== undefined && !is_trusted_schema_runtime(project.hson)) return this.error(request, "RUNTIME_MISMATCH", "Project runtime identity differs from the validator.");
      const exported = project.trustedSchemas;
      if (exported !== undefined && (typeof exported !== "object" || exported === null)) return this.error(request, "MODULE_LOAD_FAILED", "trustedSchemas must be an object.");
      if (exported !== undefined && !is_trusted_schema_runtime(project.hson)) return this.error(request, "RUNTIME_MISMATCH", "Exported Schemas require explicit project runtime-origin evidence.");
      const schemas = new Map<string, object>();
      if (exported !== undefined) for (const [id, schema] of Object.entries(exported)) {
        if (!is_owned_trusted_schema(schema)) return this.error(request, "RUNTIME_MISMATCH", "Exported Schema is not owned by the validator's capability registries.");
        schemas.set(id, schema);
      }
      for (const registration of registrations) {
        if (!is_trusted_schema_runtime(registration.origin) || !is_owned_trusted_schema(registration.schema)) return this.error(request, "RUNTIME_MISMATCH", "Development registration has missing or incompatible runtime-origin evidence.");
        if (schemas.has(registration.id) && schemas.get(registration.id) !== registration.schema) return this.error(request, "MODULE_LOAD_FAILED", "Conflicting Schema handles.");
        schemas.set(registration.id, registration.schema);
      }
      for (const proposal of attachments) {
        if (!is_trusted_schema_runtime(proposal.origin) || schemas.get(proposal.evidence.schemaId) !== proposal.schema) return this.error(request, "RUNTIME_MISMATCH", "Application Schema identity does not match its declared runtime capability.");
      }
      for (const [id, schema] of schemas) this.#schemas.set(id, schema);
      for (const proposal of attachments) this.#proposals.set(proposal.evidence.associationId, proposal);
      return Object.freeze({ ...this.reply(request, "loaded"), schemaIds: Object.freeze([...this.#schemas.keys()]), associations: Object.freeze(attachments.map((record) => record.evidence)) });
    } catch (cause) {
      consume_trusted_schema_development_registrations();
      consume_trusted_schema_attachments();
      return this.error(request, "MODULE_LOAD_FAILED", cause instanceof Error ? cause.message : "Project module failed to load.");
    }
  }

  private associate(request: Extract<TrustedSchemaRequest, { type: "associate" }>): TrustedSchemaResponse {
    const proposal = this.#proposals.get(request.associationId);
    if (proposal === undefined || proposal.evidence.correspondence !== "direct") {
      this.#associations.delete(request.associationId);
      return this.error(request, "ASSOCIATION_UNAVAILABLE", "No proven direct construction/attachment correspondence.");
    }
    this.#associations.set(request.associationId, proposal);
    return this.reply(request, "associated");
  }

  private validate(request: Extract<TrustedSchemaRequest, { type: "validate" }>): TrustedSchemaResponse {
    const association = this.#associations.get(request.associationId);
    if (association === undefined || association.evidence.templateRevision !== request.templateRevision || association.evidence.schemaId !== request.schemaId || this.#schemas.get(request.schemaId) !== association.schema) return Object.freeze({ ...this.reply(request, "result"), result: { status: "ASSOCIATION_UNAVAILABLE" as const, diagnostics: Object.freeze([]) } });
    const { rootMode } = association.evidence;
    const parseStart = performance.now();
    let parsed: ReturnType<typeof parse_hson_with_provenance>;
    try { parsed = parse_hson_with_provenance(request.source, { allowTopLevelTextFragment: rootMode === "fragment" }); }
    catch (cause) { return Object.freeze({ ...this.reply(request, "result"), result: { status: "CANDIDATE_INVALID" as const, diagnostics: Object.freeze([]), timings: { parseMs: performance.now() - parseStart, validateMs: 0, lowerMs: 0 } }, message: cause instanceof Error ? cause.message : "Candidate HSON is invalid." }); }
    const parseMs = performance.now() - parseStart;
    const validateStart = performance.now();
    let issues: readonly LiveMapSchemaIssue[];
    try {
      if (rootMode === "projected") {
        if (!is_owned_projected_schema(association.schema)) return this.error(request, "RUNTIME_MISMATCH", "Schema lacks an owned projected capability.");
        issues = association.schema.validateRoot(materialize_projected_value(projected_value_from_hson_node(parsed.value))).issues;
      }
      else {
        const schema = require_document_root_schema(association.schema, rootMode).value;
        const mode = classify_live_root_mode(parsed.value);
        // Root-mode mismatch is also an authoritative validator issue. Do not
        // manufacture a tooling-only mismatch or invent an expected-root range.
        issues = validate_livemap_document_schema_root(schema, parsed.value, mode === "element" || mode === "fragment" ? mode : rootMode).issues;
      }
    } catch (cause) { return this.error(request, "VALIDATION_THROW", cause instanceof Error ? cause.message : "Schema validation threw unexpectedly."); }
    const validateMs = performance.now() - validateStart;
    const lowerStart = performance.now();
    const diagnostics: TrustedSchemaDiagnostic[] = issues.map((issue) => {
      const resolution = rootMode === "projected"
        ? resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue)
        : resolve_document_schema_issue_source(parsed.value, rootMode, parsed.provenance, issue);
      const range = resolution.kind === "unresolved" ? { precision: "unresolved" as const } : { precision: resolution.kind, start: resolution.range.start, end: resolution.range.end };
      return Object.freeze({ code: issue.code, path: Object.freeze([...issue.path]), expected: issue.expected, received: issue.received, attributeName: issue.attributeName, range: Object.freeze(range) });
    });
    return Object.freeze({ ...this.reply(request, "result"), result: Object.freeze({ status: issues.length === 0 ? "VALID" : "INVALID", diagnostics: Object.freeze(diagnostics), timings: Object.freeze({ parseMs, validateMs, lowerMs: performance.now() - lowerStart }) }) });
  }

  private reply(request: TrustedSchemaRequest, type: TrustedSchemaResponse["type"]): TrustedSchemaResponse { return Object.freeze({ protocolVersion: TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION, requestId: request.requestId, runtimeGeneration: this.#generation, type }); }
  private error(request: TrustedSchemaRequest, error: NonNullable<TrustedSchemaResponse["error"]>, message: string): TrustedSchemaResponse { return Object.freeze({ ...this.reply(request, "error"), error, message }); }
}

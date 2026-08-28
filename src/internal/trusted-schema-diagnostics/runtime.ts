import { performance } from "node:perf_hooks";
import { type LiveMapSchemaIssue } from "../../api/livemap/livemap.schema.js";
import { validate_schema_hson_graph } from "../schema-hson-validation/validate-schema-hson-graph.js";
import { is_projected_value_hson_node } from "../../core/projected-value-graph.js";
import { classify_live_root_mode } from "../../api/livemap/livemap.document.js";
import { same_direct_source, same_schema_source_binding, valid_schema_source_binding } from "./source-binding.js";
import { read_schema_issue_presentation } from "./issue-presentation.js";
import type { TrustedSchemaBindingRegistration, TrustedSchemaDirectSource, TrustedSchemaRootMode } from "./protocol.js";
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
  readonly #bindings: TrustedSchemaBindingRegistration[] = [];
  readonly #direct = new Map<string, Readonly<{ schema: object; schemaId: string; evidence: TrustedSchemaDirectSource }>>();
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
    if (request.type === "associate-source") return this.associateSource(request);
    if (request.type === "dispose") { if (request.associationId !== undefined) { this.#associations.delete(request.associationId); this.#direct.delete(request.associationId); } return this.reply(request, "disposed"); }
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
      const bindings: TrustedSchemaBindingRegistration[] = [];
      if (exported !== undefined) for (const [id, schema] of Object.entries(exported)) {
        if (!is_owned_trusted_schema(schema)) return this.error(request, "RUNTIME_MISMATCH", "Exported Schema is not owned by the validator's capability registries.");
        schemas.set(id, schema);
        // Export identity, not export spelling, establishes this mapping.
        for (const [exportName, value] of Object.entries(project)) if (value === schema) bindings.push({ schemaId: id, binding: { moduleUrl: request.moduleUrl, exportName } });
      }
      for (const registration of registrations) {
        if (!is_trusted_schema_runtime(registration.origin) || !is_owned_trusted_schema(registration.schema)) return this.error(request, "RUNTIME_MISMATCH", "Development registration has missing or incompatible runtime-origin evidence.");
        if (schemas.has(registration.id) && schemas.get(registration.id) !== registration.schema) return this.error(request, "AMBIGUOUS_REGISTRATION", "Conflicting Schema handles.");
        schemas.set(registration.id, registration.schema);
        if (registration.sourceBinding !== undefined) {
          if (!valid_schema_source_binding(registration.sourceBinding)) return this.error(request, "MODULE_LOAD_FAILED", "Invalid source binding metadata.");
          bindings.push({ schemaId: registration.id, binding: registration.sourceBinding });
        }
      }
      // Optional private metadata connects a registration module to another
      // source module. Export mappings additionally prove exact runtime identity.
      if (project.trustedSchemaBindings !== undefined) {
        if (!Array.isArray(project.trustedSchemaBindings)) return this.error(request, "MODULE_LOAD_FAILED", "trustedSchemaBindings must be an array.");
        for (const record of project.trustedSchemaBindings) {
          if (!record || !schemas.has(record.schemaId) || !valid_schema_source_binding(record.binding) || record.binding.exportName === undefined) return this.error(request, "MODULE_LOAD_FAILED", "Invalid exported source binding metadata.");
          bindings.push(record);
        }
      }
      for (const record of bindings) {
        if (record.binding.exportName !== undefined) {
          const owner = await import(record.binding.moduleUrl);
          if (owner[record.binding.exportName] !== schemas.get(record.schemaId)) return this.error(request, "RUNTIME_MISMATCH", "Source export differs from registered Schema object.");
        }
      }
      for (const proposal of attachments) {
        if (!is_trusted_schema_runtime(proposal.origin) || schemas.get(proposal.evidence.schemaId) !== proposal.schema) return this.error(request, "RUNTIME_MISMATCH", "Application Schema identity does not match its declared runtime capability.");
      }
      for (const [id, schema] of schemas) this.#schemas.set(id, schema);
      this.#bindings.push(...bindings.map(record => Object.freeze({ schemaId: record.schemaId, binding: Object.freeze({ ...record.binding }) })));
      for (const proposal of attachments) this.#proposals.set(proposal.evidence.associationId, proposal);
      return Object.freeze({ ...this.reply(request, "loaded"), schemaIds: Object.freeze([...this.#schemas.keys()]), bindings: Object.freeze(bindings), associations: Object.freeze(attachments.map((record) => record.evidence)) });
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

  private associateSource(request: Extract<TrustedSchemaRequest, { type: "associate-source" }>): TrustedSchemaResponse {
    this.#direct.delete(request.associationId);
    const matches = this.#bindings.filter(record => same_schema_source_binding(record.binding, request.directSource.binding));
    const objects = new Set(matches.map(record => this.#schemas.get(record.schemaId)));
    if (objects.size > 1) return this.error(request, "AMBIGUOUS_REGISTRATION", "Source binding maps to different Schema objects.");
    const schema = this.#schemas.get(request.schemaId);
    if (schema === undefined || !matches.some(record => record.schemaId === request.schemaId)) return this.error(request, "ASSOCIATION_UNAVAILABLE", "No current registered source binding.");
    this.#direct.set(request.associationId, { schema, schemaId: request.schemaId, evidence: Object.freeze({ ...request.directSource, binding: Object.freeze({ ...request.directSource.binding }) }) });
    return this.reply(request, "associated");
  }

  private validate(request: Extract<TrustedSchemaRequest, { type: "validate" }>): TrustedSchemaResponse {
    const association = this.#associations.get(request.associationId);
    const direct = this.#direct.get(request.associationId);
    const validDirect = direct !== undefined && request.directSource !== undefined && same_direct_source(direct.evidence, request.directSource)
      && direct.evidence.templateRevision === request.templateRevision && direct.evidence.documentRevision === request.candidateRevision
      && direct.schemaId === request.schemaId && this.#schemas.get(request.schemaId) === direct.schema;
    const validLifecycle = request.directSource === undefined && association !== undefined && association.evidence.templateRevision === request.templateRevision && association.evidence.schemaId === request.schemaId && this.#schemas.get(request.schemaId) === association.schema;
    if (!validDirect && !validLifecycle) return Object.freeze({ ...this.reply(request, "result"), result: { status: "ASSOCIATION_UNAVAILABLE" as const, diagnostics: Object.freeze([]) } });
    const schema = validDirect ? direct!.schema : association!.schema;
    let rootMode: TrustedSchemaRootMode = validDirect ? "projected" : association!.evidence.rootMode;
    const parseStart = performance.now();
    let parsed: ReturnType<typeof parse_hson_with_provenance>;
    try { parsed = parse_hson_with_provenance(request.source, { allowTopLevelTextFragment: !validDirect && rootMode === "fragment" }); }
    catch (cause) { return Object.freeze({ ...this.reply(request, "result"), result: { status: "CANDIDATE_INVALID" as const, diagnostics: Object.freeze([]), timings: { parseMs: performance.now() - parseStart, validateMs: 0, lowerMs: 0 } }, message: cause instanceof Error ? cause.message : "Candidate HSON is invalid." }); }
    const parseMs = performance.now() - parseStart;
    if (validDirect && !is_projected_value_hson_node(parsed.value)) {
      const mode = classify_live_root_mode(parsed.value);
      if (mode === "element" || mode === "fragment") rootMode = mode;
    }
    const validateStart = performance.now();
    let issues: readonly LiveMapSchemaIssue[];
    try {
      issues = validate_schema_hson_graph(schema, parsed.value).issues;
    } catch (cause) { return this.error(request, "VALIDATION_THROW", cause instanceof Error ? cause.message : "Schema validation threw unexpectedly."); }
    const validateMs = performance.now() - validateStart;
    const lowerStart = performance.now();
    const diagnostics: TrustedSchemaDiagnostic[] = issues.map((issue) => {
      const resolution = rootMode === "projected"
        ? resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue)
        : resolve_document_schema_issue_source(parsed.value, rootMode, parsed.provenance, issue);
      const range = resolution.kind === "unresolved" ? { precision: "unresolved" as const } : { precision: resolution.kind, start: resolution.range.start, end: resolution.range.end };
      return Object.freeze({ ...read_schema_issue_presentation(issue), code: issue.code, path: Object.freeze([...issue.path]), expected: issue.expected, received: issue.received, attributeName: issue.attributeName, range: Object.freeze(range) });
    });
    return Object.freeze({ ...this.reply(request, "result"), result: Object.freeze({ status: issues.length === 0 ? "VALID" : "INVALID", diagnostics: Object.freeze(diagnostics), timings: Object.freeze({ parseMs, validateMs, lowerMs: performance.now() - lowerStart }) }) });
  }

  private reply(request: TrustedSchemaRequest, type: TrustedSchemaResponse["type"]): TrustedSchemaResponse { return Object.freeze({ protocolVersion: TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION, requestId: request.requestId, runtimeGeneration: this.#generation, type }); }
  private error(request: TrustedSchemaRequest, error: NonNullable<TrustedSchemaResponse["error"]>, message: string): TrustedSchemaResponse { return Object.freeze({ ...this.reply(request, "error"), error, message }); }
}

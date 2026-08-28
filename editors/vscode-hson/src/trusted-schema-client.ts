import { performance } from "node:perf_hooks";
import { TrustedSchemaNodeSupervisor, type TrustedSchemaSupervisorOptions } from "../../../src/internal/trusted-schema-diagnostics/node-supervisor.js";
import type { TrustedSchemaBindingRegistration, TrustedSchemaDirectSource, TrustedSchemaResponse, TrustedSchemaTiming } from "../../../src/internal/trusted-schema-diagnostics/protocol.js";
import { same_schema_source_binding, same_map_flow } from "../../../src/internal/trusted-schema-diagnostics/source-binding.js";
import { discover_schema_validation_sources } from "../../../src/internal/trusted-schema-diagnostics/discover-validation-sources.js";
import { read_authored_hson_source } from "../../../src/internal/embedded-hson/authored-hson-source.js";
import { present_schema_diagnostic } from "./schema-presentation.js";
import type { DiagnosticDocument } from "./diagnostics.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";
import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { interpolation_site, map_interpolation_range } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { source_point_range_at } from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { pathToFileURL } from "node:url";
import { completion_source } from "./completion-source.js";
import type { SchemaCompletionResult } from "../../../src/internal/schema-completion/query.js";

export type EditorCompletionResult = Readonly<{
  status: SchemaStatus; completion?: SchemaCompletionResult;
  measurement?: Readonly<{ discoveryMs: number; roundTripMs: number; endToEndMs: number }>;
}>;

export type SchemaStatus = "off" | "waiting" | "current-valid" | "current-invalid" | "stale" | "ambiguous" | "unavailable" | "runtime-failed";
export type D2Measurement = Readonly<{
  lifecycleMs?: number;
  discoveryMs: number; roundTripMs: number; publicationMs: number; endToEndMs: number;
  stages: readonly TrustedSchemaTiming[];
}>;
export type SchemaClientResult = Readonly<{
  status: SchemaStatus; diagnostics: readonly DocumentDiagnosticSpec[]; generation?: number;
  message?: string; measurement?: D2Measurement;
}>;
export type SchemaClientOptions = TrustedSchemaSupervisorOptions & Readonly<{ moduleUrl: string; hsonModuleUrl: string }>;

/** One persistent D1 owner per configured runtime/project. No duplicated supervision. */
export class TrustedSchemaClient {
  readonly supervisor: TrustedSchemaNodeSupervisor;
  readonly #options: SchemaClientOptions;
  #load: Promise<TrustedSchemaResponse> | undefined;
  #loadedGeneration: number | undefined;
  #completionLoaded: TrustedSchemaResponse | undefined;
  readonly #completionTickets = new Map<string, number>();
  #revision = 0;
  #bindings: readonly TrustedSchemaBindingRegistration[] = [];
  #lifecycleModules: readonly string[] = [];
  readonly #documentVersions = new Map<string, number>();
  readonly #retiredDocuments = new Set<string>();
  get schemaModuleUrls(): readonly string[] { return [...this.#bindings.map(record => record.binding.moduleUrl), ...this.#lifecycleModules]; }
  constructor(options: SchemaClientOptions) { this.#options = options; this.supervisor = new TrustedSchemaNodeSupervisor(options); }
  dispose(): void { this.supervisor.dispose(); }
  invalidate(): void { this.supervisor.terminate(); this.#load = undefined; this.#documentVersions.clear(); this.#retiredDocuments.clear(); }
  invalidateDocument(document: DiagnosticDocument): void {
    this.#completionTickets.set(document.uri, (this.#completionTickets.get(document.uri) ?? 0) + 1);
    if (this.#documentVersions.has(document.uri) || discover_hson_tagged_templates(document.fileName, document.text).interpolated.length > 0) {
      this.#retiredDocuments.add(document.uri);
    }
  }
  async validate(document: DiagnosticDocument, current: () => boolean): Promise<SchemaClientResult> {
    const started = performance.now();
    if (!this.#options.trust.enabled || !this.#options.trust.workspaceTrusted) return { status: "off", diagnostics: [] };
    if (!current()) return { status: "stale", diagnostics: [] };
    const associations = discover_schema_validation_sources(document.fileName, document.text);
    const templates = discover_hson_tagged_templates(document.fileName, document.text).interpolated.map(source => interpolation_site(source, pathToFileURL(document.fileName).href));
    if (templates.length > 0) {
      const previous = this.#documentVersions.get(document.uri);
      if (previous !== undefined && previous !== document.version) this.#retiredDocuments.add(document.uri);
      this.#documentVersions.set(document.uri, document.version);
      if (this.#retiredDocuments.has(document.uri)) return { status: "waiting", diagnostics: [] };
    }
    const discoveryMs = performance.now() - started;
    if (associations.length === 0 && templates.length === 0) return { status: "unavailable", diagnostics: [] };
    let roundTripMs = 0, publicationMs = 0, lifecycleMs = 0, checked = 0;
    const stages: TrustedSchemaTiming[] = [];
    const diagnostics: DocumentDiagnosticSpec[] = [];
    let status: SchemaStatus = "current-valid";
    let message: string | undefined;
    try {
      if (!current()) return { status: "stale", diagnostics: [] };
      await this.supervisor.start();
      const generation = this.supervisor.activeGeneration;
      if (this.#load === undefined || this.#loadedGeneration !== generation) {
        this.#loadedGeneration = generation;
        this.#load = this.supervisor.request({ type: "load", moduleUrl: this.#options.moduleUrl, hsonModuleUrl: this.#options.hsonModuleUrl }, this.#options.startupDeadlineMs ?? 2_000);
      }
      const loaded = await this.#load;
      if (!current() || generation !== this.supervisor.activeGeneration) return { status: "stale", diagnostics: [] };
      if (loaded.type !== "loaded") return failure(loaded);
      this.#completionLoaded = loaded;
      message = loaded.loadFailure;
      const observed = templates.length === 0 ? undefined : await this.supervisor.request({ type: "captures", moduleUrl: pathToFileURL(document.fileName).href });
      if (!current() || generation !== this.supervisor.activeGeneration) return { status: "stale", diagnostics: [] };
      if (observed !== undefined && observed.type !== "captured") return failure(observed);
      const runtimeCaptures = observed?.captures ?? [];
      const bindings: readonly TrustedSchemaBindingRegistration[] = loaded.bindings ?? [];
      this.#bindings = bindings;
      this.#lifecycleModules = (loaded.associations ?? []).flatMap(record => record.mapFlow === undefined ? [] : [record.mapFlow.moduleUrl]);
      this.#lifecycleModules = [...this.#lifecycleModules, ...(loaded.captures ?? []).map(c => c.site.moduleUrl), ...runtimeCaptures.map(c => c.site.moduleUrl)];
      for (const template of templates) {
        const matches = runtimeCaptures.filter(c => c.site.templateId === template.templateId && c.site.sourceRevision === template.sourceRevision);
        if (matches.length !== 1) { status = matches.length > 1 ? "ambiguous" : "waiting"; continue; }
        const capture = matches[0]!;
        if (capture.failure !== undefined) {
          const failure = capture.failure;
          const point = failure.details?.source === undefined ? undefined : source_point_range_at(capture.source, failure.details.source.index);
          const origin = failure.substitution === undefined ? map_interpolation_range(template, capture.segments,
            point === undefined ? { precision: "unresolved" } : { precision: "exact", ...point })
            : { kind: "substitution-expression" as const, range: template.expressions[failure.substitution]! };
          diagnostics.push({ runtimeAdmission: true, range: origin.range, hostOrigin: origin.kind, precision: origin.kind === "substitution-expression" ? "substitution-expression" : origin.kind === "literal-exact" ? "exact" : "unresolved",
            message: failure.message, code: failure.details?.code, source: "HSON", related: [] });
          status = "current-invalid"; checked++;
        }
      }
      for (const association of associations) {
        if (!current() || generation !== this.supervisor.activeGeneration) return { status: "stale", diagnostics: [] };
        const captures = association.interpolation === undefined ? [] : runtimeCaptures.filter(c => c.site.templateId === association.interpolation!.templateId && c.site.sourceRevision === association.interpolation!.sourceRevision);
        const capture = captures.length === 1 ? captures[0] : undefined;
        if (association.interpolation !== undefined && capture === undefined) { status = captures.length > 1 ? "ambiguous" : "waiting"; continue; }
        if (capture?.failure !== undefined) continue;
        let registration = bindings.find(record => same_schema_source_binding(record.binding, association.binding));
        if (registration === undefined) { if (status !== "ambiguous" && status !== "runtime-failed") status = "unavailable"; continue; }
        const lookupStarted = performance.now();
        const lifecycleMatches = association.mapFlow === undefined ? [] : (loaded.associations ?? []).filter(record =>
          same_map_flow(record.mapFlow, association.mapFlow) && record.binding !== undefined && same_schema_source_binding(record.binding, association.binding)
          && record.correspondence === "direct" && record.validationAttempted === true);
        lifecycleMs += performance.now() - lookupStarted;
        if (association.mapFlow !== undefined && lifecycleMatches.length !== 1) {
          if (lifecycleMatches.length > 1) status = "ambiguous";
          continue;
        }
        const lifecycle = lifecycleMatches[0];
        if (lifecycle !== undefined) registration = bindings.find(record => record.schemaId === lifecycle.schemaId && same_schema_source_binding(record.binding, association.binding));
        if (registration === undefined) { status = "unavailable"; continue; }
        const associationRevision = ++this.#revision;
        const associationId = `${association.callId}@${document.version}:${associationRevision}`;
        const directSource: TrustedSchemaDirectSource = {
          interpolation: capture === undefined ? undefined : { templateId: capture.site.templateId, sourceRevision: capture.site.sourceRevision, evaluationId: capture.evaluationId },
          mapFlow: association.mapFlow,
          templateId: association.templateId, callId: association.callId, binding: association.binding,
          documentRevision: document.version, templateRevision: document.version, associationRevision,
        };
        const requestStarted = performance.now();
        const associated = await this.supervisor.request({ type: "associate-source", associationId, lifecycleId: lifecycle?.associationId, schemaId: registration.schemaId, directSource });
        try {
          if (!current() || generation !== this.supervisor.activeGeneration) return { status: "stale", diagnostics: [] };
          if (associated.type !== "associated") {
            const failed = failure(associated);
            if (status !== "runtime-failed" && (status !== "ambiguous" || failed.status === "runtime-failed")) status = failed.status;
            message = failed.message; continue;
          }
          const response = await this.supervisor.request({ type: "validate", associationId, schemaId: registration.schemaId,
            templateRevision: document.version, candidateRevision: document.version, directSource, source: capture?.source ?? read_authored_hson_source(association.source) });
          roundTripMs += performance.now() - requestStarted;
          if (!current() || generation !== this.supervisor.activeGeneration || response.runtimeGeneration !== generation) return { status: "stale", diagnostics: [] };
          if (response.type === "error") {
            const failed = failure(response);
            if (status !== "runtime-failed" && (status !== "ambiguous" || failed.status === "runtime-failed")) status = failed.status;
            message = failed.message; continue;
          }
          if (response.result?.timings) stages.push(response.result.timings);
          if (response.result?.status === "VALID" || response.result?.status === "INVALID") checked++;
          if (response.result?.status === "INVALID") {
            if (status === "current-valid") status = "current-invalid";
            const publicationStarted = performance.now();
            diagnostics.push(...response.result.diagnostics.map(issue => present_schema_diagnostic(issue, association)));
            publicationMs += performance.now() - publicationStarted;
          } else if (response.result?.status !== "VALID" && status !== "ambiguous" && status !== "runtime-failed") status = "unavailable";
        } finally {
          if (generation === this.supervisor.activeGeneration) await this.supervisor.request({ type: "dispose", associationId });
        }
      }
      if (!current() || generation !== this.supervisor.activeGeneration) return { status: "stale", diagnostics: [] };
      if (checked === 0 && status === "current-valid") status = "unavailable";
      return { status, diagnostics, generation, message, measurement: { lifecycleMs, discoveryMs, roundTripMs, publicationMs, stages, endToEndMs: performance.now() - started } };
    } catch (error) {
      return { status: "runtime-failed", diagnostics: [], message: error instanceof Error ? error.message : "Trusted Schema runtime failed." };
    }
  }

  async complete(document: DiagnosticDocument, offset: number, current: () => boolean): Promise<EditorCompletionResult> {
    const started = performance.now();
    if (!this.#options.trust.enabled || !this.#options.trust.workspaceTrusted) return { status: "off" };
    const ticket = (this.#completionTickets.get(document.uri) ?? 0) + 1;
    this.#completionTickets.set(document.uri, ticket);
    const generation = this.supervisor.activeGeneration;
    const loaded = this.#completionLoaded;
    // Completion never starts/restarts a process or loads workspace code.
    if (generation === undefined || loaded?.runtimeGeneration !== generation || loaded.completionVersion !== 1) return { status: "waiting" };
    const live = () => current() && this.#completionTickets.get(document.uri) === ticket && this.supervisor.activeGeneration === generation;
    if (!live()) return { status: "stale" };
    const associations = discover_schema_validation_sources(document.fileName, document.text).filter(a => completion_source(a, offset) !== undefined);
    if (associations.length !== 1) return { status: associations.length > 1 ? "ambiguous" : "unavailable" };
    const association = associations[0];
    let registration = loaded.bindings?.find(r => same_schema_source_binding(r.binding, association.binding));
    if (registration === undefined) return { status: "unavailable" };
    const lifecycles = association.mapFlow === undefined ? [] : (loaded.associations ?? []).filter(r => same_map_flow(r.mapFlow, association.mapFlow)
      && r.binding !== undefined && same_schema_source_binding(r.binding, association.binding) && r.correspondence === "direct" && r.validationAttempted === true);
    if (association.mapFlow !== undefined && lifecycles.length !== 1) return { status: lifecycles.length > 1 ? "ambiguous" : "unavailable" };
    const lifecycle = lifecycles[0];
    if (lifecycle !== undefined) registration = loaded.bindings?.find(r => r.schemaId === lifecycle.schemaId && same_schema_source_binding(r.binding, association.binding));
    if (registration === undefined) return { status: "unavailable" };
    const discoveryMs = performance.now() - started;
    const requestStarted = performance.now();
    let associationId: string | undefined;
    try {
      const observed = association.interpolation === undefined || this.#retiredDocuments.has(document.uri) ? undefined
        : await this.supervisor.request({ type: "captures", moduleUrl: pathToFileURL(document.fileName).href });
      if (!live()) return { status: "stale" };
      if (observed !== undefined && observed.type !== "captured") return { status: "unavailable" };
      const captures = (observed?.captures ?? []).filter(c => c.site.templateId === association.interpolation?.templateId && c.site.sourceRevision === association.interpolation?.sourceRevision);
      if (captures.length > 1) return { status: "ambiguous" };
      const capture = captures[0]?.canonical === undefined ? undefined : captures[0];
      const candidate = completion_source(association, offset, capture);
      if (candidate === undefined) return { status: "unavailable" };
      const associationRevision = ++this.#revision;
      associationId = `${association.callId}@completion:${document.version}:${associationRevision}`;
      const directSource: TrustedSchemaDirectSource = { templateId: association.templateId, callId: association.callId, binding: association.binding,
        mapFlow: association.mapFlow, documentRevision: document.version, templateRevision: document.version, associationRevision,
        interpolation: capture === undefined ? undefined : { templateId: capture.site.templateId, sourceRevision: capture.site.sourceRevision, evaluationId: capture.evaluationId } };
      const associated = await this.supervisor.request({ type: "associate-source", associationId, lifecycleId: lifecycle?.associationId, schemaId: registration.schemaId, directSource });
      if (!live()) return { status: "stale" };
      if (associated.type !== "associated") return { status: failure(associated).status };
      const response = await this.supervisor.request({ type: "complete", associationId, schemaId: registration.schemaId, directSource,
        templateRevision: document.version, candidateRevision: document.version, source: candidate.source, cursor: candidate.cursor, unknownRanges: candidate.unknownRanges });
      if (!live()) return { status: "stale" };
      const completion = response.completion;
      const range = completion?.range === undefined ? undefined : candidate.map(completion.range);
      if (response.type !== "completed" || completion === undefined || range === undefined) return { status: "unavailable" };
      return { status: "current-valid", completion: { ...completion, range }, measurement: { discoveryMs, roundTripMs: performance.now() - requestStarted, endToEndMs: performance.now() - started } };
    } catch { return { status: live() ? "runtime-failed" : "stale" }; }
    finally { if (associationId !== undefined && this.supervisor.activeGeneration === generation) await this.supervisor.request({ type: "dispose", associationId }).catch(() => {}); }
  }
}
function failure(response: TrustedSchemaResponse): SchemaClientResult {
  return { status: response.error === "AMBIGUOUS_REGISTRATION" ? "ambiguous" : response.error === "ASSOCIATION_UNAVAILABLE" ? "unavailable" : "runtime-failed", diagnostics: [], message: response.message };
}

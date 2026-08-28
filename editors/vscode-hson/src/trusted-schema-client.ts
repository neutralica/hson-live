import { performance } from "node:perf_hooks";
import { TrustedSchemaNodeSupervisor, type TrustedSchemaSupervisorOptions } from "../../../src/internal/trusted-schema-diagnostics/node-supervisor.js";
import type { TrustedSchemaBindingRegistration, TrustedSchemaDirectSource, TrustedSchemaResponse, TrustedSchemaTiming } from "../../../src/internal/trusted-schema-diagnostics/protocol.js";
import { same_schema_source_binding, same_map_flow } from "../../../src/internal/trusted-schema-diagnostics/source-binding.js";
import { discover_schema_validation_sources } from "../../../src/internal/trusted-schema-diagnostics/discover-validation-sources.js";
import { read_authored_hson_source } from "../../../src/internal/embedded-hson/authored-hson-source.js";
import { present_schema_diagnostic } from "./schema-presentation.js";
import type { DiagnosticDocument } from "./diagnostics.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";

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
  #revision = 0;
  #bindings: readonly TrustedSchemaBindingRegistration[] = [];
  #lifecycleModules: readonly string[] = [];
  get schemaModuleUrls(): readonly string[] { return [...this.#bindings.map(record => record.binding.moduleUrl), ...this.#lifecycleModules]; }
  constructor(options: SchemaClientOptions) { this.#options = options; this.supervisor = new TrustedSchemaNodeSupervisor(options); }
  dispose(): void { this.supervisor.dispose(); }
  invalidate(): void { this.supervisor.terminate(); this.#load = undefined; }
  async validate(document: DiagnosticDocument, current: () => boolean): Promise<SchemaClientResult> {
    const started = performance.now();
    if (!this.#options.trust.enabled || !this.#options.trust.workspaceTrusted) return { status: "off", diagnostics: [] };
    const associations = discover_schema_validation_sources(document.fileName, document.text);
    const discoveryMs = performance.now() - started;
    if (associations.length === 0) return { status: "unavailable", diagnostics: [] };
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
      const bindings: readonly TrustedSchemaBindingRegistration[] = loaded.bindings ?? [];
      this.#bindings = bindings;
      this.#lifecycleModules = (loaded.associations ?? []).flatMap(record => record.mapFlow === undefined ? [] : [record.mapFlow.moduleUrl]);
      for (const association of associations) {
        if (!current() || generation !== this.supervisor.activeGeneration) return { status: "stale", diagnostics: [] };
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
            templateRevision: document.version, candidateRevision: document.version, directSource, source: read_authored_hson_source(association.source) });
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
}
function failure(response: TrustedSchemaResponse): SchemaClientResult {
  return { status: response.error === "AMBIGUOUS_REGISTRATION" ? "ambiguous" : response.error === "ASSOCIATION_UNAVAILABLE" ? "unavailable" : "runtime-failed", diagnostics: [], message: response.message };
}

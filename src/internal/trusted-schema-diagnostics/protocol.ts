/**
 * Private, transport-neutral protocol for trusted authored-HSON diagnostics.
 * This is intentionally not exported from a package entrypoint.
 */
export const TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION = 1;

/** Explicit registration metadata; never inferred from a handle's spelling. */
export type TrustedSchemaSourceBinding = Readonly<{
  moduleUrl: string;
  exportName?: string;
  localName?: string;
  declarationStart?: number;
}>;
export type TrustedSchemaBindingRegistration = Readonly<{
  schemaId: string;
  binding: TrustedSchemaSourceBinding;
}>;
export type TrustedSchemaMapFlow = Readonly<{
  moduleUrl: string;
  contextRevision: string;
  templateId: string;
  constructionId: string;
  callId: string;
}>;
export type TrustedSchemaDirectSource = Readonly<{
  templateId: string;
  callId: string;
  documentRevision: number;
  templateRevision: number;
  associationRevision: number;
  mapFlow?: TrustedSchemaMapFlow;
  binding: TrustedSchemaSourceBinding;
}>;

export type TrustedSchemaRootMode = "projected" | "element" | "fragment";
export type TrustedSchemaAssociationEvidence = Readonly<{
  mapFlow?: TrustedSchemaMapFlow;
  binding?: TrustedSchemaSourceBinding;
  validationAttempted?: boolean;
  associationId: string;
  applicationId: string;
  schemaId: string;
  rootMode: TrustedSchemaRootMode;
  templateId: string;
  templateRevision: number;
  source: string;
  canonical: string;
  constructedRevision: number;
  attemptRevision: number;
  correspondence: "direct" | "unavailable";
  attachment: "attempted" | "attached" | "rejected";
}>;
export type TrustedSchemaDiagnosticStatus =
  | "VALID"
  | "INVALID"
  | "CANDIDATE_INVALID"
  | "ASSOCIATION_UNAVAILABLE"
  | "RUNTIME_FAILURE";

export type TrustedSchemaTiming = Readonly<{
  parseMs: number;
  validateMs: number;
  lowerMs: number;
}>;

export type TrustedSchemaRange = Readonly<{
  precision: "exact" | "anchor" | "unresolved";
  start?: number;
  end?: number;
}>;

export type TrustedSchemaDiagnostic = Readonly<{
  subject?: "tag" | "flag";
  constraintLabel?: string;
  code: string;
  path: readonly (string | number)[];
  expected?: string;
  received?: string;
  attributeName?: string;
  range: TrustedSchemaRange;
}>;

export type TrustedSchemaRequest =
  | Readonly<{ type: "handshake"; protocolVersion: number; requestId: string; runtimeGeneration: number }>
  | Readonly<{
      type: "load";
      protocolVersion: number;
      requestId: string;
      runtimeGeneration: number;
      moduleUrl: string;
      hsonModuleUrl: string;
    }>
  | Readonly<{
      type: "associate";
      protocolVersion: number;
      requestId: string;
      runtimeGeneration: number;
      associationId: string;
    }>
  | Readonly<{
      type: "associate-source";
      protocolVersion: number;
      requestId: string;
      runtimeGeneration: number;
      associationId: string;
      schemaId: string;
      lifecycleId?: string;
      directSource: TrustedSchemaDirectSource;
    }>
  | Readonly<{
      type: "validate";
      protocolVersion: number;
      requestId: string;
      runtimeGeneration: number;
      associationId: string;
      schemaId: string;
      templateRevision: number;
      candidateRevision: number;
      source: string;
      directSource?: TrustedSchemaDirectSource;
    }>
  | Readonly<{ type: "dispose" | "shutdown" | "ping"; protocolVersion: number; requestId: string; runtimeGeneration: number; associationId?: string }>;

export type TrustedSchemaResponse = Readonly<{
  protocolVersion: number;
  requestId: string;
  runtimeGeneration: number;
  type: "ready" | "loaded" | "associated" | "result" | "disposed" | "pong" | "error";
  error?: "PROTOCOL_MISMATCH" | "RUNTIME_MISMATCH" | "MODULE_LOAD_FAILED" | "ASSOCIATION_UNAVAILABLE" | "AMBIGUOUS_REGISTRATION" | "VALIDATION_THROW";
  message?: string;
  schemaIds?: readonly string[];
  bindings?: readonly TrustedSchemaBindingRegistration[];
  associations?: readonly TrustedSchemaAssociationEvidence[];
  result?: Readonly<{
    status: TrustedSchemaDiagnosticStatus;
    diagnostics: readonly TrustedSchemaDiagnostic[];
    timings?: TrustedSchemaTiming;
  }>;
}>;

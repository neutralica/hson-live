import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";

export const CANONICAL_SCHEMA_FORMAT = "hson-canonical-schema" as const;
export const CANONICAL_SCHEMA_VERSION = 1 as const;

export type CanonicalSchemaNodeRef = number;

export type CanonicalSchemaCapabilities = Readonly<{
  projectedRoot?: CanonicalSchemaNodeRef;
  documentItem?: CanonicalSchemaNodeRef;
  documentContent?: CanonicalSchemaNodeRef;
  documentElementRoot?: CanonicalSchemaNodeRef;
  documentFragmentRoot?: CanonicalSchemaNodeRef;
  attrs?: CanonicalSchemaNodeRef;
}>;

export type CanonicalSchemaDocumentationMetadata = Readonly<{
  description?: string;
  sourceLocation?: string;
  authoringProvenance?: string;
  generatedFrom?: string;
  typescriptOrigin?: string;
}>;

export type CanonicalSchemaSemanticDiagnosticMetadata = Readonly<{
  labels: readonly (readonly [CanonicalSchemaNodeRef, string])[];
}>;

export type CanonicalRefinementRule =
  | Readonly<{ kind: "number-lower-bound"; value: number; inclusive: boolean }>
  | Readonly<{ kind: "number-upper-bound"; value: number; inclusive: boolean }>
  | Readonly<{ kind: "integer" }>
  | Readonly<{ kind: "string-length"; minimum?: number; maximum?: number }>
  | Readonly<{
    kind: "string-pattern";
    dialect: "literal-string-v1";
    mode: "full" | "prefix" | "suffix" | "contains";
    pattern: string;
  }>
  | Readonly<{ kind: "collection-length"; minimum?: number; maximum?: number }>
  | Readonly<{ kind: "array-unique" }>;

type ProjectedPrimitiveNode = Readonly<{
  kind: "projected-any" | "projected-string" | "projected-number" | "projected-boolean" | "projected-null";
}>;

export type CanonicalProjectedSchemaNode =
  | ProjectedPrimitiveNode
  | Readonly<{ kind: "projected-literal"; values: readonly OrderedProjectedValue[] }>
  | Readonly<{ kind: "projected-object"; exact: boolean; properties: readonly (readonly [string, CanonicalSchemaNodeRef])[] }>
  | Readonly<{ kind: "projected-array"; item?: CanonicalSchemaNodeRef }>
  | Readonly<{ kind: "projected-tuple"; items: readonly CanonicalSchemaNodeRef[] }>
  | Readonly<{ kind: "projected-record"; value: CanonicalSchemaNodeRef }>
  | Readonly<{ kind: "projected-union"; choices: readonly CanonicalSchemaNodeRef[] }>
  | Readonly<{ kind: "projected-optional"; base: CanonicalSchemaNodeRef }>
  | Readonly<{ kind: "projected-nullable"; base: CanonicalSchemaNodeRef }>
  | Readonly<{ kind: "projected-ref"; target: CanonicalSchemaNodeRef }>
  | Readonly<{ kind: "projected-refinement"; base: CanonicalSchemaNodeRef; rule: CanonicalRefinementRule; label?: string }>;

export type CanonicalDocumentSchemaNode =
  | Readonly<{ kind: "document-any-item" }>
  | Readonly<{ kind: "document-text" }>
  | Readonly<{
    kind: "document-element";
    tag?: string;
    attrs?: CanonicalSchemaNodeRef;
    content: CanonicalSchemaNodeRef;
  }>
  | Readonly<{ kind: "document-item-union"; choices: readonly CanonicalSchemaNodeRef[] }>
  | Readonly<{ kind: "document-broad-content" }>
  | Readonly<{ kind: "document-sequence"; items: readonly CanonicalSchemaNodeRef[] }>
  | Readonly<{ kind: "document-repeat"; item: CanonicalSchemaNodeRef; count?: number }>
  | Readonly<{ kind: "document-content-union"; choices: readonly CanonicalSchemaNodeRef[] }>
  | Readonly<{ kind: "document-fragment-root"; content: CanonicalSchemaNodeRef }>
  | Readonly<{
    kind: "document-attrs";
    exact: boolean;
    properties: readonly CanonicalDocumentAttrProperty[];
  }>;

export type CanonicalDocumentAttrProperty = Readonly<{
  name: string;
  optional: boolean;
} & (
  | Readonly<{ flag: true }>
  | Readonly<{ flag: false; value: CanonicalSchemaNodeRef }>
)>;

export type CanonicalSchemaNode = CanonicalProjectedSchemaNode | CanonicalDocumentSchemaNode;

export type CanonicalSchemaGraph = Readonly<{
  format: typeof CANONICAL_SCHEMA_FORMAT;
  version: typeof CANONICAL_SCHEMA_VERSION;
  capabilities: CanonicalSchemaCapabilities;
  nodes: readonly CanonicalSchemaNode[];
  semanticDiagnosticMetadata?: CanonicalSchemaSemanticDiagnosticMetadata;
  documentationMetadata?: CanonicalSchemaDocumentationMetadata;
}>;

declare const VERIFIED_CANONICAL_SCHEMA_GRAPH: unique symbol;
export type VerifiedCanonicalSchemaGraph = CanonicalSchemaGraph & Readonly<{
  readonly [VERIFIED_CANONICAL_SCHEMA_GRAPH]: true;
}>;

export const CANONICAL_CAPABILITY_KEYS = Object.freeze([
  "projectedRoot",
  "documentItem",
  "documentContent",
  "documentElementRoot",
  "documentFragmentRoot",
  "attrs",
] as const);

export type CanonicalCapabilityKey = typeof CANONICAL_CAPABILITY_KEYS[number];

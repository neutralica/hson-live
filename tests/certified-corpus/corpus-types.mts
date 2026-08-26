import type { HsonNode } from "../../src/core/types.ts";
import type { TransformErrorDetails } from "../../src/core/errors.ts";

export type CorpusClassification =
  | "literal-accepted-authored-hson"
  | "materialized-accepted-family-case"
  | "literal-rejected-authored-hson"
  | "materialized-rejected-family-case"
  | "graph-ingress-accepted-transport"
  | "graph-ingress-rejected-transport"
  | "structural-json-transport"
  | "structural-html-transport"
  | "diagnostic-circuit-regression"
  | "specialized-test-cross-reference";

export type CorpusIngress = "hson" | "graph" | "json-text" | "html" | "diagnostic" | "reference";
export type CorpusDisposition = "accept" | "reject" | "reference";

export type CorpusTaxonomy = Readonly<{
  shape: string;
  slot: string;
  variation?: string;
  defect?: string;
}>;

export type CorpusExpectedOutputs = Readonly<{
  hson?: string;
  json?: string;
  html?: string;
  diagnostic?: string;
}>;

export type CorpusCommon = Readonly<{
  id: string;
  claim: string;
  classification: CorpusClassification;
  ingress: CorpusIngress;
  escapedInput: string;
  verbatimInput?: string;
  taxonomy: CorpusTaxonomy;
  tags: readonly string[];
  origin: string;
  rationale: string;
  provenance?: string;
  novelty?: string;
  humanReviewPriority?: "low" | "medium" | "high" | "critical";
  declaredSourceReuse?: string;
  specializedTestIds?: readonly string[];
}>;

export type AcceptedCorpusCase = CorpusCommon & Readonly<{
  disposition: "accept";
  source?: string;
  graphIngress?: HsonNode;
  transportIngress?: string;
  expectedGraph: HsonNode;
  expectedOutputs: CorpusExpectedOutputs;
  expectedKeySequences?: readonly (readonly string[])[];
  expectedStringLeaves?: readonly string[];
  negativeZeroPaths?: readonly string[];
  cycles?: number;
  htmlMode?: "ordinary-html" | "structural-transport";
}>;

export type RejectedCorpusCase = CorpusCommon & Readonly<{
  disposition: "reject";
  source?: string;
  graphIngress?: HsonNode;
  transportIngress?: string;
  expectedRejection: TransformErrorDetails;
  htmlMode?: "ordinary-html" | "structural-transport";
}>;

export type SpecializedReferenceCase = CorpusCommon & Readonly<{
  disposition: "reference";
  referencedCaseIds: readonly string[];
}>;

export type MaterializedCorpusCase = AcceptedCorpusCase | RejectedCorpusCase | SpecializedReferenceCase;

export type AcceptedFamilyDefinition = Readonly<{
  id: string;
  claim: string;
  classification: "transparent-accepted-family";
  variedDimension: string;
  cases: readonly AcceptedCorpusCase[];
}>;

export type RejectedFamilyDefinition = Readonly<{
  id: string;
  claim: string;
  classification: "transparent-rejected-family";
  variedDimension: string;
  cases: readonly RejectedCorpusCase[];
}>;

export type CorpusFamilyDefinition = AcceptedFamilyDefinition | RejectedFamilyDefinition;

export type CorpusCounts = Readonly<{
  literalAcceptedAuthoredHson: number;
  transparentAcceptedAuthoredHson: number;
  literalRejectedAuthoredHson: number;
  transparentRejectedAuthoredHson: number;
  graphOnlyAcceptedTransport: number;
  graphOnlyRejectedTransport: number;
  structuralJsonTransport: number;
  structuralHtmlTransport: number;
  diagnosticCircuitRegressions: number;
  specializedTestReferences: number;
  totalConcreteDescriptors: number;
  uniqueAuthoredSources: number;
  declaredSourceReuse: number;
}>;

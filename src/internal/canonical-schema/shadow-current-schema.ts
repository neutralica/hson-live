import type { HsonNode } from "../../core/types.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { DocumentLiveMapMode } from "../../types/livemap.types.js";
import type { LiveMapSchemaValidation } from "../../api/livemap/livemap.schema.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "./evaluate.js";
import {
  lower_current_schema,
  type CurrentSchemaNonLowerableReason,
} from "./lower-current-schema.js";
import type { VerifiedCanonicalSchemaGraph } from "./graph.js";

export type ShadowSchemaCapabilityClass = "projected" | "document" | "attrs" | "multi-capability";

export type CurrentSchemaShadowState =
  | Readonly<{
    status: "SHADOW_GRAPH_COMPLETE";
    graph: VerifiedCanonicalSchemaGraph;
    capabilityClass: ShadowSchemaCapabilityClass;
  }>
  | Readonly<{
    status: "SHADOW_GRAPH_NON_LOWERABLE";
    reasons: readonly CurrentSchemaNonLowerableReason[];
    capabilityClass: ShadowSchemaCapabilityClass;
  }>;

export type ShadowSchemaCensus = Readonly<{
  total: number;
  complete: number;
  nonLowerable: number;
  reasons: Readonly<{
    constrain: number;
    recurse: number;
    unsupported: number;
    invalid: number;
    other: number;
  }>;
  capabilities: Readonly<Record<ShadowSchemaCapabilityClass, number>>;
  differentialEvaluations: number;
  differentialMismatches: number;
}>;

const SHADOW_BY_SCHEMA = new WeakMap<object, CurrentSchemaShadowState>();
const SHADOW_BY_PROJECTED_ROOT = new WeakMap<object, CurrentSchemaShadowState>();
let differentialEnabled = initial_differential_mode();
let total = 0;
let complete = 0;
let nonLowerable = 0;
let differentialEvaluations = 0;
let differentialMismatches = 0;
const reasonCounts = { constrain: 0, recurse: 0, unsupported: 0, invalid: 0, other: 0 };
const capabilityCounts: Record<ShadowSchemaCapabilityClass, number> = {
  projected: 0,
  document: 0,
  attrs: 0,
  "multi-capability": 0,
};

/**
 * Phase-2 finalization boundary. It observes only current nodes already produced
 * by existing construction and never invokes user callbacks.
 */
export function finalize_current_schema_shadow(
  schema: object,
  evidence: Readonly<{
    expression?: object;
    projectedRoot?: object;
    hasDocument: boolean;
    hasAttrs: boolean;
  }>,
): CurrentSchemaShadowState {
  const known = SHADOW_BY_SCHEMA.get(schema);
  if (known !== undefined) return known;
  let lowered: ReturnType<typeof lower_current_schema>;
  try {
    lowered = lower_current_schema(schema);
  } catch (error) {
    lowered = Object.freeze({
      ok: false,
      reasons: Object.freeze([Object.freeze({
        code: "CAPABILITY_FAILURE" as const,
        detail: error instanceof Error ? error.message : "Shadow graph finalization failed.",
      })]),
    });
  }
  const capabilityClass = classify_capabilities(evidence);
  const state: CurrentSchemaShadowState = lowered.ok
    ? Object.freeze({ status: "SHADOW_GRAPH_COMPLETE", graph: lowered.graph, capabilityClass })
    : Object.freeze({ status: "SHADOW_GRAPH_NON_LOWERABLE", reasons: lowered.reasons, capabilityClass });
  SHADOW_BY_SCHEMA.set(schema, state);
  if (evidence.expression !== undefined && !SHADOW_BY_SCHEMA.has(evidence.expression)) {
    SHADOW_BY_SCHEMA.set(evidence.expression, state);
  }
  if (evidence.projectedRoot !== undefined) SHADOW_BY_PROJECTED_ROOT.set(evidence.projectedRoot, state);
  record_state(state);
  return state;
}

/** Private migration evidence; deliberately absent from package barrels. */
export function read_current_schema_shadow(schema: unknown): CurrentSchemaShadowState | undefined {
  return is_object(schema) ? SHADOW_BY_SCHEMA.get(schema) : undefined;
}

/** Controlled test/development hook. Production defaults to disabled. */
export function set_current_schema_shadow_differential(enabled: boolean): void {
  differentialEnabled = enabled;
}

export function read_current_schema_shadow_census(): ShadowSchemaCensus {
  return Object.freeze({
    total,
    complete,
    nonLowerable,
    reasons: Object.freeze({ ...reasonCounts }),
    capabilities: Object.freeze({ ...capabilityCounts }),
    differentialEvaluations,
    differentialMismatches,
  });
}

export function assert_projected_shadow_equivalence(
  schemaOrRoot: object,
  candidate: OrderedProjectedValue,
  current: LiveMapSchemaValidation,
): void {
  if (!differentialEnabled) return;
  const state = SHADOW_BY_SCHEMA.get(schemaOrRoot) ?? SHADOW_BY_PROJECTED_ROOT.get(schemaOrRoot);
  if (state?.status !== "SHADOW_GRAPH_COMPLETE" || state.graph.capabilities.projectedRoot === undefined) return;
  differentialEvaluations += 1;
  const canonical = evaluate_canonical_projected_schema(state.graph, candidate);
  assert_equivalent("projected", state.graph, current, canonical);
}

export function assert_document_shadow_equivalence(
  schemaOrRoot: object,
  candidate: HsonNode,
  mode: DocumentLiveMapMode,
  current: LiveMapSchemaValidation,
): void {
  if (!differentialEnabled) return;
  const state = SHADOW_BY_SCHEMA.get(schemaOrRoot);
  if (state?.status !== "SHADOW_GRAPH_COMPLETE") return;
  differentialEvaluations += 1;
  const canonical = evaluate_canonical_document_schema(state.graph, candidate, mode);
  assert_equivalent("document", state.graph, current, canonical);
}

function assert_equivalent(
  domain: "projected" | "document",
  graph: VerifiedCanonicalSchemaGraph,
  current: LiveMapSchemaValidation,
  canonical: Readonly<{ ok: boolean; issues: readonly Readonly<{
    code: string;
    path: readonly (string | number)[];
    expected?: string;
    received?: string;
    attributeName?: string;
  }>[] }>,
): void {
  const currentEvidence = evidence(current);
  const canonicalEvidence = evidence(canonical);
  if (JSON.stringify(currentEvidence) === JSON.stringify(canonicalEvidence)) return;
  differentialMismatches += 1;
  throw new Error(`Canonical Schema shadow mismatch (${domain}).\ncurrent=${JSON.stringify(currentEvidence)}\ncanonical=${JSON.stringify(canonicalEvidence)}\ncapabilities=${JSON.stringify(graph.capabilities)}\nnodes=${JSON.stringify(graph.nodes)}`);
}

function evidence(result: Readonly<{ ok: boolean; issues: readonly Readonly<{
  code: string;
  path: readonly (string | number)[];
  expected?: string;
  received?: string;
  attributeName?: string;
}>[] }>): unknown {
  return {
    ok: result.ok,
    issues: result.issues.map(({ code, path, expected, received, attributeName }) => ({
      code,
      path: [...path],
      ...(expected === undefined ? {} : { expected }),
      ...(received === undefined ? {} : { received }),
      ...(attributeName === undefined ? {} : { attributeName }),
    })),
  };
}

function classify_capabilities(evidence: Readonly<{ expression?: object; projectedRoot?: object; hasDocument: boolean; hasAttrs: boolean }>): ShadowSchemaCapabilityClass {
  const projected = evidence.projectedRoot !== undefined;
  const count = Number(projected) + Number(evidence.hasDocument) + Number(evidence.hasAttrs);
  if (count > 1) return "multi-capability";
  if (projected) return "projected";
  if (evidence.hasAttrs) return "attrs";
  return "document";
}

function record_state(state: CurrentSchemaShadowState): void {
  total += 1;
  capabilityCounts[state.capabilityClass] += 1;
  if (state.status === "SHADOW_GRAPH_COMPLETE") {
    complete += 1;
    return;
  }
  nonLowerable += 1;
  const categories = new Set(state.reasons.map(reason_category));
  for (const category of categories) reasonCounts[category] += 1;
}

function reason_category(reason: CurrentSchemaNonLowerableReason): keyof typeof reasonCounts {
  if (reason.code === "CONSTRAIN_CALLBACK") return "constrain";
  if (reason.code === "UNRESOLVED_RECURSE_THUNK") return "recurse";
  if (reason.code === "UNSUPPORTED_CURRENT_NODE") return "unsupported";
  if (reason.code === "INVALID_LOWERED_GRAPH") return "invalid";
  return "other";
}

function is_object(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function initial_differential_mode(): boolean {
  const processValue: unknown = Reflect.get(globalThis, "process");
  if (!is_object(processValue)) return false;
  const env: unknown = Reflect.get(processValue, "env");
  return is_object(env) && Reflect.get(env, "HSON_CANONICAL_SCHEMA_SHADOW_DIFFERENTIAL") === "1";
}

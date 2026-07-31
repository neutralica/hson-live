import { hsonTransform } from "../api/transform/index.js";
import { parse_hson } from "../api/transform/parsers/parse-hson.js";
import { serialize_hson } from "../api/transform/serializers/serialize-hson.js";
import type { HsonSerializeInputOptions } from "../api/transform/serializers/serialize-hson.js";
import { detach_hson_root_value } from "../api/transform/utils/node-utils/detach-hson-root-value.js";
import { assert_invariants } from "../core/assert-invariants.js";
import {
  canonical_hson_graph_difference,
  type CanonicalHsonDifference,
} from "../core/canonical-hson-equal.js";
import {
  read_transform_error_details,
  type TransformErrorDetails,
} from "../core/errors.js";
import type { HsonNode } from "../core/types.js";

export type TransformOracleClassification =
  | "expected-rejection"
  | "unexpected-acceptance"
  | "unexpected-rejection"
  | "unexpected-error-class"
  | "canonical-divergence"
  | "input-mutation"
  | "nonconvergent-cycle"
  | "cross-runtime-divergence";

export type TransformOracleExpectedClassification = TransformOracleClassification | "success";

export type TransformOracleStage =
  | "source-admission"
  | "tokenization"
  | "parsing"
  | "root-detachment"
  | "canonical-invariant-admission"
  | "serialization-admission"
  | "serialization"
  | "reparse"
  | "canonical-comparison"
  | "nonmutation"
  | "runtime-projection";

export type TransformOracleWitness = Readonly<{
  launcher: string;
  case: string;
  operation: string;
  ingress?: string;
  source?: string;
  graphFixture?: unknown;
  serializeOptions?: Readonly<{ noBreak?: boolean; noQuid?: boolean }>;
  expectedClassification: TransformOracleExpectedClassification;
  actualClassification: TransformOracleClassification;
  stage?: TransformOracleStage | string;
  firstCanonicalDifference?: CanonicalHsonDifference;
  structuredError?: TransformErrorDetails;
}>;

export class TransformOracleAssertionError extends Error {
  readonly classification: TransformOracleClassification;
  readonly witness: TransformOracleWitness;
  readonly witnessBody: string;

  constructor(
    classification: TransformOracleClassification,
    witness: TransformOracleWitness,
    cause?: unknown,
  ) {
    const witnessBody = format_transform_oracle_witness(witness);
    super(`[TRANSFORM_ORACLE_FAILURE]\n${witnessBody}`, cause === undefined ? undefined : { cause });
    this.classification = classification;
    this.witness = witness;
    this.witnessBody = witnessBody;
  }
}

type MutableRecord = Record<string, unknown>;

function stable_value(value: unknown, active = new WeakSet<object>()): unknown {
  if (typeof value === "number") {
    if (Object.is(value, -0)) return { $number: "-0" };
    if (!Number.isFinite(value)) return { $number: String(value) };
    return value;
  }
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) return { $cycle: true };
  active.add(value);
  if (Array.isArray(value)) {
    const output = value.map((item) => stable_value(item, active));
    active.delete(value);
    return output;
  }
  const output: MutableRecord = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = stable_value((value as Readonly<MutableRecord>)[key], active);
  }
  active.delete(value);
  return output;
}

export function format_transform_oracle_witness(witness: TransformOracleWitness): string {
  return JSON.stringify(stable_value(witness), null, 2);
}

function clone_value<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const item of value) output.push(clone_value(item, seen));
    return output as T;
  }
  const output: MutableRecord = {};
  seen.set(value, output);
  for (const key of Object.keys(value)) {
    output[key] = clone_value((value as Readonly<MutableRecord>)[key], seen);
  }
  return output as T;
}

function projected_options(options: HsonSerializeInputOptions | undefined): Readonly<{ noBreak?: boolean; noQuid?: boolean }> | undefined {
  if (options === undefined) return undefined;
  return Object.freeze({
    ...(options.noBreak === undefined ? {} : { noBreak: options.noBreak }),
    ...(options.noQuid === undefined ? {} : { noQuid: options.noQuid }),
  });
}

function base_witness(input: Readonly<{
  launcher: string;
  caseId: string;
  operation: string;
  ingress?: string;
  source?: string;
  graphFixture?: unknown;
  serializeOptions?: HsonSerializeInputOptions;
  expectedClassification: TransformOracleExpectedClassification;
  actualClassification: TransformOracleClassification;
  stage?: TransformOracleStage | string;
  firstCanonicalDifference?: CanonicalHsonDifference;
  structuredError?: TransformErrorDetails;
}>): TransformOracleWitness {
  return Object.freeze({
    launcher: input.launcher,
    case: input.caseId,
    operation: input.operation,
    ...(input.ingress === undefined ? {} : { ingress: input.ingress }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.graphFixture === undefined ? {} : { graphFixture: clone_value(input.graphFixture) }),
    ...(input.serializeOptions === undefined ? {} : { serializeOptions: projected_options(input.serializeOptions) }),
    expectedClassification: input.expectedClassification,
    actualClassification: input.actualClassification,
    ...(input.stage === undefined ? {} : { stage: input.stage }),
    ...(input.firstCanonicalDifference === undefined ? {} : { firstCanonicalDifference: input.firstCanonicalDifference }),
    ...(input.structuredError === undefined ? {} : { structuredError: input.structuredError }),
  });
}

function throw_failure(
  classification: TransformOracleClassification,
  input: Parameters<typeof base_witness>[0],
  cause?: unknown,
): never {
  throw new TransformOracleAssertionError(classification, base_witness(input), cause);
}

function assert_unmutated(
  before: HsonNode,
  after: HsonNode,
  context: Readonly<{
    launcher: string;
    caseId: string;
    operation: string;
    ingress?: string;
    source?: string;
    serializeOptions?: HsonSerializeInputOptions;
  }>,
): void {
  const mutation = canonical_hson_graph_difference(before, after);
  if (mutation === undefined) return;
  throw_failure("input-mutation", {
    ...context,
    graphFixture: before,
    expectedClassification: "success",
    actualClassification: "input-mutation",
    stage: "nonmutation",
    firstCanonicalDifference: mutation,
  });
}

export function assert_canonical_oracle_graph_equal(input: Readonly<{
  launcher: string;
  caseId: string;
  operation: string;
  expected: HsonNode;
  actual: HsonNode;
  ingress?: string;
  source?: string;
  serializeOptions?: HsonSerializeInputOptions;
  classification?: "canonical-divergence" | "cross-runtime-divergence" | "input-mutation";
}>): void {
  const firstCanonicalDifference = canonical_hson_graph_difference(input.expected, input.actual);
  if (firstCanonicalDifference === undefined) return;
  const classification = input.classification ?? "canonical-divergence";
  throw_failure(classification, {
    ...input,
    graphFixture: input.expected,
    expectedClassification: "success",
    actualClassification: classification,
    stage: classification === "cross-runtime-divergence" ? "runtime-projection" : "canonical-comparison",
    firstCanonicalDifference,
  });
}

function fluent_serialize(node: HsonNode, options: HsonSerializeInputOptions): string {
  let builder = hsonTransform.fromNode(node).toHson();
  if (options.noBreak === true) builder = builder.noBreak();
  if (options.noQuid === true) builder = builder.noQuid();
  return builder.serialize();
}

export type CanonicalClosureInput = Readonly<{
  launcher: string;
  caseId: string;
  ingress: "hson-source" | "canonical-node";
  source?: string;
  node?: HsonNode;
  expectedNode?: HsonNode;
  serializeOptions?: HsonSerializeInputOptions;
  cycles?: number;
  compareFluent?: boolean;
}>;

export type CanonicalClosureResult = Readonly<{
  semantic: HsonNode;
  serialized: string;
  reparsed: HsonNode;
}>;

export type CanonicalSerializedClosureInput = Readonly<{
  launcher: string;
  caseId: string;
  node: HsonNode;
  serialized: string;
  expectedNode?: HsonNode;
  ingress?: string;
  serializeOptions?: HsonSerializeInputOptions;
}>;

function unexpected_rejection(
  input: CanonicalClosureInput,
  operation: string,
  stage: TransformOracleStage,
  cause: unknown,
): never {
  const structuredError = read_transform_error_details(cause);
  throw_failure("unexpected-rejection", {
    launcher: input.launcher,
    caseId: input.caseId,
    operation,
    ingress: input.ingress,
    source: input.source,
    graphFixture: input.node,
    serializeOptions: input.serializeOptions,
    expectedClassification: "success",
    actualClassification: "unexpected-rejection",
    stage: structuredError?.stage ?? stage,
    structuredError,
  }, cause);
}

/** Assert closure for an already-produced serializer output. */
export function assertCanonicalSerializedClosure(
  input: CanonicalSerializedClosureInput,
): HsonNode {
  const context: CanonicalClosureInput = {
    launcher: input.launcher,
    caseId: input.caseId,
    ingress: "canonical-node",
    node: input.node,
    expectedNode: input.expectedNode,
    source: input.serialized,
    serializeOptions: input.serializeOptions,
  };
  try {
    assert_invariants(input.node, "transform oracle serialized closure input");
  } catch (cause) {
    return unexpected_rejection(context, "assert_invariants", "canonical-invariant-admission", cause);
  }
  const before = clone_value(input.node);
  let reparsed: HsonNode;
  try {
    reparsed = detach_hson_root_value(parse_hson(input.serialized));
    assert_invariants(reparsed, "transform oracle serialized closure reparse");
  } catch (cause) {
    return unexpected_rejection(context, "serialize-reparse", "reparse", cause);
  }
  assert_unmutated(before, input.node, {
    launcher: input.launcher,
    caseId: input.caseId,
    operation: "serialize-reparse",
    ingress: input.ingress ?? "canonical-node",
    serializeOptions: input.serializeOptions,
  });
  assert_canonical_oracle_graph_equal({
    launcher: input.launcher,
    caseId: input.caseId,
    operation: "serialize-parse-detach-compare",
    expected: input.expectedNode ?? input.node,
    actual: reparsed,
    ingress: input.ingress ?? "canonical-node",
    serializeOptions: input.serializeOptions,
  });
  return reparsed;
}

/** Assert strict parse/serialize/reparse closure without comparison-time repair. */
export function assertCanonicalClosure(input: CanonicalClosureInput): CanonicalClosureResult {
  let attached: HsonNode;
  if (input.ingress === "hson-source") {
    if (input.source === undefined) throw new Error("hson-source closure requires source");
    try {
      attached = parse_hson(input.source);
    } catch (cause) {
      return unexpected_rejection(input, "parse_hson", "parsing", cause);
    }
  } else {
    if (input.node === undefined) throw new Error("canonical-node closure requires node");
    attached = input.node;
  }

  let semantic: HsonNode;
  if (input.ingress === "hson-source") {
    try {
      semantic = detach_hson_root_value(attached);
    } catch (cause) {
      return unexpected_rejection(input, "detach_hson_root_value", "root-detachment", cause);
    }
  } else {
    semantic = attached;
  }

  try {
    assert_invariants(semantic, "transform oracle closure input");
  } catch (cause) {
    return unexpected_rejection(input, "assert_invariants", "canonical-invariant-admission", cause);
  }
  const before = clone_value(semantic);
  const expected = input.expectedNode ?? semantic;
  const options = input.serializeOptions ?? {};

  let serialized: string;
  try {
    serialized = serialize_hson(semantic, options);
  } catch (cause) {
    return unexpected_rejection(input, "serialize_hson", "serialization", cause);
  }
  assert_unmutated(before, semantic, {
    launcher: input.launcher,
    caseId: input.caseId,
    operation: "serialize_hson",
    ingress: input.ingress,
    source: input.source,
    serializeOptions: options,
  });

  if (input.compareFluent !== false) {
    let fluent: string;
    try {
      fluent = fluent_serialize(semantic, options);
    } catch (cause) {
      return unexpected_rejection(input, "fromNode.toHson.serialize", "serialization", cause);
    }
    let fluentSemantic: HsonNode;
    try {
      fluentSemantic = detach_hson_root_value(parse_hson(fluent));
    } catch (cause) {
      return unexpected_rejection(input, "fluent-reparse", "reparse", cause);
    }
    assert_canonical_oracle_graph_equal({
      launcher: input.launcher,
      caseId: input.caseId,
      operation: "direct-versus-fluent",
      expected,
      actual: fluentSemantic,
      ingress: input.ingress,
      source: input.source,
      serializeOptions: options,
    });
  }

  let reparsed: HsonNode;
  try {
    reparsed = detach_hson_root_value(parse_hson(serialized));
    assert_invariants(reparsed, "transform oracle closure reparse");
  } catch (cause) {
    return unexpected_rejection(input, "serialize-reparse", "reparse", cause);
  }
  assert_canonical_oracle_graph_equal({
    launcher: input.launcher,
    caseId: input.caseId,
    operation: "serialize-parse-detach-compare",
    expected,
    actual: reparsed,
    ingress: input.ingress,
    source: input.source,
    serializeOptions: options,
  });

  const cycles = Math.max(1, input.cycles ?? 1);
  let cycleNode = reparsed;
  let priorSource = serialized;
  for (let cycle = 1; cycle < cycles; cycle += 1) {
    let nextSource: string;
    let nextNode: HsonNode;
    try {
      nextSource = serialize_hson(cycleNode, options);
      nextNode = detach_hson_root_value(parse_hson(nextSource));
    } catch (cause) {
      return unexpected_rejection(input, `closure-cycle-${cycle}`, "reparse", cause);
    }
    const cycleDifference = canonical_hson_graph_difference(cycleNode, nextNode);
    if (cycleDifference !== undefined || nextSource !== priorSource) {
      throw_failure("nonconvergent-cycle", {
        launcher: input.launcher,
        caseId: input.caseId,
        operation: `closure-cycle-${cycle}`,
        ingress: input.ingress,
        source: input.source,
        graphFixture: cycleNode,
        serializeOptions: options,
        expectedClassification: "success",
        actualClassification: "nonconvergent-cycle",
        stage: "canonical-comparison",
        ...(cycleDifference === undefined ? {} : { firstCanonicalDifference: cycleDifference }),
      });
    }
    cycleNode = nextNode;
    priorSource = nextSource;
  }

  return Object.freeze({ semantic, serialized, reparsed });
}

export type CanonicalRejectionInput = Readonly<{
  launcher: string;
  caseId: string;
  operation: string;
  ingress?: string;
  source?: string;
  candidate?: HsonNode;
  expectedCode: string;
  expectedStage?: string;
  run: () => unknown;
  repetitions?: number;
}>;

/** Assert one stable, structured, operation-owned rejection. */
export function assertCanonicalRejection(input: CanonicalRejectionInput): Readonly<{
  details: TransformErrorDetails;
  witnessBody: string;
}> {
  const repetitions = Math.max(1, input.repetitions ?? 1);
  let expectedBody: string | undefined;
  let expectedDetails: TransformErrorDetails | undefined;
  for (let attempt = 0; attempt < repetitions; attempt += 1) {
    const before = input.candidate === undefined ? undefined : clone_value(input.candidate);
    let observed: unknown;
    try {
      input.run();
    } catch (cause) {
      observed = cause;
    }
    if (observed === undefined) {
      return throw_failure("unexpected-acceptance", {
        launcher: input.launcher,
        caseId: input.caseId,
        operation: input.operation,
        ingress: input.ingress,
        source: input.source,
        graphFixture: input.candidate,
        expectedClassification: "expected-rejection",
        actualClassification: "unexpected-acceptance",
        stage: input.expectedStage,
      });
    }
    const details = read_transform_error_details(observed);
    if (
      details === undefined
      || details.code !== input.expectedCode
      || (input.expectedStage !== undefined && details.stage !== input.expectedStage)
    ) {
      return throw_failure("unexpected-error-class", {
        launcher: input.launcher,
        caseId: input.caseId,
        operation: input.operation,
        ingress: input.ingress,
        source: input.source,
        graphFixture: input.candidate,
        expectedClassification: "expected-rejection",
        actualClassification: "unexpected-error-class",
        stage: details?.stage ?? input.expectedStage,
        structuredError: details,
      }, observed);
    }
    if (before !== undefined && input.candidate !== undefined) {
      assert_unmutated(before, input.candidate, {
        launcher: input.launcher,
        caseId: input.caseId,
        operation: input.operation,
        ingress: input.ingress,
        source: input.source,
      });
    }
    const witness = base_witness({
      launcher: input.launcher,
      caseId: input.caseId,
      operation: input.operation,
      ingress: input.ingress,
      source: input.source,
      graphFixture: input.candidate,
      expectedClassification: "expected-rejection",
      actualClassification: "expected-rejection",
      stage: details.stage,
      structuredError: details,
    });
    const body = format_transform_oracle_witness(witness);
    if (expectedBody !== undefined && body !== expectedBody) {
      return throw_failure("unexpected-error-class", {
        launcher: input.launcher,
        caseId: input.caseId,
        operation: input.operation,
        ingress: input.ingress,
        source: input.source,
        graphFixture: input.candidate,
        expectedClassification: "expected-rejection",
        actualClassification: "unexpected-error-class",
        stage: details.stage,
        structuredError: details,
      }, observed);
    }
    expectedBody = body;
    expectedDetails = details;
  }
  if (expectedBody === undefined || expectedDetails === undefined) throw new Error("rejection oracle did not execute");
  return Object.freeze({ details: expectedDetails, witnessBody: expectedBody });
}

export function assertCanonicalRuntimeParity(input: Readonly<{
  launcher: string;
  caseId: string;
  operation: string;
  projections: readonly Readonly<{ runtime: string; run: () => HsonNode }>[];
}>): readonly HsonNode[] {
  if (input.projections.length < 2) throw new Error("runtime parity requires at least two projections");
  const results = input.projections.map((projection) => {
    const result = projection.run();
    assert_invariants(result, `runtime projection ${projection.runtime}`);
    return result;
  });
  const expected = results[0];
  if (expected === undefined) throw new Error("runtime parity produced no baseline");
  for (let index = 1; index < results.length; index += 1) {
    const actual = results[index];
    if (actual === undefined) continue;
    assert_canonical_oracle_graph_equal({
      launcher: input.launcher,
      caseId: input.caseId,
      operation: `${input.operation}:${input.projections[index]?.runtime ?? index}`,
      expected,
      actual,
      classification: "cross-runtime-divergence",
    });
  }
  return Object.freeze(results);
}

/** Controlled cycle hook used to prove convergence diagnostics independently. */
export function assertCanonicalCycleConvergence(input: Readonly<{
  launcher: string;
  caseId: string;
  operation: string;
  initial: HsonNode;
  cycles: number;
  next: (current: HsonNode, cycle: number) => HsonNode;
}>): HsonNode {
  let current = input.initial;
  for (let cycle = 1; cycle <= input.cycles; cycle += 1) {
    const before = clone_value(current);
    const next = input.next(current, cycle);
    assert_unmutated(before, current, {
      launcher: input.launcher,
      caseId: input.caseId,
      operation: input.operation,
    });
    const firstCanonicalDifference = canonical_hson_graph_difference(current, next);
    if (firstCanonicalDifference !== undefined) {
      throw_failure("nonconvergent-cycle", {
        launcher: input.launcher,
        caseId: input.caseId,
        operation: `${input.operation}:${cycle}`,
        graphFixture: current,
        expectedClassification: "success",
        actualClassification: "nonconvergent-cycle",
        stage: "canonical-comparison",
        firstCanonicalDifference,
      });
    }
    current = next;
  }
  return current;
}

export type TransformRegressionCase =
  | Readonly<{ kind: "valid-source-closure"; caseId: string; source: string; serializeOptions?: HsonSerializeInputOptions }>
  | Readonly<{ kind: "invalid-source-rejection"; caseId: string; source: string; expectedCode: string; expectedStage?: string }>
  | Readonly<{ kind: "valid-graph-serialization-closure"; caseId: string; node: HsonNode; serializeOptions?: HsonSerializeInputOptions }>
  | Readonly<{ kind: "invalid-graph-serialization-rejection"; caseId: string; node: HsonNode; expectedCode: string; expectedStage?: string }>
  | Readonly<{ kind: "cross-runtime-parity"; caseId: string; fixture: HsonNode; runtimes: readonly string[] }>;

import assert from "node:assert/strict";
import { hsonTransform } from "../../src/api/transform/index.ts";
import { hsonString } from "../../src/api/transform/hson-string.ts";
import { detach_hson_root_value } from "../../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import {
  canonical_hson_graph_difference,
  canonical_hson_graph_equal,
} from "../../src/core/canonical-hson-equal.ts";
import { read_transform_error_details, TransformError } from "../../src/core/errors.ts";
import type { HsonNode } from "../../src/core/types.ts";
import {
  assertCanonicalCycleConvergence,
  assert_canonical_oracle_graph_equal,
  format_transform_oracle_witness,
  TransformOracleAssertionError,
} from "../../src/_tests/transform-oracle.ts";
import {
  acceptedAssertionWeight,
  corpusAssertionCounts,
  materializedCorpusCases,
} from "./corpus-manifest.mts";
import type {
  AcceptedCorpusCase,
  MaterializedCorpusCase,
  RejectedCorpusCase,
} from "./corpus-types.mts";
import { obj, property, val } from "./graph-expectations.mts";

class AtomicAssertions {
  count = 0;

  equal(actual: unknown, expected: unknown, message: string): void {
    assert.equal(actual, expected, message);
    this.count += 1;
  }

  deepEqual(actual: unknown, expected: unknown, message: string): void {
    assert.deepEqual(actual, expected, message);
    this.count += 1;
  }

  ok(value: unknown, message: string): void {
    assert.ok(value, message);
    this.count += 1;
  }
}

function semanticNode(node: HsonNode): HsonNode {
  const detached = node.$_tag === "_hson_root" ? detach_hson_root_value(node) : node;
  return hsonTransform.fromNode(detached).toNode();
}

function strictEqual(left: HsonNode, right: HsonNode): boolean {
  return canonical_hson_graph_equal(left, right);
}

function objectKeySequences(root: HsonNode): readonly (readonly string[])[] {
  const sequences: string[][] = [];
  const visit = (current: HsonNode): void => {
    if (
      current.$_tag === "_hson_obj"
      && current.$_content.length > 0
      && current.$_content.every((child) =>
        typeof child === "object" && child !== null && !child.$_tag.startsWith("_hson_"))
    ) {
      sequences.push(current.$_content.map((child) => (child as HsonNode).$_tag));
    }
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null) visit(child);
    }
  };
  visit(root);
  return sequences;
}

function stringLeaves(root: HsonNode): readonly string[] {
  const values: string[] = [];
  const visit = (current: HsonNode): void => {
    if (current.$_tag === "_hson_str" && typeof current.$_content[0] === "string") {
      values.push(current.$_content[0]);
    }
    for (const child of current.$_content) {
      if (typeof child === "object" && child !== null) visit(child);
    }
  };
  visit(root);
  return values;
}

function graphPathValue(root: HsonNode, path: string): unknown {
  let current: unknown = root;
  let consumed = "$";
  for (const match of path.matchAll(/\.\$_content\[(\d+)\]/g)) {
    assert.equal(match.index, consumed.length, path + ": supported graph path syntax");
    assert.ok(typeof current === "object" && current !== null && "$_content" in current);
    current = (current as HsonNode).$_content[Number(match[1])];
    consumed += match[0];
  }
  assert.equal(consumed, path, path + ": complete graph path resolution");
  return current;
}

function assertNegativeZeroPaths(
  atomic: AtomicAssertions,
  entry: AcceptedCorpusCase,
  graph: HsonNode,
  route: string,
): void {
  for (const path of entry.negativeZeroPaths ?? []) {
    atomic.equal(Object.is(graphPathValue(graph, path), -0), true, entry.id + ": Object.is negative zero via " + route + " at " + path);
  }
}

function runAcceptedAuthored(entry: AcceptedCorpusCase, atomic: AtomicAssertions): void {
  assert.ok(entry.source !== undefined);
  const before = entry.source;
  const transform = hsonTransform.fromHson(entry.source);
  const actual = transform.toNode();
  atomic.ok(actual !== undefined, entry.id + ": admission");
  atomic.equal(strictEqual(actual, entry.expectedGraph), true, entry.id + ": strict expected graph");
  atomic.equal(entry.source, before, entry.id + ": input nonmutation");
  const hson = transform.toHson().serialize();
  atomic.equal(hson, entry.expectedOutputs.hson, entry.id + ": exact canonical HSON");
  const reparsed = hsonTransform.fromHson(hson).toNode();
  atomic.equal(strictEqual(reparsed, entry.expectedGraph), true, entry.id + ": HSON reparse");
  atomic.equal(hsonString(hson), hson, entry.id + ": canonical HsonString idempotence");
  assertNegativeZeroPaths(atomic, entry, actual, "authored HSON admission");
  assertNegativeZeroPaths(atomic, entry, reparsed, "canonical HSON reparse");
}

function runAcceptedGraph(entry: AcceptedCorpusCase, atomic: AtomicAssertions): void {
  assert.ok(entry.graphIngress !== undefined);
  const before = structuredClone(entry.graphIngress);
  const transform = hsonTransform.fromNode(entry.graphIngress);
  const admitted = transform.toNode();
  atomic.ok(admitted !== undefined, entry.id + ": admission");
  atomic.equal(strictEqual(admitted, entry.expectedGraph), true, entry.id + ": expected graph");
  atomic.deepEqual(entry.graphIngress, before, entry.id + ": input nonmutation");
  const hson = transform.toHson().serialize();
  atomic.equal(hson, entry.expectedOutputs.hson, entry.id + ": HSON output");
  const hsonReparsed = hsonTransform.fromHson(hson).toNode();
  atomic.equal(strictEqual(hsonReparsed, entry.expectedGraph), true, entry.id + ": HSON reparse");
  const json = transform.toJson().serialize();
  atomic.equal(json, entry.expectedOutputs.json, entry.id + ": JSON output");
  const jsonReparsed = semanticNode(hsonTransform.fromJson(json).toNode());
  atomic.equal(strictEqual(jsonReparsed, entry.expectedGraph), true, entry.id + ": JSON reparse");
  const html = transform.toHtml().serialize();
  atomic.equal(html, entry.expectedOutputs.html, entry.id + ": HTML output");
  const htmlReparsed = semanticNode(hsonTransform.fromTrustedHtml(html).toNode());
  atomic.equal(strictEqual(htmlReparsed, entry.expectedGraph), true, entry.id + ": HTML reparse");
  atomic.deepEqual(
    [transform.toHson().serialize(), transform.toJson().serialize(), transform.toHtml().serialize()],
    [hson, json, html],
    entry.id + ": deterministic outputs",
  );
  assertNegativeZeroPaths(atomic, entry, admitted, "detached graph admission");
  assertNegativeZeroPaths(atomic, entry, hsonReparsed, "HSON transport");
  assertNegativeZeroPaths(atomic, entry, jsonReparsed, "structural JSON transport");
  assertNegativeZeroPaths(atomic, entry, htmlReparsed, "structural HTML transport");
}

function runAcceptedJson(entry: AcceptedCorpusCase, atomic: AtomicAssertions): void {
  assert.ok(entry.graphIngress !== undefined);
  const before = structuredClone(entry.graphIngress);
  const transform = hsonTransform.fromNode(entry.graphIngress);
  atomic.ok(transform.toNode() !== undefined, entry.id + ": graph admission");
  const json = transform.toJson().serialize();
  atomic.equal(json, entry.expectedOutputs.json, entry.id + ": exact JSON");
  atomic.deepEqual(objectKeySequences(entry.expectedGraph), entry.expectedKeySequences, entry.id + ": baseline key sequences");
  const reparsed = semanticNode(hsonTransform.fromJson(json).toNode());
  atomic.equal(strictEqual(reparsed, entry.expectedGraph), true, entry.id + ": reparse equality");
  atomic.deepEqual(objectKeySequences(reparsed), entry.expectedKeySequences, entry.id + ": reparsed key sequences");
  atomic.deepEqual(entry.graphIngress, before, entry.id + ": graph nonmutation");
  atomic.equal(transform.toJson().serialize(), json, entry.id + ": deterministic JSON");
  let current = reparsed;
  for (let cycle = 0; cycle < (entry.cycles ?? 1); cycle += 1) {
    current = semanticNode(hsonTransform.fromJson(hsonTransform.fromNode(current).toJson().serialize()).toNode());
    assert.equal(strictEqual(current, entry.expectedGraph), true, entry.id + ": cycle " + cycle + " baseline");
  }
  atomic.equal(strictEqual(current, entry.expectedGraph), true, entry.id + ": repeated cycles retain original baseline");
  assertNegativeZeroPaths(atomic, entry, reparsed, "structural JSON reparse");
  assertNegativeZeroPaths(atomic, entry, current, "repeated structural JSON cycles");
}

function runAcceptedHtml(entry: AcceptedCorpusCase, atomic: AtomicAssertions): void {
  const inputBefore = entry.graphIngress === undefined ? entry.transportIngress : structuredClone(entry.graphIngress);
  let admitted: HsonNode;
  if (entry.graphIngress !== undefined) admitted = hsonTransform.fromNode(entry.graphIngress).toNode();
  else {
    assert.ok(entry.transportIngress !== undefined);
    admitted = semanticNode(hsonTransform.fromTrustedHtml(entry.transportIngress).toNode());
  }
  atomic.ok(admitted !== undefined, entry.id + ": admission");
  const output = hsonTransform.fromNode(entry.expectedGraph).toHtml().serialize();
  atomic.equal(output, entry.expectedOutputs.html, entry.id + ": exact HTML");
  const reparsed = semanticNode(hsonTransform.fromTrustedHtml(output).toNode());
  atomic.equal(strictEqual(reparsed, entry.expectedGraph), true, entry.id + ": HTML reparse");
  atomic.equal(strictEqual(admitted, entry.expectedGraph), true, entry.id + ": ownership normalization boundary");
  atomic.deepEqual(
    entry.expectedStringLeaves === undefined ? [] : stringLeaves(reparsed),
    entry.expectedStringLeaves ?? [],
    entry.id + ": string leaf count and order",
  );
  if (entry.graphIngress !== undefined) atomic.deepEqual(entry.graphIngress, inputBefore, entry.id + ": graph nonmutation");
  else atomic.equal(entry.transportIngress, inputBefore, entry.id + ": source nonmutation");
  atomic.equal(hsonTransform.fromNode(entry.expectedGraph).toHtml().serialize(), output, entry.id + ": deterministic HTML");
  assertNegativeZeroPaths(atomic, entry, admitted, "structural HTML admission");
  assertNegativeZeroPaths(atomic, entry, reparsed, "structural HTML reparse");
}

function captureOracleError(run: () => unknown): TransformOracleAssertionError {
  let observed: TransformOracleAssertionError | undefined;
  assert.throws(run, (error) => {
    if (!(error instanceof TransformOracleAssertionError)) return false;
    observed = error;
    return true;
  });
  assert.ok(observed);
  return observed;
}

function runDiagnostic(entry: AcceptedCorpusCase, atomic: AtomicAssertions): void {
  const baseline = structuredClone(entry.expectedGraph);
  if (entry.id.endsWith("original-baseline-retained")) {
    const wire = hsonTransform.fromNode(baseline).toHson().serialize();
    const reparsed = hsonTransform.fromHson(wire).toNode();
    atomic.equal(strictEqual(baseline, entry.expectedGraph), true, entry.id + ": original baseline");
    atomic.equal(strictEqual(reparsed, baseline), true, entry.id + ": route compares to baseline");
    atomic.equal(canonical_hson_graph_difference(baseline, reparsed), undefined, entry.id + ": exact closure");
    atomic.deepEqual(entry.expectedGraph, baseline, entry.id + ": baseline unmodified");
    return;
  }
  if (entry.id.endsWith("divergence-cannot-replace-baseline")) {
    const divergent = obj(property("value", val(1)));
    const error = captureOracleError(() => assert_canonical_oracle_graph_equal({
      launcher: "certified-authored-hson-corpus", caseId: entry.id, operation: "divergence",
      expected: baseline, actual: divergent,
    }));
    atomic.equal(error.classification, "canonical-divergence", entry.id + ": divergence classification");
    atomic.ok(error.witness.firstCanonicalDifference !== undefined, entry.id + ": exact difference");
    atomic.equal(strictEqual(baseline, entry.expectedGraph), true, entry.id + ": baseline retained");
    atomic.equal(strictEqual(divergent, baseline), false, entry.id + ": divergence cannot replace baseline");
    return;
  }
  if (entry.id.endsWith("lossy-fixed-point-cannot-pass")) {
    const lossy = obj(property("before", val(1)));
    const error = captureOracleError(() => assertCanonicalCycleConvergence({
      launcher: "certified-authored-hson-corpus", caseId: entry.id, operation: "cycle",
      initial: baseline, cycles: 2, next: () => lossy,
    }));
    atomic.equal(error.classification, "nonconvergent-cycle", entry.id + ": nonconvergent classification");
    atomic.ok(error.witness.firstCanonicalDifference !== undefined, entry.id + ": divergence evidence");
    atomic.equal(strictEqual(baseline, entry.expectedGraph), true, entry.id + ": baseline retained");
    atomic.equal(strictEqual(lossy, baseline), false, entry.id + ": lossy fixed point cannot pass");
    return;
  }
  const witness = format_transform_oracle_witness({
    launcher: "certified-authored-hson-corpus", case: "negative-zero-witness", operation: "render",
    graphFixture: baseline, expectedClassification: "success", actualClassification: "canonical-divergence",
    stage: "canonical-comparison",
  });
  atomic.equal(witness, entry.expectedOutputs.diagnostic, entry.id + ": exact witness");
  atomic.ok(witness.includes("\"$number\": \"-0\""), entry.id + ": negative-zero rendering");
  atomic.equal(strictEqual(baseline, entry.expectedGraph), true, entry.id + ": baseline retained");
  atomic.equal(Object.is(baseline.$_content[0], -0), true, entry.id + ": witness baseline identity");
}

function runAccepted(entry: AcceptedCorpusCase, atomic: AtomicAssertions): void {
  const before = atomic.count;
  switch (entry.classification) {
    case "literal-accepted-authored-hson":
    case "materialized-accepted-family-case":
      runAcceptedAuthored(entry, atomic);
      break;
    case "graph-ingress-accepted-transport":
      runAcceptedGraph(entry, atomic);
      break;
    case "structural-json-transport":
      runAcceptedJson(entry, atomic);
      break;
    case "structural-html-transport":
      runAcceptedHtml(entry, atomic);
      break;
    case "diagnostic-circuit-regression":
      runDiagnostic(entry, atomic);
      break;
    default:
      throw new Error(entry.id + ": unsupported accepted classification");
  }
  assert.equal(atomic.count - before, acceptedAssertionWeight(entry), entry.id + ": declared accepted assertion weight");
}

function rejectionRun(entry: RejectedCorpusCase): () => unknown {
  if (entry.ingress === "hson") return () => hsonTransform.fromHson(entry.source ?? "").toNode();
  if (entry.ingress === "graph") return () => hsonTransform.fromNode(entry.graphIngress as HsonNode).toNode();
  if (entry.ingress === "json-text") return () => hsonTransform.fromJson(entry.transportIngress ?? "").toNode();
  if (entry.ingress === "html") return () => hsonTransform.fromTrustedHtml(entry.transportIngress ?? "").toNode();
  throw new Error(entry.id + ": unsupported rejected ingress");
}

function captureRejection(run: () => unknown): TransformError {
  let observed: TransformError | undefined;
  assert.throws(run, (error) => {
    if (!(error instanceof TransformError)) return false;
    observed = error;
    return true;
  });
  assert.ok(observed);
  return observed;
}

function runRejected(entry: RejectedCorpusCase, atomic: AtomicAssertions): void {
  const sourceBefore = entry.source ?? entry.transportIngress;
  const graphBefore = entry.graphIngress === undefined ? undefined : structuredClone(entry.graphIngress);
  const run = rejectionRun(entry);
  const first = captureRejection(run);
  const firstDetails = read_transform_error_details(first);
  atomic.ok(firstDetails !== undefined, entry.id + ": deterministic rejection");
  atomic.equal(firstDetails?.operation, entry.expectedRejection.operation, entry.id + ": operation");
  atomic.equal(firstDetails?.stage, entry.expectedRejection.stage, entry.id + ": stage");
  atomic.equal(firstDetails?.code, entry.expectedRejection.code, entry.id + ": code");
  atomic.deepEqual(firstDetails?.source, entry.expectedRejection.source, entry.id + ": source coordinates");
  atomic.equal(firstDetails?.path, entry.expectedRejection.path, entry.id + ": path");
  atomic.deepEqual(firstDetails?.related, entry.expectedRejection.related, entry.id + ": related evidence");
  if (entry.graphIngress === undefined) atomic.equal(entry.source ?? entry.transportIngress, sourceBefore, entry.id + ": source nonmutation");
  else atomic.deepEqual(entry.graphIngress, graphBefore, entry.id + ": graph nonmutation");
  const secondDetails = read_transform_error_details(captureRejection(run));
  atomic.deepEqual(secondDetails, firstDetails, entry.id + ": equivalent repeated rejection");
}

export type CorpusRunSummary = Readonly<{
  acceptedCases: number;
  rejectedCases: number;
  acceptedAssertions: number;
  rejectedAssertions: number;
}>;

export function runAcceptedCorpusCases(): CorpusRunSummary {
  const atomic = new AtomicAssertions();
  const accepted = materializedCorpusCases.filter((entry): entry is AcceptedCorpusCase => entry.disposition === "accept");
  for (const entry of accepted) runAccepted(entry, atomic);
  assert.equal(atomic.count, corpusAssertionCounts.acceptedAssertions);
  return { acceptedCases: accepted.length, rejectedCases: 0, acceptedAssertions: atomic.count, rejectedAssertions: 0 };
}

export function runRejectedCorpusCases(): CorpusRunSummary {
  const atomic = new AtomicAssertions();
  const rejected = materializedCorpusCases.filter((entry): entry is RejectedCorpusCase => entry.disposition === "reject");
  for (const entry of rejected) runRejected(entry, atomic);
  assert.equal(atomic.count, corpusAssertionCounts.rejectedAssertions);
  return { acceptedCases: 0, rejectedCases: rejected.length, acceptedAssertions: 0, rejectedAssertions: atomic.count };
}

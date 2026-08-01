import type { AcceptedCorpusCase, SpecializedReferenceCase } from "./corpus-types.mts";
import { obj, property, val } from "./graph-expectations.mts";

function diagnostic(id: string, claim: string, graph: AcceptedCorpusCase["expectedGraph"], tags: readonly string[]): AcceptedCorpusCase {
  return {
    id: "diagnostic." + id, claim, classification: "diagnostic-circuit-regression", ingress: "diagnostic",
    escapedInput: JSON.stringify(graph), taxonomy: { shape: graph.$_tag, slot: "diagnostic-baseline", variation: id },
    tags: ["diagnostic-circuit", ...tags], origin: "transform-test-oracle-contract", rationale: claim,
    disposition: "accept", graphIngress: graph, expectedGraph: graph, expectedOutputs: {},
  };
}

export const diagnosticCircuitCases: readonly AcceptedCorpusCase[] = [
  diagnostic("original-baseline-retained", "Every diagnostic route compares against the original admitted graph baseline.", obj(property("value", val(1))), ["baseline"]),
  diagnostic("divergence-cannot-replace-baseline", "A divergent intermediate graph cannot replace the diagnostic baseline.", obj(property("value", val(2))), ["divergence"]),
  diagnostic("lossy-fixed-point-cannot-pass", "Lossy fixed-point convergence cannot satisfy strict baseline closure.", obj(property("before", val(1)), property("after", val(2))), ["fixed-point", "divergence"]),
  {
    ...diagnostic("negative-zero-witness", "Diagnostic witness rendering distinguishes negative zero from zero.", val(-0), ["negative-zero", "witness"]),
    negativeZeroPaths: ["$.$_content[0]"],
    expectedOutputs: { diagnostic: `{
  "actualClassification": "canonical-divergence",
  "case": "negative-zero-witness",
  "expectedClassification": "success",
  "graphFixture": {
    "$_content": [
      {
        "$number": "-0"
      }
    ],
    "$_tag": "_hson_val"
  },
  "launcher": "certified-authored-hson-corpus",
  "operation": "render",
  "stage": "canonical-comparison"
}` },
  },
] as const;

function reference(id: string, claim: string, referencedCaseIds: readonly string[], tags: readonly string[]): SpecializedReferenceCase {
  return {
    id: "reference." + id, claim, classification: "specialized-test-cross-reference", ingress: "reference",
    escapedInput: JSON.stringify(referencedCaseIds), taxonomy: { shape: "specialized-suite", slot: "cross-reference", variation: id },
    tags: ["specialized-test", ...tags], origin: "specialized-fixture-ownership", rationale: claim,
    disposition: "reference", referencedCaseIds,
  };
}

export const specializedReferenceCases: readonly SpecializedReferenceCase[] = [
  reference("tokenizer-token-arrays", "Tokenizer token-array shape remains specialized ownership.", ["tests/hson-tokenizer.acceptance.mts#token-summary"], ["tokenizer"]),
  reference("coordinate-mechanics", "Exhaustive coordinate mechanics remain specialized ownership.", ["tests/hson-tokenizer.acceptance.mts#structured-identities"], ["diagnostics"]),
  reference("malformed-graph-admission", "General malformed graph admission remains specialized ownership.", ["tests/hson-root-boundary.acceptance.mts#malformed-graph-admission", "tests/hson-structural-mode.acceptance.mts#canonical-invariant-admission"], ["graph-ingress", "invariants"]),
  reference("serializer-options", "Serializer noBreak/noQuid option matrices remain specialized ownership.", ["tests/hson-serializer.acceptance.mts#option-matrix"], ["serializer"]),
  reference("quid-mechanics", "QUID ingress and egress mechanics remain specialized ownership.", ["tests/hson-node-quid-ingress.acceptance.mts", "tests/hson-node-quid-egress.acceptance.mts"], ["quid"]),
  reference("runtime-wiring", "Worker and browser wiring remain specialized ownership.", ["tests/transform-worker.acceptance.mts", "hson-demo2/tests/browser/parse.spec.ts"], ["worker", "browser"]),
  reference("oracle-self-tests", "Transform-oracle implementation self-tests remain specialized ownership.", ["tests/transform-oracle.acceptance.mts"], ["oracle", "diagnostics"]),
  reference("ordered-json-parser", "Low-level ordered JSON parser mechanics remain specialized ownership.", ["tests/json-ingress.acceptance.mts#structural-json-order"], ["json"]),
  reference("late-duplicate-performance", "The 12,000-property late duplicate remains a scale/performance regression.", ["tests/json-ingress.acceptance.mts#late-duplicate-12000"], ["json", "performance"]),
  reference("wikipedia-legacy-closure", "The Wikipedia real-world closure remains in its legacy HTML suite and is not an authored-HSON semantic case.", ["transform/legacy/html::html__largeFormat.html_wikipedia"], ["legacy-html", "performance", "wikipedia"]),
] as const;

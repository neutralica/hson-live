import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CORPUS_INTEGRITY_ASSERTION_COUNT,
  corpusAssertionCounts,
  corpusCounts,
  corpusFamilyDefinitions,
  materializedCorpusCases,
} from "./corpus-manifest.mts";
import { CORPUS_REVIEW_ARTIFACT, renderCorpusReviewArtifact } from "./corpus-review.mts";
import type { AcceptedCorpusCase, MaterializedCorpusCase, RejectedCorpusCase } from "./corpus-types.mts";

class IntegrityAssertions {
  count = 0;
  hit(value: unknown, message: string): void {
    assert.ok(value, message);
    this.count += 1;
  }
}

function containsFunction(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((entry) => containsFunction(entry, seen));
}

function duplicateSourceClaim(cases: readonly MaterializedCorpusCase[]): boolean {
  const seen = new Set<string>();
  for (const entry of cases) {
    if (entry.disposition === "reference") continue;
    const source = entry.source ?? entry.transportIngress;
    if (source === undefined) continue;
    const key = source + "\u0000" + entry.claim;
    if (seen.has(key) && entry.declaredSourceReuse === undefined) return true;
    seen.add(key);
  }
  return false;
}

function isAccepted(entry: MaterializedCorpusCase): entry is AcceptedCorpusCase {
  return entry.disposition === "accept";
}

function isRejected(entry: MaterializedCorpusCase): entry is RejectedCorpusCase {
  return entry.disposition === "reject";
}

export async function runCorpusIntegrityChecks(): Promise<number> {
  const atomic = new IntegrityAssertions();
  const ids = materializedCorpusCases.map((entry) => entry.id);
  atomic.hit(new Set(ids).size === ids.length, "1 unique case IDs");
  atomic.hit(corpusFamilyDefinitions.every((family) => family.cases.length === family.expectedExpansionCount), "2 exact family counts");
  atomic.hit(corpusFamilyDefinitions.every((family) => family.cases.every((entry) => ids.includes(entry.id))), "3 every expansion materialized");
  atomic.hit(ids.join("\n") === [...ids].sort().join("\n"), "4 deterministic ID ordering");
  atomic.hit(materializedCorpusCases.filter((entry) => entry.disposition === "accept").every((entry) => entry.expectedGraph !== undefined), "5 accepted expected graphs");
  atomic.hit(materializedCorpusCases.filter((entry) => entry.disposition === "accept").every((entry) =>
    entry.classification === "diagnostic-circuit-regression" || Object.keys(entry.expectedOutputs).length > 0), "6 applicable accepted outputs");
  atomic.hit(materializedCorpusCases.filter((entry) => entry.disposition === "reject").every((entry) => entry.expectedRejection.operation.length > 0 && entry.expectedRejection.code.length > 0), "7 structured rejection expectations");
  atomic.hit(!containsFunction(materializedCorpusCases) && !containsFunction(corpusFamilyDefinitions), "8 no callback fixture logic");
  atomic.hit(corpusFamilyDefinitions.every((family) => family.variedDimension.length > 0 && family.cases.every((entry) =>
    entry.taxonomy.variation !== undefined || entry.taxonomy.defect !== undefined)), "9 one visible varied dimension");
  atomic.hit(materializedCorpusCases.every((entry) => entry.taxonomy.shape.length > 0 && entry.taxonomy.slot.length > 0 && entry.origin.length > 0), "10 taxonomy and origin IDs");
  atomic.hit(!duplicateSourceClaim(materializedCorpusCases), "11 no undeclared duplicate source/claim");
  atomic.hit(corpusCounts.declaredSourceReuse === materializedCorpusCases.filter((entry) => entry.declaredSourceReuse !== undefined).length, "12 declared reuse accounting");
  atomic.hit(materializedCorpusCases.every((entry) => !containsFunction(entry.disposition === "accept" ? entry.expectedOutputs : entry)), "13 no production-generated expected output callback");
  atomic.hit(materializedCorpusCases.every((entry) => !containsFunction(entry.disposition === "accept" ? entry.expectedGraph : entry)), "14 no production-generated expected graph callback");
  atomic.hit(corpusCounts.totalConcreteDescriptors === materializedCorpusCases.length, "15 derived summary total");
  const rendered = renderCorpusReviewArtifact();
  atomic.hit(ids.every((id) => rendered.split("=== " + id + " ===").length === 2), "16 review contains every case once");
  atomic.hit(rendered === renderCorpusReviewArtifact(), "17 byte-identical regeneration");
  atomic.hit(materializedCorpusCases.filter((entry) => entry.classification.includes("transport")).every((entry) =>
    entry.ingress === "graph" || entry.ingress === "json-text" || entry.ingress === "html"), "18 transport ingress formats");
  atomic.hit(materializedCorpusCases.filter(isAccepted).filter((entry) => entry.classification === "structural-html-transport" && entry.tags.includes("transport")).every((entry) =>
    entry.expectedStringLeaves !== undefined || !entry.id.includes("string-")), "19 HTML string leaf declarations");
  atomic.hit(materializedCorpusCases.filter(isAccepted).filter((entry) => entry.id.includes("negative-zero")).every((entry) =>
    (entry.negativeZeroPaths?.length ?? 0) > 0), "20 negative-zero Object.is declarations");
  atomic.hit(materializedCorpusCases.filter(isAccepted).filter((entry) => entry.classification === "structural-json-transport").every((entry) =>
    (entry.expectedKeySequences?.length ?? 0) > 0), "21 JSON order declarations");
  atomic.hit(materializedCorpusCases.filter((entry): entry is AcceptedCorpusCase | RejectedCorpusCase => entry.disposition !== "reference" && entry.classification === "structural-html-transport" && (entry.id.includes("style") || entry.id.includes("script"))).every((entry) =>
    entry.htmlMode === "ordinary-html" || entry.htmlMode === "structural-transport"), "22 raw/structural HTML declaration");
  atomic.hit(ids.includes("graph.reject.direct-element-true") && ids.includes("graph.reject.nested-element-number")
    && ids.includes("html.reject.direct-element-value") && ids.includes("html.reject.nested-element-value"), "23 direct and nested element/value rejection");
  atomic.hit(materializedCorpusCases.filter(isRejected).filter((entry) => entry.expectedRejection.code === "HSON_JSON_DUPLICATE_PROPERTY").every((entry) =>
    entry.expectedRejection.source !== undefined && entry.expectedRejection.path !== undefined
    && entry.expectedRejection.related?.[0]?.role === "first-declaration"), "24 decoded duplicate evidence");
  assert.equal(atomic.count, CORPUS_INTEGRITY_ASSERTION_COUNT);
  assert.equal(corpusAssertionCounts.integrityAssertions, atomic.count);
  const committed = await readFile(CORPUS_REVIEW_ARTIFACT, "utf8");
  assert.equal(committed, rendered, "committed review artifact must be current");
  return atomic.count;
}

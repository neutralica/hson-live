import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusAssertionCounts, corpusCounts, materializedCorpusCases } from "./corpus-manifest.mts";
import type { MaterializedCorpusCase } from "./corpus-types.mts";

export const CORPUS_REVIEW_ARTIFACT = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  "docs",
  "contracts",
  "certified-authored-hson-corpus.review.txt",
);

function visibleString(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029\ufffe\uffff]/g, (unit) =>
    "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"));
}

function stableValue(value: unknown, active = new WeakSet<object>()): unknown {
  if (typeof value === "number" && Object.is(value, -0)) return { $number: "-0" };
  if (typeof value === "string") return value;
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) return { $cycle: true };
  active.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => stableValue(entry, active));
    active.delete(value);
    return output;
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    output[key] = stableValue((value as Readonly<Record<string, unknown>>)[key], active);
  }
  active.delete(value);
  return output;
}

function block(label: string, value: unknown): string {
  if (value === undefined) return label + ": —";
  if (typeof value === "string") return label + ": " + visibleString(value);
  return label + ":\n" + JSON.stringify(stableValue(value), null, 2);
}

function renderCase(entry: MaterializedCorpusCase): string {
  const lines = [
    "=== " + entry.id + " ===",
    "claim: " + entry.claim,
    "classification: " + entry.classification,
    "ingress format: " + entry.ingress,
    "escaped input: " + visibleString(entry.escapedInput),
    "verbatim input: " + (entry.verbatimInput === undefined ? "—" : visibleString(entry.verbatimInput)),
    "semantic shape: " + entry.taxonomy.shape,
    "slot: " + entry.taxonomy.slot,
    "variation: " + (entry.taxonomy.variation ?? "—"),
    "defect: " + (entry.taxonomy.defect ?? "—"),
    "disposition: " + entry.disposition,
  ];
  if (entry.disposition === "accept") {
    lines.push(block("hand-authored expected graph", entry.expectedGraph));
    lines.push(block("exact HSON output", entry.expectedOutputs.hson));
    lines.push(block("exact JSON output", entry.expectedOutputs.json));
    lines.push(block("exact HTML output", entry.expectedOutputs.html));
    lines.push(block("exact diagnostic output", entry.expectedOutputs.diagnostic));
    lines.push(block("expected key sequences", entry.expectedKeySequences));
    lines.push(block("expected string leaves", entry.expectedStringLeaves));
    lines.push(block("negative-zero paths", entry.negativeZeroPaths));
    lines.push("structured rejection: —");
  } else if (entry.disposition === "reject") {
    lines.push("hand-authored expected graph: —");
    lines.push("exact HSON output: —");
    lines.push("exact JSON output: —");
    lines.push("exact HTML output: —");
    lines.push(block("structured rejection", entry.expectedRejection));
    lines.push(block("source evidence", entry.expectedRejection.source));
    lines.push("path evidence: " + (entry.expectedRejection.path ?? "—"));
    lines.push(block("related evidence", entry.expectedRejection.related));
  } else {
    lines.push("hand-authored expected graph: —");
    lines.push("structured rejection: —");
    lines.push(block("specialized-test references", entry.referencedCaseIds));
  }
  lines.push("origin: " + entry.origin);
  lines.push(block("specialized-test reference", entry.specializedTestIds));
  lines.push("declared source reuse: " + (entry.declaredSourceReuse ?? "—"));
  lines.push("tags: " + entry.tags.join(", "));
  lines.push("rationale: " + entry.rationale);
  return lines.join("\n");
}

export function renderCorpusReviewArtifact(): string {
  const transports = materializedCorpusCases
    .filter((entry) => entry.classification.includes("transport"))
    .map((entry) => entry.id);
  const header = [
    "CERTIFIED AUTHORED-HSON CORPUS — FULLY MATERIALIZED REVIEW",
    "",
    "SUMMARY",
    JSON.stringify({ counts: corpusCounts, assertions: corpusAssertionCounts }, null, 2),
    "",
    "TRANSPORT INVENTORY",
    ...transports.map((id) => "- " + id),
    "",
    "MATERIALIZED CASES",
    "",
  ].join("\n");
  return header + materializedCorpusCases.map(renderCase).join("\n\n") + "\n";
}

export async function writeCorpusReviewArtifact(): Promise<void> {
  await writeFile(CORPUS_REVIEW_ARTIFACT, renderCorpusReviewArtifact(), "utf8");
}

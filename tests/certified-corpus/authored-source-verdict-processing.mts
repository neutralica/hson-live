import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { corpusCounts, materializedCorpusCases } from "./corpus-manifest.mts";
import {
  AUTHORED_VERDICT_DOCUMENT,
  REVIEW_FAMILY_GROUPS,
  calibratedStandaloneIds,
} from "./authored-source-verdicts.mts";
import type { MaterializedCorpusCase } from "./corpus-types.mts";

export const VERDICT_LEDGER_PATH =
  "docs/contracts/authored-hson-review/02-authored-source-verdict-ledger.json";
export const RECONCILIATION_REPORT_PATH =
  "docs/contracts/authored-hson-review/03-authored-source-reconciliation.md";
export const CORPUS_REVIEW_PATH = "docs/contracts/certified-authored-hson-corpus.review.txt";

type AuthoredCase = Exclude<MaterializedCorpusCase, { disposition: "reference" }> & { source: string };
type RawVerdict = "" | "V" | "I" | "?";
export type HumanVerdict = "valid" | "invalid" | "uncertain" | "unreviewed";
export type VerdictSource = "row" | "family" | "none";

export type ParsedVerdictCase = Readonly<{
  caseId: string;
  humanVerdict: HumanVerdict;
  verdictSource: VerdictSource;
  familyId?: string;
  currentProposal: "valid" | "invalid";
  agreesWithProposal: boolean | null;
  note?: string;
  source: string;
  claim: string;
  section: string;
  provenancePriority: "low" | "medium" | "high" | "critical";
  rowOverride: boolean;
}>;

export type VerdictSummary = Readonly<{
  humanValid: number;
  humanInvalid: number;
  humanUncertain: number;
  unreviewed: number;
  rowVerdicts: number;
  familyInheritedVerdicts: number;
  rowOverrides: number;
  proposalAgreements: number;
  proposalDisagreements: number;
}>;

export type ProcessedWorksheet = Readonly<{
  worksheetSha256: string;
  corpusReviewFingerprint: string;
  families: readonly Readonly<{ familyId: string; humanVerdict: HumanVerdict }>[];
  cases: readonly ParsedVerdictCase[];
  summary: VerdictSummary;
}>;

const authoredCases: readonly AuthoredCase[] = materializedCorpusCases.flatMap((entry) =>
  entry.ingress === "hson" && entry.disposition !== "reference" && entry.source !== undefined
    ? [entry as AuthoredCase]
    : []);
const caseById = new Map(authoredCases.map((entry) => [entry.id, entry]));

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function verdict(raw: RawVerdict): HumanVerdict {
  if (raw === "V") return "valid";
  if (raw === "I") return "invalid";
  if (raw === "?") return "uncertain";
  return "unreviewed";
}

function parsePriorityEvidence(): Map<string, "low" | "medium" | "high" | "critical"> {
  const text = readFileSync(
    "docs/contracts/authored-hson-review/evidence/authored-hson-corpus-provenance-audit.txt",
    "utf8",
  );
  const result = new Map<string, "low" | "medium" | "high" | "critical">();
  for (const match of text.matchAll(/^=== (.+) ===\n([\s\S]*?)^human-review priority: (low|medium|high|critical)$/gm)) {
    result.set(match[1], match[3] as "low" | "medium" | "high" | "critical");
  }
  return result;
}

function sectionAt(text: string, index: number): string {
  const headings = Array.from(text.slice(0, index).matchAll(/^## (\d+\. .+)$/gm));
  return headings.at(-1)?.[1] ?? "Unsectioned";
}

function extractClaim(block: string, fieldEnd: number): string {
  const sourceIndex = block.indexOf("**Source:**", fieldEnd);
  if (sourceIndex < 0) return "";
  return block.slice(fieldEnd, sourceIndex).trim();
}

function extractNote(block: string): string | undefined {
  const lines = block.split("\n");
  const notesIndex = lines.findIndex((line) => line.startsWith("**Notes:**"));
  if (notesIndex < 0) return undefined;
  const noteLines: string[] = [];
  const sameLine = lines[notesIndex].slice("**Notes:**".length);
  if (sameLine.length > 0) noteLines.push(sameLine);
  for (let index = notesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---" || line.startsWith("<!-- family:end ")
        || line.startsWith("## ") || line.startsWith("### Family:")) break;
    noteLines.push(line);
  }
  while (noteLines[0] === "") noteLines.shift();
  while (noteLines.at(-1) === "") noteLines.pop();
  return noteLines.length === 0 ? undefined : noteLines.join("\n");
}

function familyMembership(text: string): Readonly<{
  caseToFamily: Map<string, string>;
  familyVerdicts: Map<string, RawVerdict>;
}> {
  const caseToFamily = new Map<string, string>();
  const familyVerdicts = new Map<string, RawVerdict>();
  for (const group of REVIEW_FAMILY_GROUPS) {
    const startMarker = `<!-- family:start ${group.id} -->`;
    const endMarker = `<!-- family:end ${group.id} -->`;
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker);
    if (start < 0 || end < start) throw new Error(`Missing or malformed family region: ${group.id}`);
    const regionIds = Array.from(text.slice(start, end).matchAll(/^<!-- authored-case:([^>\n]+) -->$/gm))
      .map((match) => match[1]);
    const expectedIds = group.entries.map((entry) => entry.id);
    if (regionIds.join("\n") !== expectedIds.join("\n")) {
      throw new Error(`Family membership or order changed: ${group.id}`);
    }
    for (const id of regionIds) caseToFamily.set(id, group.id);
    const preceding = text.slice(0, start);
    const fields = Array.from(preceding.matchAll(
      /^\*\*Family verdict — V \/ I \/ \?:\*\*\s*`([^`]*)`\s*$/gm,
    ));
    const raw = fields.at(-1)?.[1].trim();
    if (raw === undefined || !["", "V", "I", "?"].includes(raw)) {
      const line = fields.at(-1)?.index === undefined ? 0 : lineNumber(text, fields.at(-1)!.index!);
      throw new Error(`Malformed family verdict for ${group.id} at line ${line}: ${JSON.stringify(raw)}`);
    }
    familyVerdicts.set(group.id, raw as RawVerdict);
  }
  return { caseToFamily, familyVerdicts };
}

export function processWorksheet(text: string): ProcessedWorksheet {
  const markers = Array.from(text.matchAll(/^<!-- authored-case:([^>\n]+) -->$/gm));
  if (markers.length !== 269) throw new Error(`Expected 269 authored-case markers, found ${markers.length}.`);
  const ids = markers.map((match) => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate authored-case marker.");
  const expectedIds = authoredCases.map((entry) => entry.id).sort();
  if ([...ids].sort().join("\n") !== expectedIds.join("\n")) {
    throw new Error("Worksheet case IDs do not exactly match the authored descriptor inventory.");
  }

  const { caseToFamily, familyVerdicts } = familyMembership(text);
  for (const id of calibratedStandaloneIds()) {
    if (caseToFamily.has(id)) throw new Error(`Calibrated case must remain standalone: ${id}`);
  }
  const priorityEvidence = parsePriorityEvidence();
  const parsed: ParsedVerdictCase[] = [];

  for (const [index, marker] of markers.entries()) {
    const id = marker[1];
    const descriptor = caseById.get(id);
    if (descriptor === undefined) throw new Error(`Unknown authored case ID: ${id}`);
    const blockStart = marker.index! + marker[0].length;
    const blockEnd = markers[index + 1]?.index ?? text.length;
    const block = text.slice(blockStart, blockEnd);
    const fields = Array.from(block.matchAll(
      /^\*\*(Verdict|Override) — V \/ I \/ \?:\*\*\s*`([^`]*)`\s*$/gm,
    ));
    if (fields.length !== 1) throw new Error(`${id} has ${fields.length} verdict fields.`);
    const rowRaw = fields[0][2].trim();
    if (!["", "V", "I", "?"].includes(rowRaw)) {
      throw new Error(`Malformed verdict at line ${lineNumber(text, blockStart + fields[0].index!)} for ${id}: ${JSON.stringify(rowRaw)}`);
    }
    const familyId = caseToFamily.get(id);
    const familyRaw = familyId === undefined ? "" : familyVerdicts.get(familyId)!;
    const effectiveRaw = (rowRaw || familyRaw) as RawVerdict;
    const verdictSource: VerdictSource = rowRaw !== "" ? "row" : familyRaw !== "" ? "family" : "none";
    const humanVerdict = verdict(effectiveRaw);
    const currentProposal = descriptor.disposition === "accept" ? "valid" : "invalid";
    const agreesWithProposal = humanVerdict === "valid" || humanVerdict === "invalid"
      ? humanVerdict === currentProposal
      : null;
    const visibleProposal = Array.from(block.matchAll(/^\*\*Current proposal:\*\* (Valid|Invalid)$/gm));
    if (visibleProposal.length !== 1 || visibleProposal[0][1].toLowerCase() !== currentProposal) {
      throw new Error(`Current proposal mismatch for ${id}.`);
    }
    const claim = extractClaim(block, fields[0].index! + fields[0][0].length);
    if (claim.length === 0) throw new Error(`Missing visible claim for ${id}.`);
    const note = extractNote(block);
    const provenancePriority = descriptor.humanReviewPriority
      ?? priorityEvidence.get(id)
      ?? "medium";
    parsed.push({
      caseId: id,
      humanVerdict,
      verdictSource,
      ...(familyId === undefined ? {} : { familyId }),
      currentProposal,
      agreesWithProposal,
      ...(note === undefined ? {} : { note }),
      source: descriptor.source,
      claim,
      section: sectionAt(text, marker.index!),
      provenancePriority,
      rowOverride: familyId !== undefined && rowRaw !== "" && familyRaw !== "",
    });
  }

  const count = (predicate: (entry: ParsedVerdictCase) => boolean): number => parsed.filter(predicate).length;
  const summary: VerdictSummary = {
    humanValid: count((entry) => entry.humanVerdict === "valid"),
    humanInvalid: count((entry) => entry.humanVerdict === "invalid"),
    humanUncertain: count((entry) => entry.humanVerdict === "uncertain"),
    unreviewed: count((entry) => entry.humanVerdict === "unreviewed"),
    rowVerdicts: count((entry) => entry.verdictSource === "row"),
    familyInheritedVerdicts: count((entry) => entry.verdictSource === "family"),
    rowOverrides: count((entry) => entry.rowOverride),
    proposalAgreements: count((entry) => entry.agreesWithProposal === true),
    proposalDisagreements: count((entry) => entry.agreesWithProposal === false),
  };
  return {
    worksheetSha256: sha256(text),
    corpusReviewFingerprint: sha256(readFileSync(CORPUS_REVIEW_PATH)),
    families: REVIEW_FAMILY_GROUPS.map((group) => ({
      familyId: group.id,
      humanVerdict: verdict(familyVerdicts.get(group.id)!),
    })),
    cases: parsed,
    summary,
  };
}

export function processCurrentWorksheet(): ProcessedWorksheet {
  return processWorksheet(readFileSync(AUTHORED_VERDICT_DOCUMENT, "utf8"));
}

export function renderLedger(processed: ProcessedWorksheet): string {
  const ledger = {
    schemaVersion: 1,
    artifactKind: "authored-hson-source-verdict-ledger",
    scope: "human-reviewed authored-language membership only",
    worksheetSha256: processed.worksheetSha256,
    corpusReviewFingerprint: processed.corpusReviewFingerprint,
    authoredDescriptorCount: corpusCounts.uniqueAuthoredSources,
    summary: processed.summary,
    families: processed.families,
    cases: processed.cases.map((entry) => ({
      caseId: entry.caseId,
      humanVerdict: entry.humanVerdict,
      verdictSource: entry.verdictSource,
      ...(entry.familyId === undefined ? {} : { familyId: entry.familyId }),
      currentProposal: entry.currentProposal,
      agreesWithProposal: entry.agreesWithProposal,
      ...(entry.note === undefined ? {} : { note: entry.note }),
    })),
  };
  return JSON.stringify(ledger, null, 2) + "\n";
}

function sourceCode(source: string): string {
  const value = JSON.stringify(source)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
    .replaceAll("\ufeff", "\\uFEFF");
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${value}${fence}`;
}

const recommendationById = new Map<string, string>([
  ["hson.reject.basis.number.missing-integer-before-fraction", "specification correction"],
  ["hson.reject.literal.element.malformed-closer", "specification correction"],
  ["hson.reject.literal.root.mixed-modes", "specification correction"],
]);

const remainingQuestionById = new Map<string, string>([
  ["hson.accept.literal.object.one-property", "Confirm that `<a 1>` is valid as written and separate that verdict from the broader question of string-valued object properties."],
  ["hson.accept.basis.number.negative-exponent-sign", "Confirm whether authored numbers follow JSON by accepting a negative exponent sign."],
  ["hson.accept.basis.number.positive-exponent-sign", "Confirm whether authored numbers follow JSON by accepting an explicit positive exponent sign."],
  ["hson.accept.literal.primitive.exponent", "Confirm whether ordinary exponent notation is admitted under the JSON-number rule."],
  ["hson.reject.literal.comment.block", "Decide whether block comments remain forbidden or become authored-HSON trivia."],
  ["hson.reject.literal.source.comment-only", "Decide whether comment-only input is invalid because it contains no semantic root value."],
  ["hson.reject.literal.whitespace.byte-order-mark", "Decide whether U+FEFF is forbidden or admitted as source trivia."],
]);

function reportNote(note: string | undefined): string {
  return note === undefined ? "_(none)_" : note.replace(/[ \t]+$/gm, "").replaceAll("\n", "<br>");
}

export function renderReconciliation(processed: ProcessedWorksheet): string {
  const disagreements = processed.cases.filter((entry) => entry.agreesWithProposal === false);
  const uncertain = processed.cases.filter((entry) => entry.humanVerdict === "uncertain");
  const unreviewed = processed.cases.filter((entry) => entry.humanVerdict === "unreviewed");
  const lines: string[] = [
    "# Authored-HSON source-membership reconciliation",
    "",
    "This report reconciles only **human-reviewed authored-language membership**.",
    "It does not certify expected graphs, canonical output, or structured diagnostics.",
    "",
    "## Input binding",
    "",
    `- Worksheet SHA-256: \`${processed.worksheetSha256}\``,
    `- Corpus review fingerprint: \`${processed.corpusReviewFingerprint}\``,
    `- Authored descriptors: ${processed.cases.length}`,
    "",
    "## Summary",
    "",
    "| Measure | Count |",
    "|---|---:|",
    `| Human valid | ${processed.summary.humanValid} |`,
    `| Human invalid | ${processed.summary.humanInvalid} |`,
    `| Human uncertain | ${processed.summary.humanUncertain} |`,
    `| Unreviewed | ${processed.summary.unreviewed} |`,
    `| Row verdicts | ${processed.summary.rowVerdicts} |`,
    `| Family-inherited verdicts | ${processed.summary.familyInheritedVerdicts} |`,
    `| Row overrides | ${processed.summary.rowOverrides} |`,
    `| Proposal agreements | ${processed.summary.proposalAgreements} |`,
    `| Proposal disagreements | ${processed.summary.proposalDisagreements} |`,
    "",
    "## Proposal disagreements",
    "",
  ];
  for (const entry of disagreements) {
    lines.push(
      `### \`${entry.caseId}\``,
      "",
      `- Exact authored source: ${sourceCode(entry.source)}`,
      `- Current proposal: ${entry.currentProposal}`,
      `- Human verdict: ${entry.humanVerdict}`,
      `- Human note: ${reportNote(entry.note)}`,
      `- Candidate claim: ${entry.claim}`,
      `- Provenance priority: ${entry.provenancePriority}`,
      `- Recommended owner: **${recommendationById.get(entry.caseId) ?? "review clarification"}**`,
      "",
    );
  }
  lines.push("## Uncertain cases", "");
  for (const entry of uncertain) {
    lines.push(
      `### \`${entry.caseId}\``,
      "",
      `- Source: ${sourceCode(entry.source)}`,
      `- Human note: ${reportNote(entry.note)}`,
      `- Current proposal: ${entry.currentProposal}`,
      `- Minimal remaining question: ${remainingQuestionById.get(entry.caseId) ?? "Clarify the intended authored-language membership rule."}`,
      "",
    );
  }
  lines.push("## Unreviewed cases", "");
  const groups = new Map<string, ParsedVerdictCase[]>();
  for (const entry of unreviewed) {
    const key = entry.familyId === undefined ? entry.section : `${entry.section} / family \`${entry.familyId}\``;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const [group, entries] of groups) {
    lines.push(`### ${group}`, "", ...entries.map((entry) => `- \`${entry.caseId}\``), "");
  }
  lines.push(
    "## Next focused action",
    "",
    "Resolve the three proposal disagreements, seven uncertain cases, and two entirely unreviewed",
    "accepted-family groups. Only then reconcile expected graphs and canonical outputs for sources",
    "whose authored-language validity has human approval.",
    "",
  );
  return lines.join("\n");
}

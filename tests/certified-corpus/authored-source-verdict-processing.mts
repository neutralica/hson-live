import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AMENDMENT_ONLY_ACTIVE_CASES,
  HISTORICAL_WORKSHEET_PATH,
  HISTORICAL_WORKSHEET_SHA256,
  QUOTED_NAME_AMENDMENT_PATH,
  activeCaseIdForHistorical,
  activeFamilyIdForHistorical,
  amendmentVerdictForActiveCase,
  delimiterChangedForCase,
} from "./authored-name-delimiter-amendment.mts";
import { materializedCorpusCases } from "./corpus-manifest.mts";
import type { MaterializedCorpusCase } from "./corpus-types.mts";

export const VERDICT_LEDGER_PATH =
  "docs/contracts/authored-hson-review/02-authored-source-verdict-ledger.json";
export const RECONCILIATION_REPORT_PATH =
  "docs/contracts/authored-hson-review/03-authored-source-reconciliation.md";
export const CORPUS_REVIEW_PATH = "docs/contracts/certified-authored-hson-corpus.review.txt";

type AuthoredCase = Exclude<MaterializedCorpusCase, { disposition: "reference" }> & { source: string };
type RawVerdict = "" | "V" | "I" | "?";
export type HumanVerdict = "valid" | "invalid" | "uncertain" | "unreviewed";
export type VerdictSource = "row" | "family" | "amendment" | "none";

export type ParsedVerdictCase = Readonly<{
  caseId: string;
  historicalCaseId?: string;
  humanVerdict: HumanVerdict;
  historicalVerdict?: HumanVerdict;
  verdictSource: VerdictSource;
  historicalVerdictSource?: Exclude<VerdictSource, "amendment">;
  familyId?: string;
  historicalFamilyId?: string;
  currentProposal: "valid" | "invalid";
  agreesWithProposal: boolean | null;
  note?: string;
  source: string;
  claim: string;
  historicalClaim?: string;
  section: string;
  provenancePriority: "low" | "medium" | "high" | "critical";
  rowOverride: boolean;
  amendmentApplied: boolean;
}>;

export type VerdictSummary = Readonly<{
  humanValid: number;
  humanInvalid: number;
  humanUncertain: number;
  unreviewed: number;
  rowVerdicts: number;
  familyInheritedVerdicts: number;
  amendmentVerdicts: number;
  rowOverrides: number;
  proposalAgreements: number;
  proposalDisagreements: number;
}>;

export type ProcessedWorksheet = Readonly<{
  worksheetSha256: string;
  amendmentSha256: string;
  corpusReviewFingerprint: string;
  families: readonly Readonly<{
    familyId: string;
    historicalFamilyId: string;
    humanVerdict: HumanVerdict;
    historicalVerdict: HumanVerdict;
  }>[];
  caseIdMigrations: readonly Readonly<{ historicalCaseId: string; activeCaseId: string }>[];
  cases: readonly ParsedVerdictCase[];
  summary: VerdictSummary;
}>;

const authoredCases: readonly AuthoredCase[] = materializedCorpusCases.flatMap((entry) =>
  entry.ingress === "hson" && entry.disposition !== "reference" && entry.source !== undefined
    ? [entry as AuthoredCase]
    : []);
const caseById = new Map(authoredCases.map((entry) => [entry.id, entry]));
const HISTORICAL_AUTHORED_CASE_COUNT = 269;
const calibratedHistoricalStandaloneIds = Object.freeze([
  "hson.reject.family.backtick-name.unicode-interrupted-backtick",
  "hson.reject.family.backtick-name.trailing-backslash",
]);

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
  return headings.at(-1)?.[1] ?? "Amendment-only cases";
}

function extractHistoricalClaim(block: string, fieldEnd: number): string {
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
  familyOrder: readonly string[];
  familyVerdicts: Map<string, RawVerdict>;
}> {
  const caseToFamily = new Map<string, string>();
  const familyVerdicts = new Map<string, RawVerdict>();
  const starts = Array.from(text.matchAll(/^<!-- family:start ([^>\n]+) -->$/gm));
  for (const startMatch of starts) {
    const familyId = startMatch[1];
    const start = startMatch.index! + startMatch[0].length;
    const endMarker = `<!-- family:end ${familyId} -->`;
    const end = text.indexOf(endMarker, start);
    if (end < start) throw new Error(`Missing or malformed historical family region: ${familyId}`);
    const regionIds = Array.from(text.slice(start, end).matchAll(/^<!-- authored-case:([^>\n]+) -->$/gm))
      .map((match) => match[1]);
    if (regionIds.length === 0) throw new Error(`Historical family has no cases: ${familyId}`);
    for (const id of regionIds) {
      if (caseToFamily.has(id)) throw new Error(`Historical case belongs to multiple families: ${id}`);
      caseToFamily.set(id, familyId);
    }
    const fields = Array.from(text.slice(0, startMatch.index).matchAll(
      /^\*\*Family verdict — V \/ I \/ \?:\*\*\s*`([^`]*)`\s*$/gm,
    ));
    const raw = fields.at(-1)?.[1].trim();
    if (raw === undefined || !["", "V", "I", "?"].includes(raw)) {
      throw new Error(`Malformed historical family verdict for ${familyId}.`);
    }
    familyVerdicts.set(familyId, raw as RawVerdict);
  }
  return { caseToFamily, familyOrder: starts.map((match) => match[1]), familyVerdicts };
}

export function processWorksheet(text: string): ProcessedWorksheet {
  const worksheetSha256 = sha256(text);
  if (worksheetSha256 !== HISTORICAL_WORKSHEET_SHA256) {
    throw new Error(`Historical worksheet SHA-256 mismatch: ${worksheetSha256}`);
  }
  const markers = Array.from(text.matchAll(/^<!-- authored-case:([^>\n]+) -->$/gm));
  if (markers.length !== HISTORICAL_AUTHORED_CASE_COUNT) {
    throw new Error(`Expected ${HISTORICAL_AUTHORED_CASE_COUNT} historical authored-case markers, found ${markers.length}.`);
  }
  const historicalIds = markers.map((match) => match[1]);
  if (new Set(historicalIds).size !== historicalIds.length) throw new Error("Duplicate historical authored-case marker.");

  const caseIdMigrations = historicalIds.map((historicalCaseId) => ({
    historicalCaseId,
    activeCaseId: activeCaseIdForHistorical(historicalCaseId),
  }));
  const migratedIds = caseIdMigrations.map((entry) => entry.activeCaseId);
  if (new Set(migratedIds).size !== migratedIds.length) throw new Error("Historical-to-active case-ID mapping is not one-to-one.");
  const expectedActiveIds = [...migratedIds, ...Object.keys(AMENDMENT_ONLY_ACTIVE_CASES)].sort();
  const actualActiveIds = authoredCases.map((entry) => entry.id).sort();
  if (expectedActiveIds.join("\n") !== actualActiveIds.join("\n")) {
    throw new Error("Amendment-aware worksheet inventory does not exactly match active authored descriptors.");
  }

  const { caseToFamily, familyOrder, familyVerdicts } = familyMembership(text);
  for (const id of calibratedHistoricalStandaloneIds) {
    if (caseToFamily.has(id)) throw new Error(`Calibrated historical case must remain standalone: ${id}`);
  }
  const priorityEvidence = parsePriorityEvidence();
  const parsed: ParsedVerdictCase[] = [];

  for (const [index, marker] of markers.entries()) {
    const historicalCaseId = marker[1];
    const caseId = activeCaseIdForHistorical(historicalCaseId);
    const descriptor = caseById.get(caseId);
    if (descriptor === undefined) throw new Error(`Unknown active authored case ID: ${caseId}`);
    const blockStart = marker.index! + marker[0].length;
    const blockEnd = markers[index + 1]?.index ?? text.length;
    const block = text.slice(blockStart, blockEnd);
    const fields = Array.from(block.matchAll(
      /^\*\*(Verdict|Override) — V \/ I \/ \?:\*\*\s*`([^`]*)`\s*$/gm,
    ));
    if (fields.length !== 1) throw new Error(`${historicalCaseId} has ${fields.length} verdict fields.`);
    const rowRaw = fields[0][2].trim();
    if (!["", "V", "I", "?"].includes(rowRaw)) {
      throw new Error(`Malformed verdict at line ${lineNumber(text, blockStart + fields[0].index!)} for ${historicalCaseId}: ${JSON.stringify(rowRaw)}`);
    }
    const historicalFamilyId = caseToFamily.get(historicalCaseId);
    const familyRaw = historicalFamilyId === undefined ? "" : familyVerdicts.get(historicalFamilyId)!;
    const effectiveRaw = (rowRaw || familyRaw) as RawVerdict;
    const historicalVerdictSource: Exclude<VerdictSource, "amendment"> =
      rowRaw !== "" ? "row" : familyRaw !== "" ? "family" : "none";
    const historicalVerdict = verdict(effectiveRaw);
    const amendmentVerdict = amendmentVerdictForActiveCase(caseId);
    const humanVerdict = amendmentVerdict ?? historicalVerdict;
    const verdictSource: VerdictSource = amendmentVerdict === undefined ? historicalVerdictSource : "amendment";
    const currentProposal = descriptor.disposition === "accept" ? "valid" : "invalid";
    const agreesWithProposal = humanVerdict === "valid" || humanVerdict === "invalid"
      ? humanVerdict === currentProposal
      : null;
    const visibleProposal = Array.from(block.matchAll(/^\*\*Current proposal:\*\* (Valid|Invalid)$/gm));
    if (visibleProposal.length !== 1) throw new Error(`Historical proposal field is missing for ${historicalCaseId}.`);
    const historicalClaim = extractHistoricalClaim(block, fields[0].index! + fields[0][0].length);
    if (historicalClaim.length === 0) throw new Error(`Missing visible historical claim for ${historicalCaseId}.`);
    const note = extractNote(block);
    const familyId = historicalFamilyId === undefined ? undefined : activeFamilyIdForHistorical(historicalFamilyId);
    parsed.push({
      caseId,
      historicalCaseId,
      humanVerdict,
      historicalVerdict,
      verdictSource,
      historicalVerdictSource,
      ...(familyId === undefined ? {} : { familyId, historicalFamilyId }),
      currentProposal,
      agreesWithProposal,
      ...(note === undefined ? {} : { note }),
      source: descriptor.source,
      claim: descriptor.claim,
      historicalClaim,
      section: sectionAt(text, marker.index!),
      provenancePriority: descriptor.humanReviewPriority ?? priorityEvidence.get(historicalCaseId) ?? "medium",
      rowOverride: historicalFamilyId !== undefined && rowRaw !== "" && familyRaw !== "",
      amendmentApplied: delimiterChangedForCase(historicalCaseId, caseId),
    });
  }

  for (const [caseId, humanVerdict] of Object.entries(AMENDMENT_ONLY_ACTIVE_CASES)) {
    const descriptor = caseById.get(caseId);
    if (descriptor === undefined) throw new Error(`Missing amendment-only active authored case: ${caseId}`);
    const currentProposal = descriptor.disposition === "accept" ? "valid" : "invalid";
    parsed.push({
      caseId,
      humanVerdict,
      verdictSource: "amendment",
      currentProposal,
      agreesWithProposal: humanVerdict === currentProposal,
      source: descriptor.source,
      claim: descriptor.claim,
      section: "Amendment-only cases",
      provenancePriority: descriptor.humanReviewPriority ?? "critical",
      rowOverride: false,
      amendmentApplied: true,
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
    amendmentVerdicts: count((entry) => entry.verdictSource === "amendment"),
    rowOverrides: count((entry) => entry.rowOverride),
    proposalAgreements: count((entry) => entry.agreesWithProposal === true),
    proposalDisagreements: count((entry) => entry.agreesWithProposal === false),
  };
  return {
    worksheetSha256,
    amendmentSha256: sha256(readFileSync(QUOTED_NAME_AMENDMENT_PATH)),
    corpusReviewFingerprint: sha256(readFileSync(CORPUS_REVIEW_PATH)),
    families: familyOrder.map((historicalFamilyId) => {
      const familyId = activeFamilyIdForHistorical(historicalFamilyId);
      const historicalVerdict = verdict(familyVerdicts.get(historicalFamilyId)!);
      const amendedFamily = familyId.includes("quoted-name");
      return {
        familyId,
        historicalFamilyId,
        humanVerdict: amendedFamily && historicalVerdict === "unreviewed" ? "valid" : historicalVerdict,
        historicalVerdict,
      };
    }),
    caseIdMigrations,
    cases: parsed,
    summary,
  };
}

export function processCurrentWorksheet(): ProcessedWorksheet {
  return processWorksheet(readFileSync(HISTORICAL_WORKSHEET_PATH, "utf8"));
}

export function renderLedger(processed: ProcessedWorksheet): string {
  const ledger = {
    schemaVersion: 2,
    artifactKind: "authored-hson-source-verdict-ledger",
    scope: "amendment-aware human-reviewed authored-language membership only",
    inputBinding: {
      historicalWorksheetPath: HISTORICAL_WORKSHEET_PATH,
      worksheetSha256: processed.worksheetSha256,
      amendmentPath: QUOTED_NAME_AMENDMENT_PATH,
      amendmentSha256: processed.amendmentSha256,
      corpusReviewFingerprint: processed.corpusReviewFingerprint,
    },
    activeAuthoredDescriptorCount: processed.cases.length,
    historicalAuthoredDescriptorCount: processed.caseIdMigrations.length,
    summary: processed.summary,
    families: processed.families,
    caseIdMigrations: processed.caseIdMigrations,
    cases: processed.cases.map((entry) => ({
      caseId: entry.caseId,
      ...(entry.historicalCaseId === undefined ? {} : { historicalCaseId: entry.historicalCaseId }),
      humanVerdict: entry.humanVerdict,
      ...(entry.historicalVerdict === undefined ? {} : { historicalVerdict: entry.historicalVerdict }),
      verdictSource: entry.verdictSource,
      ...(entry.historicalVerdictSource === undefined ? {} : { historicalVerdictSource: entry.historicalVerdictSource }),
      ...(entry.familyId === undefined ? {} : { familyId: entry.familyId }),
      ...(entry.historicalFamilyId === undefined ? {} : { historicalFamilyId: entry.historicalFamilyId }),
      currentProposal: entry.currentProposal,
      agreesWithProposal: entry.agreesWithProposal,
      amendmentApplied: entry.amendmentApplied,
      source: entry.source,
      claim: entry.claim,
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
  return `${"`".repeat(longest + 1)}${value}${"`".repeat(longest + 1)}`;
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
  ["hson.reject.literal.comment.block", "Decide whether block comments remain forbidden or become authored-Hson trivia."],
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
  const renamed = processed.caseIdMigrations.filter((entry) => entry.historicalCaseId !== entry.activeCaseId);
  const lines: string[] = [
    "# Authored-Hson source-membership reconciliation",
    "",
    "This amendment-aware report reconciles **human-reviewed authored-language membership**.",
    "It does not certify expected graphs, canonical output, or structured diagnostics.",
    "The completed worksheet remains immutable historical input; current syntax comes from the quoted-name amendment.",
    "",
    "## Input binding",
    "",
    `- Historical worksheet SHA-256: \`${processed.worksheetSha256}\``,
    `- Quoted-name amendment SHA-256: \`${processed.amendmentSha256}\``,
    `- Corpus review fingerprint: \`${processed.corpusReviewFingerprint}\``,
    `- Historical authored descriptors: ${processed.caseIdMigrations.length}`,
    `- Active authored descriptors: ${processed.cases.length}`,
    "",
    "## Historical-to-active ID migration",
    "",
    "All 269 historical IDs are recorded in the ledger. Unlisted IDs are identity mappings.",
    "",
    ...renamed.map((entry) => `- \`${entry.historicalCaseId}\` → \`${entry.activeCaseId}\``),
    "",
    "Amendment-only active IDs:",
    "",
    ...Object.keys(AMENDMENT_ONLY_ACTIVE_CASES).map((id) => `- \`${id}\``),
    "",
    "## Summary",
    "",
    "| Measure | Count |",
    "|---|---:|",
    `| Human/amendment valid | ${processed.summary.humanValid} |`,
    `| Human/amendment invalid | ${processed.summary.humanInvalid} |`,
    `| Human uncertain | ${processed.summary.humanUncertain} |`,
    `| Unreviewed | ${processed.summary.unreviewed} |`,
    `| Direct row verdicts | ${processed.summary.rowVerdicts} |`,
    `| Family-inherited verdicts | ${processed.summary.familyInheritedVerdicts} |`,
    `| Amendment verdicts | ${processed.summary.amendmentVerdicts} |`,
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
      `- Exact active authored source: ${sourceCode(entry.source)}`,
      `- Current proposal: ${entry.currentProposal}`,
      `- Human/amendment verdict: ${entry.humanVerdict}`,
      `- Human note: ${reportNote(entry.note)}`,
      `- Active claim: ${entry.claim}`,
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
      `- Active source: ${sourceCode(entry.source)}`,
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
    "The remaining authored-Hson decisions are separate from this delimiter migration:",
    "`.5` admission, element-closer trivia, comment syntax, and mixed-root design reservation.",
    "",
  );
  return lines.join("\n");
}

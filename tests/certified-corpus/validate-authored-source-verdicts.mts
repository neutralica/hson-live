import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AUTHORED_VERDICT_DOCUMENT,
  EXPECTED_PROVENANCE_SHA256,
  EXPECTED_SHAPE_SHA256,
  PROVENANCE_EVIDENCE,
  REVIEW_FAMILY_GROUPS,
  SHAPE_EVIDENCE,
  authoredReviewCaseIds,
  calibratedStandaloneIds,
  orderedAuthoredReviewCases,
  renderAuthoredSourceVerdictTemplate,
} from "./authored-source-verdicts.mts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const allowVerdicts = process.argv.includes("--allow-verdicts");
const document = readFileSync(AUTHORED_VERDICT_DOCUMENT, "utf8");
const expectedIds = authoredReviewCaseIds();
const bareMarkers = Array.from(document.matchAll(/^<!-- authored-case:([^>\n]+) -->$/gm));
const caseMarkers = Array.from(document.matchAll(
  /^<!-- review-meta: ([^\n]+) -->\n<!-- authored-case:([^>\n]+) -->$/gm,
));
const actualIds = caseMarkers.map((match) => match[2]);
const visibleDocument = document.replace(/^<!-- authored-case:[^>\n]+ -->$/gm, "");

assert(expectedIds.length === 269, `Expected 269 authored descriptor IDs, found ${expectedIds.length}.`);
assert(actualIds.length === 269, `Expected 269 checklist markers, found ${actualIds.length}.`);
assert(bareMarkers.length === 269, `Expected 269 exact HTML case markers, found ${bareMarkers.length}.`);
assert(new Set(actualIds).size === actualIds.length, "A checklist case marker is duplicated.");
assert([...actualIds].sort().join("\n") === expectedIds.join("\n"), "Checklist markers do not exactly match authored descriptors.");
assert(actualIds.join("\n") === bareMarkers.map((match) => match[1]).join("\n"),
  "Every case marker must have exactly one immediately preceding machine-mapping comment.");

const expectedOrder = orderedAuthoredReviewCases.map((entry) => entry.id);
assert(actualIds.join("\n") === expectedOrder.join("\n"), "Checklist conceptual ordering is not deterministic.");

for (const [index, match] of caseMarkers.entries()) {
  const id = match[2];
  const blockStart = match.index! + match[0].length;
  const blockEnd = caseMarkers[index + 1]?.index ?? document.length;
  const block = document.slice(blockStart, blockEnd);
  const fields = Array.from(block.matchAll(
    /^\*\*(Verdict — V \/ I \/ \?|Override — V \/ I \/ \?):\*\* `([VI? ])`$/gm,
  ));
  assert(fields.length === 1, `${id} must have exactly one verdict or override field.`);
  assert(block.trimStart().startsWith(fields[0][0]), `${id} must show its verdict or override before visible case content.`);
  const sourceHeadings = Array.from(block.matchAll(/^\*\*Source:\*\*(.*)$/gm));
  assert(sourceHeadings.length === 1, `${id} must have exactly one source display.`);
  const sourceIndex = sourceHeadings[0].index!;
  const claim = block.slice(fields[0].index! + fields[0][0].length, sourceIndex).trim();
  assert(claim.length > 0 && !claim.includes("<!--"), `${id} must have one visible plain-English claim.`);
  const proposalMatches = Array.from(block.matchAll(/^\*\*Current proposal:\*\* (Valid|Invalid)$/gm));
  assert(proposalMatches.length === 1, `${id} must have exactly one current proposal.`);
  assert(proposalMatches[0].index! > sourceIndex, `${id} must show its current proposal after its source.`);
  const sourceBody = block.slice(sourceIndex + sourceHeadings[0][0].length, proposalMatches[0].index).trim();
  assert(sourceHeadings[0][1].trim().length > 0 || sourceBody.length > 0, `${id} has no exact source materialization.`);
  const notesMatches = Array.from(block.matchAll(/^\*\*Notes:\*\*[^\S\r\n]*$/gm));
  assert(notesMatches.length === 1, `${id} must have exactly one blank notes field.`);
  assert(notesMatches[0].index! > proposalMatches[0].index!, `${id} must show notes after its current proposal.`);
  if (!allowVerdicts) {
    assert(fields[0][2] === " ", `Verdict or override is not initially blank for ${id}.`);
  }
  assert(!visibleDocument.includes(id), `${id} must not appear as visible case content.`);
}

const inheritanceText = [
  "**Family verdict — V / I / ?:** ` `",
  "",
  "A family verdict applies to every blank override below. An individual override wins.",
  "Blank family and override fields mean not reviewed.",
].join("\n");
assert(document.split(inheritanceText).length - 1 === REVIEW_FAMILY_GROUPS.length,
  "Family inheritance syntax is missing, duplicated, or ambiguous.");
const familyVerdicts = Array.from(document.matchAll(/^\*\*Family verdict — V \/ I \/ \?:\*\* `([VI? ])`$/gm));
assert(familyVerdicts.length === REVIEW_FAMILY_GROUPS.length, "Every family must have one shared verdict field.");
if (!allowVerdicts) {
  assert(familyVerdicts.every((match) => match[1] === " "), "A family verdict is not initially blank.");
}

for (const group of REVIEW_FAMILY_GROUPS) {
  const start = `<!-- family:start ${group.id} -->`;
  const end = `<!-- family:end ${group.id} -->`;
  assert(document.split(start).length - 1 === 1, `Missing or duplicate family start marker for ${group.id}.`);
  assert(document.split(end).length - 1 === 1, `Missing or duplicate family end marker for ${group.id}.`);
  const region = document.slice(document.indexOf(start), document.indexOf(end) + end.length);
  const regionIds = Array.from(region.matchAll(/^<!-- authored-case:([^>\n]+) -->$/gm)).map((match) => match[1]);
  assert(regionIds.join("\n") === group.entries.map((entry) => entry.id).join("\n"),
    `${group.id} family membership or ordering changed.`);
  const regionMappings = Array.from(region.matchAll(
    /^<!-- review-meta: ([^\n]+) -->\n<!-- authored-case:([^>\n]+) -->$/gm,
  ));
  for (const [index, entry] of group.entries.entries()) {
    assert(regionMappings[index]?.[2] === entry.id
      && regionMappings[index]?.[1].includes(`review=family:${group.id}`),
    `${entry.id} lacks an inherited-family mapping.`);
  }
}

for (const id of calibratedStandaloneIds()) {
  const markerIndex = caseMarkers.findIndex((match) => match[2] === id);
  assert(markerIndex >= 0 && caseMarkers[markerIndex][1].includes("review=standalone"),
    `${id} must remain outside inherited family review.`);
  const blockStart = caseMarkers[markerIndex].index! + caseMarkers[markerIndex][0].length;
  const blockEnd = caseMarkers[markerIndex + 1]?.index ?? document.length;
  const block = document.slice(blockStart, blockEnd);
  assert(block.includes("review only the rejection verdict"), `${id} lacks its diagnostic-deferral warning.`);
}

assert(document.includes("Implementation-influenced expected output; this pass reviews source validity only"),
  "The element-trivia implementation-influence warning is missing.");
assert(sha256(PROVENANCE_EVIDENCE) === EXPECTED_PROVENANCE_SHA256, "Provenance evidence hash mismatch.");
assert(sha256(SHAPE_EVIDENCE) === EXPECTED_SHAPE_SHA256, "Shape-preview evidence hash mismatch.");

if (!allowVerdicts) {
  assert(document === renderAuthoredSourceVerdictTemplate(),
    "The initial checklist is not byte-identical to deterministic template regeneration.");
}

console.log(JSON.stringify({
  authoredBlocks: actualIds.length,
  standaloneBlocks: actualIds.length - REVIEW_FAMILY_GROUPS.reduce((sum, group) => sum + group.entries.length, 0),
  familyGroups: REVIEW_FAMILY_GROUPS.length,
  inheritedBlocks: REVIEW_FAMILY_GROUPS.reduce((sum, group) => sum + group.entries.length, 0),
  calibratedStandaloneCases: calibratedStandaloneIds().length,
  verdictMode: allowVerdicts ? "human-edited-allowed" : "initially-blank",
  provenanceSha256: EXPECTED_PROVENANCE_SHA256,
  shapeSha256: EXPECTED_SHAPE_SHA256,
}));

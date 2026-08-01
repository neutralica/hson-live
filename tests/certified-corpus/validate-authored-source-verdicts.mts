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
const caseMarkers = Array.from(document.matchAll(/^<!-- authored-case:([^;]+); source:(inline|display); review:([^ ]+) -->$/gm));
const rowMatches = Array.from(document.matchAll(/^\| `([^`]+)` \| (.+) \| (Valid|Invalid) \| (.+) \|([^|]*)\|([^|]*)\|$/gm));
const actualIds = caseMarkers.map((match) => match[1]);
const rowIds = rowMatches.map((match) => match[1]);

assert(expectedIds.length === 269, `Expected 269 authored descriptor IDs, found ${expectedIds.length}.`);
assert(actualIds.length === 269, `Expected 269 checklist markers, found ${actualIds.length}.`);
assert(rowIds.length === 269, `Expected 269 checklist rows, found ${rowIds.length}.`);
assert(new Set(actualIds).size === actualIds.length, "A checklist case marker is duplicated.");
assert(new Set(rowIds).size === rowIds.length, "A checklist row is duplicated.");
assert([...actualIds].sort().join("\n") === expectedIds.join("\n"), "Checklist markers do not exactly match authored descriptors.");
assert([...rowIds].sort().join("\n") === expectedIds.join("\n"), "Checklist rows do not exactly match authored descriptors.");
assert(actualIds.join("\n") === rowIds.join("\n"), "Case markers and rows are not paired in the same order.");

const expectedOrder = orderedAuthoredReviewCases.map((entry) => entry.id);
assert(actualIds.join("\n") === expectedOrder.join("\n"), "Checklist conceptual ordering is not deterministic.");

for (const match of caseMarkers) {
  assert(match[2] === "inline" || match[2] === "display", `Missing source presentation for ${match[1]}.`);
}
for (const match of rowMatches) {
  assert(match[2].trim().length > 0, `Missing exact source/display for ${match[1]}.`);
  assert(match[3] === "Valid" || match[3] === "Invalid", `Missing current proposal for ${match[1]}.`);
  assert(match[4].trim().length > 0, `Missing plain-English claim for ${match[1]}.`);
  if (!allowVerdicts) {
    assert(match[5].trim() === "", `Human verdict is not initially blank for ${match[1]}.`);
    assert(match[6].trim() === "", `Optional note is not initially blank for ${match[1]}.`);
  }
}

const inheritanceText = [
  "Family verdict (`V/I/?`): ______",
  "",
  "Inheritance rule:",
  "If a family verdict is present, every blank row inherits it.",
  "An individual row verdict overrides the family verdict.",
  "Blank family and row verdicts mean not reviewed.",
].join("\n");
assert(document.split(inheritanceText).length - 1 === REVIEW_FAMILY_GROUPS.length,
  "Family inheritance syntax is missing, duplicated, or ambiguous.");

for (const group of REVIEW_FAMILY_GROUPS) {
  const start = `<!-- family:start ${group.id} -->`;
  const end = `<!-- family:end ${group.id} -->`;
  assert(document.split(start).length - 1 === 1, `Missing or duplicate family start marker for ${group.id}.`);
  assert(document.split(end).length - 1 === 1, `Missing or duplicate family end marker for ${group.id}.`);
  const region = document.slice(document.indexOf(start), document.indexOf(end) + end.length);
  for (const entry of group.entries) {
    assert(region.includes(`authored-case:${entry.id};`), `${entry.id} is outside its declared family region.`);
  }
}

for (const id of calibratedStandaloneIds()) {
  const marker = caseMarkers.find((match) => match[1] === id);
  assert(marker?.[3] === "standalone", `${id} must remain outside inherited family review.`);
  const row = rowMatches.find((match) => match[1] === id);
  assert(row?.[4].includes("review only the rejection verdict"), `${id} lacks its diagnostic-deferral warning.`);
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
  authoredRows: rowIds.length,
  familyGroups: REVIEW_FAMILY_GROUPS.length,
  calibratedStandaloneCases: calibratedStandaloneIds().length,
  verdictMode: allowVerdicts ? "human-edited-allowed" : "initially-blank",
  provenanceSha256: EXPECTED_PROVENANCE_SHA256,
  shapeSha256: EXPECTED_SHAPE_SHA256,
}));

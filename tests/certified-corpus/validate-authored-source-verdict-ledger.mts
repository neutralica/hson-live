import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RECONCILIATION_REPORT_PATH,
  VERDICT_LEDGER_PATH,
  processCurrentWorksheet,
  processWorksheet,
  renderLedger,
  renderReconciliation,
} from "./authored-source-verdict-processing.mts";
import { AUTHORED_VERDICT_DOCUMENT, calibratedStandaloneIds } from "./authored-source-verdicts.mts";

let checkNumber = 0;
function check(name: string, body: () => void): void {
  body();
  checkNumber += 1;
  console.log(`ok ${checkNumber} - ${name}`);
}

const worksheet = readFileSync(AUTHORED_VERDICT_DOCUMENT, "utf8");
const worksheetBefore = Buffer.from(worksheet);
const processed = processCurrentWorksheet();
const committedLedger = readFileSync(VERDICT_LEDGER_PATH, "utf8");
const committedReport = readFileSync(RECONCILIATION_REPORT_PATH, "utf8");
const ledger = JSON.parse(committedLedger) as Record<string, unknown>;

check("worksheet parser accepts only the explicit verdict grammar", () => {
  const mutated = worksheet.replace(/(\*\*Verdict — V \/ I \/ \?:\*\*\s*`)[VI? ]+`/, "$1valid`");
  assert.throws(() => processWorksheet(mutated), /Malformed verdict/);
  assert.equal(processed.cases.length, 269);
});

check("worksheet inventory contains every authored descriptor exactly once", () => {
  assert.equal(new Set(processed.cases.map((entry) => entry.caseId)).size, 269);
  assert.equal(processed.cases.length, 269);
});

check("family inheritance and row overrides reproduce worksheet semantics", () => {
  assert.equal(processed.summary.familyInheritedVerdicts, 139);
  assert.equal(processed.summary.rowOverrides, 3);
  assert(processed.cases.filter((entry) => entry.verdictSource === "family").every((entry) => entry.familyId !== undefined));
});

check("calibrated backtick cases remain standalone", () => {
  for (const id of calibratedStandaloneIds()) {
    const entry = processed.cases.find((candidate) => candidate.caseId === id)!;
    assert.equal(entry.familyId, undefined);
    assert.notEqual(entry.verdictSource, "family");
  }
});

check("reviewer notes remain associated with their case IDs", () => {
  assert.match(processed.cases.find((entry) => entry.caseId === "hson.accept.literal.primitive.false")?.note ?? "", /_hson_obj/);
  assert.match(processed.cases.find((entry) => entry.caseId === "hson.reject.literal.element.malformed-closer")?.note ?? "", /space/i);
});

check("ledger contains 269 deterministic case records", () => {
  const ledgerCases = ledger.cases as Array<Record<string, unknown>>;
  assert.equal(ledgerCases.length, 269);
  assert.deepEqual(ledgerCases.map((entry) => entry.caseId), processed.cases.map((entry) => entry.caseId));
  for (const [index, entry] of processed.cases.entries()) {
    assert.equal(ledgerCases[index].humanVerdict, entry.humanVerdict);
    assert.equal(ledgerCases[index].verdictSource, entry.verdictSource);
    assert.equal(ledgerCases[index].familyId, entry.familyId);
    assert.equal(ledgerCases[index].note, entry.note);
  }
  assert.equal(committedLedger, renderLedger(processed));
});

check("proposal agreement and disagreement counts reconcile", () => {
  assert.equal(processed.summary.proposalAgreements, 237);
  assert.equal(processed.summary.proposalDisagreements, 3);
  assert.equal(processed.summary.proposalAgreements + processed.summary.proposalDisagreements
    + processed.summary.humanUncertain + processed.summary.unreviewed, 269);
});

check("uncertain and unreviewed inventories reconcile", () => {
  assert.equal(processed.summary.humanUncertain, 7);
  assert.equal(processed.summary.unreviewed, 22);
});

check("reconciliation report is complete and deterministic", () => {
  assert.equal(committedReport, renderReconciliation(processed));
  for (const entry of processed.cases.filter((candidate) => candidate.agreesWithProposal === false
    || candidate.humanVerdict === "uncertain" || candidate.humanVerdict === "unreviewed")) {
    assert(committedReport.includes(entry.caseId));
  }
});

check("processing never overwrites the human worksheet", () => {
  assert(Buffer.from(readFileSync(AUTHORED_VERDICT_DOCUMENT)).equals(worksheetBefore));
});

console.log(`# ${checkNumber} authored-source verdict processing checks passed`);

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
import {
  AMENDMENT_ONLY_ACTIVE_CASES,
  HISTORICAL_WORKSHEET_PATH,
  HISTORICAL_WORKSHEET_SHA256,
  activeCaseIdForHistorical,
} from "./authored-name-delimiter-amendment.mts";

let checkNumber = 0;
function check(name: string, body: () => void): void {
  body();
  checkNumber += 1;
  console.log(`ok ${checkNumber} - ${name}`);
}

const worksheet = readFileSync(HISTORICAL_WORKSHEET_PATH, "utf8");
const worksheetBefore = Buffer.from(worksheet);
const processed = processCurrentWorksheet();
const committedLedger = readFileSync(VERDICT_LEDGER_PATH, "utf8");
const committedReport = readFileSync(RECONCILIATION_REPORT_PATH, "utf8");
const ledger = JSON.parse(committedLedger) as Record<string, unknown>;

check("historical worksheet remains bound to its original SHA-256", () => {
  assert.equal(processed.worksheetSha256, HISTORICAL_WORKSHEET_SHA256);
  const mutated = worksheet.replace(/(\*\*Verdict — V \/ I \/ \?:\*\*\s*`)[VI? ]+`/, "$1valid`");
  assert.throws(() => processWorksheet(mutated), /SHA-256 mismatch/);
});

check("amendment-aware inventory maps historical rows to unique active cases", () => {
  assert.equal(new Set(processed.cases.map((entry) => entry.caseId)).size, processed.cases.length);
});

check("historical and active quoted-name IDs map exactly", () => {
  for (const migration of processed.caseIdMigrations) {
    assert.equal(migration.activeCaseId, activeCaseIdForHistorical(migration.historicalCaseId));
  }
  assert(processed.caseIdMigrations.some((entry) =>
    entry.historicalCaseId.endsWith("escaped-backtick")
    && entry.activeCaseId.endsWith("escaped-apostrophe")));
});

check("amendment-only cases have explicit amendment verdicts", () => {
  for (const [id, expected] of Object.entries(AMENDMENT_ONLY_ACTIVE_CASES)) {
    const entry = processed.cases.find((candidate) => candidate.caseId === id);
    assert.equal(entry?.humanVerdict, expected);
    assert.equal(entry?.verdictSource, "amendment");
    assert.equal(entry?.historicalCaseId, undefined);
  }
});

check("family inheritance and row overrides preserve historical semantics", () => {
  assert(processed.cases.filter((entry) => entry.historicalVerdictSource === "family")
    .every((entry) => entry.historicalFamilyId !== undefined));
});

check("reviewer notes remain associated through ID migration", () => {
  assert.match(processed.cases.find((entry) => entry.caseId === "hson.accept.literal.primitive.false")?.note ?? "", /_hson_obj/);
  assert.match(processed.cases.find((entry) => entry.caseId === "hson.reject.literal.element.malformed-closer")?.note ?? "", /space/i);
});

check("ledger contains deterministic current records and full provenance mapping", () => {
  const ledgerCases = ledger.cases as Array<Record<string, unknown>>;
  const migrations = ledger.caseIdMigrations as Array<Record<string, unknown>>;
  assert.equal(ledger.schemaVersion, 2);
  assert.deepEqual(ledgerCases.map((entry) => entry.caseId), processed.cases.map((entry) => entry.caseId));
  assert.deepEqual(migrations, processed.caseIdMigrations);
  assert.equal(committedLedger, renderLedger(processed));
});

check("proposal agreement inventory reconciles exactly", () => {
  assert.equal(processed.summary.proposalAgreements + processed.summary.proposalDisagreements
    + processed.summary.humanUncertain + processed.summary.unreviewed, processed.cases.length);
});

check("current reconciliation report is deterministic and amendment-aware", () => {
  assert.equal(committedReport, renderReconciliation(processed));
  assert.match(committedReport, /Quoted-name amendment SHA-256/);
  assert.match(committedReport, /legacy-backtick-name/);
});

check("derived processing never overwrites the historical worksheet", () => {
  assert(Buffer.from(readFileSync(HISTORICAL_WORKSHEET_PATH)).equals(worksheetBefore));
});

console.log(`# ${checkNumber} authored-source verdict processing checks passed`);

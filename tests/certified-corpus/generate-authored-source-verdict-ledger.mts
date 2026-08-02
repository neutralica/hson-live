import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  RECONCILIATION_REPORT_PATH,
  VERDICT_LEDGER_PATH,
  processCurrentWorksheet,
  renderLedger,
  renderReconciliation,
} from "./authored-source-verdict-processing.mts";
import {
  HISTORICAL_WORKSHEET_PATH,
  HISTORICAL_WORKSHEET_SHA256,
} from "./authored-name-delimiter-amendment.mts";
import { createHash } from "node:crypto";

const applyAmendment = process.argv.includes("--apply-amendment");
const outputIndex = process.argv.indexOf("--output-dir");
const outputDirectory = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
if (applyAmendment === (outputDirectory !== undefined)) {
  throw new Error("Use exactly one of --apply-amendment or --output-dir <temporary-directory>.");
}

const worksheetBefore = readFileSync(HISTORICAL_WORKSHEET_PATH);
const worksheetHash = createHash("sha256").update(worksheetBefore).digest("hex");
if (worksheetHash !== HISTORICAL_WORKSHEET_SHA256) {
  throw new Error(`Historical worksheet SHA-256 mismatch: ${worksheetHash}`);
}
const processed = processCurrentWorksheet();
const ledger = renderLedger(processed);
const report = renderReconciliation(processed);
let ledgerPath: string;
let reportPath: string;

if (applyAmendment) {
  ledgerPath = resolve(VERDICT_LEDGER_PATH);
  reportPath = resolve(RECONCILIATION_REPORT_PATH);
  if (!existsSync(ledgerPath) || !existsSync(reportPath)) {
    throw new Error("Amendment migration requires both existing derived artifacts.");
  }
} else {
  const directory = resolve(outputDirectory!);
  const roots = [resolve("/tmp"), resolve("/private/tmp"), resolve(tmpdir())];
  if (!roots.some((root) => directory === root || directory.startsWith(root + "/"))) {
    throw new Error("Deterministic comparison output is restricted to a temporary directory.");
  }
  ledgerPath = resolve(directory, "02-authored-source-verdict-ledger.json");
  reportPath = resolve(directory, "03-authored-source-reconciliation.md");
}

mkdirSync(dirname(ledgerPath), { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(ledgerPath, ledger, "utf8");
writeFileSync(reportPath, report, "utf8");
const worksheetAfter = readFileSync(HISTORICAL_WORKSHEET_PATH);
if (!worksheetBefore.equals(worksheetAfter)) throw new Error("Worksheet changed during artifact generation.");
console.log(JSON.stringify({ ledgerPath, reportPath, worksheetSha256: processed.worksheetSha256 }));

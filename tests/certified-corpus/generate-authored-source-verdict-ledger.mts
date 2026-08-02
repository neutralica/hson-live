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
import { AUTHORED_VERDICT_DOCUMENT } from "./authored-source-verdicts.mts";

const initialize = process.argv.includes("--initialize");
const outputIndex = process.argv.indexOf("--output-dir");
const outputDirectory = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
if (initialize === (outputDirectory !== undefined)) {
  throw new Error("Use exactly one of --initialize or --output-dir <temporary-directory>.");
}

const worksheetBefore = readFileSync(AUTHORED_VERDICT_DOCUMENT);
const processed = processCurrentWorksheet();
const ledger = renderLedger(processed);
const report = renderReconciliation(processed);
let ledgerPath: string;
let reportPath: string;

if (initialize) {
  ledgerPath = resolve(VERDICT_LEDGER_PATH);
  reportPath = resolve(RECONCILIATION_REPORT_PATH);
  if (existsSync(ledgerPath) || existsSync(reportPath)) {
    throw new Error("Refusing to overwrite an existing verdict ledger or reconciliation report.");
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
const worksheetAfter = readFileSync(AUTHORED_VERDICT_DOCUMENT);
if (!worksheetBefore.equals(worksheetAfter)) throw new Error("Worksheet changed during artifact generation.");
console.log(JSON.stringify({ ledgerPath, reportPath, worksheetSha256: processed.worksheetSha256 }));

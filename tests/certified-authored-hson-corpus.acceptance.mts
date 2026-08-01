// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import {
  corpusAssertionCounts,
  corpusCounts,
  materializedCorpusCases,
} from "./certified-corpus/corpus-manifest.mts";
import {
  runAcceptedCorpusCases,
  runRejectedCorpusCases,
} from "./certified-corpus/corpus-runner.mts";
import { runCorpusIntegrityChecks } from "./certified-corpus/corpus-integrity.mts";

const LAUNCHER = "transform.certified-authored-hson-corpus";
let checks = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

await check("materialized descriptor summary is derived from the source of truth", () => {
  assert.equal(corpusCounts.totalConcreteDescriptors, materializedCorpusCases.length);
  assert.ok(corpusCounts.totalConcreteDescriptors > 295);
});

await check("all accepted corpus cases satisfy their exact authored expectations", () => {
  const result = runAcceptedCorpusCases();
  assert.equal(result.acceptedAssertions, corpusAssertionCounts.acceptedAssertions);
});

await check("all rejected corpus cases satisfy exact repeated structured evidence", () => {
  const result = runRejectedCorpusCases();
  assert.equal(result.rejectedAssertions, corpusAssertionCounts.rejectedAssertions);
});

await check("integrity rules and the committed review artifact are deterministic", async () => {
  assert.equal(await runCorpusIntegrityChecks(), corpusAssertionCounts.integrityAssertions);
});

process.stdout.write(`# ${checks} certified authored-HSON corpus checks passed\n`);
process.stdout.write(`# descriptors ${JSON.stringify(corpusCounts)}\n`);
process.stdout.write(`# assertions ${JSON.stringify(corpusAssertionCounts)}\n`);
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);

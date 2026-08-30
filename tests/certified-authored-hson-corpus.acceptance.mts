// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import {
  corpusCounts,
  materializedCorpusCases,
} from "./certified-corpus/corpus-manifest.mts";
import {
  runAcceptedCorpusCases,
  runCorpusSubset,
  runRejectedCorpusCases,
} from "./certified-corpus/corpus-runner.mts";
import { authoredCompletenessBasisCases } from "./certified-corpus/authored-completeness-basis.mts";
import { runCorpusIntegrityChecks } from "./certified-corpus/corpus-integrity.mts";

const LAUNCHER = "transform.certified-authored-hson-corpus";
let checks = 0;
let acceptedAssertions = 0;
let rejectedAssertions = 0;
let integrityAssertions = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function basisCases(...ids: readonly string[]) {
  return ids.map((id) => {
    const entry = authoredCompletenessBasisCases.find((candidate) => candidate.id === id);
    assert.ok(entry, id + ": completeness-basis descriptor exists");
    return entry;
  });
}

function runBasis(...ids: readonly string[]): void {
  const result = runCorpusSubset(basisCases(...ids));
  assert.equal(result.acceptedCases + result.rejectedCases, ids.length);
  assert.ok(result.acceptedAssertions + result.rejectedAssertions > 0);
}

await check("number basis admits a negative integer", () => runBasis("hson.accept.basis.number.negative-integer"));
await check("number basis admits a positive fraction", () => runBasis("hson.accept.basis.number.positive-fraction"));
await check("number basis admits uppercase and explicitly signed exponents", () => runBasis(
  "hson.accept.basis.number.uppercase-exponent",
  "hson.accept.basis.number.positive-exponent-sign",
  "hson.accept.basis.number.negative-exponent-sign",
));
await check("number basis rejects a leading zero", () => runBasis("hson.reject.basis.number.leading-zero"));
await check("number basis rejects a leading plus", () => runBasis("hson.reject.basis.number.leading-plus"));
await check("number basis rejects a missing integer before a fraction", () => runBasis("hson.reject.basis.number.missing-integer-before-fraction"));
await check("number basis rejects missing fraction digits", () => runBasis("hson.reject.basis.number.missing-fraction-digits"));
await check("number basis rejects missing exponent digits", () => runBasis("hson.reject.basis.number.missing-exponent-digits"));
await check("number basis rejects missing signed exponent digits", () => runBasis("hson.reject.basis.number.missing-signed-exponent-digits"));
await check("number basis rejects named NaN", () => runBasis("hson.reject.basis.number.named-nan"));
await check("number basis rejects named positive Infinity", () => runBasis("hson.reject.basis.number.named-positive-infinity"));
await check("number basis rejects named negative Infinity", () => runBasis("hson.reject.basis.number.named-negative-infinity"));
await check("number basis rejects hexadecimal spelling", () => runBasis("hson.reject.basis.number.hexadecimal"));
await check("number basis rejects numeric separators", () => runBasis("hson.reject.basis.number.numeric-separator"));
await check("number basis rejects nonfinite overflow", () => runBasis("hson.reject.basis.number.nonfinite-overflow"));
await check("object trivia basis covers scanner-significant slots", () => runBasis("hson.accept.basis.trivia.object-slots"));
await check("array trivia basis covers scanner-significant slots", () => runBasis("hson.accept.basis.trivia.array-slots"));
await check("element trivia basis covers scanner-significant slots", () => runBasis("hson.accept.basis.trivia.element-slots"));
await check("source trivia basis accepts a comment through EOF", () => runBasis("hson.accept.basis.trivia.comment-to-eof"));
await check("object-to-element structural crossing rejects", () => runBasis("hson.reject.basis.mode.object-element"));
await check("homogeneous root element sequences retain sibling order", () => runBasis("hson.accept.basis.root.element-sequence"));
await check("primitive-looking object property keys stay contextual names", () => runBasis("hson.accept.basis.object.primitive-looking-keys"));
await check("nonempty quoted element names admit", () => runBasis("hson.accept.basis.quoted-name.element-name"));
await check("nonempty quoted attribute names reject", () => runBasis("hson.reject.basis.quoted-name.attribute-name"));
await check("nonempty quoted flag names reject", () => runBasis("hson.reject.basis.quoted-name.flag-name"));

await check("materialized descriptor summary is derived from the source of truth", () => {
  assert.equal(corpusCounts.totalConcreteDescriptors, materializedCorpusCases.length);
});

await check("all accepted corpus cases satisfy their exact authored expectations", () => {
  const result = runAcceptedCorpusCases();
  acceptedAssertions = result.acceptedAssertions;
});

await check("all rejected corpus cases satisfy exact repeated structured evidence", () => {
  const result = runRejectedCorpusCases();
  rejectedAssertions = result.rejectedAssertions;
});

await check("integrity rules and the committed review artifact are deterministic", async () => {
  integrityAssertions = await runCorpusIntegrityChecks();
});

process.stdout.write(`# ${checks} certified authored-Hson corpus checks passed\n`);
process.stdout.write(`# descriptors ${JSON.stringify(corpusCounts)}\n`);
process.stdout.write(`# observed assertions ${JSON.stringify({ acceptedAssertions, rejectedAssertions, integrityAssertions, totalAssertions: acceptedAssertions + rejectedAssertions + integrityAssertions })}\n`);
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);

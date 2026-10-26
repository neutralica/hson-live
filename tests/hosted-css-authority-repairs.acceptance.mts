import { hosted_css_subject_revocation_race_cases, hosted_css_subject_durability_cases, hosted_css_dispatched_subject_cases, hosted_css_subject_rejection_cases, hosted_css_subject_ordering_cases, hosted_css_scoped_subject_cases } from "./fixtures/hosted-css-subject-correspondence-cases.mts";
import assert from "node:assert/strict";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { hosted_css_queue_revocation_cases } from "./fixtures/hosted-css-queue-revocation-cases.mts";
import { hosted_css_subject_boundary_cases } from "./fixtures/hosted-css-subject-boundary-cases.mts";
import { hosted_css_missing_correspondence_cases, hosted_css_execution_authorization_cases, hosted_css_subject_count_cases } from "./fixtures/hosted-css-admission-gaps-cases.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "css.hosted-authority-repairs", title: "Hosted CSS queue repair and subject boundary",
  category: "Locus", runtime: "node", tags: Object.freeze(["css", "hosted", "worker", "revocation", "correspondence"]) });

await hosted_css_subject_boundary_cases();
await hosted_css_missing_correspondence_cases();
await hosted_css_execution_authorization_cases();
await hosted_css_subject_count_cases();
await hosted_css_subject_rejection_cases();
await hosted_css_dispatched_subject_cases();
await hosted_css_subject_ordering_cases();
await hosted_css_subject_revocation_race_cases();
await hosted_css_scoped_subject_cases();
await hosted_css_subject_durability_cases();
await hosted_css_queue_revocation_cases();
const worker = repository_typescript_worker(new URL("./fixtures/hosted-css-authority-repairs.worker.mts", import.meta.url));
try {
  assert.equal(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), "pass");
} finally { await worker.terminate(); }
console.log("Hosted CSS subject correspondence and queue revocation passed in Node and Worker.");

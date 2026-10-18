import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { document_capability_parity_cases, document_css_parity_cases, document_read_authority_cases, document_echo_submission_cases, document_shape_cases, document_schema_atomicity_cases, document_identity_authority_cases, document_scoped_guard_cases } from "./fixtures/document-capability-parity-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "document-capability-parity", title: "Governed document capability parity", category: "LiveMap", runtime: "node",
  tags: Object.freeze(["public-api", "document", "attributes", "css", "worker", "authority"]),
});
for (const exact of ["false", "true"]) execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
  "--noEmit", "--strict", "--noUncheckedIndexedAccess", "--target", "ESNext", "--module", "NodeNext", "--exactOptionalPropertyTypes", exact,
  fileURLToPath(new URL("./document-capability-parity.types.ts", import.meta.url))], { stdio: "inherit" });
await document_capability_parity_cases();
await document_css_parity_cases();
await document_read_authority_cases();
await document_echo_submission_cases();
await document_shape_cases();
await document_schema_atomicity_cases();
await document_identity_authority_cases();
await document_scoped_guard_cases();
const worker = repository_typescript_worker(new URL("./fixtures/document-capability-parity.worker.mts", import.meta.url));
try {
  assert.equal(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), "pass");
} finally { await worker.terminate(); }
console.log("Document capability parity passed in Node and Worker.");

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { library_capability_cases, collection_capability_cases, collection_command_parity_cases, refinement_repair_cases } from "./fixtures/library-capability-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "library-capability", title: "Public Library and collection capabilities", category: "LiveMap", runtime: "node",
  tags: Object.freeze(["public-api", "libraries", "collections", "worker", "authority"]),
});
for (const exact of ["false", "true"]) {
  execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
    "--noEmit", "--strict", "--noUncheckedIndexedAccess", "--target", "ESNext", "--module", "NodeNext",
    "--exactOptionalPropertyTypes", exact,
    fileURLToPath(new URL("./library-admission.types.ts", import.meta.url)),
    fileURLToPath(new URL("./library-collections.types.ts", import.meta.url))], { stdio: "inherit" });
}
await library_capability_cases();
await collection_capability_cases();
await collection_command_parity_cases();
await refinement_repair_cases();
const worker = repository_typescript_worker(new URL("./fixtures/library-capability.worker.mts", import.meta.url));
try {
  assert.equal(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), "pass");
} finally { await worker.terminate(); }
console.log("Public Library capabilities passed in Node and Worker.");

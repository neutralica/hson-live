import assert from "node:assert/strict";
import { hosted_h3b_cases } from "./fixtures/hosted-continuation-h3b-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "continuation.hosted-h3b", title: "Hosted exact continuation and startup rollback",
  category: "Echo", runtime: "node", tags: Object.freeze(["scope", "worker", "continuation", "rollback"]) });
let count = 0;
await hosted_h3b_cases(async (name, run) => { await run(); count++; console.log(`PASS ${name}`); });
const worker = repository_typescript_worker(new URL("./fixtures/hosted-continuation-h3b.worker.mts", import.meta.url));
try {
  const workerCount = await new Promise<number>((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  });
  assert.equal(workerCount, count);
} finally { await worker.terminate(); }
console.log(`Hosted H3B: ${count} Node and ${count} actual Worker cases passed.`);

import assert from "node:assert/strict";
import { document_ssr_subject_cases } from "./fixtures/document-ssr-subjects-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "ssr.portable-subjects", title: "Portable subject SSR realization", category: "LiveMap", runtime: "node", tags: Object.freeze(["ssr", "quad", "css", "worker", "identity"]) });
let passed = 0;
document_ssr_subject_cases((name, run) => { run(); passed++; console.log(`PASS ${name}`); });
const result = await new Promise<{ passed: number; hasDocument: boolean }>((resolve,reject) => {
  const worker = repository_typescript_worker(new URL("./fixtures/document-ssr-subjects.worker.mts",import.meta.url));
  worker.once("message",resolve); worker.once("error",reject);
  worker.once("exit",code => { if (code !== 0) reject(Error(`Worker exited ${code}`)); });
});
assert.equal(result.passed,passed); assert.equal(result.hasDocument,false);
console.log(`SSR portable subjects: ${passed} Node and ${result.passed} actual Worker cases passed.`);

import { parentPort } from "node:worker_threads";
import { document_ssr_subject_cases } from "./document-ssr-subjects-cases.mts";
let passed = 0;
document_ssr_subject_cases((_name, run) => { run(); passed++; });
parentPort?.postMessage({ passed, hasDocument: "document" in globalThis });

import { parentPort } from "node:worker_threads";
import { document_ssr_subject_cases } from "./document-ssr-subjects-cases.mts";
import { hosted_styled_part_ssr_cases } from "./hosted-styled-part-ssr-cases.mts";
let passed = 0;
document_ssr_subject_cases((_name, run) => { run(); passed++; });
await hosted_styled_part_ssr_cases(async (_name, run) => { await run(); passed++; });
parentPort?.postMessage({ passed, hasDocument: "document" in globalThis });

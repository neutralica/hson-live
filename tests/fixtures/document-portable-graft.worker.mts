import { parentPort } from "node:worker_threads";
import { document_portable_graft_cases } from "./document-portable-graft-cases.mts";
let passed = 0;
document_portable_graft_cases((_name, run) => { run(); passed++; });
parentPort?.postMessage({ passed, hasDocument: "document" in globalThis });

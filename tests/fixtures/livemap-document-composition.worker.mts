import { isMainThread, parentPort } from "node:worker_threads";
import { document_composition_cases } from "./livemap-document-composition-cases.mts";

let cases = 0;
document_composition_cases((_name, run) => { run(); cases++; });
parentPort?.postMessage({ cases, worker: !isMainThread, hasDocument: typeof document !== "undefined" });

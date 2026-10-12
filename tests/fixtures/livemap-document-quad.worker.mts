import { parentPort } from "node:worker_threads";
import { document_quad_cases } from "./livemap-document-quad-cases.mts";
let cases = 0;
document_quad_cases((_name, run) => { run(); cases++; });
parentPort?.postMessage({ cases });

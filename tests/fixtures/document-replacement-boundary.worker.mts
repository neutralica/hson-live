import { parentPort } from "node:worker_threads";
import { document_replacement_boundary_cases } from "./document-replacement-boundary-cases.mts";
let cases = 0;
document_replacement_boundary_cases((_name, run) => { run(); cases++; });
parentPort!.postMessage({ cases });

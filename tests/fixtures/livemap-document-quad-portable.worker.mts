import { parentPort } from "node:worker_threads";
import { portable_quad_cases } from "./livemap-document-quad-portable-cases.mts";
let cases = 0;
await portable_quad_cases(async (_name, run) => { await run(); cases++; });
parentPort?.postMessage({ cases });

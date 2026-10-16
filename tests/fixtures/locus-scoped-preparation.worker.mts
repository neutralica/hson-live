import { parentPort } from "node:worker_threads";
import { locus_scoped_cases } from "./locus-scoped-preparation-cases.mts";
let count = 0;
await locus_scoped_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

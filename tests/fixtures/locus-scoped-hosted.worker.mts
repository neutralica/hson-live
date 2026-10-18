import { parentPort } from "node:worker_threads";
import { hosted_scoped_cases, hosted_scoped_rejection_cases } from "./locus-scoped-hosted-cases.mts";
import { hosted_mixed_cases } from "./locus-scoped-hosted-mixed-cases.mts";
let count = 0;
await hosted_scoped_cases(async (_name, run) => { await run(); count++; });
await hosted_scoped_rejection_cases(async (_name, run) => { await run(); count++; });
await hosted_mixed_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

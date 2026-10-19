import { parentPort } from "node:worker_threads";
import { hosted_h3b_cases } from "./hosted-continuation-h3b-cases.mts";
let count = 0;
await hosted_h3b_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

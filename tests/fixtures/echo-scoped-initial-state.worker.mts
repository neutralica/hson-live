import { parentPort } from "node:worker_threads";
import { scoped_initial_cases } from "./echo-scoped-initial-state-cases.mts";
let count = 0;
await scoped_initial_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

import { parentPort } from "node:worker_threads";
import { scoped_reconciliation_cases } from "./echo-scoped-reconciliation-cases.mts";
let count = 0;
await scoped_reconciliation_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

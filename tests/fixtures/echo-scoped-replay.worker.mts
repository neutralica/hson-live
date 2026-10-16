import { parentPort } from "node:worker_threads";
import { echo_scoped_cases } from "./echo-scoped-replay-cases.mts";
let count = 0;
await echo_scoped_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

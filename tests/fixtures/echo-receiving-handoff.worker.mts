import { parentPort } from "node:worker_threads";
import { receiving_handoff_cases } from "./echo-receiving-handoff-cases.mts";
let count = 0;
await receiving_handoff_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

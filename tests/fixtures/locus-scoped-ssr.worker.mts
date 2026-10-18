import { parentPort } from "node:worker_threads";
import { scoped_ssr_cases } from "./locus-scoped-ssr-cases.mts";
let count = 0;
await scoped_ssr_cases(async (_name, run) => { await run(); count++; });
parentPort!.postMessage(count);

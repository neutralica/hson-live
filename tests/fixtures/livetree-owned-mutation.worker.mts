import { parentPort } from "node:worker_threads";
import { owned_mutation_cases } from "./livetree-owned-mutation-cases.mts";
let cases = 0; owned_mutation_cases((_name, run) => { run(); cases++; });
parentPort?.postMessage({ cases });

import { parentPort } from "node:worker_threads";
import { managed_stylesheet_cases } from "./managed-stylesheet-cases.mts";
let cases = 0;
managed_stylesheet_cases((_name, run) => { run(); cases++; });
parentPort?.postMessage({ cases });

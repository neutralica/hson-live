import { parentPort } from "node:worker_threads";
import { inline_style_cases } from "./inline-style-cases.mts";
let cases = 0;
inline_style_cases((_name, run) => { run();cases++; });
parentPort?.postMessage({ cases });

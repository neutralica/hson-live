import { parentPort } from "node:worker_threads";
import { local_initializer_css_cases } from "./local-initializer-css-cases.mts";
let cases = 0;
local_initializer_css_cases((_name, run) => { run(); cases++; });
parentPort?.postMessage({ cases });

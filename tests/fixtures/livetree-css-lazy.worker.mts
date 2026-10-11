import { parentPort } from "node:worker_threads";
import { lazy_css_cases } from "./livetree-css-lazy-cases.mts";
let cases = 0;
lazy_css_cases((_name, run) => { run(); cases++; });
// Exercise real local and hosted continuation authority in an actual Worker.
await import("../document-continuation.acceptance.mts");
await import("../hosted-document-continuation.acceptance.mts");
parentPort?.postMessage({ cases });

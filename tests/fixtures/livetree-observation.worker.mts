import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { observation_cases } from "./livetree-observation-cases.mts";
assert.equal(typeof document, "undefined");
let cases = 0;
observation_cases((_name, run) => { run(); cases++; });
parentPort?.postMessage({ observationWorker: "pass", cases });

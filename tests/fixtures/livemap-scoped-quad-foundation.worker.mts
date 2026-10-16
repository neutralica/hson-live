import assert from "node:assert/strict";
import { isMainThread, parentPort } from "node:worker_threads";
import { scoped_quad_foundation_cases } from "./livemap-scoped-quad-foundation-cases.mts";
assert.equal(isMainThread, false);
assert.equal(typeof document, "undefined");
let cases = 0;
scoped_quad_foundation_cases((_name, run) => { run(); cases++; });
parentPort!.postMessage({ cases });

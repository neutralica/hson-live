import assert from "node:assert/strict";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { scoped_effect_cases, scoped_effect_fixture, scoped_effect_receive } from "./livemap-scoped-effects-cases.mts";
assert.equal(isMainThread, false); assert.equal(typeof document, "undefined");
let cases = 0;
scoped_effect_cases((_name, run) => { run(); cases++; });
parentPort!.postMessage({ cases, final: scoped_effect_receive(workerData), outgoing: scoped_effect_fixture() });

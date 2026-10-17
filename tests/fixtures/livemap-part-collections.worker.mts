import { public_parts_cases } from "./public-parts-cases.mts";
import { parentPort, isMainThread } from "node:worker_threads";
import { part_collection_cases } from "./livemap-part-collections-cases.mts";
if (isMainThread || parentPort === null) throw Error("Part collection acceptance requires an actual Worker.");
let cases = 0;
await public_parts_cases(async (_name, run) => { await run(); cases++; });
await part_collection_cases(async (_name, run) => { await run(); cases++; });
parentPort.postMessage({ cases, isMainThread, hasDocument: typeof document !== "undefined" });

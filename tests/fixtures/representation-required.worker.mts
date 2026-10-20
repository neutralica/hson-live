import { parentPort, isMainThread } from "node:worker_threads";
import { representation_required_cases } from "./representation-required-cases.mts";
import { representation_markup_cases } from "./representation-markup-cases.mts";
await representation_required_cases();
parentPort!.postMessage({ isMainThread, hasDocument: "document" in globalThis, markupCases: representation_markup_cases() });

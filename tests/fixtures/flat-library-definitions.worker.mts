import { parentPort } from "node:worker_threads";
import { flat_library_definition_cases } from "./flat-library-definitions-cases.mts";
await flat_library_definition_cases();

parentPort!.postMessage("pass");

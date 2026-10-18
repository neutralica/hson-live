import { parentPort } from "node:worker_threads";
import { library_capability_cases, collection_capability_cases, collection_command_parity_cases, refinement_repair_cases } from "./library-capability-cases.mts";
await library_capability_cases();
await collection_capability_cases();
await collection_command_parity_cases();
await refinement_repair_cases();
parentPort!.postMessage("pass");

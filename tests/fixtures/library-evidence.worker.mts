import { parentPort } from "node:worker_threads";
import { library_evidence_cases, echo_refinement_cases } from "./library-evidence-cases.mts";
await library_evidence_cases();
await echo_refinement_cases();
parentPort!.postMessage("pass");

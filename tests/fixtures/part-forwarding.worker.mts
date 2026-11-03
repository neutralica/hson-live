import { parentPort } from "node:worker_threads";
import { run_forwarding_editor_cases } from "./part-forwarding-cases.mts";

run_forwarding_editor_cases();
parentPort?.postMessage("passed");

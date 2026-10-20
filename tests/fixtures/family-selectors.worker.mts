import { parentPort } from "node:worker_threads";
import { family_selector_cases, family_selector_echo_cases } from "./family-selectors-cases.mts";
await family_selector_cases();
await family_selector_echo_cases();
parentPort!.postMessage("pass");

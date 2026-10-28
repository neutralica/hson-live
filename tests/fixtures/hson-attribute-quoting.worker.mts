import { parentPort } from "node:worker_threads";
import { run_attribute_quoting_cases } from "./hson-attribute-quoting-cases.mts";

parentPort!.postMessage(run_attribute_quoting_cases());

import { parentPort } from "node:worker_threads";
import { run_schema_diagnostic_cases } from "./schema-diagnostics.fixture.mts";

run_schema_diagnostic_cases();
parentPort?.postMessage("passed");

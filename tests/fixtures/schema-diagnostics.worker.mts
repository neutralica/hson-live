import { parentPort } from "node:worker_threads";
import { check_reference_transport, run_schema_diagnostic_cases } from "./schema-diagnostics.fixture.mts";

run_schema_diagnostic_cases();
parentPort?.postMessage(check_reference_transport());

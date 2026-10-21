import { parentPort, isMainThread } from "node:worker_threads";
import { parts_member_cases, parts_member_echo_cases } from "./parts-members-cases.mts";
import { parts_write_cases } from "./parts-write-cases.mts";
await parts_member_cases();
await parts_member_echo_cases();
await parts_write_cases();
parentPort!.postMessage({ passed: true, isMainThread, hasDocument: typeof document !== "undefined" });

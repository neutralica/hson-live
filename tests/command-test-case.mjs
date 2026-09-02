import { spawnSync } from "node:child_process";
import { create_test_event_emitter } from "./test-events.mjs";

/** Runs one indivisible command-backed semantic case without obscuring its process result. */
export function run_command_test_case({ suiteId, caseId, title, cwd, commands }) {
  const testEvents = create_test_event_emitter(suiteId);
  testEvents.case_begin(caseId, title);
  try {
    for (const { command, args } of commands) {
      const child = spawnSync(command, args, { cwd, stdio: "inherit" });
      if (child.error !== undefined) throw child.error;
      if (child.status !== 0) {
        const outcome = child.signal === null ? `exit ${child.status}` : `signal ${child.signal}`;
        throw new Error(`${command} ${args.join(" ")} failed with ${outcome}.`);
      }
    }
    testEvents.case_end(caseId, "pass");
    testEvents.terminal("pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command check failed.";
    testEvents.diagnostic(caseId, "command", message.slice(0, 1_000));
    testEvents.case_end(caseId, "fail");
    testEvents.terminal("fail");
    throw error;
  }
}

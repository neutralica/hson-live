import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { HSON_TEST_EVENT_PREFIX, create_test_event_emitter } from "./test-events.mjs";

const writes = [];
const originalWrite = process.stdout.write;
process.stdout.write = (value) => { writes.push(String(value)); return true; };
try {
  const events = create_test_event_emitter("fixture.events");
  events.case_begin("first", "First case");
  events.diagnostic("first", "assertion", "useful failure detail");
  events.case_end("first", "fail");
  events.terminal("fail");
  assert.throws(() => events.terminal("fail"), /only be emitted once/);
  assert.throws(() => create_test_event_emitter("x").case_begin("", "no"), /caseId/);
  const duplicate = create_test_event_emitter("duplicates");
  duplicate.case_begin("same", "Same");
  assert.throws(() => duplicate.case_begin("same", "Same"), /Duplicate/);
} finally {
  process.stdout.write = originalWrite;
}

const records = writes.map((line) => {
  assert.equal(line.startsWith(HSON_TEST_EVENT_PREFIX), true);
  const record = JSON.parse(line.slice(HSON_TEST_EVENT_PREFIX.length));
  assert.equal("version" in record, false);
  assert.equal("observedChecks" in record, false);
  assert.equal("expectedChecks" in record, false);
  return record;
});
const allowedKinds = new Set(["case_begin", "diagnostic", "case_end", "terminal"]);
assert.equal(records.every((record) => allowedKinds.has(record.t)), true);
assert.deepEqual(records.slice(0, 4).map((record) => record.t), ["case_begin", "diagnostic", "case_end", "terminal"]);
assert.deepEqual(records.slice(0, 4).map((record) => record.caseId).filter(Boolean), ["first", "first", "first"]);
const terminalRecords = records.filter((record) => record.t === "terminal");
assert.equal(terminalRecords.length, 1);
assert.equal(terminalRecords[0].status, "fail");
assert.equal("count" in terminalRecords[0], false);

const errorWrites = [];
process.stdout.write = (value) => { errorWrites.push(String(value)); return true; };
try {
  const events = create_test_event_emitter("fixture.infrastructure-error");
  events.case_begin("startup", "Startup");
  events.diagnostic("startup", "infrastructure", "runtime unavailable");
  events.case_end("startup", "error");
  events.terminal("error");
} finally {
  process.stdout.write = originalWrite;
}
const errorRecords = errorWrites.map((line) => JSON.parse(line.slice(HSON_TEST_EVENT_PREFIX.length)));
assert.deepEqual(
  errorRecords.map((record) => [record.t, record.status].filter((value) => value !== undefined)),
  [["case_begin"], ["diagnostic"], ["case_end", "error"], ["terminal", "error"]],
);

const failingCommandSource = [
  `import { run_command_test_case } from ${JSON.stringify(new URL("./command-test-case.mjs", import.meta.url).href)};`,
  "run_command_test_case({",
  '  suiteId: "fixture.command-failure",',
  '  caseId: "underlying command failure",',
  '  title: "underlying command failure",',
  "  cwd: process.cwd(),",
  '  commands: [{ command: process.execPath, args: ["--eval", "process.exit(7)"] }],',
  "});",
].join("\n");
const failingCommand = spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", failingCommandSource],
  { encoding: "utf8" },
);
assert.notEqual(failingCommand.status, 0, "a failed wrapped command must keep non-success process behavior");
const failingRecords = failingCommand.stdout
  .split("\n")
  .filter((line) => line.startsWith(HSON_TEST_EVENT_PREFIX))
  .map((line) => JSON.parse(line.slice(HSON_TEST_EVENT_PREFIX.length)));
assert.deepEqual(
  failingRecords.map((record) => [record.t, record.status].filter((value) => value !== undefined)),
  [["case_begin"], ["diagnostic"], ["case_end", "fail"], ["terminal", "fail"]],
);
assert.equal(failingRecords.every((record) => !("count" in record) && !("version" in record)), true);
console.log("test event emitter acceptance passed");

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as configuration from "../scripts/validation-config.mjs";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInventory, assertInventory, repositoryRoot } from "../scripts/validation-inventory.mjs";
import { runStages } from "../scripts/validation-execution.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "validation.accounting", title: "Validation reachability and process accounting", category: "Tooling",
  runtime: "node", tags: Object.freeze(["inventory", "failure-propagation", "timing"]),
});

const root = repositoryRoot;
const inventory = assertInventory(createInventory());
assert.equal(inventory.commands["test:hson-array-index"].caseReporting, true);
for (const name of ["build", "check:tests", "check:tooling", "hson-schema:check", "test:validation-accounting"]) {
  assert.equal(inventory.commands[name].caseReporting, false, name);
}
for (const stem of ["html-source-producer", "livemap-root-mutation", "transform-prototype-boundaries", "transform-snapshot"]) {
  assert(inventory.gates.full.includes(`test:${stem}`));
  assert(!inventory.gates.check.includes(`test:${stem}`));
}
for (const name of ["test:livetree-attribute-atomicity", "test:livetree-form-properties", "test:livetree-dataset-batch",
  "test:livemap-data-ownership", "test:livemap-commit-publication-ownership"]) assert(inventory.gates.check.includes(name));
assert(inventory.gates.extended.includes("test:scout-browser"));
const checkpoint = inventory.suites.find(suite => suite.identity === "tests/locus-scoped-checkpoint.acceptance.mts");
assert(checkpoint.destinations.some(route => route.registration === "test:locus-checkpoint-z3b" && route.invocation === "indirect"));
assert(inventory.commands["test:locus-scoped-ssr"].requirements.includes("tls"));
assert(inventory.commands["test:locus-scoped-ssr"].requirements.includes("worker"));
assert(inventory.commands["test:livetree-form-properties"].requirements.includes("chrome"));
assert(inventory.commands["editors/vscode-hson:test:integration"].requirements.includes("vscode"));
const legibilityCommand = "editors/vscode-hson:test:legibility:integration";
const legibilityEntry = "editors/vscode-hson/tests/integration/legibility.ts";
assert.deepEqual(inventory.commands[legibilityCommand].requirements, ["node", "subprocess", "vscode"]);
assert(inventory.commands[legibilityCommand].requirementEvidence.vscode.includes(legibilityEntry));
const legibilityEdge = inventory.relationships.find(edge => edge.from === "editors/vscode-hson/tests/integration/run-legibility.mjs"
  && edge.to === legibilityEntry && edge.kind === "editor-runner");
assert.equal(legibilityEdge.execution, true);
assert.equal(legibilityEdge.verification, "reviewed-source-pinned");
for (const [name, entry] of [["test:legibility:integration", legibilityEntry],
  ["test:integration", "editors/vscode-hson/tests/integration/suite.ts"],
  ["test:integration:consumer", "editors/vscode-hson/tests/integration/suite.ts"],
  ["test:baseline:integration", "editors/vscode-hson/tests/integration/baseline.ts"],
  ["test:baseline:installed", "editors/vscode-hson/tests/integration/baseline.ts"]]) {
  const registration = `editors/vscode-hson:${name}`;
  assert(inventory.commands[registration].requirements.includes("vscode"));
  const destination = inventory.suites.find(suite => suite.identity === entry).destinations.find(route => route.registration === registration);
  assert.equal(destination.destination, "editor");
  assert.equal(destination.invocation, "indirect");
  assert.equal(destination.context, "vscode");
}
for (const name of ["test:validation-accounting", "test:transform-snapshot", "editors/vscode-hson:test:unit",
  "editors/vscode-hson:test:local-host-process"]) assert(!inventory.commands[name].requirements.includes("vscode"), name);
for (const name of ["test:locus-checkpoint-z3b", "test:locus-scoped-checkpoint"]) {
  assert(inventory.commands[name].requirements.includes("subprocess"));
  assert(inventory.commands[name].requirementEvidence.subprocess.includes("tests/locus-scoped-checkpoint.acceptance.mts"));
  assert(inventory.relationships.some(edge => edge.from === "tests/locus-scoped-checkpoint.acceptance.mts"
    && edge.to === "node:child_process" && edge.kind === "dynamic-import" && !edge.execution));
  for (const kind of ["worker-launch", "subprocess-launch"]) assert(inventory.relationships.some(edge =>
    edge.from === "tests/locus-scoped-checkpoint.acceptance.mts" && edge.to === "tests/fixtures/locus-scoped-tail.restart.mts"
      && edge.kind === kind && edge.execution));
}

// Small synthetic repositories exercise the real inventory without copying tests
// or mutating symlinked repository files. Config injection supplies gate membership.
mkdirSync(resolve(root, "tmp"), { recursive: true });
const fixture = mkdtempSync(resolve(root, "tmp/validation-inventory-fixture-"));
for (const dir of ["tests", "scripts", "editors/vscode-hson/tests", "editors/vscode-hson/scripts"]) mkdirSync(resolve(fixture, dir), { recursive: true });
const put = (path, source) => writeFileSync(resolve(fixture, path), source);
put("tsconfig.json", "{}");
put("editors/vscode-hson/package.json", '{"scripts":{}}');
put("editors/vscode-hson/scripts/build-tests.mjs", "");
const target = "tests/html-source-producer.acceptance.mts";
put(target, 'export const value = 1;');
const config = { ...configuration, ordinary: [], extended: [], maintenance: [], requiredCapabilities: {}, rootBuildPrerequisites: {},
  existingRepeatedBodies: {}, declaredExecution: {},
  gateCommands: (scripts, mode) => mode === "full" ? Object.keys(scripts).filter(name => name.startsWith("test:")) : [] };
const pkg = { scripts: { check: "node scripts/run-current-acceptance.mjs check",
  "check:full": "node scripts/run-current-acceptance.mjs full", "check:extended": "node scripts/run-current-acceptance.mjs extended",
  "test:html-source-producer": `node --import=tsx ${target}`, "test:entry": "node tests/entry.mts" } };
put("tests/entry.mts", "");
function probe(change = () => {}, selected = config) {
  const candidate = structuredClone(pkg);
  change(candidate.scripts);
  put("package.json", JSON.stringify(candidate));
  return createInventory(fixture, selected);
}
assertInventory(probe());
put("tests/test-events.mjs", "export const create_test_event_emitter = () => {}; ");
put(target, 'import {create_test_event_emitter} from "./test-events.mjs"; create_test_event_emitter("fixture");');
assert.equal(assertInventory(probe()).commands["test:html-source-producer"].caseReporting, true);
put(target, 'export const value = 1;');
assert.equal(assertInventory(probe()).commands["test:html-source-producer"].caseReporting, false);
const omit = scripts => { delete scripts["test:html-source-producer"]; };
assert.throws(() => assertInventory(probe(omit)), /no execution destination: tests\/html-source-producer/);
assert.throws(() => assertInventory(probe(scripts => { scripts["test:missing"] = "node tests/missing.acceptance.mts"; })), /missing entrypoint/);
assert.throws(() => assertInventory(probe(scripts => { scripts["test:missing"] = "npm run nonexistent"; })), /Unknown registered command/);
assert.throws(() => assertInventory(probe(scripts => { scripts["test:duplicate"] = scripts["test:html-source-producer"]; })), /Unintended duplicate/);
for (const command of [`node --check ${target}`, `echo node --import=tsx ${target}`,
  `# node --import=tsx ${target}`, `sh -c 'node --import=tsx ${target}'`,
  `node tests/entry.mts # node ${target}`, `node tests/entry.mts; node ${target}`,
  `node tests/entry.mts || node ${target}`, `echo data && node ${target}`]) {
  const candidate = probe(scripts => { scripts["test:html-source-producer"] = command; });
  assert(candidate.errors.some(error => error.includes("Unsupported package command form")), command);
  assert.equal(candidate.suites.find(suite => suite.identity === target).destinations.length, 0, command);
}
// Arguments to a supported program are data, never additional entrypoints.
assert.equal(probe(scripts => { scripts["test:html-source-producer"] = `node tests/entry.mts ${target}`; })
  .suites.find(suite => suite.identity === target).destinations.length, 0);
for (const command of [`node --import=tsx ${target}`, `node ${target} --near-limit`,
  `node tests/entry.mts && node --import=tsx ${target}`, "npm run launch"]) {
  assertInventory(probe(scripts => { scripts["test:html-source-producer"] = command; scripts.launch = `node --import=tsx ${target}`; }));
}
const importTarget = './html-source-producer.acceptance.mts';
for (const source of [
  `import type * as Unused from "${importTarget}";`,
  `import { value as Unused } from "${importTarget}";`,
  `import { value as Unused } from "${importTarget}"; type T = typeof Unused;`,
  `import { type Unused } from "${importTarget}";`, `export type * from "${importTarget}";`,
  `const unused = new URL("${importTarget}", import.meta.url);`, `const unused = "${importTarget}";`,
  `const unused = () => import("${importTarget}");`, `if (false) await import("${importTarget}");`,
  `try { throw new Error('caught'); await import("${importTarget}"); } catch {}`,
  `const missing=undefined; missing?.(await import("${importTarget}"));`,
  `false && (await import("${importTarget}"));`, `true || (await import("${importTarget}"));`,
  `await import("${importTarget}");`, // Even direct dynamic imports require a reviewed route.
  `import { Worker } from 'node:worker_threads'; new Worker(new URL("${importTarget}", import.meta.url));`,
  `import {spawnSync} from 'node:child_process'; spawnSync(process.execPath,['--import=tsx','${target}']);`,
]) {
  put("tests/entry.mts", source);
  const candidate = probe(omit);
  assert.equal(candidate.suites.find(suite => suite.identity === target).destinations.length, 0, source);
  assert.throws(() => assertInventory(candidate), /no execution destination/);
}
for (const source of [`import "${importTarget}";`, `export { value } from "${importTarget}";`,
  `import {value} from "${importTarget}"; console.log(value);`]) {
  put("tests/entry.mts", source);
  assertInventory(probe(omit));
}
put("tests/entry.mts", 'import type * as ChildTypes from "node:child_process";');
assert(!probe().commands["test:entry"].requirements.includes("subprocess"));
put("tests/entry.mts", 'await import("node:child_process");');
assert(probe().commands["test:entry"].requirements.includes("subprocess"));
put("tests/entry.mts", 'import type * as vscode from "vscode";');
assert(!probe().commands["test:entry"].requirements.includes("vscode"));
put("tests/entry.mts", 'import * as vscode from "vscode"; void vscode.window;');
assert(probe().commands["test:entry"].requirements.includes("vscode"));
// Pin a reviewed, awaited import. Changed control flow must invalidate evidence.
const source = `await import("${importTarget}");`;
const declaration = { sha256: createHash("sha256").update(source).digest("hex"),
  route: "Module entry awaits the target import.", sources: [], targets: [[target, "dynamic-import"]] };
const reviewed = { ...config, declaredExecution: { "tests/entry.mts": declaration } };
put("tests/entry.mts", source);
const route = assertInventory(probe(omit, reviewed)).relationships.find(edge => edge.declared);
assert.equal(route.verification, "reviewed-source-pinned");
assert.equal(route.independentlyVerified, false);
for (const changed of [`async function unused(){${source}}`, `false && (${source.slice(0, -1)});`, '']) {
  put("tests/entry.mts", changed);
  const candidate = probe(omit, reviewed);
  assert(candidate.errors.some(error => error.includes("declaration evidence")));
  assert.equal(candidate.relationships.find(edge => edge.declared).verification, "declared-unverified");
  assert.equal(candidate.suites.find(suite => suite.identity === target).destinations.length, 0);
}
// A shared launch helper is part of the pinned evidence, not just the caller.
const helper = "import {Worker} from 'node:worker_threads'; export const launch = url => new Worker(url);";
put("scripts/helper.mjs", helper);
const workerSource = `import {launch} from '../scripts/helper.mjs'; launch(new URL("${importTarget}", import.meta.url));`;
put("tests/entry.mts", workerSource);
const workerConfig = { ...config, declaredExecution: { "tests/entry.mts": {
  sha256: createHash("sha256").update(workerSource).digest("hex"), route: "Entry calls launch, which constructs a Worker with the target URL.",
  sources: [["scripts/helper.mjs", createHash("sha256").update(helper).digest("hex")]], targets: [[target, "worker-launch"]],
} } };
assertInventory(probe(omit, workerConfig));
put("scripts/helper.mjs", "export const launch = () => {};");
assert.throws(() => assertInventory(probe(omit, workerConfig)), /declaration evidence/);
const unsupported = { ...config, declaredExecution: { "tests/entry.mts": { ...declaration, sha256: undefined } } };
assert.throws(() => assertInventory(probe(omit, unsupported)), /declaration evidence/);
put("tests/entry.mts", "");
// Real browser plumbing: retain all text inside an uncalled function, then retain
// only references. Neither may satisfy its existing reviewed declaration.
mkdirSync(resolve(fixture, "tests/browser"));
const scoutPath = "scripts/run-scout-browser.mjs";
const scout = readFileSync(resolve(root, scoutPath), "utf8");
for (const [path] of configuration.declaredExecution[scoutPath].targets) put(path, "");
const browserConfig = { ...config, declaredExecution: { [scoutPath]: configuration.declaredExecution[scoutPath] } };
const browserCommand = scripts => { scripts["test:scout"] = `node ${scoutPath}`; };
put(scoutPath, scout);
assertInventory(probe(browserCommand, browserConfig));
const lines = scout.split("\n"), imports = lines.filter(line => line.startsWith("import ")), body = lines.filter(line => !line.startsWith("import "));
for (const changed of [imports.join("\n") + "\nasync function unused(){\n" + body.join("\n") + "\n}",
  scout.replace('bundle("tests/browser/scout.entry.mjs", bundlePath);', 'void "tests/browser/scout.entry.mjs";')]) {
  put(scoutPath, changed);
  const candidate = probe(browserCommand, browserConfig);
  assert(candidate.errors.some(error => error.includes("declaration evidence")));
  assert.equal(candidate.suites.find(suite => suite.identity === "tests/browser/scout.entry.mjs").destinations.length, 0);
}
// Restore the tiny fixture for the preflight-failure execution probe below.
put(scoutPath, scout);

const executionRoot = mkdtempSync(resolve(root, "tmp/validation-execution-fixture-"));
writeFileSync(resolve(executionRoot, "package.json"), JSON.stringify({ private: true, scripts: {
  build: "node -e \"console.log('fixture build')\"",
  fail: "npm run build && npm run build && node -e \"process.exit(7)\"",
  never: "node -e \"process.exit(99)\"",
} }));
const identity = { fixture: true };
const failed = await runStages({ root: executionRoot, mode: "fixture-stop", identity, configuration: {}, preflight() {},
  stages: [{ name: "fail" }, { name: "never" }] });
assert.equal(failed.exitStatus, 7);
assert.equal(failed.report.rootBuildInvocations, 2);
assert.equal(failed.report.stages[1].exitStatus, 7);
assert.equal(failed.report.stages[2].status, "skipped");
assert.equal(failed.report.stages[2].skippedBecause, "fail");
assert(failed.report.nestedCommands > 0);
const observed = readFileSync(failed.eventFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
assert.equal(observed.filter(event => event.type === "process-start" && event.rootBuild).length, 2);
assert.equal(observed.filter(event => event.type === "process-end" && event.rootBuild).length, 2);
assert(observed.some(event => event.type === "command-end" && event.exitStatus === 7));
for (const stage of failed.report.stages.filter(stage => stage.status !== "skipped")) {
  assert(stage.wallMs >= 0);
  assert(Date.parse(stage.endedAt) >= Date.parse(stage.startedAt));
}
let launched = false;
const blocked = await runStages({ root: executionRoot, mode: "fixture-preflight", identity, configuration: {},
  preflight() { return assertInventory(probe(scripts => { delete scripts["test:html-source-producer"]; })); }, stages: [{ name: "never" }],
  execute() { launched = true; throw new Error("must not execute"); } });
assert.equal(launched, false);
assert.notEqual(blocked.exitStatus, 0);
assert.equal(blocked.report.stages[0].status, "failed");
assert.match(blocked.report.stages[0].error, /no execution destination: tests\/html-source-producer/);
assert.equal(blocked.report.stages[1].status, "skipped");
const continued = await runStages({ root: executionRoot, mode: "fixture-continue", identity, configuration: {}, preflight() {},
  stages: [{ name: "fail", executable: process.execPath, args: ["-e", "process.exit(3)"], continueOnFailure: true },
    { name: "pass", executable: process.execPath, args: ["--input-type=module", "-e", "import {spawnSync} from 'node:child_process'; const r=spawnSync('/nonexistent-validation-fixture-command'); if (!r.error) process.exit(1)"] }] });
assert.notEqual(continued.exitStatus, 0);
assert.notEqual(blocked.reportPath, continued.reportPath, "back-to-back runs must have distinct artifacts");
assert.equal(JSON.parse(readFileSync(blocked.reportPath, "utf8")).stages[1].status, "skipped");
assert.equal(continued.report.stages[2].status, "passed");
const spawnFailure = readFileSync(continued.eventFile, "utf8").trim().split("\n").map(line => JSON.parse(line))
  .find(event => event.type === "command-end" && event.error);
assert.equal(spawnFailure.exitStatus, null, "a launch error must never be recorded as exit zero");
console.log(JSON.stringify({ validationAccounting: "passed", suites: inventory.suites.length, failureReport: failed.reportPath.replace(root, "<repo>") }));

// Compare the same program with and without the preload. Error monitors must
// not count as application error handlers or alter callbacks/exit propagation.
const observer = pathToFileURL(resolve(root, "scripts/validation-observer.mjs")).href;
const plainEnv = { ...process.env };
for (const key of ["NODE_OPTIONS", "HSON_VALIDATION_EVENTS", "HSON_VALIDATION_STAGE", "HSON_VALIDATION_ROOT"]) delete plainEnv[key];
const failureCases = [
  ["missing", "import {spawn} from 'node:child_process'; const child=spawn('/nonexistent-validation-fixture-command'); if(child.listenerCount('error')) process.exit(88);", 1],
  ["handled", "import {spawn} from 'node:child_process'; spawn('/nonexistent-validation-fixture-command').once('error',e=>{process.exitCode=e.code==='ENOENT'?23:88});", 23],
  ["callback", "import {execFile} from 'node:child_process'; execFile('/nonexistent-validation-fixture-command',e=>{process.exitCode=e.code==='ENOENT'?24:88});", 24],
  ["nonzero", "import {spawn} from 'node:child_process'; spawn(process.execPath,['-e','process.exit(7)']).once('exit',code=>{process.exitCode=code});", 7],
  ["signal", "import {spawn} from 'node:child_process'; spawn(process.execPath,['-e',\"process.kill(process.pid,'SIGTERM')\"]).once('exit',(_code,signal)=>process.kill(process.pid,signal));", null],
];
for (const [name, code, expected] of failureCases) {
  const args = ["--input-type=module", "-e", code];
  const plain = spawnSync(process.execPath, args, { encoding: "utf8", env: plainEnv });
  const eventPath = resolve(executionRoot, `${name}.jsonl`);
  writeFileSync(eventPath, "");
  const instrumented = spawnSync(process.execPath, [`--import=${observer}`, ...args], { encoding: "utf8",
    env: { ...plainEnv, HSON_VALIDATION_EVENTS: eventPath, HSON_VALIDATION_ROOT: root } });
  assert.equal(plain.status, expected, name);
  assert.equal(instrumented.status, plain.status, name);
  assert.equal(instrumented.signal, plain.signal, name);
  if (name === "missing") {
    assert.match(plain.stderr, /Unhandled 'error' event/);
    assert.match(instrumented.stderr, /Unhandled 'error' event/);
  }
  const aggregate = await runStages({ root: executionRoot, mode: `semantics-${name}`, identity, configuration: {}, preflight() {},
    stages: [{ name, executable: process.execPath, args }, { name: "never" }] });
  assert.notEqual(aggregate.exitStatus, 0, name);
  assert.equal(aggregate.report.stages[1].status, "failed", name);
  assert.equal(aggregate.report.stages[2].status, "skipped", name);
}
const missingStage = await runStages({ root: executionRoot, mode: "launch-error", identity, configuration: {}, preflight() {},
  stages: [{ name: "missing-executable", executable: "/nonexistent-validation-fixture-command", args: [] }] });
assert.notEqual(missingStage.exitStatus, 0);
assert.equal(missingStage.report.stages[1].status, "failed");
assert.match(missingStage.report.stages[1].error, /ENOENT/);
const timedOut = await runStages({ root: executionRoot, mode: "timeout", identity, configuration: {}, preflight() {},
  stages: [{ name: "timeout", executable: process.execPath, args: ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    timeout: 200, continueOnFailure: true }, { name: "after-timeout", executable: process.execPath, args: ["-e", "process.exit(0)"] }] });
assert.notEqual(timedOut.exitStatus, 0);
assert.equal(timedOut.report.stages[1].status, "failed");
assert.match(timedOut.report.stages[1].error, /timed out/);
assert.equal(timedOut.report.stages[2].status, "passed");
const incompleteCleanup = await runStages({ root: executionRoot, mode: "incomplete-cleanup", identity, configuration: {}, preflight() {},
  stages: [{ name: "failed", continueOnFailure: true }, { name: "never" }], execute() {
    return { status: 7, error: new Error("original stage diagnostic"), cleanup: { status: "incomplete", error: "owned group remains" } };
  } });
assert.equal(incompleteCleanup.exitStatus, 7);
assert.equal(incompleteCleanup.report.stages[1].error, "original stage diagnostic");
assert.equal(incompleteCleanup.report.stages[1].cleanup.error, "owned group remains");
assert.equal(incompleteCleanup.report.stages[2].status, "skipped", "incomplete cleanup overrides continueOnFailure");
assert.equal(continued.report.stages[2].cleanup, undefined, "successful stages retain normal semantics");
const partialObservation = await runStages({ root: executionRoot, mode: "partial-observation", identity, configuration: {}, preflight() {},
  stages: [{ name: "partial" }], execute(_command, _args, options) {
    writeFileSync(options.env.HSON_VALIDATION_EVENTS, '{"incomplete":'); return { status: 0 };
  } });
assert.notEqual(partialObservation.exitStatus, 0);
assert.equal(partialObservation.report.observationIncomplete, true);
assert(partialObservation.report.endedAt);

// Exercise actual child processes and the runner's saved stage/aggregate
// decisions, including a zero process status that contradicts suite evidence.
const emitterUrl = pathToFileURL(resolve(root, "tests/test-events.mjs")).href;
const beginCase = `import {create_test_event_emitter} from ${JSON.stringify(emitterUrl)};
const events=create_test_event_emitter('fixture.completion'); events.case_begin('same','Same case');\n`;
const finishCase = status => `events.case_end('same',${JSON.stringify(status)}); events.terminal(${JSON.stringify(status)});\n`;
async function completionProbe(name, source, expected, { reporting = true, continued = false, started, completed } = {}) {
  const entry = resolve(executionRoot, `${name}.mjs`);
  writeFileSync(entry, source);
  // Use real inventory evidence for the contract rather than a test-only flag.
  const stageName = reporting ? "test:hson-array-index" : "build";
  const result = await runStages({ root: executionRoot, mode: name, identity, configuration: {},
    preflight: () => ({ commands: inventory.commands }), stages: [
      { name: stageName, executable: process.execPath, args: [entry], timeout: 5000, continueOnFailure: continued },
      { name: "after-completion", executable: process.execPath, args: ["-e", "process.exit(0)"] },
    ] });
  const row = result.report.stages[1];
  assert.equal(row.exitStatus, 0, `${name}: preserve the observed process result`);
  assert.equal(row.caseCompletion.status, expected, name);
  const passed = ["passed", "not-required"].includes(expected);
  assert.equal(row.status, passed ? "passed" : "failed", name);
  assert.equal(result.report.status, passed ? "passed" : "failed", name);
  assert.equal(result.exitStatus, passed ? 0 : 1, name);
  assert.equal(result.report.stages[2].status, passed || continued ? "passed" : "skipped", name);
  assert.deepEqual(JSON.parse(readFileSync(result.reportPath, "utf8")).stages[1], JSON.parse(JSON.stringify(row)));
  if (started !== undefined) assert.equal(row.caseCompletion.suitesStarted, started, name);
  if (completed !== undefined) assert.equal(row.caseCompletion.suitesCompleted, completed, name);
  return readFileSync(result.eventFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
}
for (const status of ["error", "cancelled", "fail"]) {
  await completionProbe(`terminal-${status}`, beginCase + finishCase(status) + "process.exit(0);", "failed", { continued: true });
}
await completionProbe("unfinished-case", beginCase + "process.exit(0);", "incomplete");
await completionProbe("missing-terminal", beginCase + "events.case_end('same','pass');", "incomplete");
await completionProbe("empty-emitter", beginCase.split(" events.case_begin")[0], "incomplete");
await completionProbe("missing-reporting", "process.exit(0);", "incomplete");
await completionProbe("ordinary-command", "process.exit(0);", "not-required", { reporting: false });
for (const status of ["pass", "skip", "unsupported"]) {
  await completionProbe(`completed-${status}`, beginCase + finishCase(status), "passed", { started: 1, completed: 1 });
}
// Nested stdout may be captured instead of inherited. The suite evidence must
// still reach the existing observation file. Equal suite/case IDs are legal in
// separate processes and threads and must not complete one another's emitters.
for (const kind of ["subprocess", "worker"]) {
  for (const variant of ["pass", "error", "cancelled", "incomplete", "parent-incomplete"]) {
    const leaf = resolve(executionRoot, `leaf-${kind}-${variant}.mjs`);
    const leafStatus = variant === "parent-incomplete" ? "pass" : variant;
    writeFileSync(leaf, beginCase + (leafStatus === "incomplete" ? "" : finishCase(leafStatus)) + "process.exit(0);");
    const launch = kind === "subprocess"
      ? `import {spawnSync} from 'node:child_process';
const child=spawnSync(process.execPath,[${JSON.stringify(leaf)}],{encoding:'utf8'});
if(child.status!==0 || !child.stdout.includes('<HSON_TEST_EVENT>')) throw new Error('nested output/status changed');\n`
      : `import {Worker} from 'node:worker_threads';
const worker=new Worker(new URL(${JSON.stringify(pathToFileURL(leaf).href)}),{stdout:true}); worker.stdout.resume();
await new Promise((done,reject)=>{worker.once('error',reject);worker.once('exit',code=>code===0?done():reject(new Error('worker exit')));});\n`;
    const expected = variant.includes("incomplete") ? "incomplete" : variant === "pass" ? "passed" : "failed";
    const observed = await completionProbe(`nested-${kind}-${variant}`, beginCase + launch
      + (variant === "parent-incomplete" ? "" : finishCase("pass")), expected,
    { started: 2, completed: variant.includes("incomplete") ? 1 : 2 });
    const reporters = observed.filter(event => event.type === "suite-start");
    assert.equal(new Set(reporters.map(event => `${event.pid}:${event.threadId}:${event.id}`)).size, 2);
    if (kind === "worker") assert.equal(new Set(reporters.map(event => event.pid)).size, 1);
    else assert(observed.some(event => event.type === "command-end" && event.exitStatus === 0));
  }
}

// Descendant evidence arriving during a later stage must still affect the
// aggregate. Inject it through the existing transport without owning new work.
const lateCompletion = await runStages({ root: executionRoot, mode: "late-completion", identity, configuration: {}, preflight() {},
  stages: [{ name: "early" }, { name: "later" }], execute(_command, _args, options) {
    const early = options.env.HSON_VALIDATION_STAGE === "early";
    const records = ["suite-start", "suite-end"].map(type => ({ type, stage: "early", pid: 1, threadId: 0,
      id: early ? 1 : 2, suiteId: "fixture.late", ...(type === "suite-end" ? { status: early ? "pass" : "error" } : {}) }));
    writeFileSync(options.env.HSON_VALIDATION_EVENTS, records.map(record => JSON.stringify(record) + "\n").join(""), { flag: "a" });
    return { status: 0 };
  } });
assert.equal(lateCompletion.report.stages[1].exitStatus, 0);
assert.equal(lateCompletion.report.stages[1].caseCompletion.status, "failed");
assert.equal(lateCompletion.report.stages[1].status, "failed");
assert.equal(lateCompletion.report.status, "failed");
assert.equal(lateCompletion.exitStatus, 1);

const pause = () => new Promise(done => setTimeout(done, 20));
async function waitFor(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) { assert(Date.now() < deadline, `Timed out: ${label}`); await pause(); }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
// An abnormal leader exit must clean its still-running descendants before a
// continue-on-failure stage begins. Controls are children of this test, not of
// the stage group, and must survive both TERM and the KILL escalation.
if (process.platform !== "win32") for (const termination of ["nonzero", "signal"]) {
  const failedRoot = mkdtempSync(resolve(root, "tmp/validation-failed-descendant-"));
  writeFileSync(resolve(failedRoot, "leaf.mjs"), "import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); writeFileSync('leaf.pid',String(process.pid)); setInterval(()=>{},1000);");
  writeFileSync(resolve(failedRoot, "parent.mjs"), `import {spawn} from 'node:child_process'; import {existsSync} from 'node:fs';
const child=spawn(process.execPath,['leaf.mjs'],{stdio:'ignore'}); child.unref();
while(!existsSync('leaf.pid')) await new Promise(done=>setTimeout(done,10));
${termination === "nonzero" ? "process.exit(7);" : "process.kill(process.pid,'SIGTERM');"}`);
  const control = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", env: plainEnv });
  const controlExit = once(control, "exit");
  let pid;
  try {
    const result = await runStages({ root: failedRoot, mode: `descendant-${termination}`, identity, configuration: {}, preflight() {}, stages: [
      { name: "failed-parent", executable: process.execPath, args: ["parent.mjs"], continueOnFailure: true },
      { name: "after-cleanup", executable: process.execPath, args: ["-e", "const pid=Number(require('node:fs').readFileSync('leaf.pid','utf8')); try {process.kill(pid,0);process.exitCode=99;} catch(e) {if(e.code!=='ESRCH')throw e;}"] },
    ] });
    pid = Number(readFileSync(resolve(failedRoot, "leaf.pid"), "utf8"));
    assert(!alive(pid), "failed stage descendant is gone when runStages returns");
    assert(alive(control.pid), "unrelated control survives failed-stage cleanup");
    const row = result.report.stages[1];
    assert.equal(row.status, "failed");
    assert.equal(row.exitStatus, termination === "nonzero" ? 7 : null);
    assert.equal(row.signal, termination === "signal" ? "SIGTERM" : null);
    assert.equal(result.exitStatus, termination === "nonzero" ? 7 : 1);
    assert.equal(result.report.status, "failed");
    assert.equal(row.cleanup.scope, "owned-process-group");
    assert.equal(row.cleanup.status, "complete");
    assert.equal(row.error, undefined, "cleanup must not replace the stage diagnostics");
    assert.equal(result.report.stages[2].status, "passed", "next stage starts after cleanup");
  } finally {
    if (existsSync(resolve(failedRoot, "leaf.pid"))) pid = Number(readFileSync(resolve(failedRoot, "leaf.pid"), "utf8"));
    if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    control.kill("SIGKILL"); await controlExit;
  }
}
// The policy owns only a private stage group. Exercise npm -> shell -> Node ->
// Node, including SIGTERM-resistant descendants and an unrelated control child.
if (process.platform !== "win32") for (const cancelSignal of ["SIGTERM", "SIGINT"]) {
  const cancelRoot = mkdtempSync(resolve(root, "tmp/validation-cancellation-fixture-"));
  const token = cancelRoot.split("/").at(-1);
  writeFileSync(resolve(cancelRoot, "leaf.mjs"), "import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); writeFileSync('leaf.pid',String(process.pid)); setInterval(()=>{},1000);\n");
  writeFileSync(resolve(cancelRoot, "slow.mjs"), `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); spawn(process.execPath,['leaf.mjs',${JSON.stringify(token)}],{stdio:'inherit'}); writeFileSync('child.pid',String(process.pid)); setInterval(()=>{},1000);\n`);
  writeFileSync(resolve(cancelRoot, "package.json"), JSON.stringify({ private: true, scripts: { slow: "node slow.mjs" } }));
  const runnerPath = resolve(cancelRoot, "runner.mjs");
  writeFileSync(runnerPath, `import {runStages} from ${JSON.stringify(pathToFileURL(resolve(root, "scripts/validation-execution.mjs")).href)};
const r=await runStages({root:${JSON.stringify(cancelRoot)},mode:'cancel',identity:{fixture:true},configuration:{},preflight(){},stages:[
{name:'completed',executable:process.execPath,args:['-e','process.exit(0)']},
{name:'slow',continueOnFailure:true},
{name:'never',executable:process.execPath,args:['-e',${JSON.stringify("require('node:fs').writeFileSync('never-started','bad')")}]}
]}); process.exitCode=r.exitStatus;\n`);
  const control = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", token], { stdio: "ignore", env: plainEnv });
  const runner = spawn(process.execPath, [runnerPath, token], { stdio: "ignore", env: plainEnv });
  const runnerExit = once(runner, "exit");
  const controlExit = once(control, "exit");
  const pids = [];
  try {
    await waitFor(() => ["leaf.pid", "child.pid"].every(file => existsSync(resolve(cancelRoot, file))), "cancellation probe ready");
    for (const file of ["child.pid", "leaf.pid"]) pids.push(Number(readFileSync(resolve(cancelRoot, file), "utf8")));
    for (const pid of pids) assert(alive(pid));
    runner.kill(cancelSignal);
    await waitFor(() => runner.exitCode !== null || runner.signalCode !== null, "runner cancellation");
    const [code, signal] = await runnerExit;
    assert.equal(code, cancelSignal === "SIGINT" ? 130 : 143); assert.equal(signal, null);
    for (const pid of pids) await waitFor(() => !alive(pid), "child termination");
    assert(alive(control.pid), "unrelated child must survive cancellation");
    assert.equal(existsSync(resolve(cancelRoot, "never-started")), false);
    const timingRoot = resolve(cancelRoot, "tmp/validation-timing");
    const [folder] = readdirSync(timingRoot);
    const report = JSON.parse(readFileSync(resolve(timingRoot, folder, "report.json"), "utf8"));
    assert.equal(report.status, "cancelled"); assert.equal(report.exitStatus, code);
    assert.equal(report.cancellationSignal, cancelSignal);
    assert(report.endedAt);
    assert.equal(report.stages[1].status, "passed");
    assert.equal(report.stages[2].status, "cancelled");
    assert.equal(report.stages[3].status, "skipped");
    assert(!report.stages.some(stage => stage.status === "running" || stage.status === "pending"));
  } finally {
    // Clean up only the uniquely identified probe processes, even on assertion failure.
    for (const file of ["child.pid", "leaf.pid"]) if (existsSync(resolve(cancelRoot, file))) {
      const pid = Number(readFileSync(resolve(cancelRoot, file), "utf8"));
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
    if (control.exitCode === null && control.signalCode === null) control.kill("SIGKILL");
    await runnerExit; await controlExit;
  }
}
console.log(JSON.stringify({ correctionRegressions: "passed", processComparisons: failureCases.length, cancellationSignals: process.platform === "win32" ? [] : ["SIGINT", "SIGTERM"] }));

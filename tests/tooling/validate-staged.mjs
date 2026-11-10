import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCommitted, validateStaged } from "../../scripts/validate-staged.mjs";
import { runStages, validationEnvironment } from "../../scripts/validation-execution.mjs";
import { runAcceptance } from "../../scripts/run-current-acceptance.mjs";
import { ordinary, gateCommands } from "../../scripts/validation-config.mjs";

// Deliberately outside the application inventory: run this orchestration probe
// directly. Every real child is a short synthetic program in a disposable repo.
const sourceRoot = resolve(import.meta.dirname, "../..");
const temporary = mkdtempSync(resolve(tmpdir(), "hson-hook-checks-"));
let checks = 0;
const pause = ms => new Promise(done => setTimeout(done, ms));
async function waitFor(predicate) {
  const until = Date.now() + 10_000;
  while (!predicate()) { assert(Date.now() < until, "probe did not become ready"); await pause(15); }
}
async function check(name, run) { await run(); console.log(`ok ${++checks} - ${name}`); }
function git(root, args, extra = {}) {
  const result = spawnSync("git", args, { cwd: root, env: { ...validationEnvironment(), ...extra }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture() {
  const root = mkdtempSync(resolve(temporary, "repo-"));
  git(root, ["-c", "init.templateDir=", "init", "-q"]);
  git(root, ["config", "user.name", "Hook checks"]);
  git(root, ["config", "user.email", "hook-checks@example.invalid"]);
  git(root, ["config", "commit.gpgSign", "false"]);
  git(root, ["config", "core.hooksPath", resolve(root, "no-hooks")]);
  writeFileSync(resolve(root, "input"), "committed\n");
  writeFileSync(resolve(root, ".gitignore"), "dist/\n.hson/\nnode_modules/\n");
  git(root, ["add", "input", ".gitignore"]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}
function stage(name, source, extra = {}) {
  return { name, command: `synthetic ${name}`, executable: process.execPath, args: ["--input-type=module", "-e", source], ...extra };
}
function run(root, reports, stages, extra = {}) {
  return runStages({ root, reportRoot: reports, mode: "synthetic", collectAll: true, captureOutput: true,
    identity: { synthetic: true }, preflight() {}, configuration: {}, stages, ...extra });
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
function cliFixture({ brokenRootInstall = false, brokenEditorInstall = false } = {}) {
  const root = fixture();
  mkdirSync(resolve(root, "scripts"));
  for (const file of ["validate-staged.mjs", "validation-execution.mjs", "validation-observer.mjs", "validation-build-publication.mjs"]) {
    copyFileSync(resolve(sourceRoot, "scripts", file), resolve(root, "scripts", file));
  }
  for (const prefix of ["", "editors/vscode-hson/"]) {
    mkdirSync(resolve(root, prefix), { recursive: true });
    const pkg = { name: prefix ? "fixture-editor" : "fixture-root", version: "1.0.0", private: true, type: "module",
      scripts: { "check:commit": "sh .githooks/pre-commit",
        first: "node -e \"console.log('first completed')\"", last: "node -e \"console.log('last completed')\"" } };
    writeFileSync(resolve(root, prefix, "package.json"), JSON.stringify(pkg));
    if (!(prefix ? brokenEditorInstall : brokenRootInstall)) writeFileSync(resolve(root, prefix, "package-lock.json"), JSON.stringify({
      name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { "": { name: pkg.name, version: pkg.version } },
    }));
  }
  writeFileSync(resolve(root, "scripts/validation-config.mjs"), "export const gateCommands=()=>['first','last'];export const rootBuildPrerequisites={};");
  writeFileSync(resolve(root, "scripts/run-current-acceptance.mjs"), `import {runStages} from './validation-execution.mjs';
export function runAcceptance(mode,options){return runStages({root:new URL('../',import.meta.url).pathname,mode,
identity:{fixture:true},configuration:{},preflight(){},stages:[{name:'first'},{name:'last'}],...options});}`);
  if (brokenEditorInstall) {
    const pkgPath = resolve(root, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.scripts["check:editor"] = "node -e \"throw Error('blocked editor stage executed')\"";
    writeFileSync(pkgPath, JSON.stringify(pkg));
    writeFileSync(resolve(root, "scripts/validation-config.mjs"),
      "export const gateCommands=()=>['first','check:editor','last'];export const rootBuildPrerequisites={};");
    writeFileSync(resolve(root, "scripts/run-current-acceptance.mjs"), `import {runStages} from './validation-execution.mjs';
export function runAcceptance(mode,options){return runStages({root:new URL('../',import.meta.url).pathname,mode,
identity:{fixture:true},configuration:{},preflight(){},
stages:['first','check:editor','last'].map(name=>({name})),...options});}`);
  }
  git(root, ["add", "scripts", "package.json", "editors"]);
  if (!brokenRootInstall) git(root, ["add", "package-lock.json"]);
  return root;
}

function installHook(root) {
  mkdirSync(resolve(root, ".githooks"));
  copyFileSync(resolve(sourceRoot, ".githooks/pre-commit"), resolve(root, ".githooks/pre-commit"));
  git(root, ["config", "core.hooksPath", ".githooks"]);
  git(root, ["add", ".githooks"]);
}

function sweepFixture({ failures = false, failBuild = false, failInstall = false, drift, testError, setupDrift = false } = {}) {
  const root = cliFixture({ brokenRootInstall: failInstall });
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const names = ["build", "test:first", "test:later", "test:last"];
  const tools = "import {mkdirSync,writeFileSync} from 'node:fs'; for (const name of ['typescript','tsx','esbuild']) { const dir='node_modules/'+name; mkdirSync(dir,{recursive:true}); writeFileSync(dir+'/package.json',JSON.stringify({version:'0.0.0'})); }";
  pkg.scripts = {
    "check:sweep": ledger(resolve(sourceRoot, "package.json")).scripts["check:sweep"],
    postinstall: `node --input-type=module -e "${tools}${setupDrift ? " writeFileSync('tests/first.acceptance.mjs', '');" : ""}"`,
    build: failBuild ? 'node -e "process.exit(1)"'
      : 'node -e "const fs = require(\'node:fs\'); fs.mkdirSync(\'dist\'); fs.writeFileSync(\'dist/build\', \'private\')"',
  };
  copyFileSync(resolve(sourceRoot, "scripts/run-current-acceptance.mjs"), resolve(root, "scripts/run-current-acceptance.mjs"));
  mkdirSync(resolve(root, "tests"));
  copyFileSync(resolve(sourceRoot, "tests/test-events.mjs"), resolve(root, "tests/test-events.mjs"));
  for (const test of ["first", "later", "last"]) {
    const path = `tests/${test}.acceptance.mjs`;
    pkg.scripts[`test:${test}`] = `node ${path}`;
    writeFileSync(resolve(root, path), [
      "import assert from 'node:assert/strict';",
      "import {readFileSync, writeFileSync} from 'node:fs';",
      "assert.equal(readFileSync('dist/build', 'utf8'), 'private');",
      test === "later" ? "writeFileSync('dist/test-output', 'private');" : "",
      drift === "source" && test === "first" ? "writeFileSync('tests/later.acceptance.mjs', 'console.log(\"rewritten test\");');" : "",
      drift === "dependencies" && test === "first" ? "writeFileSync('node_modules/partial', 'incomplete');" : "",
      testError === "setup" && test === "first" ? "await import('./missing-fixture.mjs');" : "",
      testError === "mixed" && test === "first" ? `
import { create_test_event_emitter as create } from './test-events.mjs';
const events = create('checks', ['load', 'check']);
events.case_begin('load', 'Load fixture');
try { await import('./missing-fixture.mjs'); }
catch (error) {
  events.diagnostic('load', 'error', error.message);
  events.case_end('load', 'error');
}
events.terminal('error');
const checks = create('assertions', ['check']);
checks.case_begin('check', 'Check value');
try { assert.fail('failed assertion'); }
catch (error) {
  checks.diagnostic('check', 'fail', error.message);
  checks.case_end('check', 'fail');
}
checks.terminal('fail');` : "",
      testError === "child" && test === "first" ? `
import { spawnSync } from 'node:child_process';
process.exitCode = spawnSync(process.execPath, ['-e', 'require("node:assert/strict").fail()']).status;` : "",
      failures && test === "first" ? "assert.fail('uncaught assertion');" : "",
      failures && test === "last" ? `
import { create_test_event_emitter as create } from './test-events.mjs';
const checks = create('last', ['check']);
checks.case_begin('check', 'Check value');
try { assert.fail('reported assertion'); }
catch { checks.case_end('check', 'fail'); }
checks.terminal('fail');` : `console.log("passed ${test}");`,
    ].join("\n"));
  }
  writeFileSync(resolve(root, "package.json"), JSON.stringify(pkg));
  writeFileSync(resolve(root, "scripts/validation-config.mjs"), `
export const ordinary=${JSON.stringify(names)}, rootBuildConsumers=[], rootBuildPrerequisites={};
export const gateCommands=(_scripts, gate)=>gate==='full'?ordinary:[];
export const assertInventory=inventory=>inventory;`);
  const commands = Object.fromEntries(names.slice(1).map(name => [name, {
    suites: [`tests/${name.slice(5)}.acceptance.mjs`], requirements: ["node"],
    caseReporting: name === "test:last" && failures || name === "test:first" && testError === "mixed",
  }]));
  writeFileSync(resolve(root, "scripts/validation-inventory.mjs"), `export const createInventory=()=>({suites:[], commands:${JSON.stringify(commands)}});`);
  git(root, ["add", "package.json", "scripts", "tests"]);
  git(root, ["commit", "-qm", "diagnostic fixture"]);
  return root;
}

const ledger = path => JSON.parse(readFileSync(path, "utf8"));

try {
  for (const [name, options, expected] of [
    ["continues after two clean assertions", { failures: true }, ["passed", "failed", "passed", "failed"]],
    ["stops after a failed build", { failBuild: true }, ["failed", "skipped", "skipped", "skipped"]],
    ["stops after a failed install", { failInstall: true }, ["skipped", "skipped", "skipped", "skipped"]],
    ["stops after a failing test changes installed dependencies", { failures: true, drift: "dependencies" }, ["passed", "failed", "skipped", "skipped"]],
    ["stops after a passing test changes tracked source", { drift: "source" }, ["passed", "failed", "skipped", "skipped"]],
    ["stops after a failing test changes tracked source", { failures: true, drift: "source" }, ["passed", "failed", "skipped", "skipped"]],
    ["stops setup after an install changes tracked source", { setupDrift: true }, ["skipped", "skipped", "skipped", "skipped"]],
    ["stops on mixed assertion and setup errors", { testError: "mixed" }, ["passed", "failed", "skipped", "skipped"]],
    ["stops on a module-load error alone", { testError: "setup" }, ["passed", "failed", "skipped", "skipped"]],
    ["stops on an incidental child assertion", { testError: "child" }, ["passed", "failed", "skipped", "skipped"]],
    ["keeps passing diagnostics separate from certification", {}, ["passed", "passed", "passed", "passed"]],
  ]) await check(`sweep ${name}`, () => {
    const root = sweepFixture(options);
    writeFileSync(resolve(root, "tests/later.acceptance.mjs"), "throw new Error('owner working tree');");
    const invocation = spawnSync("npm", ["run", "check:sweep"], {
      cwd: root, env: { ...validationEnvironment(), npm_config_offline: "true" }, encoding: "utf8", timeout: 30_000,
    });
    const success = expected.every(status => status === "passed");
    assert.equal(invocation.status, success ? 0 : 1, invocation.error?.message ?? invocation.stdout + invocation.stderr);
    const reports = resolve(root, ".git/diagnostic-reports");
    const [folder] = readdirSync(reports);
    const report = ledger(resolve(reports, folder, "diagnostic.json"));
    const gate = ledger(report.gateReport);
    const setup = ledger(report.setupReport);
    const stages = gate.stages.slice(1);
    assert.deepEqual(stages.map(row => row.status), expected);
    assert.deepEqual(gate.stageCounts, Object.fromEntries(["passed", "failed", "skipped", "blocked", "cancelled"]
      .map(status => [status, [gate.stages[0].status, ...expected].filter(item => item === status).length])));
    assert(stages.filter(row => row.status === "skipped").every(row => !row.log && (row.skippedBecause || row.blockedBecause?.length)));
    assert.equal(report.label, "DIAGNOSTIC — NOT CERTIFICATION");
    assert.equal(gate.label, report.label);
    assert.equal(setup.label, report.label);
    assert.equal(report.status, success ? "passed" : "failed");
    assert.equal(report.exitStatus, invocation.status);
    assert.equal(gate.status, report.status);
    assert([report, setup, gate].every(row => row.endedAt));
    assert.equal(report.checkoutRemoved, true);
    assert.equal(existsSync(report.checkout), false);
    assert.equal(existsSync(resolve(root, ".git/validation-reports")), false);
    if (options.failInstall || options.setupDrift) assert.deepEqual(setup.stages.slice(1).map(row => row.status), ["failed", "skipped"]);
    if (options.setupDrift) assert.match(setup.stages[1].diagnosticStopReason, /tracked source.*tests\/first\.acceptance\.mjs/s);
    if (options.drift === "source") assert.match(stages[1].diagnosticStopReason, /tracked source.*tests\/later\.acceptance\.mjs/s);
    if (options.drift === "dependencies") assert.match(stages[1].diagnosticStopReason, /checkout changed/);
    if (options.testError) {
      assert.equal(stages[1].diagnosticContinuation, undefined);
      assert.equal(stages[1].failureKind, options.testError === "child" ? "unclassified-process" : "environment-or-setup");
      if (options.testError === "mixed") assert.deepEqual(stages[1].caseCompletion.suites.map(suite => suite.status), ["error", "fail"]);
    }
    if (options.failures && !options.drift) {
      assert.deepEqual(stages.filter(row => row.failureKind === "assertion").map(row => row.name), ["test:first", "test:last"]);
      assert(stages.filter(row => row.status === "failed").every(row => row.diagnosticContinuation === "verified-assertion"));
      assert.match(readFileSync(resolve(report.gateReport, "..", stages[2].log), "utf8"), /passed later/);
    }
  });

  await check("sweep stops on incomplete cleanup", async () => {
    const root = fixture();
    const result = await run(root, resolve(temporary, "sweep-cleanup"), [{ name: "test:first" }, { name: "test:later" }], {
      mode: "sweep", execute: () => ({ status: 1, cleanup: { status: "incomplete", error: "owned group remains" } }),
    });
    const [, failed, unreached] = ledger(result.reportPath).stages;
    assert.equal(result.exitStatus, 1);
    assert.equal(failed.status, "failed");
    assert.equal(failed.cleanup.status, "incomplete");
    assert.equal(unreached.status, "skipped");
    assert.equal(unreached.skippedBecause, failed.name);
  });

  await check("installed hook rejects staged conflict markers before using any project scripts", () => {
    const root = cliFixture();
    installHook(root);
    const head = git(root, ["rev-parse", "HEAD"]);
    writeFileSync(resolve(root, "input"), "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> other\n");
    git(root, ["add", "input"]);
    writeFileSync(resolve(root, "input"), "clean worktree\n");
    const pkgPath = resolve(root, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.scripts["check:commit"] = "exit 0";
    writeFileSync(pkgPath, JSON.stringify(pkg));
    const hook = spawnSync("git", ["hook", "run", "pre-commit"], { cwd: root, env: validationEnvironment(), encoding: "utf8" });
    assert.notEqual(hook.status, 0);
    assert.match(hook.stderr + hook.stdout, /leftover conflict marker/);
    assert.equal(git(root, ["rev-parse", "HEAD"]), head);
    assert.equal(existsSync(resolve(root, ".git/validation-reports")), false);
  });

  await check("installed hook uses the default CLI, private dependency installs and staged commit tree", () => {
    const root = cliFixture();
    installHook(root);
    const candidate = git(root, ["write-tree"]);
    writeFileSync(resolve(root, "input"), "unstaged owner work\n");
    for (const script of ["validate-staged.mjs", "validation-execution.mjs", "run-current-acceptance.mjs"]) {
      writeFileSync(resolve(root, "scripts", script), "throw new Error('unstaged validator ran');\n");
    }
    const commit = spawnSync("git", ["commit", "-qm", "candidate"], {
      cwd: root, env: { ...validationEnvironment(), npm_config_offline: "true" }, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(commit.status, 0, commit.stdout + commit.stderr);
    const [folder] = readdirSync(resolve(root, ".git/validation-reports"));
    const report = JSON.parse(readFileSync(resolve(root, ".git/validation-reports", folder, "candidate.json"), "utf8"));
    assert.equal(report.status, "passed"); assert.equal(report.candidateTree, candidate);
    assert.equal(git(root, ["rev-parse", "HEAD^{tree}"]), candidate);
    assert.equal(readFileSync(resolve(root, "input"), "utf8"), "unstaged owner work\n");
    assert.equal(existsSync(resolve(root, "node_modules")), false);
    assert.equal(existsSync(resolve(root, "editors/vscode-hson/node_modules")), false);
    const setup = JSON.parse(readFileSync(report.setupReport, "utf8"));
    assert.deepEqual(setup.stages.map(row => row.status), ["skipped", "passed", "passed"]);
    assert.equal(JSON.parse(readFileSync(report.gateReport, "utf8")).mode, "commit");
    assert.equal(existsSync(report.checkout), false);
    assert(existsSync(report.gateReport));
  });

  await check("failed root install still attempts editor installation and accounts for blocked stages", () => {
    const root = cliFixture({ brokenRootInstall: true });
    const child = spawnSync(process.execPath, ["scripts/validate-staged.mjs"], {
      cwd: root, env: { ...validationEnvironment(), npm_config_offline: "true" }, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(child.status, 1, child.stdout + child.stderr);
    const [folder] = readdirSync(resolve(root, ".git/validation-reports"));
    const report = JSON.parse(readFileSync(resolve(root, ".git/validation-reports", folder, "candidate.json"), "utf8"));
    const setup = JSON.parse(readFileSync(report.setupReport, "utf8"));
    const gate = JSON.parse(readFileSync(report.gateReport, "utf8"));
    assert.deepEqual(setup.stages.slice(1).map(row => row.status), ["failed", "passed"]);
    assert.deepEqual(gate.stages.map(row => row.status), ["skipped", "blocked", "blocked"]);
    assert.equal(existsSync(report.checkout), false);
  });

  for (const brokenRootInstall of [false, true]) await check(
    `${brokenRootInstall ? "root and editor" : "editor-only"} installation failure blocks editor stages and preserves complete reporting`, () => {
    const root = cliFixture({ brokenRootInstall, brokenEditorInstall: true });
    const child = spawnSync(process.execPath, ["scripts/validate-staged.mjs"], {
      cwd: root, env: { ...validationEnvironment(), npm_config_offline: "true" }, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(child.status, 1, child.stdout + child.stderr);
    const [folder] = readdirSync(resolve(root, ".git/validation-reports"));
    const report = JSON.parse(readFileSync(resolve(root, ".git/validation-reports", folder, "candidate.json"), "utf8"));
    const setup = JSON.parse(readFileSync(report.setupReport, "utf8"));
    const gate = JSON.parse(readFileSync(report.gateReport, "utf8"));
    assert.equal(report.status, "failed"); assert.equal(report.exitStatus, 1);
    assert.equal(report.candidateUnchanged, true); assert.equal(report.checkoutRemoved, true);
    assert.equal(existsSync(report.checkout), false);
    assert.deepEqual(setup.stages.map(row => [row.name, row.status]), [
      ["inventory-preflight", "skipped"], ["install-root", brokenRootInstall ? "failed" : "passed"], ["install-editor", "failed"],
    ]);
    assert.deepEqual(gate.stages.map(row => row.status), brokenRootInstall
      ? ["skipped", "blocked", "blocked", "blocked"]
      : ["passed", "passed", "blocked", "passed"]);
    assert.deepEqual(gate.stages.find(row => row.name === "check:editor").blockedBecause,
      brokenRootInstall ? ["install-root", "install-editor"] : ["install-editor"]);
    for (const [ledger, path] of [[setup, report.setupReport], [gate, report.gateReport]]) {
      assert.equal(ledger.status, "failed"); assert.notEqual(ledger.exitStatus, 0); assert(ledger.endedAt);
      assert(ledger.stages.every(row => ["passed", "failed", "blocked", "skipped"].includes(row.status)));
      for (const row of ledger.stages.slice(1).filter(row => row.status !== "blocked")) {
        assert(row.startedAt); assert(row.endedAt); assert(row.log);
        const log = readFileSync(resolve(path, "..", row.log), "utf8");
        if (row.status === "failed") assert(log.length > 0, `${row.name} failure log missing`);
        if (row.name === "last") assert.match(log, /last completed/);
        assert.doesNotMatch(log, /blocked editor stage executed/);
      }
    }
  });

  await check("certification freezes the committed tree and ignores staged and unstaged files", async () => {
    const root = fixture(), commit = git(root, ["rev-parse", "HEAD"]);
    writeFileSync(resolve(root, "input"), "staged\n"); git(root, ["add", "input"]);
    writeFileSync(resolve(root, "input"), "unstaged\n");
    const result = await validateCommitted({ cwd: root, validateSnapshot(snapshot, _reports, _cancelled, mode) {
      assert.equal(mode, "full");
      assert.equal(git(snapshot, ["rev-parse", "HEAD"]), commit);
      assert.equal(readFileSync(resolve(snapshot, "input"), "utf8"), "committed\n");
      return { exitStatus: 0 };
    } });
    assert.equal(result.exitStatus, 0);
    assert.equal(result.report.head, commit);
    assert.equal(result.report.committedTree, git(root, ["rev-parse", "HEAD^{tree}"]));
    assert.equal(git(root, ["show", ":input"]), "staged");
    assert.equal(readFileSync(resolve(root, "input"), "utf8"), "unstaged\n");
  });

  await check("exact staged snapshot, concurrent edits, private generated output and durable logs", async () => {
    const root = fixture();
    writeFileSync(resolve(root, ".gitattributes"), "input text eol=crlf export-ignore\n");
    git(root, ["add", ".gitattributes"]);
    writeFileSync(resolve(root, "input"), "staged\n"); git(root, ["add", "input"]);
    const tree = git(root, ["write-tree"]);
    writeFileSync(resolve(root, "input"), "unstaged\n");
    writeFileSync(resolve(root, "untracked"), "owner file");
    mkdirSync(resolve(root, "dist")); writeFileSync(resolve(root, "dist/owner"), "owner output");
    let checkout;
    const result = await validateStaged({ cwd: root, validateSnapshot: async (snapshot, reports) => {
      checkout = snapshot;
      assert.equal(readFileSync(resolve(snapshot, "input"), "utf8"), "staged\n");
      assert.equal(existsSync(resolve(snapshot, "untracked")), false);
      assert.equal(existsSync(resolve(snapshot, "dist")), false);
      assert.equal(git(snapshot, ["write-tree"]), tree);
      const running = run(snapshot, reports, [stage("output", `import {mkdirSync,writeFileSync} from 'node:fs';
        mkdirSync('dist'); mkdirSync('.hson'); mkdirSync('node_modules');
        writeFileSync('dist/generated','private'); writeFileSync('.hson/generated','private');
        writeFileSync('ready','ready'); console.log('complete stdout'); console.error('complete stderr');
        setTimeout(()=>{},150);`)]);
      await waitFor(() => existsSync(resolve(snapshot, "ready")));
      writeFileSync(resolve(root, "input"), "concurrent owner edit\n");
      const gate = await running;
      return { exitStatus: gate.exitStatus, gateReport: gate.reportPath };
    } });
    assert.equal(result.exitStatus, 0);
    assert.equal(result.report.candidateTree, tree);
    assert.equal(existsSync(checkout), false);
    assert.equal(readFileSync(resolve(root, "input"), "utf8"), "concurrent owner edit\n");
    assert.equal(readFileSync(resolve(root, "dist/owner"), "utf8"), "owner output");
    assert.equal(existsSync(resolve(root, "dist/generated")), false);
    assert.equal(existsSync(resolve(root, ".hson")), false);
    assert.equal(existsSync(resolve(root, "node_modules")), false);
    const ledger = JSON.parse(readFileSync(result.report.gateReport, "utf8"));
    const log = readFileSync(resolve(result.report.gateReport, "..", ledger.stages[1].log), "utf8");
    assert.match(log, /complete stdout/); assert.match(log, /complete stderr/);
    assert(ledger.endedAt); assert(ledger.stages.every(row => row.status === "passed"));
    assert.equal(git(root, ["write-tree"]), tree);
  });

  await check("independent failures collected; dependencies blocked; later work runs", async () => {
    const root = fixture(), reports = resolve(root, ".git/reports");
    const result = await run(root, reports, [
      stage("build", "process.exit(7)"), stage("independent", "process.exit(9)"),
      stage("dependent", "throw Error('must never run')", { dependsOn: ["build"] }),
      stage("last", "console.log('last ran')"),
    ]);
    assert.notEqual(result.exitStatus, 0);
    assert.deepEqual(result.report.stages.slice(1).map(row => row.status), ["failed", "failed", "blocked", "passed"]);
    assert.deepEqual(result.report.stages[3].blockedBecause, ["build"]);
    const preflight = await run(root, reports, [stage("independent", "process.exit(0)")], {
      preflight() { throw Error("inventory broken"); },
    });
    assert.equal(preflight.report.stages[0].status, "failed");
    assert.equal(preflight.report.stages[1].status, "passed"); assert.notEqual(preflight.exitStatus, 0);
  });

  await check("discovered root-build dependency survives failed inventory validation", async () => {
    const root = fixture();
    const result = await run(root, resolve(root, ".git/reports"), [stage("build", "process.exit(7)"),
      stage("consumer", "throw Error('must never run')"), stage("independent", "process.exit(0)")], {
      preflight: () => ({ commands: { consumer: { prerequisites: ["root build output"] } } }),
      checkInventory() { throw Error("inventory rejected"); },
    });
    assert.equal(result.report.stages[0].status, "failed");
    assert.deepEqual(result.report.stages.slice(1).map(row => row.status), ["failed", "blocked", "passed"]);
  });

  for (const inventoryFails of [false, true]) await check(
    `build-dependent commit stages are blocked when build fails${inventoryFails ? " and inventory cannot load" : ""}`, async () => {
      const calls = [];
      const result = await runAcceptance("commit", { collectAll: true, reportRoot: resolve(temporary, "commit-dependencies"),
        identity: { fixture: true }, preflight() {
          if (inventoryFails) throw Error("inventory could not load");
          return { errors: [] };
        },
        execute(_command, [, name]) { calls.push(name); return { status: name === "build" ? 7 : 0 }; },
      });
      const blocked = ["check:tests", "check:entrypoints", "test:public-entrypoint-runtime"];
      assert.notEqual(result.exitStatus, 0);
      assert.equal(result.report.stages[0].status, inventoryFails ? "failed" : "passed");
      assert.equal(result.report.stages[1].status, "failed");
      assert.deepEqual(result.report.stages.filter(row => row.status === "blocked").map(row => row.name), blocked);
      for (const row of result.report.stages.filter(row => blocked.includes(row.name))) {
        assert.deepEqual(row.blockedBecause, ["build"]);
        assert.equal(row.startedAt, undefined);
      }
      assert.deepEqual(calls, ["build", "check:source", "check:tooling", "check:editor", "test:hson-document", "test:portable-node-ingress"]);
    });

  for (const change of ["index", "HEAD", "branch"]) await check(`${change} changes reject success for the captured candidate`, async () => {
    const root = fixture();
    const result = await validateStaged({ cwd: root, validateSnapshot: async () => {
      if (change === "branch") git(root, ["checkout", "-qb", "other"]);
      else {
        writeFileSync(resolve(root, "input"), "changed\n"); git(root, ["add", "input"]);
        if (change === "HEAD") git(root, ["commit", "-qm", "changed"]);
      }
      return { exitStatus: 0 };
    } });
    assert.equal(result.exitStatus, 1); assert.equal(result.report.candidateUnchanged, false);
    assert.equal(existsSync(result.report.checkout), false);
    assert.match(result.report.error, /candidate or HEAD changed/);
  });

  await check("alternate hook index is captured and children cannot inherit it", async () => {
    const root = fixture(), index = resolve(root, ".git/alternate-index");
    git(root, ["read-tree", "HEAD"], { GIT_INDEX_FILE: index });
    writeFileSync(resolve(root, "input"), "alternate\n");
    git(root, ["add", "input"], { GIT_INDEX_FILE: index });
    const previous = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = index;
    try {
      const result = await validateStaged({ cwd: root, validateSnapshot: async (snapshot, reports) => {
        assert.equal(readFileSync(resolve(snapshot, "input"), "utf8"), "alternate\n");
        return run(snapshot, reports, [stage("clean-environment", `
          import {realpathSync} from 'node:fs';
          if(Object.keys(process.env).some(n=>n.startsWith('GIT_'))) process.exit(5);
          if(realpathSync(process.env.PWD)!==process.cwd() || realpathSync(process.env.INIT_CWD)!==process.cwd()) process.exit(6);`)]);
      } });
      assert.equal(result.exitStatus, 0);
      assert.equal(git(root, ["show", ":input"]), "committed");
    } finally {
      if (previous === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = previous;
    }
  });

  await check("concurrent invocations own separate checkouts and persistent reports", async () => {
    const root = fixture(), runner = resolve(temporary, "concurrent.mjs");
    writeFileSync(runner, `import {validateStaged} from ${JSON.stringify(pathToFileURL(resolve(sourceRoot, "scripts/validate-staged.mjs")).href)};
import {runStages} from ${JSON.stringify(pathToFileURL(resolve(sourceRoot, "scripts/validation-execution.mjs")).href)};
const result=await validateStaged({cwd:${JSON.stringify(root)},validateSnapshot:(snapshot,reports)=>runStages({
root:snapshot,reportRoot:reports,mode:'overlap',identity:{fixture:true},configuration:{},preflight(){},
stages:[${JSON.stringify(stage("overlap", "setTimeout(()=>{},250)"))}]})});process.exitCode=result.exitStatus;`);
    const outputs = ["", ""];
    const children = [0, 1].map(index => {
      const child = spawn(process.execPath, [runner], { env: validationEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { outputs[index] += data; });
      return child;
    });
    const exits = children.map(child => once(child, "exit"));
    try {
      await waitFor(() => children.every(child => child.exitCode !== null || child.signalCode !== null));
      for (const [index, result] of (await Promise.all(exits)).entries()) assert.equal(result[0], 0, outputs[index]);
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await Promise.all(exits);
    }
    const parent = resolve(root, ".git/validation-reports"), folders = readdirSync(parent);
    assert.equal(folders.length, 2);
    const checkouts = new Set();
    for (const folder of folders) {
      const report = JSON.parse(readFileSync(resolve(parent, folder, "candidate.json"), "utf8"));
      checkouts.add(report.checkout);
      assert.equal(report.status, "passed"); assert(existsSync(report.gateReport));
      assert.equal(existsSync(report.checkout), false);
    }
    assert.equal(checkouts.size, 2);
  });

  await check("exceptions fail closed, persist diagnostics and remove checkout", async () => {
    const result = await validateStaged({ cwd: fixture(), validateSnapshot() { throw Error("synthetic exception"); } });
    assert.equal(result.exitStatus, 1); assert.match(result.report.error, /synthetic exception/);
    assert.equal(existsSync(result.report.checkout), false); assert(existsSync(result.reportPath));
  });

  await check("tracked symlinks are rejected before executing candidate commands", async () => {
    const root = fixture();
    const { symlinkSync } = await import("node:fs");
    symlinkSync("/tmp", resolve(root, "escape")); git(root, ["add", "escape"]);
    const result = await validateStaged({ cwd: root, validateSnapshot() { assert.fail("unsafe candidate executed"); } });
    assert.equal(result.exitStatus, 1); assert.match(result.report.error, /symlinks or submodules/);
    assert.equal(existsSync(result.report.checkout), false);
  });

  await check("successful stages reap background descendants before running independent work", async () => {
    if (process.platform === "win32") return;
    const root = fixture(), pidFile = resolve(root, "background.pid");
    let pid;
    try {
      const result = await run(root, resolve(root, ".git/reports"), [stage("background", `
        import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
        const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
        setTimeout(()=>{writeFileSync('background.pid',String(child.pid));process.exit(0)},150);`),
        stage("after-cleanup", "process.exit(0)")]);
      pid = Number(readFileSync(pidFile, "utf8"));
      assert.equal(result.exitStatus, 0);
      assert.equal(result.report.stages[1].cleanup.status, "complete");
      assert.equal(result.report.stages[2].status, "passed");
      assert.equal(alive(pid), false);
    } finally {
      if (!pid && existsSync(pidFile)) pid = Number(readFileSync(pidFile, "utf8"));
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"]) await check(`${signal} interrupts owned descendants, preserves reports and cleans checkout`, async () => {
    if (process.platform === "win32") return;
    const root = fixture(), ready = resolve(root, "ready.json"), script = resolve(temporary, `cancel-${signal}.mjs`);
    writeFileSync(script, `import {validateStaged} from ${JSON.stringify(pathToFileURL(resolve(sourceRoot, "scripts/validate-staged.mjs")).href)};
import {runStages} from ${JSON.stringify(pathToFileURL(resolve(sourceRoot, "scripts/validation-execution.mjs")).href)};
const result=await validateStaged({cwd:${JSON.stringify(root)},validateSnapshot:async(snapshot,reports)=>{
return runStages({root:snapshot,reportRoot:reports,mode:'cancel',identity:{fixture:true},configuration:{},preflight(){},collectAll:true,captureOutput:true,stages:[
${JSON.stringify(stage("wait", `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
const leaf=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
setTimeout(()=>writeFileSync(${JSON.stringify(ready)},JSON.stringify({leader:process.pid,leaf:leaf.pid})),100);
setInterval(()=>{},1000);`))},${JSON.stringify(stage("never", "process.exit(0)"))}]});}});
process.exitCode=result.exitStatus;`);
    const child = spawn(process.execPath, [script], { env: validationEnvironment(), stdio: "ignore" });
    const exited = once(child, "exit");
    let pids;
    try {
      await waitFor(() => existsSync(ready)); pids = JSON.parse(readFileSync(ready, "utf8"));
      child.kill(signal);
      await waitFor(() => child.exitCode !== null || child.signalCode !== null);
      const [status] = await exited; assert.equal(status, signal === "SIGINT" ? 130 : 143);
      await waitFor(() => !alive(pids.leader) && !alive(pids.leaf));
      const parent = resolve(root, ".git/validation-reports"), [folder] = readdirSync(parent);
      const report = JSON.parse(readFileSync(resolve(parent, folder, "candidate.json"), "utf8"));
      assert.equal(report.status, "cancelled"); assert.equal(existsSync(report.checkout), false);
      const ledger = JSON.parse(readFileSync(report.gateReport, "utf8"));
      assert.deepEqual(ledger.stages.slice(1).map(row => row.status), ["cancelled", "skipped"]);
      assert(!ledger.stages.some(row => ["running", "pending"].includes(row.status)));
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (pids) for (const pid of Object.values(pids)) { try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
      await exited;
    }
  });

  await check("required gate stages, original commands and ordinary ordering are preserved", async () => {
    const scripts = JSON.parse(readFileSync(resolve(sourceRoot, "package.json"), "utf8")).scripts;
    const names = gateCommands(scripts, "check");
    assert.deepEqual(names, [...ordinary]);
    const calls = [];
    const result = await runAcceptance("check", { collectAll: true, reportRoot: resolve(temporary, "inventory"),
      identity: { fixture: true }, rootBuildPrerequisites: {}, preflight: () => ({ errors: [] }),
      execute: async (executable, args) => { calls.push([executable, args]); return { status: args[1] === "build" ? 0 : 17 }; } });
    assert.deepEqual(result.report.stages.slice(1).map(row => row.name), names);
    assert.deepEqual(result.report.stages.slice(1).map(row => row.command), names.map(name => scripts[name]));
    assert.deepEqual(calls, names.map(name => ["npm", ["run", name]]));
    assert.equal(result.report.stages[1].status, "passed");
    assert(result.report.stages.slice(2).every(row => row.status === "failed"));
  });
  console.log(JSON.stringify({ validationOrchestration: "passed", checks }));
} finally { rmSync(temporary, { recursive: true, force: true }); }

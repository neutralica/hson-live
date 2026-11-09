import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function git(root, args, env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")))) {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd: root, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.error?.message ?? (result.stderr + result.stdout).trim()}`);
  return result.stdout.trim();
}

export async function runSnapshot(snapshot, reports, cancelled, mode) {
  if (cancelled()) return { exitStatus: 1 };
  const { runStages } = await import(pathToFileURL(resolve(snapshot, "scripts/validation-execution.mjs")).href);
  // Dependency installs are private, independently attempted and fully logged.
  // Never symlink the developer's node_modules or reuse their generated output.
  const setup = await runStages({ root: snapshot, mode: `${mode}-setup`, identity: { snapshot },
    configuration: {}, collectAll: true, captureOutput: true, reportRoot: reports,
    stages: [
      { name: "install-root", command: "npm ci --no-audit --no-fund", executable: "npm", args: ["ci", "--no-audit", "--no-fund"] },
      { name: "install-editor", command: "npm --prefix editors/vscode-hson ci --no-audit --no-fund", executable: "npm", args: ["--prefix", "editors/vscode-hson", "ci", "--no-audit", "--no-fund"] },
    ] });
  if (cancelled() || setup.report.stages.some(row => row.cleanup?.status === "incomplete")) {
    return { exitStatus: setup.exitStatus || 1, setupReport: setup.reportPath };
  }
  const rootReady = setup.report.stages.find(row => row.name === "install-root").status === "passed";
  const editorReady = setup.report.stages.find(row => row.name === "install-editor").status === "passed";
  const collectAll = mode === "commit";
  let gate;
  if (rootReady && (editorReady || collectAll)) {
    const { runAcceptance } = await import(pathToFileURL(resolve(snapshot, "scripts/run-current-acceptance.mjs")).href);
    if (cancelled()) return { exitStatus: 1, setupReport: setup.reportPath };
    gate = await runAcceptance(mode, { collectAll, captureOutput: true, reportRoot: reports,
      blockedStages: editorReady ? {} : { "check:editor": ["install-editor"] } });
  } else {
    const { gateCommands } = await import(pathToFileURL(resolve(snapshot, "scripts/validation-config.mjs")).href);
    if (cancelled()) return { exitStatus: 1, setupReport: setup.reportPath };
    const scripts = JSON.parse(readFileSync(resolve(snapshot, "package.json"), "utf8")).scripts;
    const stages = gateCommands(scripts, mode).map(name => ({ name, command: scripts[name] }));
    const blockedBy = setup.report.stages.filter(row => row.status === "failed").map(row => row.name);
    gate = await runStages({ root: snapshot, mode, identity: { snapshot }, configuration: {},
      reportRoot: reports, stages, blockedStages: Object.fromEntries(stages.map(({ name }) => [name, blockedBy])),
      preflightSkippedBecause: `Dependency setup failed: ${blockedBy.join(", ")}` });
  }
  return { exitStatus: setup.exitStatus || gate.exitStatus, setupReport: setup.reportPath, gateReport: gate.reportPath };
}

// The callback is a module API for short orchestration tests, never a CLI/env
// override that could accidentally weaken the installed hook.
export async function validateStaged({ cwd = process.cwd(), validateSnapshot, expected } = {}) {
  return validateCheckout(cwd, "commit", validateSnapshot, expected);
}

export async function validateCommitted({ cwd = process.cwd(), validateSnapshot = runSnapshot } = {}) {
  return validateCheckout(cwd, "full", validateSnapshot);
}

async function validateCheckout(cwd, mode, validateSnapshot, expected) {
  const staged = mode === "commit";
  const originalEnv = { ...process.env };
  if (originalEnv.GIT_INDEX_FILE) originalEnv.GIT_INDEX_FILE = resolve(cwd, originalEnv.GIT_INDEX_FILE);
  const root = git(cwd, ["rev-parse", "--show-toplevel"], originalEnv);
  const original = args => git(root, args, originalEnv);
  const head = () => original(["rev-parse", "--verify", "HEAD"]);
  const headRef = () => original(["rev-parse", "--symbolic-full-name", "HEAD"]);
  const parent = resolve(original(["rev-parse", "--path-format=absolute", "--git-common-dir"]), "validation-reports");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const reports = mkdtempSync(resolve(parent, `${new Date().toISOString().replaceAll(":", "-")}-`));
  const reportPath = resolve(reports, staged ? "candidate.json" : "certification.json");
  const indexTree = name => {
    const activeIndex = originalEnv.GIT_INDEX_FILE ?? original(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    const index = resolve(reports, `${name}.index`);
    // Git publishes index updates by rename. One read freezes either complete
    // version, without taking the developer's index.lock or updating its cache.
    writeFileSync(index, readFileSync(activeIndex), { mode: 0o600 });
    return git(root, ["-c", "core.splitIndex=false", "write-tree"], { ...originalEnv, GIT_INDEX_FILE: index });
  };
  const report = { schemaVersion: 1, mode, status: "running", startedAt: new Date().toISOString(), root };
  const save = () => {
    writeFileSync(reportPath + ".tmp", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    renameSync(reportPath + ".tmp", reportPath);
  };
  let temporary;
  let cancellation;
  const handlers = new Map(["SIGINT", "SIGTERM"].map(signal => [signal, () => { cancellation ??= signal; }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    save();
    console.log(`${staged ? "Candidate" : "Certification"} report: ${reportPath}`);
    report.head = head();
    let tree;
    if (staged) {
      report.headRef = headRef();
      report.candidateTree = tree = indexTree("candidate");
      if (head() !== report.head || headRef() !== report.headRef) throw new Error("HEAD changed during candidate capture");
      if (expected && (tree !== expected.tree || report.head !== expected.head || report.headRef !== expected.ref)) {
        throw new Error("Staged candidate or HEAD changed after the hook bootstrap; rerun validation");
      }
    } else {
      report.committedTree = tree = original(["rev-parse", `${report.head}^{tree}`]);
      console.log(`Certifying commit ${report.head} (tree ${tree})`);
    }
    save();
    temporary = mkdtempSync(resolve(tmpdir(), "hson-validation-"));
    const snapshot = resolve(temporary, "checkout");
    report.checkout = snapshot; save();
    git(temporary, ["-c", "init.templateDir=", "clone", "--shared", "--no-checkout", "--quiet", "--", root, snapshot]);
    git(snapshot, ["update-ref", "--no-deref", "HEAD", report.head]);
    git(snapshot, ["read-tree", tree]);
    if (staged) git(snapshot, ["diff", "--cached", "--check", "--no-ext-diff", "--no-textconv", report.head, "--"]);
    // A submodule or authored symlink can make files escape checkout isolation.
    // Fail explicitly rather than silently validate an incomplete/aliased tree.
    if (/^(?:120000|160000) /m.test(git(snapshot, ["ls-files", "--stage"]))) throw new Error("Validation checkout does not support tracked symlinks or submodules");
    // Validate repository blobs, without smudge filters, EOL/encoding conversion,
    // or ident expansion changing the bytes the tools will execute.
    mkdirSync(resolve(snapshot, ".git/info"), { recursive: true });
    writeFileSync(resolve(snapshot, ".git/info/attributes"), "* -text -filter -ident -working-tree-encoding\n");
    git(snapshot, ["checkout-index", "--all", "--force", "--index"]);
    git(snapshot, ["diff-files", "--quiet"]);
    if (git(snapshot, ["write-tree"]) !== tree) throw new Error("Validation checkout tree mismatch");
    if (cancellation) throw new Error(`Interrupted: ${cancellation}`);
    // The hook loads the staged coordinator as a single blob. From this point
    // the commit gate and its setup code load from the complete checkout.
    const run = validateSnapshot ?? (await import(pathToFileURL(resolve(snapshot, "scripts/validate-staged.mjs")).href)).runSnapshot;
    const result = await run(snapshot, reports, () => cancellation, mode);
    report.exitStatus = Number.isInteger(result.exitStatus) && result.exitStatus >= 0 ? result.exitStatus : 1;
    report.setupReport = result.setupReport;
    report.gateReport = result.gateReport ?? result.reportPath;
    if (!staged && report.exitStatus === 0) {
      git(snapshot, ["diff", "--exit-code", "--name-only", "--no-ext-diff", "--no-textconv", report.head, "--"]);
      if (git(snapshot, ["rev-parse", "HEAD"]) !== report.head || git(snapshot, ["write-tree"]) !== tree) {
        throw new Error("Certification checkout revision changed during validation");
      }
    }
    report.status = report.exitStatus === 0 ? "passed" : "failed";
  } catch (error) {
    report.status = "failed"; report.error = error.stack ?? error.message; report.exitStatus = 1;
  } finally {
    try {
      if (temporary) rmSync(temporary, { recursive: true, force: true });
      report.checkoutRemoved = true;
    } catch (error) {
      report.cleanupError = error.message; report.status = "failed"; report.exitStatus = 1;
    }
    await new Promise(done => setImmediate(done));
    // Check after removing potentially large dependency trees, as close to hook
    // return as possible. Git offers no lock spanning hook return and commit.
    if (report.candidateTree) {
      try {
        report.finalTree = indexTree("final");
        report.finalHead = head(); report.finalHeadRef = headRef();
        report.candidateUnchanged = report.finalTree === report.candidateTree
          && report.finalHead === report.head && report.finalHeadRef === report.headRef;
        if (!report.candidateUnchanged) throw new Error("Staged candidate or HEAD changed during validation; rerun validation for the new candidate");
      } catch (error) { report.status = "failed"; report.error = error.stack ?? error.message; report.exitStatus = 1; }
    }
    if (cancellation) {
      report.status = "cancelled"; report.cancellationSignal = cancellation;
      report.exitStatus = cancellation === "SIGINT" ? 130 : 143;
    }
    report.endedAt = new Date().toISOString();
    try { save(); }
    finally { for (const [signal, handler] of handlers) process.removeListener(signal, handler); }
  }
  console.log(`${staged ? "Candidate" : "Certification"} ${(staged ? report.candidateTree : report.head) ?? "capture"}: ${report.status}. Report: ${reportPath}`);
  if (report.error) console.error(report.error);
  return { exitStatus: report.exitStatus, report, reportPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.exitCode = (await validateStaged()).exitStatus; }
  catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}

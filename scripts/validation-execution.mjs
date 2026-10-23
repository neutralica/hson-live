import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

const hash = input => createHash("sha256").update(input).digest("hex");
export function sourceIdentity(root) {
  const git = args => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const head = git(["rev-parse", "HEAD"]);
  const listing = git(["ls-files", "-co", "--exclude-standard", "-z"]);
  if (head.status !== 0 || listing.status !== 0) throw new Error("Cannot record validation source identity");
  const digest = createHash("sha256");
  // Contents, not absolute paths or personal Git settings. Include unstaged and
  // untracked inputs. README is human-owned and outside validation configuration.
  for (const file of [...new Set(listing.stdout.split("\0").filter(Boolean))].sort()) {
    if (/(^|\/)README\.md$/.test(file)) continue;
    const path = resolve(root, file);
    digest.update(file + "\0");
    digest.update(existsSync(path) ? readFileSync(path) : "<deleted>");
  }
  const version = name => JSON.parse(readFileSync(resolve(root, `node_modules/${name}/package.json`), "utf8")).version;
  return { recordedAt: new Date().toISOString(), head: head.stdout.trim(), sourceSha256: digest.digest("hex"), node: process.version,
    platform: process.platform, architecture: process.arch, typescript: version("typescript"), tsx: version("tsx"), esbuild: version("esbuild"),
    npm: spawnSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).stdout?.trim() };
}

// Process-level wall durations only. No per-test or CPU-time claims are made.
// Existing command output is inherited and exit semantics stay with the caller.
export async function runStages({ root, mode, stages, preflight, configuration, identity = sourceIdentity(root), execute }) {
  const parent = resolve(root, "tmp/validation-timing");
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(resolve(parent, `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}-`));
  const eventFile = resolve(folder, "events.jsonl");
  writeFileSync(eventFile, "");
  const reportPath = resolve(folder, "report.json");
  const report = { schemaVersion: 1, mode, clock: "wall (monotonic durations; UTC timestamps)", identity,
    configuration, configurationSha256: hash(JSON.stringify(configuration)), startedAt: new Date().toISOString(),
    stages: [{ name: "inventory-preflight", status: "pending" }, ...stages.map(stage => ({ name: stage.name, command: stage.command, status: "pending" }))],
    nestedObservation: "Node preload observes child_process calls and Node process lifetimes. Non-Node descendants and explicitly replaced environments may be unobservable; missing end events remain incomplete.",
    cancellationPolicy: process.platform === "win32" ? "Terminate and reap the direct child; descendant cleanup is incomplete on Windows."
      : "Each stage owns a new process group. On cancellation, timeout or abnormal exit send SIGTERM, then SIGKILL after 1000 ms, only to that group; reap the direct child.",
    rootBuildInvocations: 0 };
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  save();
  const runStart = performance.now();
  let stoppedBy = null;
  let exitStatus = 0;
  const observe = pathToFileURL(resolve(import.meta.dirname, "validation-observer.mjs")).href;
  let cancellation = null;
  let active = null;
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      cancellation ??= signal;
      active?.stop();
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  function launch(executable, args, options) {
    return new Promise(resolveResult => {
      // A private POSIX group also contains npm's shell and its children. Never
      // enumerate or signal unrelated processes, or the runner's own group.
      const grouped = process.platform !== "win32";
      const { timeout, ...spawnOptions } = options;
      const child = spawn(executable, args, { ...spawnOptions, detached: grouped });
      let error;
      let deadline;
      let escalation;
      let escalationDone;
      let stopping = false;
      let cleanupError;
      const signal = name => {
        try {
          if (grouped && child.pid) process.kill(-child.pid, name);
          else child.kill(name);
        } catch (failure) { if (failure.code !== "ESRCH") cleanupError ??= failure; }
      };
      const stop = () => {
        if (stopping) return;
        stopping = true;
        signal("SIGTERM");
        // Keep this timer even if the group leader exits first: its descendants
        // may still hold the group and ignore SIGTERM.
        escalationDone = new Promise(done => {
          escalation = setTimeout(() => { signal("SIGKILL"); done(); }, 1000);
        });
      };
      active = { stop };
      if (timeout) deadline = setTimeout(() => { error = new Error("Stage timed out"); stop(); }, timeout);
      child.once("error", failure => { error ??= failure; if (child.pid) stop(); });
      // 'exit' reaps the leader before 'close'. Descendants may still own stdio
      // or the group, so begin cleanup here and finish it before the next stage.
      child.once("exit", (status, childSignal) => { if (status !== 0 || childSignal) stop(); });
      child.once("close", async (status, childSignal) => {
        clearTimeout(deadline);
        if (child.pid && (status !== 0 || childSignal || error)) stop();
        if (stopping) await escalationDone;
        clearTimeout(escalation);
        // kill() only queues a signal. Do not release the stage while the owned
        // group still exists; the OS may not have scheduled/reaped its members.
        if (stopping && grouped && child.pid) {
          const until = performance.now() + 1000;
          let groupError;
          while (true) {
            try { process.kill(-child.pid, 0); }
            catch (failure) {
              if (failure.code === "ESRCH") break;
              // Darwin can report EPERM during reaping. It is not evidence of
              // absence: retry within the bound, then report incomplete cleanup.
              groupError = failure;
            }
            if (performance.now() >= until) {
              cleanupError ??= groupError ?? new Error("Owned process group remains after SIGKILL");
              break;
            }
            await new Promise(done => setTimeout(done, 10));
          }
        }
        active = null;
        resolveResult({ status, signal: childSignal, error,
          ...(stopping ? { cleanup: { scope: grouped ? "owned-process-group" : "direct-child",
            status: cleanupError ? "incomplete" : grouped ? "complete" : "descendants-unverified",
            ...(cleanupError ? { error: cleanupError.message } : {}) } } : {}) });
      });
      if (cancellation) stop();
    });
  }
  async function timed(row, run) {
    row.startedAt = new Date().toISOString(); row.status = "running"; save();
    const begin = performance.now();
    try {
      const result = await run();
      row.exitStatus = result.status; row.signal = result.signal ?? null;
      if (result.error) row.error = result.error.message;
      if (result.cleanup) row.cleanup = result.cleanup;
      row.status = cancellation ? "cancelled" : result.status === 0 && !result.signal && !result.error ? "passed" : "failed";
    } catch (error) { row.status = "failed"; row.exitStatus = 1; row.error = error.message; }
    row.endedAt = new Date().toISOString(); row.wallMs = performance.now() - begin;
    save();
    return row.status === "passed";
  }
  try {
    if (!await timed(report.stages[0], () => {
      const inventory = preflight();
      if (inventory) {
        const contents = JSON.stringify(inventory, null, 2) + "\n";
        const inventoryPath = resolve(folder, "inventory.json");
        writeFileSync(inventoryPath, contents);
        report.inventory = { path: relative(root, inventoryPath), sha256: hash(contents) };
      }
      return { status: 0 };
    })) {
      stoppedBy = "inventory-preflight"; exitStatus = 1;
      console.error(report.stages[0].error);
    }
    for (const [index, stage] of stages.entries()) {
      const row = report.stages[index + 1];
      // Yield between stages so pending signals are handled before another launch.
      await new Promise(done => setImmediate(done));
      if (cancellation) { stoppedBy = `cancelled: ${cancellation}`; exitStatus = cancellation === "SIGINT" ? 130 : 143; }
      if (stoppedBy) { row.status = "skipped"; row.skippedBecause = stoppedBy; save(); continue; }
      console.log(`[${index + 1}/${stages.length}] ${stage.name}`);
      const passed = await timed(row, () => (execute ?? launch)(stage.executable ?? "npm", stage.args ?? ["run", stage.name], {
        cwd: root, stdio: "inherit", ...(stage.timeout ? { timeout: stage.timeout } : {}),
        env: { ...process.env, HSON_VALIDATION_EVENTS: eventFile, HSON_VALIDATION_ROOT: root, HSON_VALIDATION_STAGE: stage.name,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${observe}`.trim() },
      }));
      if (!passed) {
        exitStatus = row.exitStatus || 1;
        if (!stage.continueOnFailure || row.cleanup?.status === "incomplete") stoppedBy = stage.name;
      }
    }
    const events = [];
    for (const line of readFileSync(eventFile, "utf8").split("\n").filter(Boolean)) {
      try { events.push(JSON.parse(line)); }
      catch { report.observationIncomplete = true; exitStatus ||= 1; }
    }
    report.rootBuildInvocations = events.filter(event => event.type === "process-start" && event.rootBuild).length;
    if (cancellation) exitStatus = cancellation === "SIGINT" ? 130 : 143;
    report.status = cancellation ? "cancelled" : exitStatus === 0 ? "passed" : "failed";
    if (cancellation) report.cancellationSignal = cancellation;
    report.endedAt = new Date().toISOString(); report.wallMs = performance.now() - runStart; report.exitStatus = exitStatus;
    report.events = relative(root, eventFile);
    report.nestedCommands = events.filter(event => event.type === "command-start").length;
    save();
    console.log(`Validation report: ${relative(root, reportPath)} (${report.rootBuildInvocations} root build invocations)`);
    return { exitStatus, report, reportPath, eventFile };
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

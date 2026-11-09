import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { assertRootBuildPublication } from "./validation-build-publication.mjs";

const hash = input => createHash("sha256").update(input).digest("hex");
// Hook-local Git variables (especially GIT_INDEX_FILE) must never redirect a
// validation child back into the developer's checkout.
export function validationEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !name.startsWith("GIT_") && !/^npm_config_(?:prefix|local_prefix|workspace|workspaces)$/i.test(name)));
  // npm run prepends the caller's dependency binaries. The isolated npm
  // processes add their own paths, so remove the paths from the outer checkout.
  const inheritedBins = new Set();
  for (let dir = process.env.npm_config_local_prefix; dir; dir = dirname(dir)) {
    inheritedBins.add(resolve(dir, "node_modules/.bin"));
    if (dirname(dir) === dir) break;
  }
  if (env.PATH && inheritedBins.size) env.PATH = env.PATH.split(delimiter).filter(dir => !inheritedBins.has(dir)).join(delimiter);
  return env;
}
export function sourceIdentity(root) {
  const git = args => spawnSync("git", args, { cwd: root, encoding: "utf8", env: validationEnvironment() });
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

// Capture both complete output trees, including file membership and replacement
// metadata. Equal bytes rewritten by another writer are still a conflict. This
// digest is an invocation-local guard, never a saved success/reuse permission.
function rootBuildArtifacts(root) {
  for (const path of ["dist/index.js", "dist/index.d.ts", "dist/hson-schema.mjs",
    ".hson/compiler-input/tsconfig.json/tsconfig.json", ".hson/compiler-input/tsconfig.json/manifest.json"]) {
    if (!existsSync(resolve(root, path))) throw new Error(`Missing root build prerequisite artifact: ${path}`);
  }
  const digest = createHash("sha256");
  const metadata = stat => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  function visit(path) {
    const file = resolve(root, path);
    const before = lstatSync(file, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory() && !before.isFile()) throw new Error(`Unsafe root build artifact: ${path}`);
    if (path.endsWith("/.publishing.json")) throw new Error("Root build publication is incomplete");
    digest.update(path + "\0" + metadata(before) + "\0");
    if (before.isDirectory()) for (const name of readdirSync(file).sort()) visit(`${path}/${name}`);
    else digest.update(readFileSync(file));
    if (metadata(before) !== metadata(lstatSync(file, { bigint: true }))) throw new Error(`Root build artifact changed during capture: ${path}`);
  }
  visit("dist"); visit(".hson/compiler-input/tsconfig.json");
  return digest.digest("hex");
}

// Process-level wall durations only. No per-test or CPU-time claims are made.
// Output can be inherited or captured in full; exit semantics stay with the caller.
export async function runStages({ root, mode, stages, preflight, checkInventory, preflightSkippedBecause = "Not applicable to setup", configuration, identify = () => sourceIdentity(root), identity = identify(), execute,
  rootBuildPrerequisites = {}, collectAll = false, reportRoot, captureOutput = false, blockedStages = {} }) {
  const parent = reportRoot ?? resolve(root, "tmp/validation-timing");
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(resolve(parent, `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}-`));
  const eventFile = resolve(folder, "events.jsonl");
  const publicationFile = resolve(folder, "root-build-publication.jsonl");
  writeFileSync(eventFile, "");
  const reportPath = resolve(folder, "report.json");
  const report = { schemaVersion: 1, mode, clock: "wall (monotonic durations; UTC timestamps)", identity,
    configuration, configurationSha256: hash(JSON.stringify(configuration)), startedAt: new Date().toISOString(),
    stages: [{ name: "inventory-preflight", status: "pending" }, ...stages.map(stage => ({ name: stage.name, command: stage.command, status: "pending" }))],
    nestedObservation: "Node preload observes child_process calls and Node process lifetimes. Non-Node descendants and explicitly replaced environments may be unobservable; missing end events remain incomplete.",
    cancellationPolicy: process.platform === "win32" ? "Terminate and reap the direct child; descendant cleanup is incomplete on Windows."
      : "Each stage owns a new process group. On cancellation, timeout, abnormal exit or surviving descendants send SIGTERM, then SIGKILL after 1000 ms, only to that group; reap the direct child.",
    rootBuildInvocations: 0, rootBuildReuses: 0 };
  const save = () => {
    writeFileSync(reportPath + ".tmp", JSON.stringify(report, null, 2) + "\n");
    renameSync(reportPath + ".tmp", reportPath);
  };
  save();
  const runStart = performance.now();
  let stoppedBy = null;
  let exitStatus = 0;
  let inventory;
  let typeOnlySuites;
  const events = [];
  const eventsByStage = new Map();
  let eventOffset = 0;
  const collectEvents = () => {
    const contents = readFileSync(eventFile, "utf8");
    for (const line of contents.slice(eventOffset).split("\n").filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (!eventsByStage.has(event.stage)) eventsByStage.set(event.stage, []);
        eventsByStage.get(event.stage).push(event);
        events.push(event);
      }
      catch { report.observationIncomplete = true; exitStatus ||= 1; }
    }
    eventOffset = contents.length;
  };
  const caseCompletionFor = (name, processId) => {
    const stageEvents = eventsByStage.get(name) ?? [];
    const registration = inventory?.commands?.[name];
    const registeredEntrypoints = new Set(registration?.suites?.filter(path => !typeOnlySuites.has(path))
      .map(path => `<repo>/${path.split(sep).join("/")}`));
    const processThread = event => `${event.pid}:${event.threadId}`;
    const registeredReporters = new Set(stageEvents.filter(event =>
      event.type === "process-start" && registeredEntrypoints.has(event.entrypoint?.split(sep).join("/"))).map(processThread));
    // Descendants share the observation stream. Only the stage leader and
    // processes or threads executing a registered entrypoint count as results.
    const reportsResult = event => event.pid === processId && event.threadId === 0
      || registeredReporters.has(processThread(event));
    const starts = stageEvents.filter(event => event.type === "suite-start" && reportsResult(event));
    const ends = stageEvents.filter(event => event.type === "suite-end" && reportsResult(event));
    // terminal() requires completed cases, no active cases, and a consistent
    // status. Another suite/process/thread cannot complete this emitter.
    const sameEmitter = (start, end) => start.id === end.id && start.pid === end.pid && start.threadId === end.threadId;
    const incomplete = starts.some(start => ends.filter(end => sameEmitter(start, end)).length !== 1)
      || ends.some(end => !starts.some(start => sameEmitter(start, end)))
      || Boolean(registration?.caseReporting && starts.length === 0);
    const failed = ends.some(end => !["pass", "skip", "unsupported"].includes(end.status));
    const suites = starts.map(start => {
      const emitted = stageEvents.filter(event => sameEmitter(start, event));
      const begun = emitted.filter(event => event.type === "case-start");
      const finished = new Map(emitted.filter(event => event.type === "case-end").map(event => [event.caseId, event.status]));
      const reached = new Set(begun.map(event => event.caseId));
      return { suiteId: start.suiteId, pid: start.pid, threadId: start.threadId, emitterId: start.id,
        status: emitted.find(event => event.type === "suite-end")?.status ?? "aborted",
        casesStarted: begun.length, casesCompleted: finished.size,
        unfinished: begun.filter(event => !finished.has(event.caseId)).map(event => event.caseId),
        failedCases: [...finished].filter(([, status]) => ["fail", "error", "cancelled"].includes(status))
          .map(([caseId, status]) => ({ caseId, status })),
        notReached: start.plannedCases?.filter(caseId => !reached.has(caseId)) ?? null };
    });
    return { status: incomplete ? "incomplete" : failed ? "failed" : starts.length ? "passed" : "not-required",
      suitesStarted: starts.length, suitesCompleted: ends.length, suites };
  };
  function classifyFailure(row) {
    if (row.name === "inventory-preflight") return "inventory";
    if (row.error || row.signal || row.cleanup?.status === "incomplete"
      || row.name.startsWith("install-")) return "environment-or-setup";
    if (row.caseCompletion?.suites.some(suite => ["fail", "error"].includes(suite.status)
      && suite.failedCases.some(test => test.status === "fail"))) return "assertion";
    // A monitor event describes the process that emitted it. A descendant's
    // failure can be handled by its parent, even if their exit codes match.
    const fatal = row.exitStatus === 1 && (eventsByStage.get(row.name) ?? []).find(event =>
      event.type === "uncaught-error" && event.pid === row.processId && event.threadId === 0 && event.fatalByDefault);
    if (fatal) return fatal.kind;
    if (row.exitStatus === 0 && row.caseCompletion?.status === "incomplete") return "incomplete-suite";
    return "unclassified-process";
  }
  let rootBuild = null;
  const reuseEnabled = stages.some(stage => Object.hasOwn(rootBuildPrerequisites, stage.name));
  const identityHash = value => {
    const { recordedAt, ...current } = value;
    return hash(JSON.stringify(current));
  };
  const inputIdentity = () => identityHash(identify());
  function assertRootBuild() {
    if (!rootBuild) throw new Error("Missing successful root build prerequisite in this validation invocation");
    if (inputIdentity() !== rootBuild.inputs) throw new Error("Root build prerequisite is stale: source, configuration or tooling changed");
    if (rootBuildArtifacts(root) !== rootBuild.artifacts) throw new Error("Root build prerequisite artifacts changed: conflicting writer");
    // The existing verifier also replays compiler dependency reads, failed
    // lookups and glob membership, including inputs ignored by Git.
    rootBuild.verify(resolve(root, "tsconfig.json"));
  }
  const observe = pathToFileURL(resolve(import.meta.dirname, "validation-observer.mjs")).href;
  const observePublication = pathToFileURL(resolve(import.meta.dirname, "validation-build-publication.mjs")).href;
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
      child.once("exit", (status, childSignal) => {
        if (status !== 0 || childSignal) stop();
        else if (grouped && child.pid) {
          // Successful shells can also leave background writers behind.
          try { process.kill(-child.pid, 0); stop(); }
          catch (failure) { if (failure.code !== "ESRCH") { cleanupError ??= failure; stop(); } }
        }
      });
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
        resolveResult({ status, signal: childSignal, error, processId: child.pid,
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
      if (result.processId !== undefined) row.processId = result.processId;
      if (result.error) row.error = result.error.message;
      if (result.cleanup) row.cleanup = result.cleanup;
      row.status = cancellation ? "cancelled" : result.status === 0 && !result.signal && !result.error && result.cleanup?.status !== "incomplete"
        && !["failed", "incomplete"].includes(row.caseCompletion?.status) ? "passed" : "failed";
    } catch (error) { row.status = "failed"; row.exitStatus = 1; row.error = error.message; }
    row.endedAt = new Date().toISOString(); row.wallMs = performance.now() - begin;
    save();
    return row.status === "passed";
  }
  try {
    if (!preflight) {
      Object.assign(report.stages[0], { status: "skipped", skippedBecause: preflightSkippedBecause });
      save();
    } else if (!await timed(report.stages[0], async () => {
      inventory = await preflight();
      if (inventory) {
        typeOnlySuites = new Set(inventory.suites?.filter(suite => suite.context === "typescript-project").map(suite => suite.identity));
        const contents = JSON.stringify(inventory, null, 2) + "\n";
        const inventoryPath = resolve(folder, "inventory.json");
        writeFileSync(inventoryPath, contents);
        report.inventory = { path: relative(reportRoot ? folder : root, inventoryPath), sha256: hash(contents) };
      }
      checkInventory?.(inventory);
      return { status: 0 };
    })) {
      if (!collectAll) stoppedBy = "inventory-preflight";
      exitStatus = 1;
      console.error(report.stages[0].error);
    }
    for (const [index, stage] of stages.entries()) {
      const row = report.stages[index + 1];
      // Yield between stages so pending signals are handled before another launch.
      await new Promise(done => setImmediate(done));
      if (cancellation) { stoppedBy = `cancelled: ${cancellation}`; exitStatus = cancellation === "SIGINT" ? 130 : 143; }
      if (stoppedBy) { row.status = "skipped"; row.skippedBecause = stoppedBy; save(); continue; }
      const dependencies = [...(stage.dependsOn ?? [])];
      if (collectAll && stage.name !== "build" && (Object.hasOwn(rootBuildPrerequisites, stage.name)
        || inventory?.commands?.[stage.name]?.prerequisites?.includes("root build output"))) dependencies.push("build");
      row.dependsOn = [...new Set(dependencies)];
      const blocked = row.dependsOn.filter(name => report.stages.find(prior => prior.name === name)?.status !== "passed");
      if (Object.hasOwn(blockedStages, stage.name) || blocked.length) {
        row.status = "blocked"; row.blockedBecause = Object.hasOwn(blockedStages, stage.name) ? blockedStages[stage.name] : blocked;
        exitStatus ||= 1; save(); continue;
      }
      console.log(`[${index + 1}/${stages.length}] ${stage.name}`);
      const passed = await timed(row, async () => {
        let executable = stage.executable ?? "npm", args = stage.args ?? ["run", stage.name];
        const body = Object.hasOwn(rootBuildPrerequisites, stage.name) ? rootBuildPrerequisites[stage.name] : undefined;
        const building = reuseEnabled && stage.name === "build";
        let inputs;
        if (building) {
          rootBuild = null;
          if (stage.executable || stage.args) throw new Error("Root build prerequisite requires the registered npm build");
          inputs = inputIdentity();
          if (inputs !== identityHash(identity)) throw new Error("Root build prerequisite inputs changed since validation started");
          writeFileSync(publicationFile, "");
        }
        if (body) {
          if (stage.command !== `npm run build && ${body}` || stage.executable || stage.args
            || !/^node --import=tsx tests\/[\w-]+\.acceptance\.mts$/.test(body)) throw new Error(`Root build prerequisite wrapper changed: ${stage.name}`);
          assertRootBuild();
          executable = process.execPath; args = body.split(" ").slice(1);
          row.executedCommand = body;
          row.rootBuildPrerequisite = { stage: "build", inputsSha256: rootBuild.inputs, artifactsSha256: rootBuild.artifacts };
        }
        let log;
        let result;
        try {
          if (captureOutput) {
            row.log = `${index + 1}.log`;
            log = openSync(resolve(folder, row.log), "w", 0o600);
            save();
          }
          result = await (execute ?? launch)(executable, args, {
            cwd: root, stdio: log === undefined ? "inherit" : ["ignore", log, log], ...(stage.timeout ? { timeout: stage.timeout } : {}),
            env: { ...validationEnvironment(), PWD: root, INIT_CWD: root,
              HSON_VALIDATION_EVENTS: eventFile, HSON_VALIDATION_ROOT: root, HSON_VALIDATION_STAGE: stage.name,
              HSON_VALIDATION_BUILD_PUBLICATION: building ? publicationFile : "",
              NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${observe}${building ? ` --import=${observePublication}` : ""}`.trim() },
          });
        } finally { if (log !== undefined) closeSync(log); }
        collectEvents();
        row.caseCompletion = caseCompletionFor(stage.name, result.processId);
        if (result.status === 0 && !result.signal && !result.error && !cancellation) {
          if (building) {
            const artifacts = rootBuildArtifacts(root);
            // Independent producer evidence must agree with disk before this
            // snapshot can authorize reuse. assertRootBuild below then fences
            // changes between the snapshot, evidence check and admission.
            assertRootBuildPublication(root, publicationFile);
            if (inputIdentity() !== inputs) throw new Error("Root build prerequisite inputs changed during build");
            const { verify_schema_compiler_project: verify } = await import(pathToFileURL(resolve(root, "dist/internal/hson-schema/compiler-project-watch.js")).href);
            rootBuild = { inputs, artifacts, verify };
            assertRootBuild();
          }
          if (body) { assertRootBuild(); report.rootBuildReuses++; }
        }
        return result;
      });
      if (!passed) {
        if (!collectAll || stage.name === "build") rootBuild = null;
        exitStatus = row.exitStatus || 1;
        if ((!collectAll && !stage.continueOnFailure) || row.cleanup?.status === "incomplete") stoppedBy = stage.name;
      }
    }
    collectEvents();
    // Include late observable evidence from descendants without extending their
    // lifetime or changing process ownership. Earlier failures stay failures.
    for (const row of report.stages.slice(1).filter(row => row.caseCompletion)) {
      row.caseCompletion = caseCompletionFor(row.name, row.processId);
      if (row.status === "passed" && ["failed", "incomplete"].includes(row.caseCompletion.status)) {
        row.status = "failed"; exitStatus ||= 1;
      }
    }
    for (const row of report.stages.filter(row => row.status === "failed")) row.failureKind = classifyFailure(row);
    report.stageCounts = Object.fromEntries(["passed", "failed", "skipped", "blocked", "cancelled"]
      .map(status => [status, report.stages.filter(row => row.status === status).length]));
    report.rootBuildInvocations = events.filter(event => event.type === "process-start" && event.rootBuild).length;
    if (cancellation) exitStatus = cancellation === "SIGINT" ? 130 : 143;
    report.status = cancellation ? "cancelled" : exitStatus === 0 ? "passed" : "failed";
    if (cancellation) report.cancellationSignal = cancellation;
    report.endedAt = new Date().toISOString(); report.wallMs = performance.now() - runStart; report.exitStatus = exitStatus;
    report.events = relative(reportRoot ? folder : root, eventFile);
    report.nestedCommands = events.filter(event => event.type === "command-start").length;
    save();
    console.log(`Validation report: ${relative(root, reportPath)} (${report.rootBuildInvocations} root build invocations)`);
    return { exitStatus, report, reportPath, eventFile };
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

import assert from "node:assert/strict";
import Module from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type * as vscode from "vscode";
import { hson_status_presentation } from "../src/hson-status.js";
import type { LocalHostState } from "../src/local-host-controller.js";
import { ManualSaveTracker } from "../src/manual-save.js";

async function main(): Promise<void> {
  const tracker = new ManualSaveTracker();
  assert.equal(tracker.formattingAllowed("one"), true);
  tracker.willSave("one", false); assert.equal(tracker.formattingAllowed("one"), false); assert.equal(tracker.didSave("one"), false);
  assert.equal(tracker.formattingAllowed("one"), true);
  tracker.willSave("one", true); assert.equal(tracker.formattingAllowed("one"), true); assert.equal(tracker.didSave("one"), true);
  assert.equal(tracker.didSave("one"), false);
  tracker.willSave("one", true); tracker.willSave("one", false); assert.equal(tracker.didSave("one"), false);
  const temporary = resolve(__dirname, "../../../tmp");
  mkdirSync(temporary, { recursive: true });
  const root = mkdtempSync(join(temporary, "hson-save-recovery-"));
  mkdirSync(join(root, "dist")); mkdirSync(join(root, "src")); mkdirSync(join(root, "node_modules"));
  symlinkSync(resolve(__dirname, "../../.."), join(root, "node_modules", "hson-live"), "dir");
  const uri = (path: string): vscode.Uri => ({ scheme: "file", fsPath: path, path, toString: () => `file://${path}` }) as vscode.Uri;
  const folder: vscode.WorkspaceFolder = { uri: uri(root), name: "recovery", index: 0 };
  const document = { uri: uri(join(root, "src/app.ts")) } as vscode.TextDocument;
  const app = join(root, "dist/app.mjs");
  const valid = 'export const application = { name: "recovery", requests: [], dispose() {} };';
  const invalid = 'import { Hson } from "hson-live"; const S = Hson.schema`<type "document" tag "html" content <sequence «<tag "head">, <tag "body">»>>`; S.certify(Hson.document`<html <body/>/>`);';
  writeFileSync(app, valid);
  const states: LocalHostState[] = [], notifications: string[] = [], information: string[] = [], warnings: string[] = [], output: string[] = [];
  const contexts = new Map<string, unknown>();
  const folders = [folder];
  const configurations = new Map<string, Record<string, unknown>>();
  let activeDocument = document;
  let outputOpened = 0;
  const opened: string[] = [];
  let willSave: (event: vscode.TextDocumentWillSaveEvent) => void = () => undefined;
  let didSave: (document: vscode.TextDocument) => void = () => undefined;
  let changedFolders: (event: vscode.WorkspaceFoldersChangeEvent) => void = () => undefined;
  const disposable = { dispose() {} };
  let buildFails = false;
  let buildDelay = 0;
  let buildCommand: string | undefined;
  let buildCommandReads = 0;
  const settings: Record<string, unknown> = { entry: "dist/app.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0, restartOnSave: true, sourceDirectory: "src" };
  const api = {
    TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
    workspace: {
      isTrusted: true, workspaceFolders: folders, getWorkspaceFolder: (uri: vscode.Uri) => folders.find(item => uri.fsPath === item.uri.fsPath || uri.fsPath.startsWith(item.uri.fsPath + "/")),
      getConfiguration: (_section: string, resource: vscode.Uri) => ({ get: (key: string, fallback: unknown) => {
        const configured = configurations.get(resource.toString());
        if (configured !== undefined) return configured[key] ?? fallback;
        if (key !== "buildCommand") return settings[key] ?? fallback;
        buildCommandReads++;
        return buildCommand ?? `"${process.execPath}" -e "setTimeout(()=>process.exit(${buildFails ? 1 : 0}),${buildDelay})"`;
      } }),
      onWillSaveTextDocument: (listener: typeof willSave) => { willSave = listener; return disposable; },
      onDidSaveTextDocument: (listener: typeof didSave) => { didSave = listener; return disposable; },
      onDidCloseTextDocument: () => disposable, onDidChangeConfiguration: () => disposable,
      onDidChangeWorkspaceFolders: (listener: typeof changedFolders) => { changedFolders = listener; return disposable; },
    },
    window: {
      get activeTextEditor() { return { document: activeDocument }; },
      onDidChangeActiveTextEditor: () => disposable,
      createOutputChannel: () => ({ append: (text: string) => output.push(text), appendLine: (text: string) => output.push(text), show: () => { outputOpened++; }, dispose() {} }),
      showErrorMessage: async (message: string) => { notifications.push(message); return undefined; },
      showInformationMessage: async (message: string) => { information.push(message); return undefined; },
      showWarningMessage: async (message: string) => { warnings.push(message); return undefined; },
    },
    commands: { registerCommand: () => disposable, executeCommand: async (_command: string, key: string, value: unknown) => { contexts.set(key, value); } },
    env: { openExternal: async (target: vscode.Uri) => { opened.push(target.toString()); return true; } },
    Uri: { parse: (value: string) => ({ toString: () => value }) },
  };
  const load = Reflect.get(Module, "_load");
  Reflect.set(Module, "_load", function (this: unknown, request: string, ...args: unknown[]) {
    return request === "vscode" ? api : Reflect.apply(load, this, [request, ...args]);
  });
  const { LocalHostExtensionManager } = await import("../src/local-host-extension.js");
  Reflect.set(Module, "_load", load);
  const context = { subscriptions: [], asAbsolutePath: (path: string) => join(resolve(__dirname, ".."), path) } as unknown as vscode.ExtensionContext;
  const manager = new LocalHostExtensionManager(context, state => states.push(state));
  const save = (reason: number): void => {
    willSave({ document, reason } as vscode.TextDocumentWillSaveEvent);
    didSave(document);
  };
  const waitFor = async (predicate: () => boolean): Promise<void> => {
    const deadline = Date.now() + 15_000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, `Timed out: ${states.join(", ")}\n${output.join("\n")}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
  };
  try {
    // The build snapshots source before an explicit filesystem barrier. The
    // actual runner must serve the latest revision after the barrier opens.
    const builder = join(root, "build.mjs");
    writeFileSync(builder, `import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
const revision = readFileSync("src/app.ts", "utf8");
if (revision.startsWith("cancel")) process.on("SIGTERM", () => setTimeout(() => process.exit(1), 200));
writeFileSync("build-pid.txt", String(process.pid));
appendFileSync("builds.txt", "start " + revision + "\\n");
writeFileSync("started.txt", revision);
while (!existsSync("release.txt") && !existsSync("release-" + revision + ".txt")) await new Promise(resolve => setTimeout(resolve, 10));
if (revision.includes("FAIL")) process.exit(1);
writeFileSync("dist/app.mjs", 'export const application = { name: "revision-" + ' + JSON.stringify(revision) + ', requests: [{ method: "GET", path: "/revision", handle() { return new Response(' + JSON.stringify(revision) + '); } }], dispose() {} };');
appendFileSync("builds.txt", "finish " + revision + "\\n");`);
    buildCommand = `"${process.execPath}" "${builder}"`;
    for (const revisions of [["A", "B"], ["A2", "B2", "C2"]]) {
      rmSync(join(root, "release.txt"), { force: true });
      rmSync(join(root, "started.txt"), { force: true });
      writeFileSync(join(root, "builds.txt"), "");
      writeFileSync(document.uri.fsPath, revisions[0]!);
      const initialReads = buildCommandReads;
      const initialStart = manager.start(folder.uri);
      await waitFor(() => { try { return readFileSync(join(root, "started.txt"), "utf8") === revisions[0]; } catch { return false; } });
      writeFileSync(document.uri.fsPath, revisions[1]!); save(1);
      await waitFor(() => buildCommandReads >= initialReads + 2);
      for (const revision of revisions.slice(2)) { writeFileSync(document.uri.fsPath, revision); save(1); }
      writeFileSync(join(root, "release.txt"), "release");
      assert.equal(await initialStart, false, "Superseded initial build must not start");
      await waitFor(() => states.at(-1) === "running");
      assert.ok(manager.currentUrl);
      const response = await fetch(new URL("/revision", manager.currentUrl));
      assert.equal(await response.text(), revisions.at(-1), "The running controller must serve the newest saved revision");
      assert.deepEqual(readFileSync(join(root, "builds.txt"), "utf8").trim().split("\n"), [`start ${revisions[0]}`, `finish ${revisions[0]}`, `start ${revisions.at(-1)}`, `finish ${revisions.at(-1)}`], "Serialize and coalesce builds to the newest pending revision");
      await manager.stop(folder.uri);
    }
    buildCommand = undefined;
    writeFileSync(app, valid);
    assert.equal(await manager.start(folder.uri), true);
    assert.equal(states.at(-1), "running");
    const beforeAutoSave = output.length;
    writeFileSync(app, invalid);
    save(2); save(3);
    await new Promise(resolveWait => setTimeout(resolveWait, 400));
    assert.equal(output.length, beforeAutoSave, "Auto-save must not build/restart");
    assert.equal(states.at(-1), "running");
    save(1);
    await waitFor(() => notifications.length === 1 && states.at(-1) === "failed");
    assert.ok(hson_status_presentation("watching", states.at(-1)!).error);
    assert.match(output.join("\n"), /HsonSchemaError[\s\S]*at HsonSchema\.certify/);
    assert.ok(notifications.every(message => !message.includes("\n") && !message.includes("at HsonSchema") && message.length < 340));
    assert.equal(outputOpened, 0, "Transient failure must not open Output");
    const failedPosition = states.length;
    writeFileSync(app, valid);
    save(1);
    await waitFor(() => states.slice(failedPosition).includes("starting") && states.at(-1) === "running");
    assert.equal(hson_status_presentation("watching", states.at(-1)!).error, false);
    // Failed build keeps the old runner but marks latest source invalid; next save recovers.
    buildFails = true; save(1);
    await waitFor(() => notifications.length === 2 && states.at(-1) === "failed");
    assert.ok(manager.currentUrl);
    buildFails = false; const buildFailurePosition = states.length; save(1);
    await waitFor(() => states.slice(buildFailurePosition).includes("starting") && states.at(-1) === "running");
    // A newer manual save during a failing build must not be consumed by that failure.
    buildFails = true; buildDelay = 650;
    const queuedOutput = output.length, queuedStates = states.length;
    save(1);
    await waitFor(() => output.slice(queuedOutput).some(text => text.includes(":build]")));
    buildFails = false; buildDelay = 0; save(1);
    await waitFor(() => notifications.length === 2 && states.slice(queuedStates).includes("starting") && states.at(-1) === "running");
    // Runtime failures after readiness retain development intent too.
    writeFileSync(app, `${valid}\nsetTimeout(() => { throw new Error("runtime-transient"); }, 500);`);
    const runtimeStates = states.length; save(1);
    await waitFor(() => states.slice(runtimeStates).includes("running") && states.at(-1) === "failed");
    assert.match(output.join("\n"), /runtime-transient[\s\S]*at Timeout/);
    assert.equal(notifications.length, 2, "Superseded build failures do not notify");
    writeFileSync(app, valid); const runtimeFailedPosition = states.length; save(1);
    await waitFor(() => states.slice(runtimeFailedPosition).includes("starting") && states.at(-1) === "running");
    await manager.stop(folder.uri);
    const stoppedOutput = output.length; save(1);
    await new Promise(resolveWait => setTimeout(resolveWait, 400));
    assert.equal(output.length, stoppedOutput, "Explicit Stop disables automatic retry");
    const builds = (): number => output.filter(text => text.includes(":build]")).length;
    const launches = (): number => output.filter(text => text.includes(":host] Starting ")).length;
    const stoppedSave = async (): Promise<void> => {
      const before = [builds(), launches(), notifications.length];
      save(1);
      await new Promise(resolveWait => setTimeout(resolveWait, 400));
      assert.deepEqual([builds(), launches(), notifications.length], before, "Stopped intent ignores corrected saves");
      if (folders.length === 1) {
        assert.equal(states.at(-1), "stopped");
        assert.equal(contexts.get("hson.localHost.canStop"), false);
      }
      assert.equal(contexts.get("hson.localHost.canStart"), true);
    };
    const canStop = (): void => {
      assert.equal(contexts.get("hson.localHost.canStop"), true);
      assert.equal(contexts.get("hson.localHost.canRestart"), true);
      assert.ok(manager.quickPickActions().some(action => action.command === "hson.stopLocalHost"));
    };
    const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const serving = (revision: string): string => `export const application = { name: "lifecycle", requests: [
      { method: "GET", path: "/revision", handle() { return new Response(${JSON.stringify(revision)}); } },
      { method: "GET", path: "/pid", handle() { return new Response(String(process.pid)); } }
    ], dispose() {} };`;
    const served = async (path: string): Promise<string> => {
      assert.ok(manager.currentUrl);
      return (await fetch(new URL(path, manager.currentUrl))).text();
    };

    buildFails = true;
    const beforeInitialFailure = notifications.length;
    assert.equal(await manager.start(), false);
    assert.equal(notifications.length, beforeInitialFailure + 1);
    assert.equal(states.at(-1), "failed"); canStop();
    await manager.stop(); buildFails = false;
    await stoppedSave();

    // Failed resolution has enabled development intent even though no runner exists.
    settings.entry = "dist/missing.mjs";
    assert.equal(await manager.start(), false);
    assert.equal(states.at(-1), "failed"); canStop();
    const warningCount = warnings.length;
    await manager.stop();
    assert.equal(warnings.length, warningCount, "Stop must select the failed-but-enabled project");
    settings.entry = "dist/app.mjs"; writeFileSync(app, serving("after-resolution"));
    await stoppedSave();
    assert.equal(await manager.start(), true);
    assert.equal(await served("/revision"), "after-resolution");
    const runningPid = Number(await served("/pid"));
    await manager.stop();
    await waitFor(() => !alive(runningPid));
    await stoppedSave();

    // Stop owns initial build cancellation, including the later child close rejection.
    buildCommand = `"${process.execPath}" "${builder}"`;
    rmSync(join(root, "release.txt"), { force: true });
    rmSync(join(root, "started.txt"), { force: true });
    writeFileSync(document.uri.fsPath, "cancel-initial");
    const beforeCancel = notifications.length, beforeCancelLaunch = launches();
    const canceledStart = manager.start();
    await waitFor(() => { try { return readFileSync(join(root, "started.txt"), "utf8") === "cancel-initial"; } catch { return false; } });
    assert.equal(states.at(-1), "starting"); canStop();
    assert.equal(contexts.get("hson.localHost.canStart"), false);
    const buildPid = Number(readFileSync(join(root, "build-pid.txt"), "utf8"));
    await manager.stop();
    assert.equal(await canceledStart, false);
    await waitFor(() => !alive(buildPid));
    assert.equal(notifications.length, beforeCancel);
    assert.equal(launches(), beforeCancelLaunch);
    writeFileSync(join(root, "release.txt"), "release");
    await stoppedSave();
    assert.equal(await manager.start(), true, "Explicit Start reenables intent after cancellation");
    assert.equal(await served("/revision"), "cancel-initial");
    await manager.stop();
    // Reenable immediately, before the cancelled child's delayed close rejects.
    rmSync(join(root, "release.txt"), { force: true });
    rmSync(join(root, "started.txt"), { force: true });
    writeFileSync(document.uri.fsPath, "cancel-late");
    const lateNotifications = notifications.length;
    const lateStart = manager.start();
    await waitFor(() => { try { return readFileSync(join(root, "started.txt"), "utf8") === "cancel-late"; } catch { return false; } });
    await manager.stop();
    writeFileSync(document.uri.fsPath, "latest-after-stop");
    writeFileSync(join(root, "release.txt"), "release");
    const freshStart = manager.start();
    assert.equal(await lateStart, false);
    assert.equal(await freshStart, true);
    assert.equal(notifications.length, lateNotifications);
    assert.equal(await served("/revision"), "latest-after-stop");
    assert.equal(states.at(-1), "running");
    await manager.stop();
    const started = async (revision: string): Promise<void> => waitFor(() => {
      try { return readFileSync(join(root, "started.txt"), "utf8") === revision; } catch { return false; }
    });
    const release = (revision: string): void => { writeFileSync(join(root, `release-${revision}.txt`), "release"); };
    const prepareOpen = (revision: string): void => {
      rmSync(join(root, "release.txt"), { force: true });
      rmSync(join(root, "started.txt"), { force: true });
      writeFileSync(join(root, "builds.txt"), "");
      writeFileSync(document.uri.fsPath, revision);
    };
    for (const test of [
      { revisions: ["cold-A", "cold-B"] },
      { revisions: ["many-A", "many-B", "many-C"] },
      { revisions: ["single"] },
      { revisions: ["pending-A", "pending-B"], pending: true },
      { revisions: ["active-A", "active-B"], pending: true, active: true },
      { revisions: ["concurrent-A", "concurrent-B"], callers: 3 },
      { revisions: ["obsolete-FAIL", "recovered-B"] },
      { revisions: ["final-A", "final-FAIL"], fails: true, callers: 2 },
      { revisions: ["single-FAIL"], fails: true },
      { revisions: ["retained-A", "retained-FAIL"], pending: true, fails: true },
    ]) {
      const first = test.revisions[0]!, last = test.revisions.at(-1)!;
      if (test.pending) {
        writeFileSync(join(root, "release.txt"), "release");
        writeFileSync(document.uri.fsPath, "retained");
        assert.equal(await manager.start(folder.uri), true);
      }
      prepareOpen(first);
      const before: { builds: number; launches: number; errors: number; info: number; warnings: number; opens: number; url: string | undefined } = { builds: builds(), launches: launches(), errors: notifications.length, info: information.length, warnings: warnings.length, opens: opened.length, url: manager.currentUrl };
      if (test.pending) save(1);
      if (test.active) await started(first);
      const requests = [manager.runAndOpen(folder.uri)];
      await started(first);
      for (let i = 1; i < (test.callers ?? 1); i++) requests.push(manager.runAndOpen(folder.uri));
      for (const revision of test.revisions.slice(1)) { writeFileSync(document.uri.fsPath, revision); save(1); }
      assert.equal(opened.length, before.opens, "No Open before the build gate");
      release(first);
      if (first !== last) {
        await started(last);
        assert.equal(opened.length, before.opens, "A superseded completion cannot open");
        assert.equal(launches(), before.launches, "Obsolete output cannot replace the runner");
        release(last);
      }
      assert.deepEqual(await Promise.all(requests), requests.map(() => !test.fails), first);
      const revisions = first === last ? [first] : [first, last];
      assert.deepEqual(readFileSync(join(root, "builds.txt"), "utf8").trim().split("\n"), revisions.flatMap(revision => revision.includes("FAIL") ? [`start ${revision}`] : [`start ${revision}`, `finish ${revision}`]));
      assert.equal(builds() - before.builds, revisions.length, "Open must not cause another build");
      assert.equal(launches() - before.launches, test.fails ? 0 : 1);
      assert.equal(notifications.length - before.errors, test.fails ? 1 : 0);
      assert.equal(warnings.length, before.warnings);
      assert.equal(information.length - before.info, test.fails ? 0 : requests.length);
      assert.equal(opened.length - before.opens, test.fails ? 0 : requests.length, "Each successful caller opens once");
      if (!test.fails) {
        assert.equal(await served("/revision"), last);
        assert.ok(opened.slice(before.opens).every(url => new URL(url).href === manager.currentUrl));
        assert.equal(await (await fetch(new URL("/revision", opened.at(-1)!))).text(), last);
        const ready = [builds(), launches(), opened.length];
        assert.equal(await manager.runAndOpen(folder.uri), true);
        assert.deepEqual([builds(), launches(), opened.length], [ready[0], ready[1], ready[2]! + 1], "An already current app opens without building or replacing");
      } else if (test.pending) {
        assert.equal(manager.currentUrl, before.url);
        assert.equal(await served("/revision"), "retained");
        await manager.open(folder.uri);
        assert.equal(opened.length, before.opens + 1, "Explicit Open still opens a retained server");
        assert.equal(new URL(opened.at(-1)!).href, before.url);
        const retry: number[] = [builds(), launches(), notifications.length, opened.length, information.length];
        assert.equal(await manager.runAndOpen(folder.uri), false, "A new command cannot use a retained server as evidence of success");
        assert.deepEqual([builds(), launches(), notifications.length, opened.length, information.length],
          [retry[0]! + 1, retry[1], retry[2]! + 1, retry[3], retry[4]]);
        assert.equal(manager.currentUrl, before.url);
      } else assert.equal(manager.currentUrl, undefined);
      await manager.stop(folder.uri);
    }

    for (const cancel of ["stop", "reenable", "remove"] as const) {
      const first = `cancel-open-${cancel}`, last = `cancel-final-${cancel}`;
      prepareOpen(first);
      const before: number[] = [builds(), launches(), notifications.length, opened.length, information.length, warnings.length];
      const request = manager.runAndOpen(folder.uri);
      await started(first);
      writeFileSync(document.uri.fsPath, last); save(1);
      release(first);
      await started(last);
      if (cancel === "remove") {
        folders.splice(folders.indexOf(folder), 1);
        changedFolders({ added: [], removed: [folder] });
      } else await manager.stop(folder.uri);
      let fresh: Promise<boolean> | undefined;
      if (cancel === "reenable") {
        writeFileSync(document.uri.fsPath, "fresh-after-cancel");
        release("fresh-after-cancel");
        fresh = manager.runAndOpen(folder.uri);
      }
      assert.equal(await request, false, "Cancellation invalidates the command, not just its revision");
      if (fresh !== undefined) {
        assert.equal(await fresh, true);
        assert.equal(await served("/revision"), "fresh-after-cancel");
      }
      assert.deepEqual([builds(), launches(), notifications.length, opened.length, information.length, warnings.length],
        [before[0]! + (fresh ? 3 : 2), before[1]! + (fresh ? 1 : 0), before[2], before[3]! + (fresh ? 1 : 0), before[4]! + (fresh ? 1 : 0), before[5]]);
      if (cancel === "remove") folders.push(folder);
      await manager.stop(folder.uri);
    }
    buildCommand = undefined;

    // A runner failure is stoppable, and cannot later retry after Stop.
    writeFileSync(app, 'throw new Error("startup-stop-probe");');
    assert.equal(await manager.start(), false);
    assert.equal(states.at(-1), "failed"); canStop();
    await manager.stop();
    writeFileSync(app, serving("stable")); await stoppedSave();
    assert.equal(await manager.start(), true);
    const stablePid = Number(await served("/pid"));
    const stableUrl = manager.currentUrl;
    buildFails = true;
    const beforeGenuine = notifications.length;
    await manager.restart();
    assert.equal(notifications.length, beforeGenuine + 1, "Current build failures still report");
    assert.equal(states.at(-1), "failed"); canStop();
    assert.equal(contexts.get("hson.localHost.canOpen"), true, "A failed rebuild retains an openable server");
    assert.equal(manager.currentUrl, stableUrl);
    assert.equal(Number(await served("/pid")), stablePid);
    assert.equal(await served("/revision"), "stable");
    buildFails = false;

    // Pending Save and explicit Restart consume one build and one replacement.
    const beforeJoined = [builds(), launches()];
    writeFileSync(app, serving("joined")); save(1);
    await Promise.all([manager.restart(), manager.restart()]);
    await new Promise(resolveWait => setTimeout(resolveWait, 400));
    assert.deepEqual([builds(), launches()], beforeJoined.map(count => count + 1));
    assert.equal(await served("/revision"), "joined");
    await waitFor(() => !alive(stablePid));
    const beforeExplicit = [builds(), launches()];
    const joinedPid = Number(await served("/pid"));
    await manager.restart();
    assert.deepEqual([builds(), launches()], beforeExplicit.map(count => count + 1), "Restart without a save remains effective");
    assert.notEqual(Number(await served("/pid")), joinedPid);
    await waitFor(() => !alive(joinedPid));

    // A second real project keeps its server and intent when the first is stopped.
    const secondRoot = join(root, "second");
    mkdirSync(join(secondRoot, "dist"), { recursive: true }); mkdirSync(join(secondRoot, "src"));
    mkdirSync(join(secondRoot, "node_modules"));
    symlinkSync(resolve(__dirname, "../../.."), join(secondRoot, "node_modules", "hson-live"), "dir");
    const second: vscode.WorkspaceFolder = { uri: uri(secondRoot), name: "second", index: 1 };
    // Most-specific folder first, as VS Code workspace resolution behaves.
    folders.unshift(second);
    configurations.set(second.uri.toString(), { ...settings, buildCommand: `"${process.execPath}" -e "process.exit(0)"` });
    writeFileSync(join(secondRoot, "dist/app.mjs"), serving("second"));
    assert.equal(await manager.start(second.uri), true);
    activeDocument = { uri: uri(join(secondRoot, "src/app.ts")) } as vscode.TextDocument;
    const secondUrl = manager.currentUrl, secondPid = Number(await served("/pid"));
    activeDocument = document;
    await manager.stop();
    await stoppedSave();
    assert.ok(alive(secondPid));
    assert.ok(secondUrl);
    assert.equal(await (await fetch(new URL("/revision", secondUrl))).text(), "second");
    assert.equal(await manager.start(), true, "The first project can explicitly reenable without affecting the second");
    await manager.stop();
    await manager.stop(second.uri);
    await waitFor(() => !alive(secondPid));

    // Both commands follow saves in their own project; Stop cancels only one.
    buildCommand = `"${process.execPath}" "${builder}"`;
    configurations.set(second.uri.toString(), { ...settings, buildCommand });
    prepareOpen("isolate-A");
    const secondDocument = { uri: uri(join(secondRoot, "src/app.ts")) } as vscode.TextDocument;
    writeFileSync(secondDocument.uri.fsPath, "other-A");
    const beforeIsolation: number[] = [builds(), launches(), notifications.length, opened.length, information.length, warnings.length];
    const firstOpen = manager.runAndOpen(folder.uri), secondOpen = manager.runAndOpen(second.uri);
    await started("isolate-A");
    const secondStarted = async (revision: string): Promise<void> => waitFor(() => {
      try { return readFileSync(join(secondRoot, "started.txt"), "utf8") === revision; } catch { return false; }
    });
    await secondStarted("other-A");
    writeFileSync(document.uri.fsPath, "isolate-B"); save(1);
    writeFileSync(secondDocument.uri.fsPath, "other-B");
    willSave({ document: secondDocument, reason: 1 } as vscode.TextDocumentWillSaveEvent); didSave(secondDocument);
    release("isolate-A"); writeFileSync(join(secondRoot, "release-other-A.txt"), "release");
    await Promise.all([started("isolate-B"), secondStarted("other-B")]);
    await manager.stop(folder.uri);
    writeFileSync(join(secondRoot, "release-other-B.txt"), "release");
    assert.deepEqual(await Promise.all([firstOpen, secondOpen]), [false, true]);
    assert.deepEqual([builds(), launches(), notifications.length, opened.length, information.length, warnings.length],
      [beforeIsolation[0]! + 4, beforeIsolation[1]! + 1, beforeIsolation[2], beforeIsolation[3]! + 1, beforeIsolation[4]! + 1, beforeIsolation[5]]);
    assert.equal(await (await fetch(new URL("/revision", opened.at(-1)!))).text(), "other-B");
    activeDocument = secondDocument;
    assert.equal(new URL(opened.at(-1)!).href, manager.currentUrl);
    activeDocument = document;
    await manager.stop(second.uri);
    folders.shift();

    // The formatting hook uses the same native reason boundary.
    const extension = readFileSync(resolve(__dirname, "../src/extension.ts"), "utf8");
    assert.match(extension, /onWillSaveTextDocument\(event => \{\s*formattingSaves.willSave[^\n]+\n\s*if \(event.reason !== vscode.TextDocumentSaveReason.Manual/);
    assert.equal((extension.match(/formattingSaves.formattingAllowed\(document.uri.toString\(\)\)/g) ?? []).length, 2);

    prepareOpen("dispose-A");
    const beforeDisposal: number[] = [builds(), launches(), notifications.length, opened.length, information.length, warnings.length];
    const disposingOpen = manager.runAndOpen(folder.uri);
    await started("dispose-A");
    writeFileSync(document.uri.fsPath, "dispose-B"); save(1);
    release("dispose-A"); await started("dispose-B");
    const disposal = manager.disposeAsync();
    assert.equal(await disposingOpen, false);
    await disposal;
    assert.equal(await manager.runAndOpen(folder.uri), false);
    assert.deepEqual([builds(), launches(), notifications.length, opened.length, information.length, warnings.length],
      [beforeDisposal[0]! + 2, ...beforeDisposal.slice(1)]);
    process.stdout.write("ok - manual saves recover real runners; auto-save stays passive; full stacks stay in Output\n");
  } finally {
    await manager.disposeAsync();
    rmSync(root, { recursive: true, force: true });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

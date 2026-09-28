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
  const states: LocalHostState[] = [], notifications: string[] = [], output: string[] = [];
  let outputOpened = 0;
  let willSave: (event: vscode.TextDocumentWillSaveEvent) => void = () => undefined;
  let didSave: (document: vscode.TextDocument) => void = () => undefined;
  const disposable = { dispose() {} };
  let buildFails = false;
  let buildDelay = 0;
  let buildCommand: string | undefined;
  let buildCommandReads = 0;
  const settings: Record<string, unknown> = { entry: "dist/app.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0, restartOnSave: true, sourceDirectory: "src" };
  const api = {
    TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
    workspace: {
      isTrusted: true, workspaceFolders: [folder], getWorkspaceFolder: () => folder,
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => {
        if (key !== "buildCommand") return settings[key] ?? fallback;
        buildCommandReads++;
        return buildCommand ?? `"${process.execPath}" -e "setTimeout(()=>process.exit(${buildFails ? 1 : 0}),${buildDelay})"`;
      } }),
      onWillSaveTextDocument: (listener: typeof willSave) => { willSave = listener; return disposable; },
      onDidSaveTextDocument: (listener: typeof didSave) => { didSave = listener; return disposable; },
      onDidCloseTextDocument: () => disposable, onDidChangeConfiguration: () => disposable, onDidChangeWorkspaceFolders: () => disposable,
    },
    window: {
      onDidChangeActiveTextEditor: () => disposable,
      createOutputChannel: () => ({ append: (text: string) => output.push(text), appendLine: (text: string) => output.push(text), show: () => { outputOpened++; }, dispose() {} }),
      showErrorMessage: async (message: string) => { notifications.push(message); return undefined; },
      showInformationMessage: async () => undefined,
    },
    commands: { registerCommand: () => disposable, executeCommand: async () => undefined },
    env: {},
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
appendFileSync("builds.txt", "start " + revision + "\\n");
writeFileSync("started.txt", revision);
while (!existsSync("release.txt")) await new Promise(resolve => setTimeout(resolve, 10));
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
    await waitFor(() => notifications.length === 3 && states.slice(queuedStates).includes("starting") && states.at(-1) === "running");
    // Runtime failures after readiness retain development intent too.
    writeFileSync(app, `${valid}\nsetTimeout(() => { throw new Error("runtime-transient"); }, 500);`);
    const runtimeStates = states.length; save(1);
    await waitFor(() => states.slice(runtimeStates).includes("running") && states.at(-1) === "failed");
    assert.match(output.join("\n"), /runtime-transient[\s\S]*at Timeout/);
    assert.equal(notifications.length, 3);
    writeFileSync(app, valid); const runtimeFailedPosition = states.length; save(1);
    await waitFor(() => states.slice(runtimeFailedPosition).includes("starting") && states.at(-1) === "running");
    await manager.stop(folder.uri);
    const stoppedOutput = output.length; save(1);
    await new Promise(resolveWait => setTimeout(resolveWait, 400));
    assert.equal(output.length, stoppedOutput, "Explicit Stop disables automatic retry");
    // The formatting hook uses the same native reason boundary.
    const extension = readFileSync(resolve(__dirname, "../src/extension.ts"), "utf8");
    assert.match(extension, /onWillSaveTextDocument\(event => \{\s*formattingSaves.willSave[^\n]+\n\s*if \(event.reason !== vscode.TextDocumentSaveReason.Manual/);
    assert.equal((extension.match(/formattingSaves.formattingAllowed\(document.uri.toString\(\)\)/g) ?? []).length, 2);
    process.stdout.write("ok - manual saves recover real runners; auto-save stays passive; full stacks stay in Output\n");
  } finally {
    await manager.disposeAsync();
    rmSync(root, { recursive: true, force: true });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

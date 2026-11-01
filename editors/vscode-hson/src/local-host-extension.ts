import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

import { LocalHostController, type LocalHostSnapshot, type LocalHostState } from "./local-host-controller.js";
import { local_app_quick_pick_actions, local_host_command_availability, type LocalAppAction, type LocalHostProjectPresentation } from "./local-host-presentation.js";
import { local_host_start_blocker, resolve_local_host_project, type LocalHostProjectSettings } from "./local-host-project.js";
import { ManualSaveTracker } from "./manual-save.js";

type ManagedProject = Readonly<{
  folder: vscode.WorkspaceFolder;
  controller: LocalHostController;
}>;

type BuildWork = { revision: number; processed: number; cancelledRevision: number; enabled: boolean; failed: boolean; timer?: ReturnType<typeof setTimeout>; child?: ChildProcess; active?: Promise<void> };

export class LocalHostExtensionManager implements vscode.Disposable {
  readonly #context: vscode.ExtensionContext;
  readonly #output: vscode.OutputChannel;
  readonly #onState: (state: LocalHostState) => void;
  readonly #projects = new Map<string, ManagedProject>();
  readonly #builds = new Map<string, BuildWork>();
  readonly #saves = new ManualSaveTracker();
  #disposed = false;
  #disposePromise: Promise<void> | undefined;

  constructor(context: vscode.ExtensionContext, onState: (state: LocalHostState) => void) {
    this.#context = context;
    this.#onState = onState;
    this.#output = vscode.window.createOutputChannel("Hson Local App");
    context.subscriptions.push(
      this.#output,
      vscode.commands.registerCommand("hson.startLocalHost", (uri?: vscode.Uri) => this.start(uri)),
      vscode.commands.registerCommand("hson.stopLocalHost", (uri?: vscode.Uri) => this.stop(uri)),
      vscode.commands.registerCommand("hson.restartLocalHost", (uri?: vscode.Uri) => this.restart(uri)),
      vscode.commands.registerCommand("hson.openLocalApp", (uri?: vscode.Uri) => this.open(uri)),
      vscode.commands.registerCommand("hson.runAndOpenLocalApp", (uri?: vscode.Uri) => this.runAndOpen(uri)),
      vscode.commands.registerCommand("hson.copyLocalAppUrl", (uri?: vscode.Uri) => this.copyUrl(uri)),
      vscode.commands.registerCommand("hson.showLocalHostOutput", () => this.#output.show(true)),
      vscode.window.onDidChangeActiveTextEditor(() => this.#updatePresentation()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("hson.localHost")) this.#updatePresentation();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(event => {
        for (const folder of event.removed) void this.#removeFolder(folder);
        this.#updatePresentation();
      }),
      vscode.workspace.onWillSaveTextDocument(event => this.#saves.willSave(event.document.uri.toString(), event.reason === vscode.TextDocumentSaveReason.Manual)),
      vscode.workspace.onDidSaveTextDocument(document => { if (this.#saves.didSave(document.uri.toString())) this.#onSave(document); }),
      vscode.workspace.onDidCloseTextDocument(document => this.#saves.forget(document.uri.toString())),
      { dispose: () => { void this.disposeAsync(); } },
    );
    this.#updatePresentation();
  }

  async start(requested?: vscode.Uri): Promise<boolean> {
    if (this.#disposed) return false;
    const folder = await this.#prepareFolder(requested, "start");
    if (folder === undefined) return false;
    const completed = await this.#run(folder, false);
    if (completed) void vscode.window.showInformationMessage(`Hson local app is running at ${this.#projects.get(folder.uri.toString())?.controller.snapshot.httpUrl}.`);
    return completed;
  }

  async stop(requested?: vscode.Uri): Promise<void> {
    const folder = await this.#selectFolder(requested, "stop");
    if (folder !== undefined) await this.stopRunning(folder);
  }

  async restart(requested?: vscode.Uri): Promise<void> {
    if (this.#disposed) return;
    const folder = await this.#prepareFolder(requested, "restart");
    if (folder !== undefined) await this.#run(folder, true);
  }

  async #run(folder: vscode.WorkspaceFolder, replace: boolean, followSaves = false): Promise<boolean> {
    if (this.#disposed) return false;
    const controller = this.#managed(folder).controller;
    const work = this.#work(folder);
    const pending = work.enabled
      && (work.active !== undefined || work.timer !== undefined || work.revision !== work.processed);
    if (!pending) {
      work.enabled = true;
      if (!replace && !work.failed && controller.snapshot.state === "running") return true;
      work.failed = false;
      work.revision++;
    }
    const revision = work.revision;
    if (work.timer !== undefined) clearTimeout(work.timer);
    work.timer = undefined;
    this.#startFlush(folder, work);
    do { await work.active; }
    while (followSaves && work.active !== undefined && this.#current(work, work.revision) && work.cancelledRevision < revision);
    return work.cancelledRevision < revision && this.#current(work, followSaves ? work.revision : revision)
      && !work.failed && work.processed === work.revision && controller.snapshot.state === "running";
  }

  async open(requested?: vscode.Uri): Promise<void> {
    const folder = await this.#selectFolder(requested, "open");
    if (folder === undefined) return;
    const snapshot = this.#projects.get(folder.uri.toString())?.controller.snapshot;
    if (snapshot?.state !== "running" || snapshot.httpUrl === undefined) {
      void vscode.window.showWarningMessage(`The Hson local app for ${folder.name} is not running. Run Hson: Run Local App first.`);
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(snapshot.httpUrl, true));
  }

  async runAndOpen(requested?: vscode.Uri): Promise<boolean> {
    if (this.#disposed) return false;
    const folder = await this.#prepareFolder(requested, "start");
    if (folder === undefined) return false;
    const work = this.#work(folder);
    const cancelledRevision = work.cancelledRevision;
    if (!await this.#run(folder, false, true) || work.cancelledRevision !== cancelledRevision || !this.#current(work, work.processed)) return false;
    const snapshot = this.#projects.get(folder.uri.toString())?.controller.snapshot;
    if (snapshot?.state !== "running" || snapshot.httpUrl === undefined) return false;
    void vscode.window.showInformationMessage(`Hson local app is running at ${snapshot.httpUrl}.`);
    await vscode.env.openExternal(vscode.Uri.parse(snapshot.httpUrl, true));
    return true;
  }

  async copyUrl(requested?: vscode.Uri): Promise<void> {
    const folder = await this.#selectFolder(requested, "open");
    if (folder === undefined) return;
    const url = this.#projects.get(folder.uri.toString())?.controller.snapshot.httpUrl;
    if (url !== undefined) await vscode.env.clipboard.writeText(new URL(url).href);
  }

  get currentUrl(): string | undefined {
    const snapshot = this.#currentSnapshot();
    return snapshot?.state === "running" && snapshot.httpUrl !== undefined ? new URL(snapshot.httpUrl).href : undefined;
  }

  hasConfiguredApp(folder: vscode.WorkspaceFolder): boolean { return this.#isConfigured(folder); }

  async stopRunning(folder: vscode.WorkspaceFolder): Promise<void> {
    this.#cancelBuild(folder);
    await this.#projects.get(folder.uri.toString())?.controller.stop();
    this.#updatePresentation();
  }

  #onSave(document: vscode.TextDocument): void {
    if (this.#disposed) return;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder === undefined || document.uri.scheme !== "file") return;
    const settings = vscode.workspace.getConfiguration("hson.localHost", folder.uri);
    if (!settings.get<boolean>("restartOnSave", false)) return;
    const sourceDirectory = settings.get<string>("sourceDirectory", "src").trim();
    const sourceRoot = resolve(folder.uri.fsPath, sourceDirectory);
    const path = relative(sourceRoot, document.uri.fsPath);
    if (sourceDirectory === "" || isAbsolute(sourceDirectory) || isAbsolute(path) || path === "" || path === ".." || path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) return;
    if (this.#builds.get(folder.uri.toString())?.enabled !== true) return;
    if (settings.get<string>("buildCommand", "").trim() === "") {
      this.#reportError(new Error("hson.localHost.restartOnSave requires hson.localHost.buildCommand."), folder);
      return;
    }
    const work = this.#work(folder);
    work.failed = false;
    work.revision++;
    if (work.timer !== undefined) clearTimeout(work.timer);
    work.timer = setTimeout(() => {
      work.timer = undefined;
      this.#startFlush(folder, work);
    }, 250);
    this.#updatePresentation();
  }

  #startFlush(folder: vscode.WorkspaceFolder, work: BuildWork): void {
    if (work.active !== undefined || !work.enabled || work.revision === work.processed) return;
    work.active = this.#flushSaves(folder, work).finally(() => {
      work.active = undefined;
      this.#updatePresentation();
      if (work.enabled && work.revision !== work.processed) this.#startFlush(folder, work);
    });
    this.#updatePresentation();
  }

  #current(work: BuildWork, revision: number): boolean {
    return !this.#disposed && work.enabled && work.revision === revision;
  }

  async #flushSaves(folder: vscode.WorkspaceFolder, work: BuildWork): Promise<void> {
    while (!this.#disposed && work.enabled) {
      const revision = work.revision;
      if (work.timer !== undefined) clearTimeout(work.timer);
      work.timer = undefined;
      try {
        await this.#build(folder, work);
        if (!this.#current(work, revision)) continue;
        const project = await resolve_local_host_project(folder.uri.fsPath, folder.uri.toString(), this.#settings(folder));
        if (!this.#current(work, revision)) continue;
        const controller = this.#managed(folder).controller;
        await controller.stop();
        if (!this.#current(work, revision)) continue;
        await controller.start(project);
        if (!this.#current(work, revision)) continue;
        work.failed = false;
      } catch (error) {
        // Stop and newer revisions invalidate both results and failure presentation.
        if (!this.#current(work, revision)) continue;
        this.#reportError(error, folder);
      }
      work.processed = revision;
      return;
    }
  }

  async #build(folder: vscode.WorkspaceFolder, work: BuildWork): Promise<void> {
    const command = vscode.workspace.getConfiguration("hson.localHost", folder.uri).get<string>("buildCommand", "").trim();
    if (command === "") return;
    this.#output.appendLine(`[${folder.name}:build] ${command}`);
    await new Promise<void>((resolveBuild, rejectBuild) => {
      const child = spawn(command, { cwd: folder.uri.fsPath, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      work.child = child;
      child.stdout?.on("data", chunk => this.#output.append(String(chunk)));
      child.stderr?.on("data", chunk => this.#output.append(String(chunk)));
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (work.child === child) work.child = undefined;
        if (error === undefined) resolveBuild(); else rejectBuild(error);
      };
      child.once("error", error => finish(new Error(`Local App build failed to start: ${error.message}`)));
      child.once("close", code => finish(code === 0 ? undefined : new Error(`Local App build failed (exit ${code ?? "unknown"}). See Hson Local App Output.`)));
    });
  }

  #work(folder: vscode.WorkspaceFolder): BuildWork {
    const key = folder.uri.toString();
    let work = this.#builds.get(key);
    if (work === undefined) { work = { revision: 0, processed: 0, cancelledRevision: 0, enabled: false, failed: false }; this.#builds.set(key, work); }
    return work;
  }

  #cancelBuild(folder: vscode.WorkspaceFolder): void {
    const work = this.#builds.get(folder.uri.toString());
    if (work === undefined) return;
    work.revision++;
    // Keep the cancellation boundary when a later command reenables development.
    work.cancelledRevision = work.revision;
    work.enabled = false;
    work.failed = false;
    if (work.timer !== undefined) clearTimeout(work.timer);
    work.timer = undefined;
    this.#updatePresentation();
    const child = work.child;
    if (child?.pid !== undefined) {
      if (process.platform === "win32") {
        const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
        taskkill.once("error", () => child.kill());
        return;
      }
      try { process.kill(-child.pid, "SIGTERM"); }
      catch { child.kill(); }
      const force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      }, 1_000);
      force.unref?.();
      child.once("close", () => clearTimeout(force));
    }
  }

  #snapshot(folder: vscode.WorkspaceFolder, presentation = false): LocalHostSnapshot {
    const projectId = folder.uri.toString();
    const snapshot = this.#projects.get(projectId)?.controller.snapshot ?? Object.freeze({ state: "stopped", projectId });
    const work = this.#builds.get(projectId);
    if (!presentation || !work?.enabled) return snapshot;
    if (work.failed) return Object.freeze({ ...snapshot, state: "failed" });
    if (work.active !== undefined || work.timer !== undefined || work.revision !== work.processed) return Object.freeze({ ...snapshot, state: "starting" });
    return snapshot;
  }

  quickPickActions(): readonly LocalAppAction[] {
    return local_app_quick_pick_actions(this.#presentations());
  }

  dispose(): void {
    void this.disposeAsync();
  }

  async disposeAsync(): Promise<void> {
    if (this.#disposePromise === undefined) {
      this.#disposed = true;
      for (const project of this.#projects.values()) this.#cancelBuild(project.folder);
      const pending = [...this.#builds.values()].flatMap(work => [work.active].filter((task): task is Promise<void> => task !== undefined));
      this.#disposePromise = Promise.allSettled([...this.#projects.values()].map(project => project.controller.dispose()).concat(pending)).then(() => {
        this.#projects.clear();
        this.#builds.clear();
      });
    }
    await this.#disposePromise;
  }

  #managed(folder: vscode.WorkspaceFolder): ManagedProject {
    const key = folder.uri.toString();
    const existing = this.#projects.get(key);
    if (existing !== undefined) return existing;
    const controller = new LocalHostController(key, {
      runnerPath: this.#context.asAbsolutePath("dist/local-host-runner.cjs"),
      output: (channel, text) => {
        const prefix = channel === "stdout" ? "stdout" : channel === "stderr" ? "stderr" : "host";
        this.#output.append(`[${folder.name} — ${folder.uri.fsPath}:${prefix}] ${text}`);
      },
      onState: () => this.#updatePresentation(),
    });
    const managed = Object.freeze({ folder, controller });
    this.#projects.set(key, managed);
    return managed;
  }

  async #prepareFolder(requested: vscode.Uri | undefined, operation: "start" | "restart"): Promise<vscode.WorkspaceFolder | undefined> {
    const blocker = local_host_start_blocker(vscode.workspace.isTrusted, vscode.env.remoteName);
    if (blocker !== undefined) {
      void vscode.window.showWarningMessage(operation === "restart" ? blocker.replace("cannot run", "cannot restart") : blocker);
      return undefined;
    }
    return this.#selectFolder(requested, operation);
  }

  async #selectFolder(requested: vscode.Uri | undefined, operation: "start" | "stop" | "restart" | "open"): Promise<vscode.WorkspaceFolder | undefined> {
    const direct = requested ?? vscode.window.activeTextEditor?.document.uri;
    const active = direct === undefined ? undefined : vscode.workspace.getWorkspaceFolder(direct);
    if (active?.uri.scheme === "file" && (requested !== undefined ? this.#isKnown(active) : this.#eligible(active, operation))) return active;
    const candidates = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === "file" && this.#eligible(folder, operation));
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
      const message = operation === "open" ? "No Hson local app is currently running."
        : operation === "stop" ? "No extension-managed Hson local app is currently active."
        : "No local workspace folder has hson.localHost.entry configured.";
      void vscode.window.showWarningMessage(message);
      return undefined;
    }
    const choice = await vscode.window.showQuickPick(candidates.map(folder => ({
      label: folder.name,
      description: this.#settings(folder).entry || "managed local app",
      detail: folder.uri.fsPath,
      folder,
    })), { placeHolder: "Choose the workspace project for the Hson local app" });
    return choice?.folder;
  }

  #settings(folder: vscode.WorkspaceFolder): LocalHostProjectSettings {
    const configuration = vscode.workspace.getConfiguration("hson.localHost", folder.uri);
    return Object.freeze({
      entry: configuration.get<string>("entry", ""),
      applicationExport: configuration.get<string>("applicationExport", "application"),
      nodeExecutable: configuration.get<string>("nodeExecutable", "node"),
      port: configuration.get<number>("port", 8787),
    });
  }

  #isConfigured(folder: vscode.WorkspaceFolder): boolean {
    return this.#settings(folder).entry.trim() !== "";
  }

  #isKnown(folder: vscode.WorkspaceFolder): boolean {
    return this.#isConfigured(folder) || this.#projects.has(folder.uri.toString());
  }

  #eligible(folder: vscode.WorkspaceFolder, operation: "start" | "stop" | "restart" | "open"): boolean {
    const snapshot = this.#snapshot(folder, operation !== "open");
    if (operation === "start") return this.#isConfigured(folder);
    if (operation === "open") return snapshot?.state === "running" && snapshot.httpUrl !== undefined;
    if (operation === "stop") return snapshot !== undefined && snapshot.state !== "stopped" && snapshot.state !== "stopping";
    return this.#isConfigured(folder) && snapshot !== undefined
      && (snapshot.state === "starting" || snapshot.state === "running" || snapshot.state === "failed");
  }

  #presentations(): readonly LocalHostProjectPresentation[] {
    const presentations = new Map<string, LocalHostProjectPresentation>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== "file") continue;
      const projectId = folder.uri.toString();
      const managed = this.#projects.get(projectId);
      const configured = this.#isConfigured(folder);
      if (!configured && managed === undefined) continue;
      presentations.set(projectId, Object.freeze({
        projectId,
        name: folder.name,
        detail: folder.uri.fsPath,
        configured,
        snapshot: this.#snapshot(folder, true),
        canOpen: managed?.controller.snapshot.state === "running",
      }));
    }
    for (const managed of this.#projects.values()) {
      const projectId = managed.folder.uri.toString();
      if (presentations.has(projectId)) continue;
      presentations.set(projectId, Object.freeze({
        projectId,
        name: managed.folder.name,
        detail: managed.folder.uri.fsPath,
        configured: false,
        snapshot: this.#snapshot(managed.folder, true),
        canOpen: managed.controller.snapshot.state === "running",
      }));
    }
    return Object.freeze([...presentations.values()]);
  }

  #currentSnapshot(presentation = false): LocalHostSnapshot | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeFolder = activeUri === undefined ? undefined : vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder !== undefined) {
      const active = this.#isKnown(activeFolder) ? this.#snapshot(activeFolder, presentation) : undefined;
      if (active !== undefined && (active.state !== "stopped" || ![...this.#projects.values()].some(project => this.#snapshot(project.folder, presentation).state !== "stopped"))) return active;
    }
    const snapshots = [...this.#projects.values()].map(project => this.#snapshot(project.folder, presentation));
    return snapshots.find(snapshot => snapshot.state === "failed")
      ?? snapshots.find(snapshot => snapshot.state === "running")
      ?? snapshots.find(snapshot => snapshot.state === "starting" || snapshot.state === "stopping")
      ?? snapshots[0];
  }

  #updatePresentation(): void {
    const availability = local_host_command_availability(this.#presentations());
    void vscode.commands.executeCommand("setContext", "hson.localHost.canStart", availability.canStart);
    void vscode.commands.executeCommand("setContext", "hson.localHost.canStop", availability.canStop);
    void vscode.commands.executeCommand("setContext", "hson.localHost.canRestart", availability.canRestart);
    void vscode.commands.executeCommand("setContext", "hson.localHost.canOpen", availability.canOpen);
    this.#onState(this.#currentSnapshot(true)?.state ?? "stopped");
  }

  async #removeFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    this.#cancelBuild(folder);
    const key = folder.uri.toString();
    const managed = this.#projects.get(key);
    if (managed === undefined) return;
    await managed.controller.dispose();
    this.#projects.delete(key);
  }

  #reportError(error: unknown, folder: vscode.WorkspaceFolder): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#output.appendLine(`[host] ${error instanceof Error ? error.stack ?? message : message}`);
    this.#work(folder).failed = true;
    this.#updatePresentation();
    const summary = message.split(/\r?\n/, 1)[0].slice(0, 240);
    void vscode.window.showErrorMessage(`Hson Local App: ${summary} See Local App Output for details.`, "Show Hson Local App Output").then(action => {
      if (action === "Show Hson Local App Output") this.#output.show(true);
    });
  }
}

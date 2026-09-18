import * as vscode from "vscode";

import { LocalHostController, type LocalHostSnapshot, type LocalHostState } from "./local-host-controller.js";
import { local_app_quick_pick_actions, local_host_command_availability, type LocalAppAction, type LocalHostProjectPresentation } from "./local-host-presentation.js";
import { local_host_start_blocker, resolve_local_host_project, type LocalHostProjectSettings } from "./local-host-project.js";

type ManagedProject = Readonly<{
  folder: vscode.WorkspaceFolder;
  controller: LocalHostController;
}>;

export class LocalHostExtensionManager implements vscode.Disposable {
  readonly #context: vscode.ExtensionContext;
  readonly #output: vscode.OutputChannel;
  readonly #onState: (state: LocalHostState) => void;
  readonly #projects = new Map<string, ManagedProject>();
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
      vscode.commands.registerCommand("hson.showLocalHostOutput", () => this.#output.show(true)),
      vscode.window.onDidChangeActiveTextEditor(() => this.#updatePresentation()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("hson.localHost")) this.#updatePresentation();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(event => {
        for (const folder of event.removed) void this.#removeFolder(folder);
        this.#updatePresentation();
      }),
      { dispose: () => { void this.disposeAsync(); } },
    );
    this.#updatePresentation();
  }

  async start(requested?: vscode.Uri): Promise<void> {
    const folder = await this.#prepareFolder(requested, "start");
    if (folder === undefined) return;
    try {
      const project = await resolve_local_host_project(folder.uri.fsPath, folder.uri.toString(), this.#settings(folder));
      const managed = this.#managed(folder);
      await managed.controller.start(project);
      void vscode.window.showInformationMessage(`Hson local app is running at ${managed.controller.snapshot.httpUrl}.`);
    } catch (error) {
      this.#reportError(error);
    }
  }

  async stop(requested?: vscode.Uri): Promise<void> {
    const folder = await this.#selectFolder(requested, "stop");
    if (folder === undefined) return;
    const managed = this.#projects.get(folder.uri.toString());
    if (managed === undefined || managed.controller.snapshot.state === "stopped") {
      void vscode.window.showInformationMessage(`No extension-managed Hson local app is running for ${folder.name}.`);
      return;
    }
    await managed.controller.stop();
  }

  async restart(requested?: vscode.Uri): Promise<void> {
    const folder = await this.#prepareFolder(requested, "restart");
    if (folder === undefined) return;
    try {
      const project = await resolve_local_host_project(folder.uri.fsPath, folder.uri.toString(), this.#settings(folder));
      await this.#managed(folder).controller.restart(project);
    } catch (error) {
      this.#reportError(error);
    }
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

  #statusState(): LocalHostState {
    return this.#currentSnapshot()?.state ?? "stopped";
  }

  quickPickActions(): readonly LocalAppAction[] {
    return local_app_quick_pick_actions(this.#presentations());
  }

  dispose(): void {
    void this.disposeAsync();
  }

  async disposeAsync(): Promise<void> {
    if (this.#disposePromise === undefined) {
      this.#disposePromise = Promise.all([...this.#projects.values()].map(project => project.controller.dispose())).then(() => {
        this.#projects.clear();
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
      port: configuration.get<number>("port", 0),
    });
  }

  #isConfigured(folder: vscode.WorkspaceFolder): boolean {
    return this.#settings(folder).entry.trim() !== "";
  }

  #isKnown(folder: vscode.WorkspaceFolder): boolean {
    return this.#isConfigured(folder) || this.#projects.has(folder.uri.toString());
  }

  #eligible(folder: vscode.WorkspaceFolder, operation: "start" | "stop" | "restart" | "open"): boolean {
    const snapshot = this.#projects.get(folder.uri.toString())?.controller.snapshot;
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
        snapshot: managed?.controller.snapshot ?? Object.freeze({ state: "stopped", projectId }),
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
        snapshot: managed.controller.snapshot,
      }));
    }
    return Object.freeze([...presentations.values()]);
  }

  #currentSnapshot(): LocalHostSnapshot | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeFolder = activeUri === undefined ? undefined : vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder !== undefined) {
      const active = this.#projects.get(activeFolder.uri.toString())?.controller.snapshot
        ?? (this.#isConfigured(activeFolder) ? Object.freeze({ state: "stopped", projectId: activeFolder.uri.toString() }) : undefined);
      if (active !== undefined && (active.state !== "stopped" || ![...this.#projects.values()].some(project => project.controller.snapshot.state !== "stopped"))) return active;
    }
    const snapshots = [...this.#projects.values()].map(project => project.controller.snapshot);
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
    this.#onState(this.#statusState());
  }

  async #removeFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    const key = folder.uri.toString();
    const managed = this.#projects.get(key);
    if (managed === undefined) return;
    await managed.controller.dispose();
    this.#projects.delete(key);
  }

  #reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#output.appendLine(`[host] ${message}`);
    this.#output.show(true);
    void vscode.window.showErrorMessage(message, "Show Hson Local App Output").then(action => {
      if (action === "Show Hson Local App Output") this.#output.show(true);
    });
  }
}

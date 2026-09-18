import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

import { LocalHostController } from "../src/local-host-controller.js";
import { local_app_quick_pick_actions, local_app_status_presentation, local_host_command_availability, local_host_project_description, type LocalHostProjectPresentation } from "../src/local-host-presentation.js";
import { is_supported_livehost_node_runtime, local_host_start_blocker, resolve_local_host_project, type ResolvedLocalHostProject } from "../src/local-host-project.js";
import { is_loopback_local_host_url, LOCAL_HOST_PROTOCOL_VERSION, local_host_stop_request, parse_local_host_child_message, parse_local_host_stop_request } from "../src/local-host-protocol.js";

let checks = 0;
async function check(name: string, body: () => void | Promise<void>): Promise<void> {
  await body();
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid = 1234;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly sent: unknown[] = [];
  readonly killed: NodeJS.Signals[] = [];

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback?.(null);
    return true;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    this.signalCode = signal;
    queueMicrotask(() => this.emit("close", null, signal));
    return true;
  }

  message(message: unknown): void {
    this.emit("message", message);
  }

  close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }
}

const project = (projectId: string): ResolvedLocalHostProject => Object.freeze({
  projectId,
  workspaceFolder: "/workspace",
  entry: "/workspace/app.mjs",
  applicationExport: "application",
  nodeExecutable: "node",
  port: 0,
  hsonLiveRoot: "/workspace/node_modules/hson-live",
  hsonLiveNodeEntry: "/workspace/node_modules/hson-live/dist/api/livehost/node/index.js",
  hsonLiveVersion: "3.5.0",
});

const starting = (id: string) => ({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "starting", projectId: id, applicationEntry: "/workspace/app.mjs", nodeVersion: "22.20.0" } as const);
const hello = (id: string) => ({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "hello", projectId: id, applicationNames: ["app"], hsonLiveVersion: "3.5.0", nodeVersion: "22.20.0" } as const);
const ready = (id: string, port = 43123) => ({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "ready", projectId: id, httpUrl: `http://127.0.0.1:${port}`, port } as const);
const handshake = (child: FakeChild, id: string, port = 43123): void => {
  child.message(starting(id)); child.message(hello(id)); child.message(ready(id, port));
};

function fakeHsonPackage(root: string, version: string): void {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "hson-live", version, exports: { "./livehost/node": { import: "./dist/node.js" } } }));
  writeFileSync(join(root, "dist", "node.js"), "export function assert_supported_livehost_node_runtime() {}\nexport async function start_node_application_host() {}\n");
}

async function main(): Promise<void> {
await check("protocol v1 validates every child and stop DTO", () => {
  assert.deepEqual(parse_local_host_stop_request(local_host_stop_request()), local_host_stop_request());
  for (const message of [starting("a"), hello("a"), ready("a"), { protocolVersion: 1, type: "failure", projectId: "a", phase: "hosting", message: "no" }, { protocolVersion: 1, type: "stopped", projectId: "a" }]) {
    assert.deepEqual(parse_local_host_child_message(message), message);
  }
  assert.equal(parse_local_host_child_message({ ...ready("a"), protocolVersion: 2 }), undefined);
  assert.equal(parse_local_host_child_message({ ...ready("a"), httpUrl: "http://example.com:43123" }), undefined);
  assert.equal(parse_local_host_child_message({ ...ready("a"), port: 0 }), undefined);
  assert.equal(parse_local_host_stop_request({ protocolVersion: 1, type: "restart" }), undefined);
  assert.equal(is_loopback_local_host_url("http://127.0.0.1:80", 80), true);
  assert.equal(is_loopback_local_host_url("https://127.0.0.1:443", 443), true);
  assert.equal(is_loopback_local_host_url("http://127.0.0.1", 81), false);
});

await check("project resolution follows the application entry's package context and canonicalizes Node", async () => {
  const root = mkdtempSync(join(tmpdir(), "hson-local-host-resolution-"));
  try {
    const entry = join(root, "packages", "decks", "dist", "app.mjs");
    mkdirSync(join(root, "packages", "decks", "dist"), { recursive: true });
    writeFileSync(entry, "export const application = {};\n");
    fakeHsonPackage(join(root, "node_modules", "hson-live"), "1.0.0-root");
    fakeHsonPackage(join(root, "packages", "decks", "node_modules", "hson-live"), "2.0.0-package");
    const local = await resolve_local_host_project(root, "decks", { entry: "packages/decks/dist/app.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0 });
    assert.equal(local.hsonLiveVersion, "2.0.0-package");
    assert.equal(local.nodeExecutable, process.execPath);

    rmSync(join(root, "packages", "decks", "node_modules", "hson-live"), { recursive: true, force: true });
    const store = join(root, "node_modules", ".pnpm", "hson-live@3.0.0", "node_modules", "hson-live");
    fakeHsonPackage(store, "3.0.0-pnpm");
    symlinkSync(store, join(root, "packages", "decks", "node_modules", "hson-live"), "dir");
    const pnpm = await resolve_local_host_project(root, "decks", { entry: "packages/decks/dist/app.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0 });
    assert.equal(pnpm.hsonLiveVersion, "3.0.0-pnpm");

    if (process.platform !== "win32") {
      const wrapper = join(root, "node-wrapper.sh");
      writeFileSync(wrapper, `#!/bin/sh\n${JSON.stringify(process.execPath)} "$@"\n`);
      chmodSync(wrapper, 0o755);
      const wrapped = await resolve_local_host_project(root, "decks", { entry: "packages/decks/dist/app.mjs", applicationExport: "application", nodeExecutable: wrapper, port: 0 });
      assert.equal(wrapped.nodeExecutable, process.execPath);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("runtime compatibility and workspace security gates are explicit", () => {
  assert.equal(is_supported_livehost_node_runtime("22.12.0"), true);
  assert.equal(is_supported_livehost_node_runtime("24.9.1"), true);
  assert.equal(is_supported_livehost_node_runtime("22.11.0"), false);
  assert.equal(is_supported_livehost_node_runtime("25.0.0"), false);
  assert.match(local_host_start_blocker(false, undefined) ?? "", /Restricted Mode/);
  assert.match(local_host_start_blocker(true, "ssh-remote") ?? "", /disabled in remote workspaces/);
  assert.equal(local_host_start_blocker(true, undefined), undefined);
});

await check("project resolution requires built workspace code and workspace hson-live", async () => {
  const root = mkdtempSync(join(tmpdir(), "hson-local-host-project-"));
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "app.mjs"), "export const application = {};\n");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    const repositoryRoot = join(__dirname, "../../..");
    symlinkSync(repositoryRoot, join(root, "node_modules", "hson-live"), "dir");
    const resolved = await resolve_local_host_project(root, "fixture", { entry: "dist/app.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0 });
    assert.equal(resolved.entry, join(root, "dist", "app.mjs"));
    assert.equal(resolved.hsonLiveVersion, "3.5.0");
    await assert.rejects(resolve_local_host_project(root, "fixture", { entry: "src/app.ts", applicationExport: "application", nodeExecutable: process.execPath, port: 0 }), /does not exist|built JavaScript/);
    await assert.rejects(resolve_local_host_project(root, "fixture", { entry: "../outside.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0 }), /within its workspace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("controller transitions through starting, running, and idempotent stop", async () => {
  const child = new FakeChild();
  let launches = 0;
  const states: string[] = [];
  const controller = new LocalHostController("one", { runnerPath: "/runner.cjs", launch: () => { launches += 1; return child as unknown as ChildProcess; }, onState: snapshot => states.push(snapshot.state) });
  const first = controller.start(project("one"));
  const duplicate = controller.start(project("one"));
  assert.equal(first, duplicate);
  assert.equal(launches, 1);
  handshake(child, "one");
  assert.equal((await first).httpUrl, "http://127.0.0.1:43123");
  const stopOne = controller.stop();
  const stopTwo = controller.stop();
  assert.equal(stopOne, stopTwo);
  assert.deepEqual(child.sent, [local_host_stop_request()]);
  child.close();
  await stopOne;
  assert.deepEqual(states, ["starting", "starting", "running", "stopping", "stopped", "stopped"]);
});

await check("restart uses a fresh child and stale child messages are ignored", async () => {
  const firstChild = new FakeChild();
  const secondChild = new FakeChild();
  const children = [firstChild, secondChild];
  let launchIndex = 0;
  const controller = new LocalHostController("restart", { runnerPath: "/runner.cjs", launch: () => children[launchIndex++] as unknown as ChildProcess });
  const initial = controller.start(project("restart"));
  handshake(firstChild, "restart", 41001);
  await initial;
  const restarted = controller.restart(project("restart"));
  firstChild.close();
  await new Promise(resolve => setImmediate(resolve));
  firstChild.message(ready("restart", 49999));
  handshake(secondChild, "restart", 41002);
  assert.equal((await restarted).port, 41002);
  assert.equal(launchIndex, 2);
  const stopping = controller.stop(); secondChild.close(); await stopping;
});

await check("crashes fail only their own project controller", async () => {
  const childA = new FakeChild(), childB = new FakeChild();
  const a = new LocalHostController("a", { runnerPath: "/runner", launch: () => childA as unknown as ChildProcess });
  const b = new LocalHostController("b", { runnerPath: "/runner", launch: () => childB as unknown as ChildProcess });
  const startedA = a.start(project("a")), startedB = b.start(project("b"));
  handshake(childA, "a", 42001); handshake(childB, "b", 42002);
  await Promise.all([startedA, startedB]);
  childA.close(7);
  assert.equal(a.snapshot.state, "failed");
  assert.equal(b.snapshot.state, "running");
  const stop = b.stop(); childB.close(); await stop;
});

await check("hung graceful shutdown receives bounded forced termination", async () => {
  const child = new FakeChild();
  const output: string[] = [];
  const controller = new LocalHostController("hung", { runnerPath: "/runner", launch: () => child as unknown as ChildProcess, shutdownTimeoutMs: 5, forceExitTimeoutMs: 5, output: (_channel, text) => output.push(text) });
  const start = controller.start(project("hung")); handshake(child, "hung"); await start;
  await controller.stop();
  assert.deepEqual(child.killed, ["SIGKILL"]);
  assert.ok(output.some(line => line.includes("forcing termination")));
});

await check("controller rejects out-of-order and late ready messages", async () => {
  const child = new FakeChild();
  const output: string[] = [];
  const controller = new LocalHostController("ordered", { runnerPath: "/runner", launch: () => child as unknown as ChildProcess, output: (_channel, text) => output.push(text) });
  const start = controller.start(project("ordered"));
  child.message(ready("ordered", 43001));
  assert.equal(controller.snapshot.state, "starting");
  handshake(child, "ordered", 43002);
  assert.equal((await start).port, 43002);
  const stop = controller.stop();
  child.message(ready("ordered", 43003));
  assert.equal(controller.snapshot.state, "stopping");
  child.close(); await stop;
  assert.ok(output.some(line => line.includes("out-of-order")));
});

await check("failed live child is closed before its replacement launches", async () => {
  const firstChild = new FakeChild(), secondChild = new FakeChild();
  const children = [firstChild, secondChild];
  let launches = 0;
  const controller = new LocalHostController("failed-restart", { runnerPath: "/runner", launch: () => children[launches++] as unknown as ChildProcess });
  const first = controller.start(project("failed-restart"));
  firstChild.message(starting("failed-restart"));
  firstChild.message({ protocolVersion: 1, type: "failure", projectId: "failed-restart", phase: "application", message: "broken" });
  await assert.rejects(first, /broken/);
  const replacement = controller.start(project("failed-restart"));
  assert.equal(launches, 1);
  assert.deepEqual(firstChild.sent, [local_host_stop_request()]);
  firstChild.close(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(launches, 2);
  handshake(secondChild, "failed-restart", 44002);
  assert.equal((await replacement).port, 44002);
  const stop = controller.stop(); secondChild.close(); await stop;
});

await check("multi-root availability and same-name identity remain unambiguous", () => {
  const presentations: LocalHostProjectPresentation[] = [
    { projectId: "file:///one/decks", name: "decks", detail: "/one/decks", configured: true, snapshot: { projectId: "file:///one/decks", state: "running", httpUrl: "http://127.0.0.1:45001" } },
    { projectId: "file:///two/decks", name: "decks", detail: "/two/decks", configured: true, snapshot: { projectId: "file:///two/decks", state: "stopped" } },
  ];
  assert.deepEqual(local_host_command_availability(presentations), { canStart: true, canStop: true, canRestart: true, canOpen: true });
  assert.notEqual(local_host_project_description(presentations[0]!), local_host_project_description(presentations[1]!));
  assert.deepEqual(local_app_quick_pick_actions(presentations).map(action => action.label), [
    "Open Local App", "Run Local App", "Restart Local App", "Stop Local App", "Show Local App Output",
  ]);
});

await check("local-app Quick Pick exposes only actions applicable to each lifecycle state", () => {
  const labels = (state: LocalHostProjectPresentation["snapshot"]["state"]): readonly string[] => {
    const snapshot = state === "running"
      ? { projectId: "file:///decks", state, httpUrl: "http://127.0.0.1:45100" } as const
      : { projectId: "file:///decks", state } as const;
    return local_app_quick_pick_actions([{ projectId: "file:///decks", name: "decks", detail: "/workspace/decks", configured: true, snapshot }]).map(action => action.label);
  };
  assert.deepEqual(labels("stopped"), ["Run Local App", "Show Local App Output"]);
  assert.deepEqual(labels("starting"), ["Stop Local App", "Show Local App Output"]);
  assert.deepEqual(labels("running"), ["Open Local App", "Restart Local App", "Stop Local App", "Show Local App Output"]);
  assert.deepEqual(labels("stopping"), ["Show Local App Output"]);
  assert.deepEqual(labels("failed"), ["Run Local App", "Show Local App Output"]);
});

await check("local-app Quick Pick actions route through the existing command IDs", () => {
  const projects: LocalHostProjectPresentation[] = [
    { projectId: "file:///running", name: "running", detail: "/workspace/running", configured: true, snapshot: { projectId: "file:///running", state: "running", httpUrl: "http://127.0.0.1:45101" } },
    { projectId: "file:///stopped", name: "stopped", detail: "/workspace/stopped", configured: true, snapshot: { projectId: "file:///stopped", state: "stopped" } },
  ];
  assert.deepEqual(local_app_quick_pick_actions(projects).map(action => action.command), [
    "hson.openLocalApp", "hson.startLocalHost", "hson.restartLocalHost", "hson.stopLocalHost", "hson.showLocalHostOutput",
  ]);
});

await check("local-app status presentation uses application wording and project detail", () => {
  const projectPresentation: LocalHostProjectPresentation = {
    projectId: "file:///workspace/decks", name: "decks", detail: "/workspace/decks", configured: true,
    snapshot: { projectId: "file:///workspace/decks", state: "running", httpUrl: "http://127.0.0.1:45102" },
  };
  assert.deepEqual(local_app_status_presentation({ projectId: projectPresentation.projectId, state: "stopped" }, projectPresentation), {
    text: "$(debug-stop) Hson: App Stopped",
    tooltip: "decks — /workspace/decks\nHson local app is stopped.",
  });
  assert.equal(local_app_status_presentation({ projectId: projectPresentation.projectId, state: "starting" }, projectPresentation).text, "$(loading~spin) Hson: App Starting · decks");
  assert.deepEqual(local_app_status_presentation(projectPresentation.snapshot, projectPresentation), {
    text: "$(radio-tower) Hson: App Running · decks",
    tooltip: "decks — /workspace/decks\nHson local app: http://127.0.0.1:45102",
  });
  assert.equal(local_app_status_presentation({ projectId: projectPresentation.projectId, state: "stopping" }, projectPresentation).text, "$(loading~spin) Hson: App Stopping · decks");
  assert.deepEqual(local_app_status_presentation({ projectId: projectPresentation.projectId, state: "failed", failure: "broken" }, projectPresentation), {
    text: "$(error) Hson: App Failed · decks",
    tooltip: "decks — /workspace/decks\nHson local app failed: broken",
  });
});

process.stdout.write(`ok - ${checks} local-host protocol, configuration, lifecycle, crash, multi-project, and trust checks passed\n`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

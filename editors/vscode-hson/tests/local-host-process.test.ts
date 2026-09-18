import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { LocalHostController, launch_local_host_child } from "../src/local-host-controller.js";
import { resolve_local_host_project, type ResolvedLocalHostProject } from "../src/local-host-project.js";

const extensionRoot = resolve(__dirname, "..");
const repositoryRoot = resolve(__dirname, "../../..");
const runnerPath = join(extensionRoot, "dist", "local-host-runner.cjs");
const temporaryRoots: string[] = [];

function workspace(name: string, disposeBody = ""): string {
  const root = mkdtempSync(join(tmpdir(), `hson-local-host-${name}-`));
  temporaryRoots.push(root);
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(repositoryRoot, join(root, "node_modules", "hson-live"), "dir");
  writeFileSync(join(root, "dist", "app.mjs"), `
export const application = {
  name: ${JSON.stringify(name)},
  requests: [
    { method: "GET", path: "/hello", handle() { return new Response(${JSON.stringify(`hello:${name}`)}); } },
    { method: "GET", path: "/pid", handle() { return new Response(String(process.pid)); } }
  ],
  dispose() { ${disposeBody} }
};
`);
  return root;
}

function lines(path: string): string[] {
  try { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean); } catch { return []; }
}

function gatedWorkspace(name: string, applicationSource: (log: string) => string): Readonly<{ root: string; log: string }> {
  const root = mkdtempSync(join(tmpdir(), `hson-local-host-${name}-`));
  temporaryRoots.push(root);
  const log = join(root, "lifecycle.txt");
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(repositoryRoot, join(root, "node_modules", "hson-live"), "dir");
  writeFileSync(join(root, "dist", "app.mjs"), applicationSource(log));
  return Object.freeze({ root, log });
}

function fakeDelayedLiveHost(root: string, log: string): void {
  const packageRoot = join(root, "node_modules", "hson-live");
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "hson-live", version: "9.0.0-test", type: "module", exports: { "./livehost/node": { import: "./dist/node.js" } } }));
  writeFileSync(join(packageRoot, "dist", "node.js"), `
import { appendFileSync } from "node:fs";
const log = ${JSON.stringify(log)};
export function assert_supported_livehost_node_runtime() {}
export async function start_node_application_host({ applications }) {
  appendFileSync(log, "host-start\\n");
  await new Promise(resolve => process.on("message", message => {
    if (message?.type === "stop") { appendFileSync(log, "host-stop-observed\\n"); resolve(); }
  }));
  return {
    httpUrl: "http://127.0.0.1:47891", port: 47891,
    async dispose() {
      appendFileSync(log, "host-dispose\\n");
      for (const application of applications) await application.dispose();
    }
  };
}
`);
}

async function resolved(root: string): Promise<ResolvedLocalHostProject> {
  return resolve_local_host_project(root, root, { entry: "dist/app.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0 });
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function main(): Promise<void> {
try {
  const firstRoot = workspace("first");
  const pids: number[] = [];
  const controller = new LocalHostController(firstRoot, {
    runnerPath,
    launch(project, runner) {
      const child = launch_local_host_child(project, runner);
      if (child.pid !== undefined) pids.push(child.pid);
      return child;
    },
  });
  const first = await controller.start(await resolved(firstRoot));
  assert.equal(first.state, "running");
  assert.ok(first.httpUrl); assert.ok(first.port && first.port > 0);
  assert.deepEqual(await (await fetch(`${first.httpUrl}/healthz`)).json(), { ready: true, applications: [{ name: "first", ready: true }] });
  assert.equal(await (await fetch(`${first.httpUrl}/hello`)).text(), "hello:first");
  const restarted = await controller.restart(await resolved(firstRoot));
  assert.equal(restarted.state, "running");
  assert.equal(pids.length, 2); assert.notEqual(pids[0], pids[1]);
  await controller.stop();
  await waitFor(() => pids.every(pid => !alive(pid)), "stopped and restarted children remained alive");

  const alphaRoot = workspace("alpha"), betaRoot = workspace("beta");
  const alphaPids: number[] = [], betaPids: number[] = [];
  const make = (root: string, observed: number[]) => new LocalHostController(root, { runnerPath, launch(project, runner) { const child = launch_local_host_child(project, runner); if (child.pid !== undefined) observed.push(child.pid); return child; } });
  const alpha = make(alphaRoot, alphaPids), beta = make(betaRoot, betaPids);
  const [alphaReady, betaReady] = await Promise.all([alpha.start(await resolved(alphaRoot)), beta.start(await resolved(betaRoot))]);
  assert.notEqual(alphaReady.port, betaReady.port);
  assert.equal(await (await fetch(`${alphaReady.httpUrl}/hello`)).text(), "hello:alpha");
  assert.equal(await (await fetch(`${betaReady.httpUrl}/hello`)).text(), "hello:beta");
  process.kill(alphaPids[0]!, "SIGKILL");
  await waitFor(() => alpha.snapshot.state === "failed", "crashed child did not enter failed state");
  assert.equal(beta.snapshot.state, "running");
  await Promise.all([alpha.dispose(), beta.dispose()]);
  await waitFor(() => [...alphaPids, ...betaPids].every(pid => !alive(pid)), "multi-project child remained alive after disposal");

  const hungRoot = workspace("hung", "return new Promise(() => {});");
  let hungChild: ChildProcess | undefined;
  const logs: string[] = [];
  const hung = new LocalHostController(hungRoot, { runnerPath, shutdownTimeoutMs: 50, forceExitTimeoutMs: 250, output: (_channel, text) => logs.push(text), launch(project, runner) { hungChild = launch_local_host_child(project, runner); return hungChild; } });
  await hung.start(await resolved(hungRoot));
  const hungPid = hungChild?.pid;
  assert.ok(hungPid);
  await hung.dispose();
  await waitFor(() => !alive(hungPid), "forced child remained alive after controller disposal");
  assert.ok(logs.some(line => line.includes("forcing termination")));

  const moduleGate = gatedWorkspace("module-gate", log => `
import { appendFileSync } from "node:fs";
const log = ${JSON.stringify(log)};
appendFileSync(log, "module-start\\n");
await new Promise(resolve => process.on("message", message => {
  if (message?.type === "stop") { appendFileSync(log, "module-stop-observed\\n"); resolve(); }
}));
appendFileSync(log, "module-finished\\n");
export function application() {
  appendFileSync(log, "factory-called\\n");
  return { name: "module-gate", dispose() { appendFileSync(log, "application-dispose\\n"); } };
}
`);
  const moduleController = new LocalHostController(moduleGate.root, { runnerPath });
  const moduleStart = assert.rejects(moduleController.start(await resolved(moduleGate.root)), /stopped before readiness/);
  await waitFor(() => lines(moduleGate.log).includes("module-start"), "module loading gate did not start");
  await moduleController.stop(); await moduleStart;
  assert.deepEqual(lines(moduleGate.log), ["module-start", "module-stop-observed", "module-finished"]);

  const factoryGate = gatedWorkspace("factory-gate", log => `
import { appendFileSync } from "node:fs";
const log = ${JSON.stringify(log)};
export async function application() {
  appendFileSync(log, "factory-start\\n");
  await new Promise(resolve => process.on("message", message => {
    if (message?.type === "stop") { appendFileSync(log, "factory-stop-observed\\n"); resolve(); }
  }));
  return { name: "factory-gate", dispose() { appendFileSync(log, "application-dispose\\n"); } };
}
`);
  const factoryController = new LocalHostController(factoryGate.root, { runnerPath });
  const factoryStart = assert.rejects(factoryController.start(await resolved(factoryGate.root)), /stopped before readiness/);
  await waitFor(() => lines(factoryGate.log).includes("factory-start"), "async factory gate did not start");
  await factoryController.stop(); await factoryStart;
  assert.deepEqual(lines(factoryGate.log), ["factory-start", "factory-stop-observed", "application-dispose"]);

  const hostRoot = mkdtempSync(join(tmpdir(), "hson-local-host-host-gate-"));
  temporaryRoots.push(hostRoot);
  const hostLog = join(hostRoot, "lifecycle.txt");
  mkdirSync(join(hostRoot, "dist"), { recursive: true });
  writeFileSync(join(hostRoot, "dist", "app.mjs"), `
import { appendFileSync } from "node:fs";
const log = ${JSON.stringify(hostLog)};
export const application = { name: "host-gate", dispose() { appendFileSync(log, "application-dispose\\n"); } };
`);
  fakeDelayedLiveHost(hostRoot, hostLog);
  const hostController = new LocalHostController(hostRoot, { runnerPath });
  const hostStart = assert.rejects(hostController.start(await resolved(hostRoot)), /stopped before readiness/);
  await waitFor(() => lines(hostLog).includes("host-start"), "LiveHost startup gate did not start");
  await hostController.stop(); await hostStart;
  assert.deepEqual(lines(hostLog), ["host-start", "host-stop-observed", "host-dispose", "application-dispose"]);

  if (process.platform !== "win32") {
    const wrapperRoot = workspace("wrapper", "while (true) {}");
    const wrapper = join(wrapperRoot, "node-wrapper.sh");
    writeFileSync(wrapper, `#!/bin/sh\n${JSON.stringify(process.execPath)} "$@"\n`);
    chmodSync(wrapper, 0o755);
    const wrapperProject = await resolve_local_host_project(wrapperRoot, wrapperRoot, { entry: "dist/app.mjs", applicationExport: "application", nodeExecutable: wrapper, port: 0 });
    assert.equal(wrapperProject.nodeExecutable, process.execPath);
    let actualChild: ChildProcess | undefined;
    const wrapperController = new LocalHostController(wrapperRoot, { runnerPath, shutdownTimeoutMs: 50, forceExitTimeoutMs: 250, launch(project, runner) { actualChild = launch_local_host_child(project, runner); return actualChild; } });
    const wrapperReady = await wrapperController.start(wrapperProject);
    assert.equal(Number(await (await fetch(`${wrapperReady.httpUrl}/pid`)).text()), actualChild?.pid);
    const actualPid = actualChild?.pid; assert.ok(actualPid);
    await wrapperController.stop();
    await waitFor(() => !alive(actualPid), "canonical runner survived forced termination");
  }

  const parentLossRoot = workspace("parent-loss");
  let parentLossChild: ChildProcess | undefined;
  const parentLossController = new LocalHostController(parentLossRoot, { runnerPath, launch(project, runner) { parentLossChild = launch_local_host_child(project, runner); return parentLossChild; } });
  await parentLossController.start(await resolved(parentLossRoot));
  const parentLossPid = parentLossChild?.pid; assert.ok(parentLossPid);
  parentLossChild?.disconnect();
  await waitFor(() => !alive(parentLossPid) && parentLossController.snapshot.state === "failed", "runner survived parent IPC loss or controller missed its close");
  assert.equal(parentLossController.snapshot.state, "failed");

  const cjsRoot = workspace("cjs-default");
  writeFileSync(join(cjsRoot, "dist", "app.cjs"), `module.exports = {
    name: "cjs-default",
    requests: [{ method: "GET", path: "/cjs", handle() { return new Response("cjs-ok"); } }],
    dispose() {}
  };\n`);
  const cjsProject = await resolve_local_host_project(cjsRoot, cjsRoot, { entry: "dist/app.cjs", applicationExport: "default", nodeExecutable: process.execPath, port: 0 });
  const cjsController = new LocalHostController(cjsRoot, { runnerPath });
  const cjsReady = await cjsController.start(cjsProject);
  assert.equal(await (await fetch(`${cjsReady.httpUrl}/cjs`)).text(), "cjs-ok");
  await cjsController.stop();

  const errorRoot = workspace("load-error");
  writeFileSync(join(errorRoot, "dist", "app.mjs"), 'throw new Error("application-load-probe");\n');
  let errorChild: ChildProcess | undefined;
  const errorController = new LocalHostController(errorRoot, { runnerPath, launch(project, runner) { errorChild = launch_local_host_child(project, runner); return errorChild; } });
  await assert.rejects(errorController.start(await resolved(errorRoot)), /application-load-probe/);
  const errorPid = errorChild?.pid; assert.ok(errorPid);
  await waitFor(() => !alive(errorPid), "application-load failure left its runner alive");
  assert.equal(errorController.snapshot.state, "failed");

  process.stdout.write("ok - real child startup, ESM/CJS loading, startup-stop disposal gates, canonical Node ownership, parent loss, restart, crash, forced stop, and two-project isolation passed\n");
} finally {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
}
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

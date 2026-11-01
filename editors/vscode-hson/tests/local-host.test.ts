import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

import { LocalHostController, LocalHostFailure } from "../src/local-host-controller.js";
import { local_app_quick_pick_actions, local_host_command_availability, type LocalHostProjectPresentation } from "../src/local-host-presentation.js";
import { is_supported_livehost_node_runtime, local_host_start_blocker, resolve_local_host_project, type ResolvedLocalHostProject } from "../src/local-host-project.js";
import { capture_local_host_error, local_host_error_details, local_host_error_summary, is_loopback_local_host_url, local_host_stop_request, parse_local_host_child_message, parse_local_host_stop_request } from "../src/local-host-protocol.js";

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

const starting = (id: string) => ({ type: "starting", projectId: id, applicationEntry: "/workspace/app.mjs", nodeVersion: "22.20.0" } as const);
const hello = (id: string) => ({ type: "hello", projectId: id, applicationNames: ["app"], hsonLiveVersion: "3.5.0", nodeVersion: "22.20.0" } as const);
const ready = (id: string, port = 43123) => ({ type: "ready", projectId: id, httpUrl: `http://127.0.0.1:${port}`, port } as const);
const handshake = (child: FakeChild, id: string, port = 43123): void => {
  child.message(starting(id)); child.message(hello(id)); child.message(ready(id, port));
};

function fakeHsonPackage(root: string, version: string): void {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "hson-live", version, exports: { "./livehost/node": { import: "./dist/node.js" } } }));
  writeFileSync(join(root, "dist", "node.js"), "export function assert_supported_livehost_node_runtime() {}\nexport async function start_node_application_host() {}\n");
}

async function main(): Promise<void> {
await check("current IPC shapes validate every child and stop DTO", () => {
  assert.deepEqual(parse_local_host_stop_request(local_host_stop_request()), local_host_stop_request());
  for (const message of [starting("a"), hello("a"), ready("a"), { type: "failure", projectId: "a", phase: "hosting", error: { message: "no" } }, { type: "stopped", projectId: "a" }]) {
    assert.deepEqual(parse_local_host_child_message(message), message);
  }
  assert.equal(parse_local_host_child_message({ ...ready("a"), httpUrl: "http://example.com:43123" }), undefined);
  assert.equal(parse_local_host_child_message({ ...ready("a"), port: 0 }), undefined);
  assert.equal(parse_local_host_stop_request({ type: "restart" }), undefined);
  for (const invalid of [null, [], { ...ready("a"), extra: true }, { ...hello("a"), applicationNames: [] }, { ...starting("a"), projectId: "" }, { type: "unknown" }]) {
    assert.equal(parse_local_host_child_message(invalid), undefined);
  }
  assert.equal(parse_local_host_stop_request({ type: "stop", extra: true }), undefined);
  assert.equal(is_loopback_local_host_url("http://127.0.0.1:80", 80), true);
  assert.equal(is_loopback_local_host_url("https://127.0.0.1:443", 443), true);
  assert.equal(is_loopback_local_host_url("http://127.0.0.1", 81), false);
});

await check("bounded failure evidence preserves causes, aggregates, Schema issues, and grounded locations", () => {
  const issues = [{ code: "WRONG_TYPE", path: ["items", 0], message: "Expected a number", expected: "number", received: "string" }];
  const leaf = Object.assign(new TypeError("Expected a number"), { code: "SCHEMA_VALIDATION", issues, source: { index: 7, line: 2, column: 3 }, fileName: "/workspace/input.hson" });
  const thrown = new AggregateError([leaf, "other failure"], "Application failed", { cause: new Error("nested explanation") });
  const evidence = capture_local_host_error(thrown);
  assert.equal(evidence.stack, thrown.stack);
  assert.equal(evidence.message, "Application failed");
  assert.equal(evidence.cause?.message, "nested explanation");
  assert.equal(evidence.errors?.[0]?.name, "TypeError");
  assert.equal(evidence.errors?.[0]?.code, "SCHEMA_VALIDATION");
  assert.deepEqual(JSON.parse(JSON.stringify(evidence.errors?.[0]?.issues)), issues);
  assert.deepEqual(JSON.parse(JSON.stringify(evidence.errors?.[0]?.details)), { source: { index: 7, line: 2, column: 3 }, fileName: "/workspace/input.hson" });
  assert.equal(evidence.errors?.[1]?.message, "other failure");
  const dto = { type: "failure", projectId: "a", phase: "application", error: evidence };
  assert.deepEqual(parse_local_host_child_message(JSON.parse(JSON.stringify(dto))), JSON.parse(JSON.stringify(dto)));
  assert.equal(parse_local_host_child_message({ ...dto, error: { message: "bad", cause: 1 } }), undefined);
  assert.equal(parse_local_host_child_message({ ...dto, error: { message: "bad", stack: 1 } }), undefined);
  assert.equal(parse_local_host_child_message({ ...dto, error: { message: "x".repeat(130_000) } }), undefined);
  assert.match(local_host_error_details(evidence), /Caused by:[\s\S]*nested explanation[\s\S]*Aggregate member 1:[\s\S]*WRONG_TYPE/);
  const compiled = capture_local_host_error(new Error("at /workspace/dist/app.js:20:3"));
  assert.equal(compiled.details, undefined, "Compiled frames and message text cannot establish authored source coordinates");
});

await check("non-Errors, cycles, oversized and unusual thrown values remain serializable and bounded", () => {
  const cyclic = new Error("cyclic"); cyclic.cause = cyclic;
  for (const value of [undefined, null, 3n, Symbol("failure"), { reason: "plain object" }, cyclic, Object.create(null),
    Object.defineProperty({}, "message", { get() { throw new Error("getter"); } }),
    new Proxy({}, { get() { throw 0; }, ownKeys() { throw 0; } })]) {
    const error = capture_local_host_error(value);
    assert.ok(error.message.length > 0);
    assert.ok(parse_local_host_child_message(JSON.parse(JSON.stringify({ type: "failure", projectId: "a", phase: "runtime", error }))));
  }
  assert.match(capture_local_host_error(cyclic).cause?.message ?? "", /circular/);
  const huge = capture_local_host_error(new AggregateError(Array.from({ length: 100 }, () => new Error("x".repeat(100_000))), "large"));
  assert.ok(JSON.stringify(huge).length < 128_000);
  assert.ok(parse_local_host_child_message({ type: "failure", projectId: "a", phase: "runtime", error: huge }));
  const broad = capture_local_host_error(Object.assign(new AggregateError(Array.from({ length: 32 }, () => new AggregateError(Array.from({ length: 32 }, () => new Error("member")), "group")), "groups"), {
    issues: [Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["field" + i, i]))],
  }));
  const wide = capture_local_host_error(Object.assign(new Error("wide Schema issue"), { issues: [Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["field" + i, i]))] }));
  for (const error of [broad, wide]) assert.ok(parse_local_host_child_message(JSON.parse(JSON.stringify({ type: "failure", projectId: "a", phase: "runtime", error }))));
  const coded = capture_local_host_error({ code: "THROWN_VALUE", source: { index: 4 } });
  assert.equal(coded.code, "THROWN_VALUE");
  assert.deepEqual(JSON.parse(JSON.stringify(coded.details)), { source: { index: 4 } });
  const hostile = Object.assign(new Error("hostile aggregate"), { errors: new Proxy([], { get() { throw 0; } }) });
  assert.match(JSON.stringify(capture_local_host_error(hostile)), /Unreadable aggregate/);
  const wrapped = capture_local_host_error(new Error("Application loading failed", { cause: new Error("[ERR: transform = tokenize-hson()]:\n  -> unterminated angle construct at 1:1 (index 0)") }));
  assert.match(local_host_error_summary(wrapped), /^unterminated angle construct/);
  assert.doesNotMatch(local_host_error_summary(wrapped), /\n|\[ERR:/);
});

await check("controller exposes one primary identity and distinct cleanup evidence without logging stacks", async () => {
  const child = new FakeChild(), output: string[] = [], events: { failure: LocalHostFailure; startup: boolean; primary: boolean }[] = [];
  const controller = new LocalHostController("evidence", { runnerPath: "/runner", launch: () => child as unknown as ChildProcess,
    output: (_channel, text) => output.push(text), onFailure: (failure, startup, primary) => events.push({ failure, startup, primary }) });
  const start = controller.start(project("evidence"));
  const rejection = assert.rejects(start, error => error === controller.snapshot.failure);
  const original = Object.assign(new Error("original failure", { cause: new Error("inner") }), { issues: [{ code: "SCHEMA", message: "issue" }] });
  const error = capture_local_host_error(original);
  child.message({ type: "failure", projectId: "evidence", phase: "application", error });
  const primary = controller.snapshot.failure;
  child.message({ type: "failure", projectId: "evidence", phase: "runtime", error });
  child.message({ type: "failure", projectId: "evidence", phase: "shutdown", error: capture_local_host_error(new Error("cleanup failure")) });
  await rejection;
  assert.equal(controller.snapshot.failure, primary);
  assert.equal(primary?.stack, original.stack);
  assert.equal(primary?.evidence.cause?.message, "inner");
  assert.equal(primary?.additional.length, 1);
  assert.equal(primary.additional[0]?.message, "cleanup failure");
  assert.deepEqual(events.map(({ startup, primary }) => [startup, primary]), [[true, true], [true, false]]);
  assert.ok(output.every(text => !text.includes("original failure") && !text.includes("out-of-order")));
  const stop = controller.stop(); child.close(1); await stop;
});

await check("post-readiness and Stop-time failures preserve state and emit evidence once", async () => {
  for (const stopping of [false, true]) {
    const child = new FakeChild(), events: boolean[][] = [];
    const controller = new LocalHostController("runtime", { runnerPath: "/runner", launch: () => child as unknown as ChildProcess,
      onFailure: (_error, startup, primary) => events.push([startup, primary]) });
    const start = controller.start(project("runtime")); handshake(child, "runtime"); await start;
    const stop = stopping ? controller.stop() : undefined;
    const failure = { type: "failure", projectId: "runtime", phase: "shutdown", error: capture_local_host_error(new Error("dispose failed")) };
    child.message(failure); child.message(failure);
    assert.equal(controller.snapshot.state, stopping ? "stopping" : "failed");
    assert.deepEqual(events, [[false, !stopping]]);
    child.close(1); await (stop ?? controller.stop());
  }
});

await check("graceful-stop delivery errors preserve their original evidence without changing stop semantics", async () => {
  const original = Object.assign(new Error("stop delivery failed", { cause: new Error("pipe closed") }), { code: "EPIPE" });
  class FailingStopChild extends FakeChild { override send(): boolean { throw original; } }
  const child = new FailingStopChild(), failures: LocalHostFailure[] = [];
  const controller = new LocalHostController("delivery", { runnerPath: "/runner", launch: () => child as unknown as ChildProcess,
    onFailure: (failure, _startup, primary) => { assert.equal(primary, false); failures.push(failure); } });
  const start = controller.start(project("delivery")); handshake(child, "delivery"); await start;
  const stop = controller.stop();
  assert.equal(controller.snapshot.state, "stopping");
  assert.equal(failures[0]?.phase, "shutdown");
  assert.equal(failures[0]?.stack, original.stack);
  assert.equal(failures[0]?.evidence.code, "EPIPE");
  assert.equal(failures[0]?.evidence.cause?.message, "pipe closed");
  child.close(); await stop;
  assert.equal(controller.snapshot.state, "stopped");
});

await check("transport budgets admit captured boundaries and reject immediately excessive records", () => {
  const admit = (error: unknown) => parse_local_host_child_message(JSON.parse(JSON.stringify({ type: "failure", projectId: "a", phase: "application", error })));
  // The message key also consumes seven UTF-16 code units.
  assert.ok(admit({ message: "x".repeat(128_000 - 7) }));
  assert.equal(admit({ message: "x".repeat(128_000 - 6) }), undefined);
  assert.ok(admit({ message: "漢".repeat(128_000 - 7) }));
  const tree = (nodes: number): unknown => {
    if (nodes === 1) return null;
    const left = Math.floor((nodes - 1) / 2), right = nodes - 1 - left;
    return left === 0 ? [tree(right)] : [tree(left), tree(right)];
  };
  assert.ok(admit({ message: "x", issues: tree(16_384 - 4) }));
  assert.equal(admit({ message: "x", issues: tree(16_384 - 3) }), undefined);
  assert.ok(admit({ message: "x", errors: Array.from({ length: 33 }, () => ({ message: "member" })) }));
  assert.equal(admit({ message: "x", errors: Array.from({ length: 34 }, () => ({ message: "member" })) }), undefined);
  let nested: unknown = null;
  for (let i = 0; i < 19; i++) nested = [nested];
  assert.ok(admit({ message: "x", issues: nested }));
  assert.equal(admit({ message: "x", issues: [nested] }), undefined);
  let deep = new Error("deep useful explanation");
  for (let i = 0; i < 30; i++) deep = new Error("wrapper", { cause: deep });
  const cyclic = new Error("cycle"); cyclic.cause = cyclic;
  for (const size of [15_999, 16_000, 16_001, 127_999, 128_000, 128_001]) {
    for (const char of ["x", "漢"]) {
      const error = capture_local_host_error(Object.assign(new Error("meaningful primary"), { issues: Array.from({ length: 32 }, () => ({ message: char.repeat(size), nested: { path: ["item", 0] } })) }));
      assert.ok(admit(error));
      assert.match(error.message, /meaningful primary/);
      assert.ok(JSON.stringify(error).length < 800_000);
    }
  }
  for (const value of [deep, cyclic, new AggregateError(Array.from({ length: 1000 }, () => new Error("wide")), "primary"),
    Object.defineProperty({ reason: "kept" }, "cause", { get() { throw 0; } })]) assert.ok(admit(capture_local_host_error(value)));
});

await check("deferred stop callbacks lose authority after close, replacement, and disposal", async () => {
  class DeferredChild extends FakeChild {
    callback: ((error: Error | null) => void) | undefined;
    override send(_message: unknown, callback?: (error: Error | null) => void): boolean { this.callback = callback; return true; }
  }
  for (const action of ["stop", "replace", "dispose"]) {
    const first = new DeferredChild(), second = new FakeChild(), failures: LocalHostFailure[] = [];
    let launches = 0;
    const controller = new LocalHostController("fenced", { runnerPath: "/runner", launch: () => (launches++ === 0 ? first : second) as unknown as ChildProcess, onFailure: failure => failures.push(failure) });
    const start = controller.start(project("fenced")); handshake(first, "fenced"); await start;
    const stop = action === "dispose" ? controller.dispose() : controller.stop(); first.close(); await stop;
    if (action === "replace") { const next = controller.start(project("fenced")); handshake(second, "fenced", 43124); await next; }
    const before = controller.snapshot;
    first.callback?.(Object.assign(new Error("obsolete delivery"), { code: "EPIPE" }));
    assert.equal(controller.snapshot, before);
    assert.equal(failures.length, 0, "No stale failure event can reach manager notification handling");
    if (action === "replace") { assert.equal(before.state, "running"); assert.equal(before.port, 43124); const stop = controller.stop(); second.close(); await stop; }
  }
  const child = new DeferredChild(), failures: LocalHostFailure[] = [];
  const controller = new LocalHostController("current", { runnerPath: "/runner", launch: () => child as unknown as ChildProcess, onFailure: f => failures.push(f) });
  const start = controller.start(project("current")); handshake(child, "current"); await start;
  child.message({ type: "failure", projectId: "current", phase: "runtime", error: { message: "primary" } });
  const primary = controller.snapshot.failure;
  const stop = controller.stop(); child.callback?.(Object.assign(new Error("current delivery"), { code: "EPIPE" }));
  assert.equal(controller.snapshot.failure, primary);
  assert.equal(primary?.additional[0]?.evidence.code, "EPIPE");
  assert.equal(failures.length, 2); child.close(); await stop;
});

await check("project resolution follows the application entry's package context and canonicalizes Node", async () => {
  const root = mkdtempSync(join(tmpdir(), "hson-local-host-resolution-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "local-host-fixture", type: "module" }));
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
  assert.match(local_host_start_blocker(false, undefined) ?? "", /local apps cannot run in Restricted Mode/);
  assert.match(local_host_start_blocker(true, "ssh-remote") ?? "", /local app execution is disabled in remote workspaces/);
  assert.equal(local_host_start_blocker(true, undefined), undefined);
});

await check("project resolution requires built workspace code and workspace hson-live", async () => {
  const root = mkdtempSync(join(tmpdir(), "hson-local-host-project-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "local-host-fixture", type: "module" }));
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "app.mjs"), "export const application = {};\n");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    const repositoryRoot = join(__dirname, "../../..");
    symlinkSync(repositoryRoot, join(root, "node_modules", "hson-live"), "dir");
    const resolved = await resolve_local_host_project(root, "fixture", { entry: "dist/app.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0 });
    assert.equal(resolved.entry, join(root, "dist", "app.mjs"));
    assert.equal(resolved.hsonLiveVersion, "3.5.0");
    await assert.rejects(resolve_local_host_project(root, "fixture", { entry: "", applicationExport: "application", nodeExecutable: process.execPath, port: 0 }), /before running the local app/);
    await assert.rejects(resolve_local_host_project(root, "fixture", { entry: "dist/missing.mjs", applicationExport: "application", nodeExecutable: process.execPath, port: 0 }), /local application entry does not exist/);
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
  firstChild.message({ type: "failure", projectId: "failed-restart", phase: "application", error: { message: "broken" } });
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
  assert.notEqual(presentations[0]?.detail, presentations[1]?.detail);
  assert.deepEqual(local_app_quick_pick_actions(presentations).map(action => action.label), [
    "Run & Open Local App", "Run Local App", "Open Local App", "Copy Local App URL", "Restart Local App", "Stop Local App", "Show Local App Output",
  ]);
});

await check("local-app Quick Pick exposes only actions applicable to each lifecycle state", () => {
  const labels = (state: LocalHostProjectPresentation["snapshot"]["state"]): readonly string[] => {
    const snapshot = state === "running"
      ? { projectId: "file:///decks", state, httpUrl: "http://127.0.0.1:45100" } as const
      : { projectId: "file:///decks", state } as const;
    return local_app_quick_pick_actions([{ projectId: "file:///decks", name: "decks", detail: "/workspace/decks", configured: true, snapshot }]).map(action => action.label);
  };
  assert.deepEqual(labels("stopped"), ["Run & Open Local App", "Run Local App", "Show Local App Output"]);
  assert.deepEqual(labels("starting"), ["Stop Local App", "Show Local App Output"]);
  assert.deepEqual(labels("running"), ["Open Local App", "Copy Local App URL", "Restart Local App", "Stop Local App", "Show Local App Output"]);
  assert.deepEqual(labels("stopping"), ["Show Local App Output"]);
  assert.deepEqual(labels("failed"), ["Run & Open Local App", "Run Local App", "Restart Local App", "Stop Local App", "Show Local App Output"]);
});

await check("local-app Quick Pick actions route through the existing command IDs", () => {
  const projects: LocalHostProjectPresentation[] = [
    { projectId: "file:///running", name: "running", detail: "/workspace/running", configured: true, snapshot: { projectId: "file:///running", state: "running", httpUrl: "http://127.0.0.1:45101" } },
    { projectId: "file:///stopped", name: "stopped", detail: "/workspace/stopped", configured: true, snapshot: { projectId: "file:///stopped", state: "stopped" } },
  ];
  assert.deepEqual(local_app_quick_pick_actions(projects).map(action => action.command), [
    "hson.runAndOpenLocalApp", "hson.startLocalHost", "hson.openLocalApp", "hson.copyLocalAppUrl", "hson.restartLocalHost", "hson.stopLocalHost", "hson.showLocalHostOutput",
  ]);
});

process.stdout.write(`ok - ${checks} local-host protocol, configuration, lifecycle, crash, multi-project, and trust checks passed\n`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

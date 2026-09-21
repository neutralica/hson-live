import assert from "node:assert/strict";
import { build_then_restart, run_and_open, run_development_services } from "../src/development-actions.js";

async function main(): Promise<void> {
  const calls: string[] = [];
  assert.deepEqual(await run_development_services([
    { name: "Schema Watch", start: async () => { calls.push("schema"); return true; } },
    { name: "Local App", start: async () => { calls.push("app"); return true; } },
  ]), []);
  assert.deepEqual(calls, ["schema", "app"]);
  assert.deepEqual(await run_development_services([
    { name: "Schema Watch", start: async () => false },
    { name: "Local App", start: async () => { throw new Error("bind failed"); } },
  ]), ["Schema Watch", "Local App"]);

  const order: string[] = [];
  let ready: (value: boolean) => void = () => undefined;
  const started = new Promise<boolean>(resolve => { ready = resolve; });
  const launch = run_and_open(() => started, async () => { order.push("open"); });
  assert.deepEqual(order, []);
  ready(true);
  assert.equal(await launch, true);
  assert.deepEqual(order, ["open"]);
  assert.equal(await run_and_open(async () => false, async () => { throw new Error("opened before readiness"); }), false);
  const lifecycle: string[] = [];
  let releaseBuild: () => void = () => undefined;
  const build = new Promise<void>(resolve => { releaseBuild = resolve; });
  const restart = build_then_restart(() => build, () => true, async () => { lifecycle.push("restart"); });
  assert.deepEqual([...lifecycle], []);
  releaseBuild();
  assert.equal(await restart, true);
  assert.deepEqual([...lifecycle], ["restart"]);
  await assert.rejects(build_then_restart(async () => { throw new Error("build failed"); }, () => true, async () => { lifecycle.push("stale restart"); }), /build failed/);
  assert.equal(await build_then_restart(async () => undefined, () => false, async () => { lifecycle.push("cancelled restart"); }), false);
  assert.deepEqual(lifecycle, ["restart"]);
  process.stdout.write("ok - Run All composes services and Run & Open waits for readiness\n");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

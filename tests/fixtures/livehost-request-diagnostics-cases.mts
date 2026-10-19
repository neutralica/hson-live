import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { start_node_application_host, type NodeHostOperationalEvent } from "hson-live/livehost/node";
import { application } from "./livehost-request-diagnostics-app.mts";

export async function request_diagnostics_acceptance() {
  // The real extension runner supplies neither deployment nor logger, and pipes
  // stdout/stderr alongside IPC. Keep NODE_ENV=production to prove it is irrelevant.
  const child = spawn(process.execPath, ["--import=tsx",
    fileURLToPath(new URL("../../editors/vscode-hson/src/local-host-runner.ts", import.meta.url)),
    JSON.stringify({ projectId: "diagnostic-test", workspaceFolder: process.cwd(),
      applicationEntry: fileURLToPath(new URL("./livehost-request-diagnostics-app.mts", import.meta.url)),
      applicationExport: "application", hsonLiveNodeEntry: fileURLToPath(new URL("../../dist/api/livehost/node/index.js", import.meta.url)),
      hsonLiveVersion: "test", port: 0 })],
    { stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env, NODE_ENV: "production" } });
  let stderr = "", stdout = "";
  assert.ok(child.stderr); assert.ok(child.stdout);
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => { stdout += chunk; });
  const exited = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", code => {
    if (code === 0) resolve(); else reject(Error(`Runner exited ${code}: ${stderr}`));
  }); });
  void exited.catch(() => undefined);
  const message = (type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(Error(`Runner missing ${type}: ${stderr}`)); }, 10_000);
    const receive = (value: unknown) => {
      if (typeof value !== "object" || value === null || !("type" in value)) return;
      if (value.type === "failure") { cleanup(); reject(Error(JSON.stringify(value))); }
      if (value.type === type) { cleanup(); resolve({ ...value }); }
    };
    const cleanup = () => { clearTimeout(timer); child.off("message", receive); };
    child.on("message", receive);
  });
  try {
    const ready = await message("ready"), url = String(ready.httpUrl);
    assert.equal(await (await fetch(url + "/ok")).text(), "ok");
    assert.equal(await (await fetch(url + "/complete")).text(), "onetwo");
    assert.equal(stderr, ""); assert.equal(stdout, "");
    const disconnect = async (path: string) => {
      const controller = new AbortController(), entered = message("diagnostic-route-entered"), finished = message("diagnostic-route-finished");
      const disconnected = fetch(`${url}/${path}`, { signal: controller.signal });
      await entered; controller.abort(); await assert.rejects(disconnected); await finished;
      assert.equal(await (await fetch(url + "/ok")).text(), "ok");
    };
    for (const path of ["abort", "node-abort"]) {
      await disconnect(path);
      assert.equal(stderr, "", `Expected cancellation at /${path} must not report a request failure.`);
    }
    for (const path of ["sync", "async", "abort-before"]) {
      const response = await fetch(`${url}/${path}`), body = await response.text();
      assert.equal(response.status, 500); assert.equal(body, "Application request failed.\n");
      assert.doesNotMatch(body, /private|Error|\bat /);
    }
    const broken = await fetch(url + "/stream");
    assert.equal(broken.status, 200);
    await assert.rejects(broken.text());
    for (const path of ["foreign-abort", "foreign-node-abort", "disconnect"]) await disconnect(path);
    for (let attempt = 0; attempt < 100 && !stderr.includes("diagnostic-disconnect-private"); attempt++) await delay(10);
    for (const name of ["sync", "async", "stream", "disconnect"]) {
      assert.equal(stderr.split(`Error: diagnostic-${name}-private`).length, 2, stderr);
      assert.match(stderr, new RegExp(`LiveHost request-diagnostics GET /${name}:`));
    }
    for (const name of ["abort-before", "foreign-abort", "foreign-node-abort"]) {
      assert.equal(stderr.split(`LiveHost request-diagnostics GET /${name}:`).length, 2, stderr);
    }
    assert.match(stderr, /\bat .*livehost-request-diagnostics-app/);
    assert.equal(stdout, "");
    const reported = stderr;
    assert.equal(await (await fetch(url + "/ok")).text(), "ok");
    assert.equal(stderr, reported);
  } finally {
    if (child.connected) child.send({ type: "stop" });
    else child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try { await exited; } finally { clearTimeout(timeout); }
  }

  // Configured loggers receive one structured diagnostic; production keeps its
  // existing logging policy and generic HTTP response. Logger failures cannot hang HTTP.
  for (const mode of ["development", "production", "throwing-logger"] as const) {
    const events: NodeHostOperationalEvent[] = [];
    const app = application();
    const host = await start_node_application_host({ port: 0, applications: [app],
      deployment: { mode: mode === "production" ? "production" : "development" },
      security: new Map([[app.name, {
        origin: () => ({ ok: true, value: undefined }), authenticate: () => ({ ok: true, value: { anonymous: true } }),
        authorize: () => ({ ok: true, value: undefined }),
      }]]),
      log: event => { events.push(event); if (mode === "throwing-logger" && event.error) throw Error("logger failed"); },
    });
    try {
      assert.equal(await (await fetch(host.httpUrl + "/ok")).text(), "ok");
      assert.equal(events.filter(event => event.error).length, 0);
      const response = await fetch(host.httpUrl + "/async");
      assert.equal(response.status, 500); assert.equal(await response.text(), "Application request failed.\n");
      const errors = events.filter(event => event.code === "NODE_HOST_APPLICATION_REQUEST_FAILED");
      assert.equal(errors.length, mode === "production" ? 0 : 1);
      if (errors[0]) { assert.match(errors[0].error!, /diagnostic-async-private[\s\S]*\bat /); assert.equal(errors[0].route, "GET /async"); }
    } finally { await host.dispose(); }
  }
}

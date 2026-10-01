import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { Hson, hsonLocus, bind_locus_http } from "../dist/index.js";
import { bind_node_locus_websocket } from "../dist/api/locus/node/index.js";
import { start_node_application_host } from "../dist/api/livehost/node/index.js";

const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "tmp"), { recursive: true });
const temporary = await mkdtemp(join(root, "tmp", "scout-browser-"));

function chrome_executable() {
  const candidates = [process.env.HSON_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium", "google-chrome", "chromium"]
    .filter((candidate) => candidate !== undefined);
  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0) return candidate;
  }
  throw new Error("Scout browser acceptance requires Chrome or Chromium.");
}

function bundle(entry, output) {
  const result = spawnSync(resolve(root, "node_modules/.bin/esbuild"), [
    resolve(root, entry), "--bundle", "--format=iife", "--platform=browser", `--outfile=${output}`,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Scout bundle failed: ${entry}`);
}

let host;
let locus;
let socketServer;
try {
  const bundlePath = join(temporary, "bundle.js");
  const registrationPath = join(temporary, "registration.js");
  bundle("tests/browser/scout.entry.mjs", bundlePath);
  bundle("tests/browser/scout-registration.entry.mjs", registrationPath);
  const script = await readFile(bundlePath);
  const registrationScript = await readFile(registrationPath);
  const interaction = {
    id: "scout-click", subject: { library: "page", path: [0, 0, 1, 0, 0, 0, 0] },
    kind: "locus", key: "save", payload: Hson.data.from(null),
    listener: { event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
  };
  let handled = 0;
  let httpCalls = 0;
  let setupCalls = 0;
  locus = hsonLocus.create({
    shared: [{ name: "page", definition: { document:
      '<html <head <script src="/bundle.js" defer/>/> <body <main <button/>/>/>/>' } }],
    interactions: [interaction],
    defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }),
    actions: { save: () => { handled += 1; } },
  });
  const map = locus.map;
  socketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveListen, rejectListen) => {
    socketServer.once("listening", resolveListen);
    socketServer.once("error", rejectListen);
  });
  socketServer.on("connection", (socket) => bind_node_locus_websocket(locus, socket));
  const socketAddress = socketServer.address();
  if (socketAddress === null || typeof socketAddress === "string") throw new Error("Scout socket server has no address.");
  const websocketUrl = `ws://127.0.0.1:${socketAddress.port}`;
  const canonical = map.cut({ html: "page" }).html;
  assert.match(canonical, /<\/body><\/html>$/);
  assert.doesNotMatch(canonical, /hson-scout/);
  assert.doesNotMatch(JSON.stringify(map.capture()), /hson-scout/);
  const scoutSuffix = "<hson-scout hidden></hson-scout>";
  const page = (scenario) => {
    if (scenario === "registration") return '<!doctype html><html><head><script defer src="/registration.js"></script></head><body></body></html>';
    const count = scenario === "duplicates-four" ? 4 : scenario === "duplicates" ? 2
      : scenario === "no-scout" || scenario === "provider-first" || scenario === "manual-collision" ? 0 : 1;
    const suffix = scenario === "malformed-attribute" ? '<hson-scout hidden endpoint="wrong"></hson-scout>'
      : scenario === "malformed-child" ? "<hson-scout hidden>content</hson-scout>"
        : scenario === "malformed-no-hidden" ? "<hson-scout></hson-scout>" : scoutSuffix.repeat(count);
    return canonical.replace("</body></html>", `</body>${suffix}</html>`);
  };
  assert.match(page("no-js"), /<hson-scout hidden><\/hson-scout>/);
  const binding = bind_locus_http(locus, { endpoint: "/_hson" });
  const results = new Map();
  const application = {
    name: "scout-browser",
    requests: [
      { method: "GET", path: "/bundle.js", handle: () => new Response(script, { headers: { "content-type": "text/javascript" } }) },
      { method: "GET", path: "/registration.js", handle: () => new Response(registrationScript, { headers: { "content-type": "text/javascript" } }) },
      { method: "GET", path: "/setup", handle: async (request) => {
        setupCalls += 1;
        const websocket = new URL(request.url).searchParams.get("scenario") === "websocket";
        const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] },
          ...(websocket ? [] : [{ connection: { principalId: "development-anonymous" } }]));
        const now = session.now({ html: "page" });
        assert.doesNotMatch(JSON.stringify(now), /hson-scout/);
        return new Response(JSON.stringify({ now, credential: session.credential, websocketUrl }),
          { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      } },
      { method: "GET", path: "/handled", handle: () => new Response(JSON.stringify({ count: handled }),
        { headers: { "content-type": "application/json", "cache-control": "no-store" } }) },
      { method: "GET", path: "/__result", handle(request) {
        const url = new URL(request.url);
        const scenario = url.searchParams.get("scenario");
        results.get(scenario)?.({ status: url.searchParams.get("status"), detail: url.searchParams.get("detail") });
        return new Response(null, { status: 204 });
      } },
      ...["registration", "no-scout", "scout-first", "provider-first", "duplicates", "duplicates-four",
        "removed-waiting", "removed-pending", "cross-document-move", "manual-collision",
        "preparing-collision", "provider-failure", "preparation-failure", "start-failure",
        "malformed-attribute", "malformed-child", "malformed-no-hidden", "http", "websocket"]
        .map((scenario) => ({ method: "GET", path: `/${scenario}`, handle: () => new Response(page(scenario),
          { headers: { "content-type": "text/html" } }) })),
      ...["/_hson", "/_hson/sync"].map((path) => ({ method: "POST", path,
        handle: (request, context) => { httpCalls += 1; return binding.handle(request, { principalId: context.principal.id }); } })),
    ],
    dispose() { binding.dispose(); },
  };
  host = await start_node_application_host({ port: 0, applications: [application] });
  const chrome = chrome_executable();
  const scenarios = ["registration", "no-scout", "scout-first", "provider-first", "duplicates",
    "duplicates-four", "removed-waiting", "removed-pending", "cross-document-move",
    "manual-collision", "preparing-collision", "provider-failure", "preparation-failure", "start-failure",
    "malformed-attribute", "malformed-child", "malformed-no-hidden", "http", "websocket"];
  for (const scenario of process.env.HSON_SCOUT_SCENARIO === undefined ? scenarios
    : scenarios.filter((name) => name === process.env.HSON_SCOUT_SCENARIO)) {
    const profile = join(temporary, `profile-${scenario}`);
    let resolveReport;
    const reported = new Promise((resolveResult) => { resolveReport = resolveResult; });
    results.set(scenario, resolveReport);
    const child = spawn(chrome, ["--headless=new", "--disable-background-networking", "--disable-component-update",
      "--disable-default-apps", "--disable-gpu", "--no-default-browser-check", "--no-first-run",
      `--user-data-dir=${profile}`, `${host.httpUrl}/${scenario}`]);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = new Promise((resolveClose) => child.once("close", resolveClose));
    let timeout;
    try {
      const result = await Promise.race([reported,
        new Promise((_, reject) => child.once("error", reject)),
        new Promise((_, reject) => child.once("close", (code) => reject(new Error(`Chrome exited ${String(code)}: ${stderr}`)))),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Scout ${scenario} timed out: ${stderr}`)), 18000); }),
      ]);
      assert.equal(result.status, "pass", `${scenario}: ${result.detail}; setup=${setupCalls} http=${httpCalls} handled=${handled}`);
      process.stdout.write(`Scout ${scenario} passed.\n`);
    } finally {
      clearTimeout(timeout);
      results.delete(scenario);
      child.kill("SIGTERM");
      await closed;
    }
  }
} finally {
  if (host !== undefined) await host.dispose();
  await new Promise((resolveClose) => socketServer?.close(resolveClose) ?? resolveClose());
  locus?.dispose();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

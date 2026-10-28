import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { locus_map_internal } from "../dist/internal/governor-maps.js";
import { Hson, bind_locus_http } from "../dist/index.js";
import { hsonLiveMap } from "hson-live/livemap";
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

async function inspect_no_js(child, profile, url, payload) {
  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Chrome exited before the no-JavaScript probe.");
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise((resolvePort) => setTimeout(resolvePort, 50)); }
  }
  assert.ok(port, "Chrome debugging did not initialize.");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => { socket.once("open", resolveOpen); socket.once("error", rejectOpen); });
  let sequence = 0;
  const pending = new Map();
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    const task = pending.get(message.id);
    if (task === undefined) return;
    pending.delete(message.id);
    clearTimeout(task.timeout);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolveCommand, rejectCommand) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); rejectCommand(new Error(`Chrome timeout: ${method}`)); }, 5000);
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined);
    return result.result.value;
  };
  try {
    await command("Emulation.setScriptExecutionDisabled", { value: true });
    await command("Page.navigate", { url });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
      ready = await evaluate("location.pathname === '/no-js' && document.readyState === 'complete'");
      if (!ready) await new Promise((resolveReady) => setTimeout(resolveReady, 50));
    }
    assert.ok(ready, "No-JavaScript SSR page did not finish parsing.");
    assert.deepEqual(await evaluate(`(() => {
      const scout = document.querySelector('hson-scout'), button = document.querySelector('button');
      return { registered: customElements.get('hson-scout') !== undefined,
        hidden: getComputedStyle(scout).display === 'none', payload: scout.textContent,
        children: document.body.childNodes.length, last: document.body.lastChild === scout,
        text: button.textContent, visible: button.getBoundingClientRect().width > 0 };
    })()`), { registered: false, hidden: true, payload, children: 2, last: true, text: "Save", visible: true });
    return { status: "pass" };
  } finally {
    for (const task of pending.values()) clearTimeout(task.timeout);
    socket.close();
  }
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
  locus = hsonLiveMap.locus.create({ "page": { document:
      '<html <head <script src="/bundle.js" defer/>/> <body <main <button "Save"/>/>/>/>', access: "shared" } }, { interactions: [interaction], defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] }, authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }), actions: { save: () => { handled += 1; } } });
  const map = locus_map_internal(locus);
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
  const smallPayload = "eyJvcGFxdWUiOiJBenlfLTA5In0";
  const largePayload = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-".repeat(16384) + "Zg==";
  const scenarios = ["registration", "no-js", "no-scout", "scout-first", "provider-first", "payload",
    "payload-large", "payload-split", "payload-module", "parser-early", "duplicates", "duplicates-four",
    "removed-waiting", "removed-pending", "cross-document-move", "manual-collision", "preparing-collision",
    "provider-failure", "preparation-failure", "start-failure", "malformed-attribute", "malformed-child",
    "malformed-comment", "malformed-text", "malformed-hidden", "malformed-no-hidden", "http", "websocket"];
  const page = (scenario) => {
    if (scenario === "registration") return '<!doctype html><html><head><script defer src="/registration.js"></script></head><body></body></html>';
    const count = scenario === "duplicates-four" ? 4 : scenario === "duplicates" ? 2
      : scenario === "no-scout" || scenario === "provider-first" || scenario === "manual-collision" ? 0 : 1;
    const payload = scenario === "payload-large" || scenario === "parser-early" ? largePayload
      : scenario === "scout-first" || scenario === "provider-first" ? "" : smallPayload;
    const suffix = scenario === "malformed-attribute" ? '<hson-scout hidden endpoint="wrong"></hson-scout>'
      : scenario === "malformed-child" ? "<hson-scout hidden><span>content</span></hson-scout>"
        : scenario === "malformed-comment" ? "<hson-scout hidden><!-- comment --></hson-scout>"
          : scenario === "malformed-text" ? "<hson-scout hidden> raw JSON {} </hson-scout>"
            : scenario === "malformed-hidden" ? '<hson-scout hidden="until-found"></hson-scout>'
              : scenario === "malformed-no-hidden" ? "<hson-scout></hson-scout>"
                : scoutSuffix.replace("></hson-scout>", `>${payload}</hson-scout>`).repeat(count);
    const html = canonical.replace("</body></html>", `</body>${suffix}</html>`);
    // Capture-only fixtures deliberately exercise earlier registration and module startup.
    if (scenario === "parser-early") return html.replace(/ defer(?:="[^"]*")?/, "");
    if (scenario === "payload-module") return html.replace(/ defer(?:="[^"]*")?/, ' type="module"');
    return html;
  };
  assert.match(page("scout-first"), /<hson-scout hidden><\/hson-scout>/);
  assert.doesNotMatch(page("parser-early"), / defer/);
  assert.match(page("payload-module"), /type="module"/);
  const pageResponse = (scenario) => {
    const html = page(scenario);
    if (scenario !== "parser-early" && scenario !== "payload-large") {
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
    // Deliver the payload across network/parser chunks, including a delayed final tail.
    let offset = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (offset === html.length) { controller.close(); return; }
        await new Promise((resolveChunk) => setTimeout(resolveChunk, 5));
        const end = Math.min(offset + 32771, html.length);
        controller.enqueue(new TextEncoder().encode(html.slice(offset, end)));
        offset = end;
      },
    });
    return new Response(body, { headers: { "content-type": "text/html" } });
  };
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
      ...scenarios.map((scenario) => ({ method: "GET", path: `/${scenario}`, handle: () => pageResponse(scenario) })),
      ...["/_hson", "/_hson/sync"].map((path) => ({ method: "POST", path,
        handle: (request, context) => { httpCalls += 1; return binding.handle(request, { principalId: context.principal.id }); } })),
    ],
    dispose() { binding.dispose(); },
  };
  host = await start_node_application_host({ port: 0, applications: [application] });
  const chrome = chrome_executable();
  for (const scenario of process.env.HSON_SCOUT_SCENARIO === undefined ? scenarios
    : scenarios.filter((name) => name === process.env.HSON_SCOUT_SCENARIO)) {
    const profile = join(temporary, `profile-${scenario}`);
    let resolveReport;
    const reported = new Promise((resolveResult) => { resolveReport = resolveResult; });
    results.set(scenario, resolveReport);
    const noJs = scenario === "no-js";
    const beforeNoJs = { setupCalls, httpCalls };
    const child = spawn(chrome, ["--headless=new", "--disable-background-networking", "--disable-component-update",
      "--disable-default-apps", "--disable-gpu", "--no-default-browser-check", "--no-first-run",
      ...(noJs ? ["--remote-debugging-port=0"] : []),
      `--user-data-dir=${profile}`, noJs ? "about:blank" : `${host.httpUrl}/${scenario}`]);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = new Promise((resolveClose) => child.once("close", resolveClose));
    let timeout;
    try {
      const result = await Promise.race([noJs ? inspect_no_js(child, profile, `${host.httpUrl}/no-js`, smallPayload) : reported,
        new Promise((_, reject) => child.once("error", reject)),
        new Promise((_, reject) => child.once("close", (code) => reject(new Error(`Chrome exited ${String(code)}: ${stderr}`)))),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Scout ${scenario} timed out: ${stderr}`)), 18000); }),
      ]);
      assert.equal(result.status, "pass", `${scenario}: ${result.detail}; setup=${setupCalls} http=${httpCalls} handled=${handled}`);
      if (noJs) assert.deepEqual({ setupCalls, httpCalls }, beforeNoJs, "Scripts ran with JavaScript disabled");
      process.stdout.write(`Scout ${scenario} passed.\n`);
    } finally {
      clearTimeout(timeout);
      results.delete(scenario);
      if (child.exitCode === null) child.kill("SIGTERM");
      await closed;
    }
  }
} finally {
  if (host !== undefined) await host.dispose();
  await new Promise((resolveClose) => socketServer?.close(resolveClose) ?? resolveClose());
  locus?.dispose();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

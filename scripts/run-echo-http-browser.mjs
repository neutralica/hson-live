import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, hsonLocus, bind_locus_http } from "../dist/index.js";
import { start_node_application_host } from "../dist/api/livehost/node/index.js";

const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "tmp"), { recursive: true });
const temporary = await mkdtemp(join(root, "tmp", "echo-http-browser-"));

function chrome_executable() {
  const candidates = [process.env.HSON_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "chromium", "chromium-browser"].filter((value) => value !== undefined);
  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0) return candidate;
  }
  throw new Error("HTTP Echo browser acceptance requires Chrome or Chromium; set HSON_CHROME_BIN.");
}

let host;
let locus;
try {
  const bundlePath = join(temporary, ".echo-http.bundle.js");
  const bundle = spawnSync(resolve(root, "node_modules/.bin/esbuild"), [
    resolve(root, "tests/browser/echo-http.entry.mjs"), "--bundle", "--format=esm", "--platform=browser",
    `--outfile=${bundlePath}`,
  ], { encoding: "utf8" });
  if (bundle.status !== 0) throw new Error(bundle.stderr || "HTTP Echo browser bundle failed.");
  const html = await readFile(resolve(root, "tests/browser/echo-http.acceptance.html"));
  const javascript = await readFile(bundlePath);
  const schema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>", schema } });
  enable_interactions(map);
  add_interaction(map, {
    id: "http-click", subject: { library: "page", path: [0, 0, 0] }, kind: "locus", key: "save",
    payload: Hson.data.from({ value: 1 }),
    listener: { event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
  });
  let handled = false;
  locus = hsonLocus.create({ map, libraries: [{ name: "page", ownership: "shared" }],
    defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }),
    actions: { save: () => { handled = true; } },
  });
  const retained = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] },
    { connection: { principalId: "development-anonymous" } });
  const setup = JSON.stringify({ now: retained.now(), credential: retained.credential });
  const binding = bind_locus_http(locus, { endpoint: "/_hson" });
  let report;
  const reported = new Promise((resolveReport) => { report = resolveReport; });
  const application = {
    name: "echo-http-browser",
    requests: [
      { method: "GET", path: "/", handle: () => new Response(html, { headers: { "content-type": "text/html" } }) },
      { method: "GET", path: "/.echo-http.bundle.js", handle: () => new Response(javascript,
        { headers: { "content-type": "text/javascript" } }) },
      { method: "GET", path: "/setup", handle: () => new Response(setup,
        { headers: { "content-type": "application/json", "cache-control": "no-store" } }) },
      { method: "GET", path: "/handled", handle: () => new Response(JSON.stringify({ handled }),
        { headers: { "content-type": "application/json", "cache-control": "no-store" } }) },
      { method: "GET", path: "/__result", handle(request) {
        const url = new URL(request.url);
        report({ status: url.searchParams.get("status"), detail: url.searchParams.get("detail") });
        return new Response(null, { status: 204 });
      } },
      ...["/_hson", "/_hson/sync"].map((path) => ({ method: "POST", path,
        handle: (request, context) => binding.handle(request, { principalId: context.principal.id }) })),
    ],
    dispose() { binding.dispose(); },
  };
  host = await start_node_application_host({ port: 0, applications: [application] });
  const child = spawn(chrome_executable(), [
    "--headless=new", "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
    "--disable-gpu", "--no-default-browser-check", "--no-first-run",
    `--user-data-dir=${join(temporary, "profile")}`, `${host.httpUrl}/`,
  ]);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolveClose) => child.once("close", resolveClose));
  let timeout;
  try {
    const result = await Promise.race([
      reported,
      new Promise((_, reject) => child.once("error", reject)),
      new Promise((_, reject) => child.once("close", (code) => reject(new Error(`Chrome exited (${String(code)}). ${stderr}`)))),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Chrome timed out. ${stderr}`)), 20000); }),
    ]);
    if (result.status !== "pass") throw new Error(`HTTP Echo browser continuation failed: ${result.detail ?? "no detail"}`);
    process.stdout.write("HTTP Echo Chrome continuation passed.\n");
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    await closed;
  }
} finally {
  if (host !== undefined) await host.dispose();
  locus?.dispose();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

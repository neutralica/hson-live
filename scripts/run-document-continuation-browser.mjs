import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { hson, hsonLocus } from "../dist/index.js";
import { capture_locus_bootstrap } from "../dist/api/locus/index.js";
import { admit_exact_runtime_livemap_node } from "../dist/internal/exact-runtime-node-admission.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = join(repositoryRoot, "tmp");
await mkdir(temporaryRoot, { recursive: true });
const fixtureRoot = await mkdtemp(join(temporaryRoot, "document-continuation-browser-"));

function chromeExecutable() {
  const candidates = [
    process.env.HSON_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
  ].filter((candidate) => candidate !== undefined);
  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0) return candidate;
  }
  throw new Error("Document continuation browser acceptance requires Chrome or Chromium.");
}

let server;
let socketServer;
let locus;
let chrome;
let timeoutId;
const requests = [];
let moduleSource = "";
try {
  await copyFile(
    resolve(repositoryRoot, "tests/browser/document-continuation.acceptance.html"),
    join(fixtureRoot, "index.html"),
  );
  const bundle = spawnSync(resolve(repositoryRoot, "node_modules/.bin/esbuild"), [
    resolve(repositoryRoot, "tests/browser/document-continuation.entry.mjs"),
    "--bundle",
    "--format=esm",
    "--platform=browser",
    `--outfile=${join(fixtureRoot, "bundle.js")}`,
  ], { encoding: "utf8" });
  if (bundle.status !== 0) throw new Error(bundle.stderr || "Document continuation browser bundle failed.");

  const hostedNode = hson.liveMap.fromHson(`<main id="hosted" <p "before"/>/>`).root();
  hostedNode.$_content[0].$_content[0].$_content[0].$_meta = { quid: "000000777" };
  const authority = admit_exact_runtime_livemap_node(hostedNode);
  if (authority.mode !== "document") throw new Error("Hosted browser fixture requires a document map.");
  locus = hsonLocus.create({ map: authority, logicalMapId: "browser-document-continuation", sessions: {} });
  const bootstrap = capture_locus_bootstrap(locus, "browser:continuation", "/locus");
  await locus.mutate((draft) => draft.document.attrs.set(
    { kind: "path", path: [0, 0, 0] },
    "data-recovered",
    "yes",
  ));
  socketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveListen, rejectListen) => {
    socketServer.once("listening", resolveListen);
    socketServer.once("error", rejectListen);
  });
  socketServer.on("connection", (socket) => locus.connect({
    send(raw) { socket.send(raw); },
    close(code, reason) { socket.close(code, reason); },
    onMessage(listener) {
      const handler = (data) => listener(data.toString());
      socket.on("message", handler);
      return () => socket.off("message", handler);
    },
    onClose(listener) { socket.on("close", listener); return () => socket.off("close", listener); },
  }));
  const socketAddress = socketServer.address();
  if (socketAddress === null || typeof socketAddress === "string") throw new Error("Browser socket server has no TCP address.");
  const socketUrl = `ws://127.0.0.1:${socketAddress.port}`;

  let reportResult;
  const browserResult = new Promise((resolveResult) => { reportResult = resolveResult; });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    if (url.pathname === "/__hosted") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ bootstrap, socketUrl }));
      return;
    }
    if (url.pathname === "/__result") {
      response.writeHead(204).end();
      reportResult({ status: url.searchParams.get("status"), detail: url.searchParams.get("detail") });
      return;
    }
    if (url.pathname === "/test.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(moduleSource);
      return;
    }
    const source = url.pathname === "/bundle.js"
      ? join(fixtureRoot, "bundle.js")
      : join(fixtureRoot, "index.html");
    let content = await readFile(source, "utf8");
    if (url.pathname !== "/bundle.js") {
      const moduleMatch = content.match(/<script type="module">([\s\S]*?)<\/script>/);
      if (moduleMatch === null) throw new Error("Browser fixture has no module body.");
      moduleSource = moduleMatch[1];
      content = content.replace(moduleMatch[0], `<script type="module" src="/test.js"></script>`);
      content = content.replace("</body>", `<script>
        (() => {
          const result = document.querySelector("#result");
          const report = () => {
            const status = document.documentElement.dataset.status;
            if (status !== "pass" && status !== "fail") return;
            fetch("/__result?status=" + encodeURIComponent(status) + "&detail=" + encodeURIComponent(document.documentElement.dataset.detail ?? ""));
          };
          new MutationObserver(report).observe(document.documentElement, { attributes: true });
          report();
        })();
      </script></body>`);
    }
    response.writeHead(200, { "content-type": url.pathname === "/bundle.js" ? "text/javascript" : "text/html" });
    response.end(content);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Browser server has no TCP address.");
  chrome = spawn(chromeExecutable(), [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(fixtureRoot, "profile")}`,
    `http://127.0.0.1:${address.port}/`,
  ]);
  let stderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { stderr += chunk; });
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Chrome timed out after requests ${JSON.stringify(requests)}.\n${stderr}`)), 20_000);
  });
  const exited = new Promise((_, reject) => chrome.once("close", (code) => reject(new Error(`Chrome exited ${code}.\n${stderr}`))));
  const result = await Promise.race([browserResult, timeout, exited]);
  clearTimeout(timeoutId);
  timeoutId = undefined;
  chrome.kill("SIGTERM");
  if (result.status !== "pass") throw new Error(`Document continuation browser acceptance failed: ${result.detail}`);
  process.stdout.write(`Document continuation native Chrome acceptance passed (${result.detail}).\n`);
} finally {
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  if (chrome !== undefined && chrome.exitCode === null) chrome.kill("SIGTERM");
  if (server !== undefined) await new Promise((resolveClose) => server.close(resolveClose));
  if (socketServer !== undefined) await new Promise((resolveClose) => socketServer.close(resolveClose));
  locus?.dispose();
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = join(repositoryRoot, "tmp");
await mkdir(temporaryRoot, { recursive: true });
const fixtureRoot = await mkdtemp(join(temporaryRoot, "browser-realization-parser-closure-"));

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
  throw new Error("Browser realization parser-closure acceptance requires Chrome or Chromium.");
}

let server;
let chrome;
let timeoutId;
try {
  await copyFile(
    resolve(repositoryRoot, "tests/browser/browser-realization-parser-closure.acceptance.html"),
    join(fixtureRoot, "index.html"),
  );
  const bundle = spawnSync(resolve(repositoryRoot, "node_modules/.bin/esbuild"), [
    resolve(repositoryRoot, "tests/browser/browser-realization-parser-closure.entry.mjs"),
    "--bundle",
    "--format=esm",
    "--platform=browser",
    `--outfile=${join(fixtureRoot, "bundle.js")}`,
  ], { encoding: "utf8" });
  if (bundle.status !== 0) throw new Error(bundle.stderr || "Browser realization parser-closure bundle failed.");

  let reportResult;
  const browserResult = new Promise((resolveResult) => { reportResult = resolveResult; });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__result") {
      response.writeHead(204).end();
      reportResult({ status: url.searchParams.get("status"), detail: url.searchParams.get("detail") });
      return;
    }
    const source = url.pathname === "/bundle.js" ? join(fixtureRoot, "bundle.js") : join(fixtureRoot, "index.html");
    let content = await readFile(source, "utf8");
    if (url.pathname !== "/bundle.js") {
      content = content.replace("</body>", `<script>
        (() => {
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
  if (address === null || typeof address === "string") throw new Error("Browser parser-closure server has no TCP address.");
  chrome = spawn(chromeExecutable(), [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(fixtureRoot, "chrome-profile")}`,
    `http://127.0.0.1:${address.port}/`,
  ]);
  let stderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { stderr += chunk; });
  const timed = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Browser realization parser-closure acceptance timed out.\n${stderr}`)), 120_000);
  });
  const exited = new Promise((_, reject) => chrome.once("close", (code) => {
    reject(new Error(`Chrome exited ${code} before reporting parser closure.\n${stderr}`));
  }));
  const result = await Promise.race([browserResult, timed, exited]);
  if (result.status !== "pass") throw new Error(result.detail || "Browser realization parser-closure acceptance failed.");
  process.stdout.write(`Browser realization parser closure acceptance passed (${result.detail}).\n`);
} finally {
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  if (chrome !== undefined && chrome.exitCode === null) {
    const closed = new Promise((resolveClose) => chrome.once("close", resolveClose));
    chrome.kill("SIGTERM");
    await closed;
  }
  if (server !== undefined) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

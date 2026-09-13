import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = join(repositoryRoot, "tmp");
await mkdir(temporaryRoot, { recursive: true });
const fixtureRoot = await mkdtemp(join(temporaryRoot, "canonical-interactions-browser-"));
const htmlName = "index.html";
const bundleName = ".canonical-interactions.library.bundle.js";

function chrome_executable() {
  const candidates = [
    process.env.HSON_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ].filter((candidate) => candidate !== undefined);
  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Canonical interaction browser acceptance requires Chrome or Chromium; set HSON_CHROME_BIN when it is not discoverable.");
}

async function run_chrome(executable, url, browserResult) {
  const child = spawn(executable, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-gpu",
    "--no-default-browser-check",
    "--no-first-run",
    `--user-data-dir=${join(fixtureRoot, "profile")}`,
    url,
  ]);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolveClose) => { child.once("close", resolveClose); });
  const exited = new Promise((_, rejectRun) => {
    child.once("error", rejectRun);
    child.once("close", (code) => rejectRun(new Error(`Headless Chrome exited before reporting a result (${String(code)}).\n${stderr}`)));
  });
  let timeout;
  const timedOut = new Promise((_, rejectRun) => {
    timeout = setTimeout(() => rejectRun(new Error(`Headless Chrome did not report a result.\n${stderr}`)), 20_000);
  });
  try {
    return await Promise.race([browserResult, exited, timedOut]);
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    await closed;
  }
}

let server;
try {
  await copyFile(resolve(repositoryRoot, "tests/browser/canonical-interactions.acceptance.html"), join(fixtureRoot, htmlName));
  const bundle = spawnSync(resolve(repositoryRoot, "node_modules/.bin/esbuild"), [
    resolve(repositoryRoot, "dist/index.js"),
    "--bundle",
    "--format=esm",
    "--platform=browser",
    `--outfile=${join(fixtureRoot, bundleName)}`,
  ], { encoding: "utf8" });
  if (bundle.status !== 0) throw new Error(bundle.stderr || "Canonical interaction browser bundle failed.");

  let reportResult;
  const browserResult = new Promise((resolveResult) => { reportResult = resolveResult; });
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/__result") {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        response.writeHead(204).end();
        reportResult(Object.freeze({
          status: requestUrl.searchParams.get("status"),
          detail: requestUrl.searchParams.get("detail"),
        }));
        return;
      }
      const name = pathname === "/" ? htmlName : pathname.slice(1);
      if (name !== htmlName && name !== bundleName) {
        response.writeHead(404).end();
        return;
      }
      let content = await readFile(join(fixtureRoot, name));
      if (name === htmlName) {
        const reporter = `<script>
          (() => {
            const result = document.querySelector("#result");
            let reported = false;
            const report = () => {
              if (reported || (result.dataset.status !== "pass" && result.dataset.status !== "fail")) return;
              reported = true;
              fetch("/__result?status=" + encodeURIComponent(result.dataset.status)
                + "&detail=" + encodeURIComponent(result.textContent ?? ""));
            };
            new MutationObserver(report).observe(result, { attributes: true, childList: true, subtree: true });
            report();
          })();
        </script>`;
        content = Buffer.from(content.toString("utf8").replace("</body>", `${reporter}</body>`));
      }
      response.writeHead(200, { "content-type": name.endsWith(".html") ? "text/html" : "text/javascript" });
      response.end(content);
    } catch (cause) {
      response.writeHead(500).end(cause instanceof Error ? cause.message : "fixture failure");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Canonical interaction browser server has no TCP address.");
  const result = await run_chrome(chrome_executable(), `http://127.0.0.1:${address.port}/`, browserResult);
  if (result.status !== "pass") {
    throw new Error(`Canonical interaction browser acceptance failed: ${result.detail ?? "no detail"}`);
  }
  process.stdout.write("Canonical interaction native Chrome acceptance passed.\n");
} finally {
  if (server !== undefined) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

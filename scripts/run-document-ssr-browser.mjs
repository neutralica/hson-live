import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { hson, hsonLocus, render_document, render_hosted_document } from "../dist/index.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = join(repositoryRoot, "tmp");
await mkdir(temporaryRoot, { recursive: true });
const fixtureRoot = await mkdtemp(join(temporaryRoot, "document-ssr-browser-"));

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
  throw new Error("Document SSR browser acceptance requires Chrome or Chromium.");
}

let server;
let socketServer;
let locus;
let chrome;
let timeoutId;
let moduleSource = "";
try {
  await copyFile(
    resolve(repositoryRoot, "tests/browser/document-ssr.acceptance.html"),
    join(fixtureRoot, "index.html"),
  );
  const bundle = spawnSync(resolve(repositoryRoot, "node_modules/.bin/esbuild"), [
    resolve(repositoryRoot, "tests/browser/document-ssr.entry.mjs"),
    "--bundle",
    "--format=esm",
    "--platform=browser",
    `--outfile=${join(fixtureRoot, "bundle.js")}`,
  ], { encoding: "utf8" });
  if (bundle.status !== 0) throw new Error(bundle.stderr || "Document SSR browser bundle failed.");

  const localMap = hson.liveMap.fromHson(`<main id="local-ssr" <p @000005201 "a" "" "b"/>/>`);
  if (localMap.mode !== "document") throw new Error("Local SSR fixture requires a document map.");
  localMap.document.attrs.set({ kind: "path", path: [0] }, "data-revision", "N");
  const local = render_document({ map: localMap });
  const fullMap = hson.liveMap.fromHson(`<html <head <title "SSR"/>/> <body <main "whole"/>/>/>`);
  if (fullMap.mode !== "document") throw new Error("Full SSR fixture requires a document map.");
  const full = render_document({ map: fullMap });

  const hostedMap = hson.liveMap.fromHson(`<main id="hosted-ssr" <p @000005202 "hosted"/>/>`);
  if (hostedMap.mode !== "document") throw new Error("Hosted SSR fixture requires a document map.");
  locus = hsonLocus.create({ map: hostedMap, logicalMapId: "browser-document-ssr", sessions: {} });
  const sessionsBefore = locus.sessions.debug().sessions.length;
  const hosted = render_hosted_document({ authority: locus });
  assert.equal(locus.sessions.debug().sessions.length, sessionsBefore, "SSR capture must create no session");
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
    if (url.pathname === "/__state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ local, full, hosted, socketUrl }));
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
      if (moduleMatch === null) throw new Error("Document SSR fixture has no module body.");
      moduleSource = moduleMatch[1];
      content = content
        .replace(moduleMatch[0], `<script type="module" src="/test.js"></script>`)
        .replace("<!--LOCAL_SSR-->", local.html)
        .replace("<!--HOSTED_SSR-->", hosted.html)
        .replace("</body>", `<script>
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
    response.writeHead(200, { "content-type": url.pathname === "/bundle.js" ? "text/javascript" : "text/html; charset=utf-8" });
    response.end(content);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Document SSR browser server has no TCP address.");

  const profile = join(fixtureRoot, "chrome-profile");
  chrome = spawn(chromeExecutable(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `http://127.0.0.1:${address.port}/`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Document SSR browser acceptance timed out.\n${stderr}`)), 30_000);
  });
  const result = await Promise.race([browserResult, timeout]);
  assert.equal(result.status, "pass", result.detail || stderr);
  process.stdout.write(`Document SSR browser acceptance passed (${result.detail}).\n`);
} finally {
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  if (chrome !== undefined && chrome.exitCode === null) {
    const closed = new Promise((resolveClose) => chrome.once("close", resolveClose));
    chrome.kill("SIGTERM");
    await closed;
  }
  await new Promise((resolveClose) => socketServer?.close(resolveClose) ?? resolveClose());
  await new Promise((resolveClose) => server?.close(resolveClose) ?? resolveClose());
  locus?.dispose();
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { Hson, add_interaction, enable_interactions, encode_ssr_bootstrap, hson, hsonLocus, render_document, render_hosted_document } from "../dist/index.js";

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
let librariesSocketServer;
let locus;
let librariesLocus;
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
  const largeHostedBootstrap = Object.freeze({
    logicalMapId: "browser-large-map",
    incarnationId: "browser-large-incarnation",
    rev: 0,
    mode: "document",
    hson: "browser-large:" + "x".repeat(2 * 1_024 * 1_024),
  });

  const LocalLibrariesStateSchema = Hson.schema`<type "data" content <count "number">>`;
  const LocalLibrariesPageSchema = Hson.schema`<type "document" tag "main" attrs <props <id "string">> content <sequence [<tag "button" content "empty">]>>`;
  const localLibrariesMap = hson.liveMap.fromLibraries({
    state: { data: { count: 7 }, schema: LocalLibrariesStateSchema },
    page: { document: '<main id="local-libraries-ssr" <button @000005204/>/>', schema: LocalLibrariesPageSchema },
  });
  const localLibraries = render_document({ map: localLibrariesMap });

  const hostedMap = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [{
    $_tag: "main", $_attrs: { id: "hosted-ssr" }, $_content: [{ $_tag: "_hson_elem", $_content: [{
      $_tag: "p", $_meta: { quid: "000005202" }, $_content: [{ $_tag: "_hson_elem", $_content: [{
        $_tag: "_hson_str", $_content: [`hosted </script> <script> <!-- --> < > & " ' \u2028 \u2029`],
      }] }],
    }] }],
  }] });
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

  const StateSchema = Hson.schema`<type "data" content <count "number">>`;
  const PageSchema = Hson.schema`<type "document" tag "main" attrs <props <id "string" data-recovered <optional "string">>> content <sequence [<tag "button" attrs <props <data-async <optional "string">>> content "empty">]>>`;
  const AdminSchema = Hson.schema`<type "document" tag "aside" attrs <props <data-recovered <optional "string">>> content "empty">`;
  const librariesMap = hson.liveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: '<main id="libraries-ssr" <button @000005203/>/>', schema: PageSchema },
    admin: { document: "<aside/>", schema: AdminSchema },
  });
  enable_interactions(librariesMap);
  add_interaction(librariesMap, Object.freeze({
    id: "ssr-click",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    listener: Object.freeze({ event: "click", target: "element", capture: false, once: false, passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false }),
    kind: "browser-local",
    key: "clicker",
    args: Hson.data.from(null),
  }));
  add_interaction(librariesMap, Object.freeze({
    id: "ssr-authoritative",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    listener: Object.freeze({ event: "click", target: "element", capture: false, once: false, passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false }),
    kind: "locus-authoritative",
    key: "state.interaction",
    payload: Hson.data.from(null),
  }));
  librariesLocus = hsonLocus.create({
    map: librariesMap,
    sessions: {},
    actions: {
      "state.increment": (context) => context.mutate((draft) => draft.lib("state").at(["count"]).set(2)),
      "state.interaction": (context) => context.mutate((draft) => draft.lib("state").at(["count"]).set(5)),
    },
  });
  const libraries = render_hosted_document({ authority: librariesLocus, document: "page" });
  const encoded = Object.freeze({
    local: encode_ssr_bootstrap(local.bootstrap),
    localLibraries: encode_ssr_bootstrap(localLibraries.bootstrap),
    full: encode_ssr_bootstrap(full.bootstrap),
    largeHosted: encode_ssr_bootstrap(largeHostedBootstrap),
    hosted: encode_ssr_bootstrap(hosted.bootstrap),
    libraries: encode_ssr_bootstrap(libraries.bootstrap),
  });
  await librariesLocus.mutate((draft) => {
    draft.lib("state").at(["count"]).set(1);
    draft.lib("page").attrs.set({ kind: "path", path: [0] }, "data-recovered", "page");
    draft.lib("admin").attrs.set({ kind: "path", path: [0] }, "data-recovered", "admin");
  });

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

  librariesSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveListen, rejectListen) => {
    librariesSocketServer.once("listening", resolveListen);
    librariesSocketServer.once("error", rejectListen);
  });
  librariesSocketServer.on("connection", (socket) => librariesLocus.connect({
    send(raw) { socket.send(raw); },
    close(code, reason) { socket.close(code, reason); },
    onMessage(listener) { const handler = (data) => listener(data.toString()); socket.on("message", handler); return () => socket.off("message", handler); },
    onClose(listener) { socket.on("close", listener); return () => socket.off("close", listener); },
  }));
  const librariesSocketAddress = librariesSocketServer.address();
  if (librariesSocketAddress === null || typeof librariesSocketAddress === "string") throw new Error("Libraries browser socket server has no TCP address.");
  const librariesSocketUrl = `ws://127.0.0.1:${librariesSocketAddress.port}`;

  let reportResult;
  const browserResult = new Promise((resolveResult) => { reportResult = resolveResult; });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ local, localLibraries, full, largeHostedBootstrap, hosted, socketUrl, libraries, librariesSocketUrl, encoded }));
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
        .replace("<!--LOCAL_LIBRARIES_SSR-->", localLibraries.html)
        .replace("<!--HOSTED_SSR-->", hosted.html)
        .replace("<!--HOSTED_CARRIER-->", `<script type="application/vnd.hson-live.ssr-bootstrap">${encoded.hosted}</script>`)
        .replace("<!--LIBRARIES_SSR-->", libraries.html)
        .replace("</body>", `<script>
          (() => {
            const fail = (event) => {
              document.documentElement.dataset.detail = String(event.message ?? event.reason ?? "Browser module failed");
              document.documentElement.dataset.status = "fail";
            };
            window.addEventListener("error", fail);
            window.addEventListener("unhandledrejection", fail);
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
  await new Promise((resolveClose) => librariesSocketServer?.close(resolveClose) ?? resolveClose());
  await new Promise((resolveClose) => server?.close(resolveClose) ?? resolveClose());
  locus?.dispose();
  librariesLocus?.dispose();
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

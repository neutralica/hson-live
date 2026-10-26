import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { opaque_document_stylesheet } from "../dist/internal/css/opaque-stylesheet.js";
import { Hson, encode_ssr_bootstrap, hson, enable_interactions, add_interaction } from "../dist/index.js";
import { hsonLiveMap } from "hson-live/livemap";
import { bind_node_locus_websocket } from "../dist/api/locus/node/index.js";
import { parse_hson_exact_runtime } from "../dist/internal/exact-runtime-hson-codec.js";
import { admit_exact_runtime_livemap_libraries } from "../dist/internal/exact-runtime-node-admission.js";
import { make_livemap_from_authored_libraries_internal } from "../dist/api/livemap/livemap.libraries.js";
import { lookup_document_quad_internal } from "../dist/api/livemap/livemap.document.quad.js";
import { create_locus_hosted_aggregate_authority_internal } from "../dist/api/locus/locus.aggregate.authority.js";
import { capture_selected_authority_projection_snapshot } from "../dist/api/locus/locus.authority-projection-snapshot.js";
import { locus_local_initializer_digest } from "../dist/api/locus/locus.local-initializer.js";
import { cut_hosted_projection } from "../dist/internal/document-cut.js";

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
let librariesSocketServer;
let librariesLocus;
let cssSocketServer;
let cssLocus;
let quadSocketServer;
let quadLocus;
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

  const LocalPageSchema = Hson.schema`<type "document" tag "main" attrs <props <id "string" data-revision <optional "string">>> content <sequence [<tag "p" content "string">]>>`;
  const localMap = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime(`<main id="local-ssr" <p @000005201 "ab"/>/>`, { allowTopLevelDocumentText: true }), schema: LocalPageSchema },
  });
  localMap.doc.must("page").document.attrs.set({ kind: "path", path: [0] }, "data-revision", "N");
  const local = localMap.cut({ html: "page" });
  assert.doesNotMatch(local.html, /hson:quid|000005201/);
  assert.doesNotMatch(JSON.stringify(local.libs), /000005201|"quid"/);
  const FullPageSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content <sequence [<tag "title" content "string">]>>, <tag "body" content <sequence [<tag "main" content "string">]>>]>>`;
  const fullMap = hson.liveMap.fromLibraries({ page: { document: `<html <head <title "SSR"/>/> <body <main "whole"/>/>/>`, schema: FullPageSchema } });
  const full = fullMap.cut({ html: "page" });
  const quadCuts = [false, true].map(multiple => {
    const map = make_livemap_from_authored_libraries_internal({ page: { document:
      `<html ${multiple ? '@:root ' : ''}<head/> <body <main <button @:confirm id="quad-button"/> <aside ${multiple ? '@:other ' : ''}id="quad-other"/> <span id="quad-anonymous"/>/>/>/>` } });
    map.doc.must("page").css.stylesheet('#quad-button{color:rgb(11,22,33)}');
    const cut = map.cut({ html: "page" });
    const serverQuids = (cut.libs.libraries[0].quads ?? []).map(({ name }) => lookup_document_quad_internal(map.doc.must("page"), name).quid);
    assert.doesNotMatch(cut.html, /hson:quid/);
    return { multiple, cut, serverQuids };
  });
  const LocalLibrariesStateSchema = Hson.schema`<type "data" content <count "number">>`;
  const LocalLibrariesPageSchema = Hson.schema`<type "document" tag "main" attrs <props <id "string">> content <sequence [<tag "button" content "empty">]>>`;
  const localSelectionMap = admit_exact_runtime_livemap_libraries({
    state: { data: { count: 7 }, schema: LocalLibrariesStateSchema },
    omitted: { data: true },
    page: { document: parse_hson_exact_runtime('<main id="local-libraries-ssr" <button @000005204/>/>', { allowTopLevelDocumentText: true }), schema: LocalLibrariesPageSchema },
  });
  const localSelection = localSelectionMap.cut({ data: ["state"], documents: ["page"], html: "page" });
  assert.doesNotMatch(localSelection.html, /hson:quid|000005204/);
  assert.doesNotMatch(JSON.stringify(localSelection.libs), /000005204|identityEpoch|issuedQuids|"identity"|"quid"/);

  const StateSchema = Hson.schema`<type "data" content <count "number">>`;
  const PageSchema = Hson.schema`<type "document" tag "main" attrs <props <id "string" data-recovered <optional "string">>> content <sequence [<tag "button" attrs <props <data-async <optional "string">>> content "empty">]>>`;
  const AdminSchema = Hson.schema`<type "document" tag "aside" attrs <props <data-recovered <optional "string">>> content "empty">`;
  const browserInteraction = Object.freeze({
    id: "ssr-click",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    listener: Object.freeze({ event: "click", target: "element", capture: false, once: false, passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false }),
    kind: "browser",
    key: "clicker",
    args: Hson.data.from(null),
  });
  const authorityInteraction = Object.freeze({
    id: "ssr-authoritative",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    listener: Object.freeze({ event: "click", target: "element", capture: false, once: false, passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false }),
    kind: "locus",
    key: "state.interaction",
    payload: Hson.data.from(null),
  });
  librariesLocus = hsonLiveMap.locus.create({ "state": { data: { count: 0 }, schema: StateSchema, access: "shared" }, "page": { document: '<main id="libraries-ssr" <button/>/>', schema: PageSchema, access: "shared" }, "admin": { document: "<aside/>", schema: AdminSchema, access: "shared" } }, { sessions: {}, interactions: [browserInteraction, authorityInteraction], defaultProjection: { libraries: ["state", "admin", "page"], systemFeatures: ["interactions"] }, authorizeProjection: () => ({ libraries: ["state", "page", "admin"], systemFeatures: ["interactions"], writableDocuments: ["page"] }), actions: {
      "state.increment": (context) => context.stage.data.must("state").at(["count"]).set(2),
      "state.interaction": (context) => context.stage.data.must("state").at(["count"]).set(5),
    } });
  const retained = await librariesLocus.session.create({ libraries: ["state", "admin", "page"], systemFeatures: ["interactions"] });
  const libraries = retained.now({ html: "page" });
  const encoded = Object.freeze({
    local: encode_ssr_bootstrap(local.libs),
    localSelection: encode_ssr_bootstrap(localSelection.libs),
    full: encode_ssr_bootstrap(full.libs),
    libraries: encode_ssr_bootstrap(libraries),
  });
  await librariesLocus.stage((draft) => {
    draft.data.must("state").at(["count"]).set(1);
    draft.doc.must("page").at([]).asElement().attrs.set("data-recovered", "page");
    draft.doc.must("admin").at([]).asElement().attrs.set("data-recovered", "admin");
  });

  librariesSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveListen, rejectListen) => {
    librariesSocketServer.once("listening", resolveListen);
    librariesSocketServer.once("error", rejectListen);
  });
  librariesSocketServer.on("connection", (socket) => bind_node_locus_websocket(librariesLocus, socket));
  const librariesSocketAddress = librariesSocketServer.address();
  if (librariesSocketAddress === null || typeof librariesSocketAddress === "string") throw new Error("Libraries browser socket server has no TCP address.");
  const librariesSocketUrl = `ws://127.0.0.1:${librariesSocketAddress.port}`;

  cssLocus = hsonLiveMap.locus.create({ "page": { document: '<html <head/> <body <p id="hosted-css-target" "hosted"/> <p id="hosted-layer-target" "grouped"/>/>/>', access: "shared" } }, { defaultProjection: { libraries: ["page"] }, authorizeProjection: () => ({ libraries: ["page"], writableDocuments: ["page"] }) });
  await cssLocus.stage(draft => { draft.doc.must("page").css({domain:"css",kind:"append",
    stylesheet:opaque_document_stylesheet('@layer { #hosted-layer-target { CoLoR: red !important; } #hosted-layer-target { color: blue !important; } }')}); });
  await cssLocus.stage((draft) => { draft.doc.must("page").css({ domain: "css", kind: "rule", ruleKey: "sel:#hosted-css-target", scopes: [],
    rule: { ruleKey: "sel:#hosted-css-target", selector: "#hosted-css-target", scopes: [], declarations: [["color", "rgb(1, 2, 3)"]] } }); });
  const cssSession = await cssLocus.session.create({ libraries: ["page"] });
  const cssCut = cssSession.now({ html: "page" });
  await cssLocus.stage((draft) => { draft.doc.must("page").css({ domain: "css", kind: "rule", ruleKey: "sel:#hosted-css-target", scopes: [],
    rule: { ruleKey: "sel:#hosted-css-target", selector: "#hosted-css-target", scopes: [], declarations: [["color", "rgb(4, 5, 6)"]] } }); });
  cssSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveListen, rejectListen) => {
    cssSocketServer.once("listening", resolveListen);
    cssSocketServer.once("error", rejectListen);
  });
  cssSocketServer.on("connection", (socket) => bind_node_locus_websocket(cssLocus, socket));
  const cssSocketAddress = cssSocketServer.address();
  if (cssSocketAddress === null || typeof cssSocketAddress === "string") throw new Error("Styled browser socket server has no TCP address.");
  const cssSocketUrl = `ws://127.0.0.1:${cssSocketAddress.port}`;

  const quadMap = make_livemap_from_authored_libraries_internal({ page: { document:
    '<html @:root <head/> <body <button @:target id="hosted-quad"/>/>/>' }, secret: { data: { sentinel: "PRIVATE_ROOT_RECOVERY" } }, side: { document: "<aside/>" } });
  enable_interactions(quadMap);
  add_interaction(quadMap, { ...browserInteraction, id: "quad-root-click", subject: { library: "page", path: [0] }, key: "rootClick" });
  quadMap.doc.must("page").css.stylesheet('#hosted-quad{color:rgb(11,22,33)}');
  quadLocus = create_locus_hosted_aggregate_authority_internal({ map: quadMap,
    libraries: [{ name: "page", ownership: "shared" }, { name: "secret", ownership: "private" }, { name: "side", ownership: "shared" }], defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, systemFeatures: requested.systemFeatures, writableDocuments: ["page"] }) });
  const quadSessionId = await quadLocus.create_session({ libraries: ["page"], systemFeatures: ["interactions"] });
  const quadHostedCut = { ...cut_hosted_projection(capture_selected_authority_projection_snapshot(quadMap,
    quadLocus.sessions.projection(quadSessionId)), "page"), format: "hson-locus-session-now",
    sessionBinding: quadLocus.sessions.binding(quadSessionId), local: [], initializerDigest: locus_local_initializer_digest([]) };
  const quadServerQuids = ["root", "target"].map(name => lookup_document_quad_internal(quadMap.doc.must("page"), name).quid);
  // Ordinary retained history is available. Recovery must still reconcile this
  // now-stale, valid SSR cut without replacing its borrowed root Element.
  await quadLocus.stage(draft => { draft.doc.must("page").attrs.set({ kind: "path", path: [0] }, "data-stale-recovered", "yes"); });
  quadSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveListen, rejectListen) => { quadSocketServer.once("listening", resolveListen); quadSocketServer.once("error", rejectListen); });
  quadSocketServer.on("connection", socket => bind_node_locus_websocket(quadLocus, socket));
  const quadSocketAddress = quadSocketServer.address();
  if (quadSocketAddress === null || typeof quadSocketAddress === "string") throw new Error("QUAD browser socket server has no TCP address.");
  const quadSocketUrl = `ws://127.0.0.1:${quadSocketAddress.port}`;

  let quadRecoveryRound = 0;
  let reportResult;
  const browserResult = new Promise((resolveResult) => { reportResult = resolveResult; });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__close-libraries-socket") {
      for (const socket of librariesSocketServer.clients) socket.close(1012, "Reconnect acceptance probe.");
      response.writeHead(204); response.end();
      return;
    }
    if (url.pathname === "/__state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ local, localSelection, full, libraries, librariesSocketUrl, credential: retained.credential,
        cssCut, cssSocketUrl, cssCredential: cssSession.credential, quadCuts, quadHostedCut, quadSocketUrl,
        quadCredential: quadLocus.sessions.credential(quadSessionId), quadServerQuids, encoded }));
      return;
    }
    if (url.pathname === "/__quad-mutate") {
      await quadLocus.stage(draft => { draft.doc.must("page").attrs.set({ kind: "path", path: [0, 0, 1, 0, 0] }, "title", "live"); });
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__quad-reconcile") {
      quadRecoveryRound++;
      await quadLocus.stage(draft => { draft.doc.must("page").attrs.set({ kind: "path", path: [0] }, "data-recovery-round", String(quadRecoveryRound)); });
      await quadLocus.sessions.updateProjection(quadSessionId, { libraries: quadRecoveryRound % 2 ? ["page", "side"] : ["page"], systemFeatures: ["interactions"] });
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__quad-current") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...quadHostedCut, ...cut_hosted_projection(capture_selected_authority_projection_snapshot(quadMap,
        quadLocus.sessions.projection(quadSessionId)), "page") }));
      return;
    }
    if (url.pathname === "/__quad-incompatible") {
      await quadLocus.stage(draft => { draft.doc.must("page").content.replace({ kind: "path", path: [] }, 0, { $_tag: "aside", $_content: [] }); });
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__css-mutate") {
      await cssLocus.stage((draft) => { draft.doc.must("page").css({ domain: "css", kind: "rule", ruleKey: "sel:#hosted-css-target", scopes: [],
        rule: { ruleKey: "sel:#hosted-css-target", selector: "#hosted-css-target", scopes: [], declarations: [["color", "rgb(7, 8, 9)"]] } }); });
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__css-revoke") {
      await cssSession.update({ libraries: [] });
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__css-regrant") {
      await cssSession.update({ libraries: ["page"] });
      response.writeHead(204).end();
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
        .replace("<!--LOCAL_LIBRARIES_SSR-->", localSelection.html)
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
  await new Promise((resolveClose) => librariesSocketServer?.close(resolveClose) ?? resolveClose());
  await new Promise((resolveClose) => cssSocketServer?.close(resolveClose) ?? resolveClose());
  await new Promise((resolveClose) => quadSocketServer?.close(resolveClose) ?? resolveClose());
  await new Promise((resolveClose) => server?.close(resolveClose) ?? resolveClose());
  librariesLocus?.dispose();
  cssLocus?.dispose();
  quadLocus?.dispose();
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

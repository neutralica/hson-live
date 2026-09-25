import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { hsonLiveMap } from "../dist/index.js";

const candidates = [process.env.HSON_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium", "google-chrome", "chromium"]
  .filter((candidate) => candidate !== undefined);
const chromeBinary = candidates.find((candidate) => (!candidate.includes("/") || existsSync(candidate))
  && spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0);
if (chromeBinary === undefined) throw new Error("Document CSS browser check requires Chrome or Chromium.");

const map = hsonLiveMap.fromLibraries({ page: {
  document: '<html <head <title "CSS"/> <style "#home-screen{color:red;}"/>/> <body <main id=home-screen "Styled"/>/>/>',
} });
map.lib("page").css.stylesheet("#home-screen { color: rgb(0, 0, 255); display: grid; }");
const html = map.render("page");
assert.equal((html.match(/data-hson-managed-document-css/g) ?? []).length, 1);

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Browser fixture server failed.");
const profile = await mkdtemp(join(tmpdir(), "hson-document-css-browser-"));
let chrome;
let socket;
try {
  chrome = spawn(chromeBinary, [
    "--headless=new", "--disable-javascript", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    `http://127.0.0.1:${address.port}/`,
  ], { stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  let debuggerPort;
  while (Date.now() < deadline) {
    try {
      debuggerPort = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      if (Number.isInteger(debuggerPort) && debuggerPort > 0) break;
    } catch { /* Chrome has not initialized its profile yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!debuggerPort) throw new Error("Chrome did not open a DevTools endpoint.");
  let target;
  while (Date.now() < deadline) {
    const pages = await (await fetch(`http://127.0.0.1:${debuggerPort}/json/list`)).json();
    target = pages.find((entry) => entry.type === "page" && entry.url.includes(String(address.port)));
    if (target !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (target === undefined) throw new Error("Chrome did not load the rendered document.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  let nextId = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id === undefined) return;
    const task = pending.get(message.id);
    if (task === undefined) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("DOM.enable");
  await send("CSS.enable");
  const { root } = await send("DOM.getDocument");
  let home;
  while (Date.now() < deadline) {
    ({ nodeId: home } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#home-screen" }));
    if (home) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(home, "rendered body reached Chrome with JavaScript disabled");
  const { computedStyle } = await send("CSS.getComputedStyleForNode", { nodeId: home });
  const property = (name) => computedStyle.find((entry) => entry.name === name)?.value;
  assert.equal(property("display"), "grid");
  assert.equal(property("color"), "rgb(0, 0, 255)");
  const { nodeIds: managed } = await send("DOM.querySelectorAll", {
    nodeId: root.nodeId, selector: "style[data-hson-managed-document-css='v1']",
  });
  assert.equal(managed.length, 1);
  console.log("Document CSS native Chrome/no-JavaScript acceptance passed.");
} finally {
  socket?.close();
  if (chrome !== undefined && chrome.exitCode === null) {
    const closed = new Promise((resolve) => chrome.once("close", resolve));
    chrome.kill("SIGTERM");
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

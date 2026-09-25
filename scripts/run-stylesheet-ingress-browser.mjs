import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { hsonLiveMap } from "../dist/api/livemap/index.js";
import { hsonLiveTree } from "../dist/api/livetree/index.js";

const candidates = [process.env.HSON_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium", "google-chrome", "chromium"]
  .filter((candidate) => candidate !== undefined);
const chromeBinary = candidates.find((candidate) => (!candidate.includes("/") || existsSync(candidate))
  && spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0);
if (chromeBinary === undefined) throw new Error("Stylesheet ingress browser check requires Chrome or Chromium.");

const source = `
  .same { color: red; }
  .same { color: blue; }
  .cascade { margin-left: 5px; margin: 0; content: var(--message); }
  @media (max-width: 600px) { @supports (display: grid) { @layer components { .card { display: grid; } } } }
  @property --phase { syntax: "<number>"; inherits: false; initial-value: 0; }
  .card { content: "a;b}"; width: calc(100% - var(--gap, 2px)); color: red !important; }
  @keyframes fade { from { padding-left: 5px; padding: 0; opacity: 0; } to { opacity: 1; } }
`;
const documentSource = "<html <head/> <body/>/>";
const nodeMap = hsonLiveMap.fromLibraries({ page: { document: documentSource } });
nodeMap.lib("page").css.stylesheet(source);
const nodeTree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] }, { isolated: true });
nodeTree.css.global.stylesheet(source);
const expected = {
  record: nodeMap.capture().libraries[0].css,
  mapCss: nodeMap.lib("page").css.snapshot(),
  treeCss: nodeTree.css.snapshot(),
};
assert.equal(expected.mapCss, expected.treeCss);
assert.match(expected.mapCss, /margin-left:5px;margin:0;/);
assert.match(expected.mapCss, /content:var\(--message\);/);
assert.match(expected.mapCss, /padding-left: 5px;\s+padding: 0;/);
nodeTree.remove();

const entry = `
  import { hsonLiveMap } from "./src/api/livemap/index.ts";
  import { hsonLiveTree } from "./src/api/livetree/index.ts";
  const source = ${JSON.stringify(source)};
  const map = hsonLiveMap.fromLibraries({ page: { document: ${JSON.stringify(documentSource)} } });
  map.lib("page").css.stylesheet(source);
  const tree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] });
  tree.css.global.stylesheet(source);
  requestAnimationFrame(() => {
    const result = {
      record: map.capture().libraries[0].css,
      mapCss: map.lib("page").css.snapshot(),
      treeCss: tree.css.snapshot(),
      managedStyle: document.querySelector("hson-_style style")?.textContent ?? null,
    };
    document.body.setAttribute("data-result", encodeURIComponent(JSON.stringify(result)));
  });
`;
const bundle = await build({ stdin: { contents: entry, loader: "ts", resolveDir: resolve(".") },
  bundle: true, platform: "browser", format: "iife", target: "es2022", write: false });
const script = new TextDecoder().decode(bundle.outputFiles[0].contents).replace(/<\/script/gi, "<\\/script");
const temporary = await mkdtemp(join(tmpdir(), "hson-stylesheet-browser-"));
try {
  const fixture = join(temporary, "fixture.html");
  const profile = join(temporary, "profile");
  await writeFile(fixture, `<!doctype html><html><head></head><body><script>${script}</script></body></html>`);
  const chrome = spawnSync(chromeBinary, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--virtual-time-budget=2000", "--dump-dom",
    `--user-data-dir=${profile}`, pathToFileURL(fixture).href],
  { encoding: "utf8", timeout: 30_000, maxBuffer: 20_000_000 });
  assert.equal(chrome.status, 0, `${chrome.error?.message ?? chrome.signal ?? "Chrome exited"}: ${chrome.stderr.slice(-2_000)}`);
  const match = /data-result="([^"]+)"/.exec(chrome.stdout);
  assert.ok(match, `Browser entry did not publish its result: ${chrome.stderr.slice(-2_000)}`);
  const actual = JSON.parse(decodeURIComponent(match[1]));
  assert.deepEqual(actual.record, expected.record);
  assert.equal(actual.mapCss, expected.mapCss);
  assert.equal(actual.treeCss, expected.treeCss);
  assert.equal(actual.managedStyle, expected.treeCss);
  console.log("Native browser stylesheet parser, LiveMap/LiveTree parity, and style synchronization passed.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

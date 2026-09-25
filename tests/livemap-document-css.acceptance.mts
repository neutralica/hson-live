import assert from "node:assert/strict";
import { hsonLiveMap, render_document, type LiveMapDynamicLibrary } from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "../src/internal/css/portable-document-stylesheet.ts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

const document = '<html <head <title "CSS"/> <style "body{font-size:12px;}"/>/> <body <main id=home-screen "Hello"/>/>/>';
const map = hsonLiveMap.fromLibraries({ page: { document }, data: { data: { count: 1 } } });
const page = map.lib("page");
const data = map.lib("data");
if (false) {
  const transitionReturn: void = page.css.stylesheet("body { margin: 0; }");
  void transitionReturn;
  // @ts-expect-error Data Libraries have no stylesheet capability.
  data.css;
  // @ts-expect-error Document locations have no stylesheet capability.
  page.at([]).css;
  // @ts-expect-error Document-wide CSS has no redundant global child.
  page.css.global;
}
const dynamic: LiveMapDynamicLibrary = map.lib("page" as string);
if (dynamic.mode === "document") {
  assert.equal(dynamic.css.snapshot(), "");
  dynamic.css.stylesheet("");
}
assert.equal("css" in data, false);
assert.equal("css" in page.at([]), false);
assert.equal("global" in page.css, false);
assert.equal(page.css.snapshot(), "");
assert.deepEqual(map.capture().libraries.find((item) => item.name === "page")?.css,
  { rules: [], properties: [], keyframes: [], order: [] });
assert.equal("css" in (map.capture().libraries.find((item) => item.name === "data") ?? {}), false);
assert.doesNotMatch(map.render("page"), /data-hson-managed-document-css/);
assert.throws(() => hsonLiveMap.fromLibraries({ data: { data: 1, css: {} } } as never), /Initial Library CSS input/);
assert.throws(() => hsonLiveMap.fromLibraries({ page: { document, css: {} } } as never), /Initial Library CSS input/);

const empty = map.capture();
const installedEmpty = install_libraries_snapshot(empty).map.lib("page");
assert.equal(installedEmpty.mode, "document");
if (installedEmpty.mode === "document") assert.equal(installedEmpty.css.snapshot(), "");
const rootBefore = page.root();
const commits: Array<ReturnType<typeof map.replay>> = [];
map.commits.observe((commit) => { if (commit.operations.some((entry) => "domain" in entry.operation && entry.operation.domain === "css")) commits.push(commit); });
let revision = map.rev;
page.css.sel("body").set.margin("0");
assert.equal(map.rev, ++revision);
page.css.sel("body").set.margin("0");
assert.equal(map.rev, revision);
page.css.sel("#home-screen").set.display("grid");
assert.equal(map.rev, ++revision);
const beforeBatch = map.rev;
page.css.sel("body").setMany({ color: "purple", backgroundColor: "white" });
assert.equal(map.rev, beforeBatch + 1);
revision = map.rev;
const beforeReject = page.css.snapshot();
assert.throws(() => page.css.sel("body").setMany({ margin: "1px", color: { broken: true } } as never));
assert.equal(map.rev, revision);
assert.equal(page.css.snapshot(), beforeReject);
assert.equal(commits.length, revision);
assert.deepEqual(page.root(), rootBefore);

page.css.media({ maxWidth: 600 }).supports("(display: grid)").sel("body").set.color("red");
page.css.layer("components").rule("panel", "main").set.padding("1rem");
page.css.var.set("accent", "rebeccapurple");
page.css.atProperty.register(["--phase", "<number>", "0"]);
page.css.keyframes.set({ name: "fade", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
const styled = map.capture();
const css = page.css.snapshot();
const installedStyled = install_libraries_snapshot(styled).map.lib("page");
assert.equal(installedStyled.mode, "document");
if (installedStyled.mode === "document") assert.equal(installedStyled.css.snapshot(), css);
assert.match(css, /@property --phase/);
assert.match(css, /@keyframes fade/);
assert.match(css, /@media \(max-width: 600px\)/);
assert.match(css, /@supports \(display: grid\)/);
assert.equal(render_portable_document_stylesheet(decode_portable_document_stylesheet(
  styled.libraries.find((item) => item.name === "page")?.css)), css);
const html = map.render("page");
assert.equal((html.match(/data-hson-managed-document-css/g) ?? []).length, 1);
assert.ok(html.indexOf("<title>CSS</title>") < html.indexOf('<style>body{font-size:12px;}</style>'));
assert.ok(html.indexOf('<style>body{font-size:12px;}</style>') < html.indexOf("data-hson-managed-document-css"));
assert.ok(html.indexOf("data-hson-managed-document-css") < html.indexOf("<body>"));
assert.match(html, /body\{[^}]*margin:0;/);
const cut = render_document({ map, document: "page" });
assert.equal(cut.html, html);
assert.equal(cut.bootstrap.revision, styled.revision);
assert.deepEqual(cut.bootstrap.libraries.find((item) => item.name === "page")?.css,
  styled.libraries.find((item) => item.name === "page")?.css);

map.restore(empty);
assert.equal(page.css.snapshot(), "");
map.restore(styled);
assert.equal(page.css.snapshot(), css);
assert.equal(map.render("page"), html);
const fresh = hsonLiveMap.fromLibraries({ page: { document }, data: { data: { count: 1 } } });
for (const commit of commits) fresh.replay(commit);
assert.deepEqual(fresh.capture(), styled);
assert.equal(fresh.render("page"), html);
const firstCssOperation = commits[0]?.operations[0]?.operation;
assert.ok(firstCssOperation && Object.isFrozen(firstCssOperation));
if (firstCssOperation && "domain" in firstCssOperation && firstCssOperation.domain === "css" && firstCssOperation.kind === "rule") {
  assert.ok(Object.isFrozen(firstCssOperation.scopes));
  if (firstCssOperation.rule !== undefined) {
    assert.ok(Object.isFrozen(firstCssOperation.rule));
    assert.ok(Object.isFrozen(firstCssOperation.rule.declarations));
  }
}
const replayRev = fresh.rev;
assert.throws(() => fresh.replay({ kind: "map", changed: true, prevRev: replayRev, rev: replayRev + 1,
  operations: [{ library: "page", operation: { domain: "css", kind: "rule", ruleKey: "missing", scopes: [] } }] } as never),
  /semantic stylesheet change/);
assert.throws(() => fresh.replay({ kind: "map", changed: true, prevRev: replayRev, rev: replayRev + 1,
  operations: [{ library: "page", operation: { domain: "css", kind: "clear-all", extra: true } }] } as never),
  /Invalid document CSS operation fields/);
assert.equal(fresh.rev, replayRev);
assert.deepEqual(fresh.capture(), styled);

const orderMap = hsonLiveMap.fromLibraries({ page: { document: "<html <head/> <body/>/>" } });
const order = orderMap.lib("page").css;
order.rule("a", ".a").set.color("red");
order.rule("b", ".b").set.color("blue");
order.rule("a", ".a").set.backgroundColor("black");
assert.ok(order.snapshot().indexOf(".a{") < order.snapshot().indexOf(".b{"));
order.rule("a", ".a").drop();
order.rule("a", ".a").set.color("red");
assert.ok(order.snapshot().indexOf(".b{") < order.snapshot().indexOf(".a{"));
order.clearAll();
assert.equal(order.snapshot(), "");

const fragment = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
fragment.lib("page").css.sel("main").set.color("red");
assert.throws(() => fragment.render("page"), /not compatible with browser-parser realization/);
assert.throws(() => fragment.render("page"), (error: unknown) =>
  error instanceof Error && error.cause instanceof Error && /explicit html\/head/.test(error.cause.message));
const dangerous = hsonLiveMap.fromLibraries({ page: { document: "<html <head/> <body/>/>" } });
dangerous.lib("page").css.sel("body").set.content('"</style><script>"');
assert.throws(() => dangerous.render("page"), (error: unknown) =>
  error instanceof Error && error.cause instanceof Error && /closing sentinel/.test(error.cause.message));

const addMap = hsonLiveMap.create();
addMap.lib.add({ page: { document: "<html <head/> <body/>/>" } });
const added = addMap.lib("page");
assert.equal(added.mode, "document");
if (added.mode === "document") assert.equal(added.css.snapshot(), "");
const worker = await new Promise<Readonly<{ capture: ReturnType<typeof map.capture>; css: string; html: string }>>((resolve, reject) => {
  const instance = repository_typescript_worker(new URL("./fixtures/livemap-document-css.worker.mts", import.meta.url));
  instance.once("message", resolve);
  instance.once("error", reject);
  instance.once("exit", (code) => { if (code !== 0) reject(new Error(`Document CSS Worker exited with ${code}.`)); });
});
const workerMap = hsonLiveMap.fromLibraries({ page: { document: "<html <head/> <body/>/>" } });
workerMap.lib("page").css.sel("body").set.margin("0");
workerMap.lib("page").css.atProperty.register(["--phase", "<number>", "0"]);
workerMap.lib("page").css.keyframes.set({ name: "fade", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
workerMap.lib("page").css.stylesheet(".worker { color: var(--accent, blue); } @media (min-width: 1px) { .worker { display: grid; } }");
assert.deepEqual(worker.capture, workerMap.capture());
assert.equal(worker.css, workerMap.lib("page").css.snapshot());
assert.equal(worker.html, workerMap.render("page"));
console.log("LiveMap document CSS state, transitions, capture, replay, and rendering acceptance passed.");

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { hsonLiveMap } from "../src/api/livemap/index.ts";
import { hsonLiveTree } from "../src/api/livetree/index.ts";

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
nodeMap.doc.must("page").css.stylesheet(source);
const nodeTree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] }, { isolated: true });
nodeTree.css.global.stylesheet(source);
const expected = {
  record: nodeMap.capture().libraries[0].css,
  mapCss: nodeMap.doc.must("page").css.snapshot(),
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
  import { continue_document } from "./src/api/continuation/continue-document.ts";
  import { runtime_for_tree, create_livetree_runtime, subject_for_tree, dispose_livetree_runtime } from "./src/api/livetree/runtime/livetree-runtime.ts";
  import { reflect_document_in_runtime } from "./src/api/mirror/mirror.document.ts";
  import { project_livetree } from "./src/api/livetree/creation/project-live-tree.ts";
  import { MANAGED_STYLESHEET_BROWSER_ORACLES } from "./tests/fixtures/managed-stylesheet-browser-oracles.mts";
  import { css_selector_browser_cases } from "./tests/fixtures/css-selector-browser-cases.mts";
  void (async () => {
  globalThis.addEventListener("error",event=>document.body.dataset.error=encodeURIComponent(String(event.error?.stack??event.message)));
  const source = ${JSON.stringify(source)};
  const map = hsonLiveMap.fromLibraries({ page: { document: ${JSON.stringify(documentSource)} } });
  map.doc.must("page").css.stylesheet(source);
  const tree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] });
  tree.css.global.stylesheet(source);
  function nativeValue(css, oracle) {
    const iframe = document.createElement("iframe"); document.body.append(iframe);
    const doc = iframe.contentDocument;
    const style = doc.createElement("style"); style.textContent = css; doc.head.append(style);
    const element = doc.createElement("div"); element.id = oracle.id ?? "target"; element.className = oracle.className ?? "x"; doc.body.append(element);
    const win = iframe.contentWindow;
    win.getComputedStyle(element).getPropertyValue(oracle.property);
    if (oracle.at !== undefined) {
      const animation = element.getAnimations()[0];
      if (!animation) throw Error("Missing native animation " + oracle.name);
      animation.pause(); animation.currentTime = oracle.at * 1000;
    }
    const value = win.getComputedStyle(element).getPropertyValue(oracle.property); iframe.remove(); return value;
  }
  const semantics = MANAGED_STYLESHEET_BROWSER_ORACLES.map(oracle => {
    const original = nativeValue(oracle.css, oracle);
    try {
    const owned = hsonLiveMap.fromLibraries({page:{document:${JSON.stringify(documentSource)}}});
    owned.doc.must("page").css.stylesheet(oracle.css);
    const reconstructed = nativeValue(owned.doc.must("page").css.snapshot(), oracle);
    const runtime = hsonLiveTree.fromNode({$_tag:"main",$_content:[]},{isolated:true});
    runtime.css.global.stylesheet(oracle.css);
    const runtimeValue = nativeValue(runtime.css.snapshot(), oracle);
    const record = owned.capture().libraries[0].css;
    runtime.remove();
    return {name:oracle.name, property:oracle.property, expected:oracle.expected, original, reconstructed, runtimeValue, record};
    } catch(error) { return {name:oracle.name, expected:oracle.expected, original, error:String(error)}; }
  });
  const operations = [];
  const orderedMap=hsonLiveMap.fromLibraries({page:{document:${JSON.stringify(documentSource)}}}), orderedPage=orderedMap.doc.must("page");
  const operationOracle={property:"color",className:"x"};
  orderedPage.css.stylesheet('@layer { .x { color: red !important; } .x { color: blue !important; } }');
  orderedPage.css.drop("stylesheet:1");
  operations.push({name:'drop one anonymous member keeps the other in its occurrence',actual:nativeValue(orderedPage.css.snapshot(),operationOracle),expected:nativeValue('@layer { .x { color: blue !important; } }',operationOracle)});
  const recreated=orderedPage.css.scope("independent","@layer").rule("recreated",".x"); recreated.set.color("red!important");
  operations.push({name:'recreation appends a distinct anonymous occurrence',actual:nativeValue(orderedPage.css.snapshot(),operationOracle),expected:nativeValue('@layer { .x { color: blue !important; } } @layer { .x { color: red !important; } }',operationOracle)});
  orderedPage.css.drop("stylesheet:2");recreated.set.color("green!important");
  operations.push({name:'update after member deletion preserves new occurrence',actual:nativeValue(orderedPage.css.snapshot(),operationOracle),expected:nativeValue('@layer {} @layer { .x { color: green !important; } }',operationOracle)});
  orderedPage.css.stylesheet('@layer { .x { color: blue !important; } .x { color: red !important; } }');
  operations.push({name:'replacement removes prior occurrence ordering',actual:nativeValue(orderedPage.css.snapshot(),operationOracle),expected:nativeValue('@layer { .x { color: red !important; } }',operationOracle)});
  orderedPage.css.clearAll();operations.push({name:'clear removes complete managed CSS',actual:orderedPage.css.snapshot(),expected:""});
  const reuse=hsonLiveTree.fromNode({$_tag:"main",$_content:[]},{isolated:true});
  reuse.css.global.stylesheet('@layer { .x { color: red !important; } .x { color: blue !important; } }');
  reuse.css.global.drop("stylesheet:2");
  reuse.css.global.stylesheet('@layer { .x { color: blue !important; } }');
  operations.push({name:'runtime key reuse cannot resurrect deleted anonymous membership',actual:nativeValue(reuse.css.snapshot(),operationOracle),expected:nativeValue('@layer { .x { color: red !important; } } @layer { .x { color: blue !important; } }',operationOracle)});
  reuse.remove();

  // Independent native targets: the two escaped terminal characters previously shared one key.
  const selectorPairs = ${JSON.stringify([['#t\\ ', 't '], ['#t\\\u00a0','t\u00a0'], ['#t\\20 x','t x']])};
  for (const owner of ["document", "runtime"]) {
    const ownedMap=hsonLiveMap.fromLibraries({page:{document:${JSON.stringify(documentSource)}}});
    const ownedTree=hsonLiveTree.fromNode({$_tag:"main",$_content:[]},{isolated:true});
    const css=owner==="document"?ownedMap.doc.must("page").css:ownedTree.css.global;
    const snapshot=()=>owner==="document"?css.snapshot():ownedTree.css.snapshot();
    for (const [selector] of selectorPairs) css.sel(selector).set.color("red");
    const values=()=>selectorPairs.map(([,id])=>nativeValue(snapshot(),{id,property:"color"}));
    operations.push({name:owner+' distinct escaped selectors coexist',actual:values(),expected:['rgb(255, 0, 0)','rgb(255, 0, 0)','rgb(255, 0, 0)']});
    css.sel(selectorPairs[0][0]).set.color("green");
    operations.push({name:owner+' selector update affects its own target',actual:values(),expected:['rgb(0, 128, 0)','rgb(255, 0, 0)','rgb(255, 0, 0)']});
    const key='sel:'+selectorPairs[0][0];
    operations.push({name:owner+' escaped selector lookup',actual:css.has(key)&&css.get(key).includes('green'),expected:true});
    css.drop(key);
    operations.push({name:owner+' selector drop leaves other targets intact',actual:values(),expected:['rgb(0, 0, 0)','rgb(255, 0, 0)','rgb(255, 0, 0)']});
    css.sel(selectorPairs[0][0]).set.color("blue");
    operations.push({name:owner+' selector recreation and later order',actual:[...values(),snapshot().indexOf(selectorPairs[0][0]+'{')>snapshot().indexOf(selectorPairs[1][0]+'{')],expected:['rgb(0, 0, 255)','rgb(255, 0, 0)','rgb(255, 0, 0)',true]});
    ownedTree.remove();
  }
  const continuation = [];
  const selectorChecks = await css_selector_browser_cases();
  const lazyFrame = document.createElement("iframe"); document.body.append(lazyFrame);
  const lazyDoc = lazyFrame.contentDocument, lazyRuntime = create_livetree_runtime();
  const lazyMap = hsonLiveMap.fromLibraries({page:{document:'<main <button class=lazy "go"/>/>'}});
  const lazyMirror = reflect_document_in_runtime(lazyMap.doc.must('page'), lazyRuntime);
  lazyDoc.body.append(project_livetree(subject_for_tree(lazyMirror.tree), 'html', lazyRuntime, lazyDoc));
  const lazyTree = lazyMirror.tree.find.must.byTag('button'), lazyElement = lazyTree.dom.el();
  const lazyRev = lazyMap.rev, lazyRecord = JSON.stringify(lazyMap.capture());
  let lazyCommits = 0, lazyClicks = 0; const stopLazy = lazyMap.commits.observe(()=>lazyCommits++);
  lazyElement.addEventListener('click',()=>lazyClicks++);
  const lazyCss = lazyTree.css, lazyGlobal = lazyCss.global;
  const noDemand = () => lazyTree.node.$_meta?.quid===undefined && lazyRuntime.issuedQuids.size===0 && lazyRuntime.quidToNode.size===0 && lazyMap.rev===lazyRev && lazyCommits===0 && JSON.stringify(lazyMap.capture())===lazyRecord;
  continuation.push({name:'plain mounted Mirror passive CSS/global/snapshot stays QUID-free',pass:lazyTree.css===lazyCss && lazyCss.global===lazyGlobal && lazyCss.snapshot()==='' && noDemand()});
  let lazyRejected=false;try{lazyGlobal.stylesheet('@import url(forbidden.css);')}catch{lazyRejected=true;}
  continuation.push({name:'rejected runtime global CSS does not issue or publish identity',pass:lazyRejected && noDemand()});
  lazyGlobal.stylesheet('.lazy{color:red}'); lazyGlobal.stylesheet('.lazy{color:green}'); lazyRuntime.cssManager.syncNow();
  const wrapper = lazyDoc.head.querySelector('hson-_style'), runtimeStyle = wrapper?.querySelector('style');
  continuation.push({name:'plain Mirror runtime-global append computes correctly in retained wrapper',pass:noDemand() && lazyFrame.contentWindow.getComputedStyle(lazyElement).color==='rgb(0, 128, 0)' && lazyMap.doc.must('page').css.snapshot()==='' && wrapper?.parentNode===lazyDoc.head && runtimeStyle?.parentNode===wrapper});
  lazyGlobal.sel('.lazy').set.opacity('.5'); await new Promise(resolve=>requestAnimationFrame(resolve)); lazyRuntime.cssManager.syncNow();
  continuation.push({name:'runtime global update retains element/listener/style-host identity without QUID',pass:noDemand() && lazyTree.dom.el()===lazyElement && lazyDoc.head.querySelector('hson-_style')===wrapper && wrapper.querySelector('style')===runtimeStyle && lazyFrame.contentWindow.getComputedStyle(lazyElement).opacity==='0.5'});
  lazyGlobal.clearAll(); await new Promise(resolve=>requestAnimationFrame(resolve)); lazyRuntime.cssManager.syncNow(); lazyElement.click();
  continuation.push({name:'runtime global clear preserves sparse identity and listeners',pass:noDemand() && lazyClicks===1 && lazyCss.snapshot()===''});
  lazyCss.set.color('blue'); lazyRuntime.cssManager.syncNow(); const demanded = lazyTree.node.$_meta?.quid;
  lazyCss.set.opacity('.7'); lazyRuntime.cssManager.syncNow();
  continuation.push({name:'subject CSS acquires and reuses genuine linked native identity',pass:typeof demanded==='string' && lazyTree.node.$_meta?.quid===demanded && lazyRuntime.issuedQuids.size===1 && lazyRuntime.quidToNode.get(demanded)===subject_for_tree(lazyTree) && lazyElement.getAttribute('hson:quid')===demanded && lazyFrame.contentWindow.getComputedStyle(lazyElement).color==='rgb(0, 0, 255)' && lazyFrame.contentWindow.getComputedStyle(lazyElement).opacity==='0.7' && lazyMap.rev===lazyRev && lazyCommits===0});
  stopLazy(); lazyMirror.dispose(); lazyMirror.tree.remove(); dispose_livetree_runtime(lazyRuntime); lazyFrame.remove();
  const framed = document.createElement("iframe"); document.body.append(framed);
  const continuedMap = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body <button class=x "go"/>/>/>'}});
  const page = continuedMap.doc.must("page");
  page.css.stylesheet('@layer { .x { color: red !important; } .x { color: blue !important; } }');
  const doc = framed.contentDocument; doc.open(); doc.write(page.render()); doc.close();
  const style = doc.head.querySelector('style[data-hson-managed-document-css]'), button=doc.querySelector('button');
  let clicks=0; button.addEventListener('click',()=>clicks++);
  const adopted=continue_document({map:continuedMap,document:page,root:doc.documentElement});
  const runtime=runtime_for_tree(adopted.tree), issued=runtime.issuedQuids.size;
  const continuedCss = adopted.tree.css, continuedGlobal = continuedCss.global;
  continuation.push({name:'continued global/snapshot façade remains cached and QUID-free',pass:adopted.tree.css===continuedCss && adopted.tree.css.global===continuedGlobal && continuedCss.snapshot()===page.css.snapshot() && adopted.tree.node.$_meta?.quid===undefined && runtime.issuedQuids.size===issued});
  continuation.push({name:'grouped continuation first paint and native adoption',pass:framed.contentWindow.getComputedStyle(button).color==='rgb(0, 0, 255)' && adopted.tree.dom.el()===doc.documentElement});
  const replacement='@layer { .x { color: blue !important; } .x { color: green !important; } }';
  adopted.tree.css.global.stylesheet(replacement);
  continuation.push({name:'bound replacement preserves owned native style identity and grouping',pass:doc.head.querySelector('style[data-hson-managed-document-css]')===style && framed.contentWindow.getComputedStyle(button).color==='rgb(0, 128, 0)' && page.css.snapshot()===adopted.tree.css.snapshot()});
  const rev=continuedMap.rev, native=style.textContent, record=JSON.stringify(continuedMap.capture());
  let rejected=false;try{adopted.tree.css.global.stylesheet('@import "forbidden.css";');}catch{rejected=true;}
  continuation.push({name:'rejected continued stylesheet publishes nothing',pass:rejected&&continuedMap.rev===rev&&style.textContent===native&&JSON.stringify(continuedMap.capture())===record});

  let restoreInvocations=0;
  const getterItems=[];Object.defineProperty(getterItems,"0",{get(){restoreInvocations++;return {kind:"group",header:"@layer",entries:[]}},enumerable:true});
  for(const entries of [Array(1),getterItems,Object.assign([],{map(){restoreInvocations++;return []}})]) {
    const snapshot=continuedMap.capture();
    const malformed={...snapshot,libraries:snapshot.libraries.map(library=>({...library,css:{rules:[],properties:[],keyframes:[],order:[{kind:"group",header:"@layer",entries}]}}))};
    let rejected=false;try{continuedMap.restore(malformed)}catch{rejected=true}
    continuation.push({name:'malformed recursive array restore has no native or identity effect',pass:rejected&&continuedMap.rev===rev&&style.textContent===native&&JSON.stringify(continuedMap.capture())===record&&doc.querySelector('button')===button&&runtime.issuedQuids.size===issued&&restoreInvocations===0});
  }
  adopted.tree.css.global.stylesheet(replacement);
  button.click();
  continuation.push({name:'managed no-op, listener and sparse identity continuity',pass:continuedMap.rev===rev&&clicks===1&&runtime.issuedQuids.size===issued&&doc.querySelector('button')===button});
  adopted.dispose();framed.remove();
  requestAnimationFrame(() => {
    const result = {
      semantics, continuation, operations, selectorChecks,
      record: map.capture().libraries[0].css,
      mapCss: map.doc.must("page").css.snapshot(),
      treeCss: tree.css.snapshot(),
      managedStyle: document.querySelector("hson-_style style")?.textContent ?? null,
    };
    document.body.setAttribute("data-result", encodeURIComponent(JSON.stringify(result)));
  });
  })().catch(error => document.body.dataset.error=encodeURIComponent(String(error.stack ?? error)));
`;
const snapshot = process.argv.find(arg => arg.startsWith("--source-snapshot="))?.slice("--source-snapshot=".length);
const plugins = snapshot ? [{name:"original-source", setup(b) { b.onLoad({filter:/\/src\/.*\.ts$/}, async ({path}) => ({contents:await readFile(join(snapshot,relative(resolve("."),path)),"utf8"),loader:"ts"})); }}] : [];
const bundle = await build({ plugins, stdin: { contents: entry, loader: "ts", resolveDir: resolve(".") },
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
  const error = /data-error="([^"]+)"/.exec(chrome.stdout);
  assert.ok(match, error ? decodeURIComponent(error[1]) : `Browser entry did not publish its result: ${chrome.stderr.slice(-2_000)}`);
  const actual = JSON.parse(decodeURIComponent(match[1]));
  console.log(JSON.stringify({ managedStylesheetSemantics: actual.semantics }));
  for (const oracle of actual.semantics) {
    assert.equal(oracle.original, oracle.expected, oracle.name + " independent native source");
    assert.equal(oracle.reconstructed, oracle.original, oracle.name + " document reconstruction");
    assert.equal(oracle.runtimeValue, oracle.original, oracle.name + " runtime reconstruction");
  }
  for (const check of actual.operations) assert.deepEqual(check.actual, check.expected, check.name);
  console.log(JSON.stringify({managedOperations:actual.operations}));
  assert.ok(actual.continuation.every(check => check.pass), JSON.stringify(actual.continuation));
  assert.ok(actual.selectorChecks.every(check => check.pass), JSON.stringify(actual.selectorChecks));
  console.log(JSON.stringify({selectorComposition:actual.selectorChecks}));
  console.log(JSON.stringify({managedContinuation:actual.continuation}));
  assert.deepEqual(actual.record, expected.record);
  assert.equal(actual.mapCss, expected.mapCss);
  assert.equal(actual.treeCss, expected.treeCss);
  assert.equal(actual.managedStyle, expected.treeCss);
  console.log("Native browser stylesheet parser, LiveMap/LiveTree parity, and style synchronization passed.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

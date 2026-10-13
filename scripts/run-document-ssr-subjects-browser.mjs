import assert from "node:assert/strict";
import { build } from "esbuild";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { ssr_subject_fixture } from "../tests/fixtures/document-ssr-subjects-cases.mts";
import { compose_livemap_document_internal, make_livemap_from_authored_libraries_internal, cut_document_ssr_internal } from "../src/api/livemap/livemap.libraries.ts";

// Source-only Chrome acceptance: no build and no writes to tracked distribution.
const fixture = ssr_subject_fixture();
const cut = cut_document_ssr_internal(fixture.map, { html: "page" }, fixture.demanded);
assert.doesNotMatch(cut.html, /hson:quid|hson\\:quid/);
const components = make_livemap_from_authored_libraries_internal({
  layout: {document:'<html <head/> <body <hson-template lib="component"/> <hson-template lib="component"/>/>/>'},
  component: {document:'<button @:source/>'},
});
const final = compose_livemap_document_internal(components, "layout", "final");
const componentOwner = internal_livemap_aggregate_authority(components), finalIdentity = componentOwner.libraries().at(-1);
const componentDemand = ["345678901", "456789012"];
componentOwner.acquireLocalDocumentIdentity(finalIdentity, validate_document_path([0,0,1,0,0]), componentDemand[0]);
componentOwner.acquireLocalDocumentIdentity(finalIdentity, validate_document_path([0,0,1,0,1]), componentDemand[1]);
final.css.stylesheet('[hson\\:quid="345678901"]{color:red}[hson\\:quid="456789012"]{color:blue}');
const componentCut = cut_document_ssr_internal(components, {html:"final", documents:["final"], data:[]}, componentDemand);
const bundle = await build({ entryPoints: ["tests/browser/document-portable-graft.entry.mjs"], bundle: true,
  write: false, platform: "browser", format: "iife", logLevel: "silent" });
const browserSource = bundle.outputFiles[0].text;
const profile = await mkdtemp(join(tmpdir(), "hson-ssr-subjects-chrome-"));
let chrome, socket, server;
let stderr = "";

function assert_ordinary_rule_order(css) {
  const prior = css.indexOf(".ordinary{color:red;}"), winning = css.indexOf(".ordinary{color:rgb(130,140,150);}");
  assert.ok(prior >= 0, "Missing prior ordinary rule.");
  assert.ok(winning >= 0, "Missing winning ordinary rule.");
  assert.ok(prior < winning, "Ordinary rules are out of cascade order.");
}
try {
  server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/graft") { response.end("<!doctype html><html><head></head><body></body></html>"); return; }
    // A negative probe: this script must never execute in the client.
    response.end(cut.html.replace("</body>", '<script>document.documentElement.dataset.executed="yes"</script></body>'));
  });
  await new Promise((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  chrome = spawn(process.env.HSON_CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore","ignore","pipe"] });
  chrome.stderr.on("data",chunk => { stderr += chunk; });
  chrome.on("error",error => { stderr += error.message; });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]; break; }
    catch { if (chrome.exitCode !== null) throw Error(`Chrome exited: ${stderr}`); await delay(100); }
  }
  if (!port) throw Error(`Chrome debugger unavailable: ${stderr}`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(target => target.type === "page");
  assert.ok(target?.webSocketDebuggerUrl);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.once("open",resolve); socket.once("error",reject); });
  let sequence = 0;
  const pending = new Map();
  socket.on("message",data => {
    const message = JSON.parse(String(data));
    const request = pending.get(message.id);
    if (request) { clearTimeout(request.timeout); pending.delete(message.id);
      if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  });
  const command = (method,params = {}) => new Promise((resolve,reject) => {
    const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error(`Chrome command timed out: ${method}`)); },10_000);
    pending.set(id,{resolve,reject,timeout}); socket.send(JSON.stringify({id,method,params}));
  });
  await command("Page.enable");
  await command("Emulation.setScriptExecutionDisabled",{value:true});
  await command("Page.navigate",{url});
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate",{expression,returnByValue:true});
    assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready = await evaluate('document.readyState === "complete" && !!document.getElementById("ordinary")');
    if (ready) break; await delay(50);
  }
  assert.equal(ready,true);
  // Inspector evaluation observes the disabled page; it does not enable page scripts.
  const evidence = await evaluate(`(() => {
    const style = id => { const element = document.getElementById(id), computed = getComputedStyle(element);
      return {color:computed.color, border:computed.borderTopWidth, padding:computed.paddingLeft, quad:element.getAttribute("hson:quad")}; };
    return { root: {quad:document.documentElement.getAttribute("hson:quad"),background:getComputedStyle(document.documentElement).backgroundColor},
      first:style("first"),second:style("second"),childOne:style("first-child"),childTwo:style("second-child"),
      anonymousOne:style("anonymous-one"),anonymousTwo:style("anonymous-two"),unrelated:style("unrelated"),ordinary:style("ordinary"),
      carriers:document.querySelectorAll('[hson\\\\:quad]').length,
      matched:document.querySelectorAll('[hson\\\\:quad="_012345678"]').length,
      executed:document.documentElement.dataset.executed ?? null,
      foreignClaims:document.querySelectorAll('[hson\\\\:quid]').length,
      styles:[...document.querySelectorAll("head style")].map(style=>({managed:style.hasAttribute("data-hson-managed-document-css"),text:style.textContent}))};
  })()`);
  assert.deepEqual(evidence.root,{quad:"_987654321",background:"rgb(1, 2, 3)"});
  assert.equal(evidence.first.border,"3px"); assert.equal(evidence.second.border,"3px");
  assert.equal(evidence.childOne.color,"rgb(11, 22, 33)"); assert.equal(evidence.childTwo.color,"rgb(44, 55, 66)");
  assert.equal(evidence.childOne.padding,"7px"); assert.equal(evidence.childTwo.padding,"9px");
  assert.equal(evidence.anonymousOne.color,"rgb(70, 80, 90)"); assert.equal(evidence.anonymousOne.quad,"_012345678");
  assert.equal(evidence.anonymousTwo.color,"rgb(100, 110, 120)"); assert.equal(evidence.anonymousTwo.quad,"_123456789");
  assert.equal(evidence.unrelated.color,"rgb(99, 99, 99)"); assert.equal(evidence.unrelated.quad,null);
  assert.equal(evidence.ordinary.color,"rgb(130, 140, 150)"); assert.equal(evidence.ordinary.quad,null);
  assert.equal(evidence.carriers,7); assert.equal(evidence.matched,1); assert.equal(evidence.foreignClaims,0);
  assert.equal(evidence.executed,null); assert.deepEqual(evidence.styles.map(style=>style.managed),[false,true]);
  assert.ok(evidence.styles[1].text.includes('[hson\\:quad="_012345678"]'));
  const managedCss = evidence.styles[1].text;
  assert_ordinary_rule_order(managedCss);
  assert.throws(() => assert_ordinary_rule_order(managedCss.replace(".ordinary{color:red;}", "")), /Missing prior ordinary rule/);
  assert.throws(() => assert_ordinary_rule_order(managedCss.replace(".ordinary{color:rgb(130,140,150);}", "")), /Missing winning ordinary rule/);
  assert.throws(() => assert_ordinary_rule_order(".ordinary{color:rgb(130,140,150);}.ordinary{color:red;}"), /out of cascade order/);
  console.log(`Chrome JavaScript-disabled first paint passed: ${JSON.stringify(evidence)}`);
  await command("Emulation.setScriptExecutionDisabled", {value:false});
  await command("Page.navigate", {url: new URL("/graft", url).href});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('document.readyState === "complete" && location.pathname === "/graft"')) break;
    await delay(50);
  }
  await evaluate(browserSource);
  const payload = { html: cut.html, libs: cut.libs, composed: componentCut,
    sourceQuids: fixture.aggregate.captureDocumentSsr(fixture.library, fixture.demanded).correspondence.map(entry => entry.quid) };
  const graftResult = await command("Runtime.evaluate", { expression: `runPortableGraftAcceptance(${JSON.stringify(payload)})`,
    awaitPromise:true, returnByValue:true });
  assert.equal(graftResult.exceptionDetails, undefined, JSON.stringify(graftResult.exceptionDetails));
  assert.equal(graftResult.result.value.passed, 20);
  console.log(`Chrome JavaScript-enabled portable graft passed: ${JSON.stringify(graftResult.result.value)}`);

} finally {
  if (socket) { socket.terminate(); }
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise(resolve => chrome.once("close",resolve)); chrome.kill("SIGTERM"); await closed;
  }
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}

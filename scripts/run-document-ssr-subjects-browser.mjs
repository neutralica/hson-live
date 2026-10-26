import assert from "node:assert/strict";
import { build } from "esbuild";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { ssr_subject_fixture } from "../tests/fixtures/document-ssr-subjects-cases.mts";
import { cut_document_ssr_internal } from "../src/api/livemap/livemap.libraries.ts";
import { optional_subject_fixture, second_repair_fixture, selector_fixture, styled_fixture } from "../tests/fixtures/livemap-styled-composition-cases.mts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { document_css_subject_identities } from "../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet, decode_portable_document_stylesheet, render_portable_document_stylesheet_carriers } from "../src/internal/css/portable-document-stylesheet.ts";
import { fixture as scoped_fixture, node as scoped_node } from "../tests/fixtures/locus-scoped-ssr-cases.mts";
import { hosted_flat_subject_fixture } from "../tests/fixtures/hosted-styled-part-ssr-cases.mts";

// Source-only Chrome acceptance: no build and no writes to tracked distribution.
const fixture = ssr_subject_fixture();
const cut = cut_document_ssr_internal(fixture.map, { html: "page" }, fixture.demanded);
assert.doesNotMatch(cut.html, /hson:quid|hson\\:quid/);
const components = styled_fixture();
const componentOwner = internal_livemap_aggregate_authority(components), finalIdentity = componentOwner.libraries().at(-1);
const componentDemand = document_css_subject_identities(encode_portable_document_stylesheet(componentOwner.stylesheet(finalIdentity)), "outbound");
const componentCut = components.cut({html:"page", documents:["page"], data:[]});
const selectors = selector_fixture(), selectorPage = selectors.doc.must("page");
const selectorCut = selectors.cut({html:"page", documents:["page"], data:[]});
const selectorPages = new Map([["/selectors", selectorCut]]);
const optionalCut = optional_subject_fixture().cut({html:"page",documents:["page"],data:[]});
const optionalPages = new Map([["/optional", optionalCut], ["/optional-restored",
  install_libraries_snapshot(install_libraries_snapshot(optionalCut.libs).map.cut({documents:["page"],data:[]}).libs).map.cut({html:"page",documents:["page"],data:[]})]]);
selectorPage.document.content.move({kind:"path",path:[0,0,1,0,0,0]},2,0);
selectorPages.set("/selectors-moved", selectors.cut({html:"page", documents:["page"], data:[]}));
const restoredSelectors = install_libraries_snapshot(install_libraries_snapshot(selectorCut.libs).map.cut({data:[],documents:["page"]}).libs).map;
selectorPages.set("/selectors-restored", restoredSelectors.cut({html:"page", documents:["page"], data:[]}));
selectorPage.q("ancestor").delete();
selectorPages.set("/selectors-retired", selectors.cut({html:"page", documents:["page"], data:[]}));
const secondRepair=second_repair_fixture().cut({html:"page",documents:["page"],data:[]});
// Keep the flat first-paint acceptance alongside genuine hosted scoped output.
const hosted = await hosted_flat_subject_fixture();
const scoped = await scoped_fixture();
const scopedPages = new Map();
function capture_scoped_pages(suffix = "") {
  const captured = scoped.session.now({html:"page"});
  const html = scoped.locus.doc.must("page").render();
  assert.equal(html, captured.html);
  assert.doesNotMatch(JSON.stringify(captured), /hson:part/);
  scopedPages.set(`/hosted-scoped${suffix}`, captured);
  scopedPages.set(`/library-scoped${suffix}`, { ...captured, html });
}
capture_scoped_pages();
await scoped.locus.stage(w => {
  w.doc.must("page").css.sel("#left button").setProp("padding", "11px");
  w.doc.must("page").css.sel("#left span").setProp("color", "rgb(70,80,90)");
});
capture_scoped_pages("-changed");
await scoped.locus.stage(w => { w.doc.must("page").at([1,0]).replace(scoped_node('<hson-part lib="parts" at="bare"/>')); });
capture_scoped_pages("-retired");
await scoped.locus.stage(w => { w.doc.must("page").at([1,2]).delete(); w.doc.must("page").at([1,1]).delete(); w.doc.must("page").at([1,0]).delete(); });
capture_scoped_pages("-empty");
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
    const scopedPage = scopedPages.get(request.url);
    if (scopedPage) { response.end(scopedPage.html.replace("</body>", '<script>document.documentElement.dataset.executed="yes"</script></body>')); return; }
    if (request.url === "/graft") { response.end("<!doctype html><html><head></head><body></body></html>"); return; }
    if (request.url === "/hosted-flat") { response.end(hosted.cut.html + '<script>document.documentElement.dataset.executed="yes"</script>'); return; }
    if (request.url === "/composed") { response.end(componentCut.html.replace("</body>", '<script>document.documentElement.dataset.executed="yes"</script></body>')); return; }
    if (request.url === "/second-repair") { response.end(secondRepair.html.replace("</body>", '<script>document.documentElement.dataset.executed="yes"</script></body>')); return; }
    const selectorPage = selectorPages.get(request.url) ?? optionalPages.get(request.url);
    if (selectorPage) { response.end(selectorPage.html.replace("</body>", '<script>document.documentElement.dataset.executed="yes"</script></body>')); return; }
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
  for (const path of optionalPages.keys()) {
    await command("Page.navigate", {url:new URL(path,url).href});
    let loaded = false;
    for (let attempt=0;attempt<100;attempt++) {
      loaded=await evaluate(`document.readyState==="complete" && location.pathname===${JSON.stringify(path)} && !!document.getElementById("optional-outside")`);
      if (loaded) break; await delay(50);
    }
    assert.equal(loaded,true);
    const optionalEvidence=await evaluate(`(() => {
      const elements=[...document.querySelectorAll('*')];
      return {colors:Object.fromEntries(['not','is','where','has','positive','list','multi','nth','outside'].map(name=>[name,getComputedStyle(document.getElementById('optional-'+name)).color])),
        matches:document.querySelectorAll(':nth-child(0)').length,
        positiveHits:elements.filter(e=>getComputedStyle(e).getPropertyValue('--omitted-hit')).length,
        omitted:document.querySelectorAll('b,hson-part,[part\\\\:optional]').length,
        foreign:elements.some(e=>e.hasAttribute('hson:quid')),executed:document.documentElement.dataset.executed??null};
    })()`);
    console.log(`Chrome omitted subject specificity ${path}: ${JSON.stringify(optionalEvidence)}`);
    assert.deepEqual(optionalEvidence,{colors:{not:'rgb(255, 0, 0)',is:'rgb(255, 0, 0)',where:'rgb(0, 0, 255)',has:'rgb(255, 0, 0)',positive:'rgb(0, 0, 255)',list:'rgb(255, 0, 0)',multi:'rgb(255, 0, 0)',nth:'rgb(255, 0, 0)',outside:'rgb(0, 0, 0)'},matches:0,positiveHits:0,omitted:0,foreign:false,executed:null});
  }
  await command("Page.navigate",{url});
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
  await command("Page.navigate", {url: new URL("/hosted-flat", url).href});
  let hostedReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    hostedReady = await evaluate('document.readyState === "complete" && location.pathname === "/hosted-flat" && !!document.getElementById("hosted-b")');
    if (hostedReady) break; await delay(50);
  }
  assert.equal(hostedReady, true);
  const hostedEvidence = await evaluate(`(() => {
    const read = id => {const element = document.getElementById(id); return {color:getComputedStyle(element).color,quad:element.getAttribute('hson:quad')};};
    return {a:read('hosted-a'),b:read('hosted-b'),outside:read('hosted-outside'),
      carriers:document.querySelectorAll('[hson\\\\:quad]').length,foreign:document.querySelectorAll('[hson\\\\:quid]').length,
      styles:document.querySelectorAll('[data-hson-managed-document-css]').length,executed:document.documentElement.dataset.executed??null};
  })()`);
  console.log(`Chrome flat hosted-subject JavaScript-disabled first paint: ${JSON.stringify(hostedEvidence)}`);
  assert.deepEqual(hostedEvidence, {a:{color:'rgb(12, 34, 56)',quad:'a'},b:{color:'rgb(12, 34, 56)',quad:'b'},
    outside:{color:'rgb(0, 0, 0)',quad:null},carriers:2,foreign:0,styles:1,executed:null});
  for (const [path, captured] of scopedPages) {
    await command("Page.navigate", {url: new URL(path, url).href});
    let loaded = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      loaded = await evaluate(`document.readyState === "complete" && location.pathname === ${JSON.stringify(path)} && !!document.getElementById("outside")`);
      if (loaded) break; await delay(50);
    }
    assert.equal(loaded, true);
    assert.equal(await evaluate("[...document.querySelectorAll('*')].some(element => element.hasAttribute('hson:part'))"), false);
    const visual = await evaluate(`(() => {
      const read = id => { const element = document.getElementById(id); if (!element) return null;
        const css = getComputedStyle(element), button = element.querySelector('button'), label = element.querySelector('span');
        return {border:css.borderTopWidth,margin:css.marginLeft,padding:getComputedStyle(button).paddingLeft,color:getComputedStyle(label).color}; };
      return {left:read('left'),right:read('right'),outside:getComputedStyle(document.getElementById('outside')).color,
        connectors:document.querySelectorAll('hson-part').length, executed:document.documentElement.dataset.executed ?? null,
        styles:document.querySelectorAll('[data-hson-managed-document-css]').length,
        markers:[...document.querySelectorAll('*')].filter(e=>e.hasAttribute('hson:quad')).map(e=>e.getAttribute('hson:quad')),
        foreign:[...document.querySelectorAll('*')].some(e=>e.hasAttribute('hson:quid'))};
    })()`);
    const empty = path.endsWith('empty'), retired = path.endsWith('retired'), changed = path.endsWith('changed');
    assert.deepEqual(visual.left, empty || retired ? null : {border:'3px',margin:'11px',padding:changed?'11px':'7px',color:changed?'rgb(70, 80, 90)':'rgb(10, 20, 30)'});
    assert.deepEqual(visual.right, empty ? null : {border:'3px',margin:'13px',padding:'7px',color:'rgb(10, 20, 30)'});
    assert.equal(visual.outside, 'rgb(40, 50, 60)');
    assert.equal(visual.connectors, 0); assert.equal(visual.executed, null); assert.equal(visual.foreign, false); assert.equal(visual.styles, render_portable_document_stylesheet_carriers(decode_portable_document_stylesheet(captured.libs.libraries.find(e=>e.name==='page').css)).length);
    assert.deepEqual(visual.markers.sort(), captured.libs.libraries.find(e=>e.name==='page').scopes.subjects.map(s=>s.name).sort());
    console.log(`Chrome scoped hosted JavaScript-disabled first paint ${path}: ${JSON.stringify(visual)}`);
  }
  await command("Page.navigate", {url: new URL("/composed", url).href});
  let composedReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    composedReady = await evaluate('document.readyState === "complete" && !!document.getElementById("instance2")');
    if (composedReady) break; await delay(50);
  }
  assert.equal(composedReady, true);
  const composedEvidence = await evaluate(`(() => {
    const visual = element => {const css=getComputedStyle(element),label=getComputedStyle(element.querySelector('span'));return [css.borderTopWidth,label.color,label.paddingLeft];};
    return {instances:[...document.querySelectorAll('section')].map(visual),control:visual(document.getElementById('unrelated')),
      buttons:[...document.querySelectorAll('button')].map(button=>{const css=getComputedStyle(button);return [css.color,css.paddingLeft];}),connectors:document.querySelectorAll('hson-part').length,
      carriers:document.querySelectorAll('[hson\\\\:quad]').length,foreign:document.querySelectorAll('[hson\\\\:quid]').length,
      styles:document.querySelectorAll('[data-hson-managed-document-css]').length,executed:document.documentElement.dataset.executed??null};
  })()`);
  assert.deepEqual(composedEvidence, {instances:Array(3).fill(['3px','rgb(10, 20, 30)','7px']),control:['0px','rgb(0, 0, 0)','0px'],buttons:[...Array(3).fill(['rgb(60, 70, 80)','11px']),['rgb(0, 0, 0)','6px']],connectors:0,carriers:3,foreign:0,styles:1,executed:null});
  console.log(`Chrome styled composition JavaScript-disabled first paint passed: ${JSON.stringify(composedEvidence)}`);
  for (const path of selectorPages.keys()) {
    await command("Page.navigate", {url:new URL(path,url).href});
    let loaded = false;
    for (let attempt=0;attempt<100;attempt++) {
      loaded=await evaluate(`document.readyState==="complete" && location.pathname===${JSON.stringify(path)} && !!document.getElementById("bare0")`);
      if (loaded) break; await delay(50);
    }
    assert.equal(loaded,true);
    const evidence=await evaluate(`(() => {
      const read=id=>{const e=document.getElementById(id);if(!e)return null;const s=getComputedStyle(e);return {color:s.color,padding:s.paddingLeft,border:s.borderTopWidth,margin:s.marginLeft,right:s.marginRight,paddingRight:s.paddingRight,top:s.marginTop,bottom:s.paddingBottom,paddingTop:s.paddingTop,letter:s.letterSpacing,word:s.wordSpacing,before:getComputedStyle(e,'::before').content};};
      return {values:Object.fromEntries(['bare0','bare1','ancestor','ancestor-child','ancestor-deep','ancestor-nested','sibling','sibling-child','explicit','outside-section','outside'].map(id=>[id,read(id)])),
        local:document.querySelector('#ancestor .local')?getComputedStyle(document.querySelector('#ancestor .local')).borderTopWidth:null,
        order:[...document.querySelector('main').children].map(e=>e.id),connectors:document.querySelectorAll('hson-part').length,
        carriers:document.querySelectorAll('[hson\\\\:quad]').length,foreign:document.querySelectorAll('[hson\\\\:quid]').length,executed:document.documentElement.dataset.executed??null};
    })()`);
    for(const id of ['bare0','bare1']) {
      assert.equal(evidence.values[id].color,'rgb(10, 20, 30)',`${path}: ordinary button selector matches root`);
      assert.equal(evidence.values[id].padding,'13px');assert.equal(evidence.values[id].border,'2px');assert.equal(evidence.values[id].before,'"ok"');
      assert.equal(evidence.values[id].paddingRight,'24px','ordinary selector lists retain per-matching-selector specificity');
    }
    assert.equal(evidence.values.explicit.color,'rgb(70, 80, 90)');assert.equal(evidence.values.explicit.padding,'19px');
    assert.equal(evidence.values.sibling.border,'8px');assert.equal(evidence.values['sibling-child'].color,'rgb(70, 80, 90)');assert.equal(evidence.values['sibling-child'].padding,'21px');
    assert.equal(evidence.values['sibling-child'].margin,'0px');assert.equal(evidence.values['sibling-child'].top,'0px');
    assert.equal(evidence.values['outside-section'].border,'0px');assert.equal(evidence.values.outside.color,'rgb(0, 0, 0)');assert.equal(evidence.values.outside.padding,'6px');assert.equal(evidence.values.outside.margin,'0px');
    const retired=path==='/selectors-retired';
    if(retired) {assert.equal(evidence.values.ancestor,null);assert.equal(evidence.local,null);}
    else {
      assert.equal(evidence.values.ancestor.border,'5px',`${path}: ordinary section selector matches root`);
      for(const id of ['ancestor-child','ancestor-deep','ancestor-nested']) {
        const s=evidence.values[id];assert.equal(s.color,'rgb(40, 50, 60)',`${path}: section button includes root ancestor and nested Part descendants`);
        assert.equal(s.padding,'14px','implicit type nesting');assert.equal(s.margin,'17px');assert.equal(s.paddingRight,'15px','implicit-first mixed list');
        assert.equal(s.top,'16px','explicit-first mixed list');assert.equal(s.bottom,'18px','implicit nesting in media/supports');
      }
      assert.equal(evidence.values['ancestor-child'].border,'4px','implicit class nesting');
      assert.equal(evidence.values['ancestor-child'].paddingTop,'19px','condition mixed list');
      assert.equal(evidence.values['ancestor-child'].right,'23px','nesting uses maximum parent-list specificity');
      assert.equal(evidence.values['ancestor-deep'].word,'6px','nested selector lists');
      assert.equal(evidence.values['ancestor-deep'].letter,'3px','inner scope root ancestor selector');
      assert.equal(evidence.local,'7px','inner scope includes its own root');
    }
    assert.deepEqual(evidence.order,retired?['bare0','bare1','sibling','explicit']:path==='/selectors-moved'?['ancestor','bare0','bare1','sibling','explicit']:['bare0','bare1','ancestor','sibling','explicit']);
    assert.equal(evidence.carriers,retired?4:5);assert.equal(evidence.foreign,0);assert.equal(evidence.connectors,0);assert.equal(evidence.executed,null);
    console.log(`Chrome root-inclusive/implicit nesting JavaScript-disabled ${path} passed: ${JSON.stringify(evidence)}`);
  }
  await command("Page.navigate",{url:new URL('/second-repair',url).href});
  let secondReady=false;
  for(let attempt=0;attempt<100;attempt++) {
    secondReady=await evaluate('document.readyState==="complete" && location.pathname==="/second-repair" && !!document.getElementById("colon1-button")');
    if(secondReady)break;await delay(50);
  }
  assert.equal(secondReady,true);
  const secondEvidence=await evaluate(`(() => {
    const read=id=>{const e=document.getElementById(id),s=getComputedStyle(e);return {color:s.color,padding:s.paddingLeft,border:s.borderTopWidth,right:s.paddingRight,margin:s.marginLeft,marginRight:s.marginRight,letter:s.letterSpacing,before:getComputedStyle(e,'::before').content};};
    return {equivalent:[0,1,2,3].map(i=>read('equivalent'+i)),colon:[0,1].map(i=>read('colon'+i+'-button')),sibling:read('colon-sibling-button'),outside:read('colon-outside'),
      carriers:document.querySelectorAll('[hson\\\\:quad]').length,foreign:document.querySelectorAll('[hson\\\\:quid]').length,connectors:document.querySelectorAll('hson-part').length,executed:document.documentElement.dataset.executed??null};
  })()`);
  for(const value of secondEvidence.equivalent){assert.equal(value.color,'rgb(10, 20, 30)','equivalent replacement installs CSS at disabled-JS first paint');assert.equal(value.padding,'13px');}
  for(const value of secondEvidence.colon){
    assert.equal(value.color,'rgb(10, 20, 30)','button:is(.b)');assert.equal(value.padding,'13px','button:not(.x)');assert.equal(value.border,'5px','button:first-child');
    assert.equal(value.before,'"hello"','button::before');assert.equal(value.right,'17px','implicit-first colon mixed list');assert.equal(value.margin,'19px','explicit-first colon mixed list');
    assert.equal(value.marginRight,'23px','functional pseudo specificity');assert.equal(value.letter,'3px','colon nesting within layer/media/supports');
  }
  assert.equal(secondEvidence.sibling.color,'rgb(70, 80, 90)');assert.equal(secondEvidence.sibling.padding,'21px');assert.equal(secondEvidence.sibling.border,'2px');assert.equal(secondEvidence.sibling.before,'none');
  assert.deepEqual(secondEvidence.outside,{color:'rgb(0, 0, 0)',padding:'6px',border:'2px',right:'6px',margin:'0px',marginRight:'0px',letter:'normal',before:'none'});
  assert.equal(secondEvidence.carriers,7);assert.equal(secondEvidence.foreign,0);assert.equal(secondEvidence.connectors,0);assert.equal(secondEvidence.executed,null);
  console.log(`Chrome equivalent replacement/colon nesting JavaScript-disabled first paint passed: ${JSON.stringify(secondEvidence)}`);
  await command("Emulation.setScriptExecutionDisabled", {value:false});
  await command("Page.navigate", {url: new URL("/graft", url).href});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('document.readyState === "complete" && location.pathname === "/graft"')) break;
    await delay(50);
  }
  await evaluate(browserSource);
  const payload = { html: cut.html, libs: cut.libs, composed: {...componentCut, sourceQuids:componentDemand},
    sourceQuids: fixture.aggregate.captureDocumentSsr(fixture.library, fixture.demanded).correspondence.map(entry => entry.quid) };
  const graftResult = await command("Runtime.evaluate", { expression: `runPortableGraftAcceptance(${JSON.stringify(payload)})`,
    awaitPromise:true, returnByValue:true });
  assert.equal(graftResult.exceptionDetails, undefined, JSON.stringify(graftResult.exceptionDetails));
  assert.equal(graftResult.result.value.passed, 21);
  console.log(`Chrome JavaScript-enabled portable graft passed: ${JSON.stringify(graftResult.result.value)}`);

} finally {
  hosted.locus.dispose();
  scoped.locus.dispose();
  if (socket) { socket.terminate(); }
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise(resolve => chrome.once("close",resolve)); chrome.kill("SIGTERM"); await closed;
  }
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}

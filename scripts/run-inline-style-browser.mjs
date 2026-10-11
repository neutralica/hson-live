import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { build } from "esbuild";
import WebSocket from "ws";
import { hsonLiveMap } from "../src/index.ts";

const root=resolve(import.meta.dirname,'..');
const snapshot=process.argv.find(argument=>argument.startsWith('--source-snapshot='))?.slice('--source-snapshot='.length);
const baseline=process.argv.includes('--baseline') || Boolean(snapshot);
const fixture=await readFile(join(root,'tests/browser/inline-style.acceptance.html'),'utf8');
const script=fixture.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Missing browser acceptance script.');
const plugins=baseline ? [{name:'source-oracle',setup(builder){builder.onLoad({filter:/\/src\/.*\.ts$/},async({path})=>({contents:snapshot ? await readFile(join(snapshot,relative(root,path)),'utf8') : execFileSync('git',['show',`HEAD:${relative(root,path)}`],{cwd:root,encoding:'utf8'}),loader:'ts'}));}}] : [];
const bundle=await build({stdin:{contents:script,resolveDir:join(root,'tests/browser'),sourcefile:'inline-style.acceptance.html'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,plugins});
const map=hsonLiveMap.fromLibraries({page:{document:'<main id=ssr-root <p id=first-paint style="color:red!important;color:blue;margin:10px;margin-top:5px" "ready"/>/>'}});
const cut=map.cut({html:'page'});
const html=fixture.replace('<!-- SSR fixture is inserted by the source browser runner. -->',cut.html).replace(/<script type="module">[\s\S]*?<\/script>/,'<script type="module" src="/probe.js"></script>');
const server=createServer((request,response)=>{if(request.url==='/probe.js'){response.setHeader('content-type','text/javascript');response.end(bundle.outputFiles[0].contents);}else if(request.url==='/__state'){response.setHeader('content-type','application/json');response.end(JSON.stringify(cut));}else{response.setHeader('content-type','text/html; charset=utf-8');response.end(html);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address && typeof address==='object');
const url=`http://127.0.0.1:${address.port}/`;
const candidates=[process.env.HSON_CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium','google-chrome','chromium'].filter(Boolean);
const binary=candidates.find(candidate=>(!candidate.includes('/')||existsSync(candidate))&&spawnSync(candidate,['--version'],{encoding:'utf8'}).status===0);
assert.ok(binary,'Actual Chromium is required.');
const profile=await mkdtemp(join(tmpdir(),'hson-inline-css-'));
let chrome,socket;
try {
  chrome=spawn(binary,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  const deadline=Date.now()+20000;const pause=()=>new Promise(resolve=>setTimeout(resolve,100));let port;
  while(Date.now()<deadline){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await pause();}
  assert.ok(port,'Chrome debugging did not initialize.');
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  let nextId=0;const pending=new Map();
  socket.on('message',raw=>{const message=JSON.parse(String(raw)),task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(new Error(message.error.message)):task.resolve(message.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');await send('DOM.enable');await send('CSS.enable');
  await send('Emulation.setScriptExecutionDisabled',{value:true});await send('Page.navigate',{url});
  let paragraph,dom;
  while(Date.now()<deadline){({root:dom}=await send('DOM.getDocument'));({nodeId:paragraph}=await send('DOM.querySelector',{nodeId:dom.nodeId,selector:'#first-paint'}));if(paragraph)break;await pause();}
  assert.ok(paragraph,'SSR native paragraph missing.');
  const {computedStyle}=await send('CSS.getComputedStyleForNode',{nodeId:paragraph});
  assert.equal(computedStyle.find(entry=>entry.name==='color')?.value,'rgb(255, 0, 0)');
  assert.equal(computedStyle.find(entry=>entry.name==='margin-top')?.value,'5px');
  const {nodeId:body}=await send('DOM.querySelector',{nodeId:dom.nodeId,selector:'body'});
  const {attributes}=await send('DOM.getAttributes',{nodeId:body});assert.ok(!attributes.includes('data-result'),'Browser JS ran during no-JavaScript control.');
  await send('Emulation.setScriptExecutionDisabled',{value:false});await send('Page.navigate',{url:url+'?enhanced'});
  let results;const finish=Date.now()+25000;
  while(Date.now()<finish){const response=await send('Runtime.evaluate',{expression:'document.body?.dataset.result',returnByValue:true});if(response.result.value){results=JSON.parse(decodeURIComponent(response.result.value));break;}await pause();}
  assert.ok(results,'Browser acceptance did not complete.');
  console.log(JSON.stringify({baseline,chromium:spawnSync(binary,['--version'],{encoding:'utf8'}).stdout.trim(),noJavaScript:true,results}));
  assert.ok(results.every(result=>result.pass),'Inline CSS browser assertions failed.');
} finally {
  socket?.close();
  if(chrome&&chrome.exitCode===null){const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill('SIGTERM');await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,3000))]);}
  await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});
}

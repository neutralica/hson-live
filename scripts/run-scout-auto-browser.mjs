import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { hsonLiveMap } from '../dist/api/livemap/index.js';
import { bind_locus_http } from '../dist/api/locus/index.js';
import { decode_ignition } from '../dist/api/scout/scout.ignition.js';
import { deliver_scout } from '../dist/api/ssr/index.js';
import { locus_map_internal } from '../dist/internal/governor-maps.js';
import { internal_livemap_aggregate_authority } from '../dist/api/livemap/livemap.internal.js';

// Exercise the published bytes unchanged. CDP only observes and drives navigation.
const asset = await readFile(new URL('../dist/scout-auto.js', import.meta.url));
const runtimeAsset = await readFile(new URL('../dist/scout-hosted.js', import.meta.url));
const deployment = '/releases/v3.5.0';
const manual = await build({ stdin: { contents: `
import { continue_hosted_document } from 'hson-live';
import { create_echo_http_transport } from './dist/api/echo/echo.http.js';
export async function start(root, gate) {
 const setup = await fetch('/manual-setup').then(r => r.json());
 const transport = create_echo_http_transport({endpoint:location.origin+'/_hson', fetch:async(input,init)=>{ if(gate) await gate; return fetch(input,init); }});
 try { const result = await continue_hosted_document({...setup,root,transport});
 return { mirror:result.mirror, dispose(){try{result.dispose();}finally{try{result.echo.dispose();}finally{transport.dispose();}}} };
 } catch(error) {transport.dispose();throw error;}
}`, resolveDir:process.cwd(), sourcefile:'scout-manual-consumer.mjs' }, bundle:true, format:'esm', platform:'browser', target:'es2022', minify:true, write:false });
const sessionsByPage = new Map();
const locus = hsonLiveMap.locus.create({
  page: { document: '<html title="R" <head <base href="/assets/"/> <script src="/canonical.js"/>/> <body <main <p "Useful SSR"/> <i @:message id="message" "Styled subject"/>/>/>/>', access: 'shared' },
  manual: { document: '<html <head/> <body <p "Manual SSR"/>/>/>', access: 'shared' },
  secrets: { data: { secret: 'private-data-sentinel' }, access: 'private' },
  ui: { parts: { scout: { kind: 'document', document: '<hson-scout hson:part hidden "%{payload}"/>' } }, access: 'private' },
}, { authorizeProjection: ({requested}) => ({ libraries: requested.libraries.filter(name => name === 'page' || name === 'manual') }), sessions: {graceMs:500} });
const authority = internal_livemap_aggregate_authority(locus_map_internal(locus));
const pageIdentity = authority.libraries()[authority.hostedRegistry().libraries.findIndex(entry => entry.name === 'page')];
const subject = authority.documentQuad(pageIdentity, 'message', undefined);
await locus.stage(w => w.doc.page.css.sel(`[hson\\:quid="${subject.quid}"]`).setProp('color', 'rgb(10, 20, 30)'));
const binding = bind_locus_http(locus, { endpoint: '/_hson' });
const recoveryResponses = new Set();
const pages = new Map();
for (const name of ['one', 'two', 'blocked', 'nojs', 'invalid', 'mismatch', 'credential', 'association', 'destination', 'bfcache', 'runtime-failure', 'pending-cancel', 'pending-hide']) {
  const session = await locus.session.create({ libraries: ['page'] });
  sessionsByPage.set(name, session);
  const now = session.now({ html: 'page' });
  let html = await deliver_scout(session, now, locus.parts.ui.scout, { endpoint: '/_hson', module: deployment + '/scout-auto.js' }).text();
  if (['credential', 'association', 'destination'].includes(name)) {
    const payload = html.match(/<hson-scout hidden="hidden">([^<]+)/)[1];
    decode_ignition(payload);
    const record = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (name === 'credential') record.credential = '0'.repeat(64);
    if (name === 'association') {
      const other = await locus.session.create({ libraries: ['page'] });
      record.credential = other.credential;
    }
    if (name === 'destination') record.endpoint = '//foreign.invalid/path';
    html = html.replace(payload, Buffer.from(JSON.stringify(record)).toString('base64url'));
  }
  if (name === 'invalid') html = html.replace(/(<hson-scout hidden="hidden">)[^<]+/, '$1A');
  if (name === 'mismatch') html = html.replace('Useful SSR', 'Wrong correspondence');
  pages.set('/' + name, html);
}
const profile = await mkdtemp(join(tmpdir(), 'hson-scout-auto-'));
let chrome, socket, server, releaseAsset, requests = 0, assets = 0, runtimeRequests = 0, runtimeFailure = false, stderr = '';
pages.set('/empty', '<!doctype html><html><head><base href="/assets/"></head><body><p>Useful SSR</p><script type="module" src="' + deployment + '/scout-auto.js"></script></body></html>');
pages.set('/ineligible', pages.get('/empty').replace('<p>Useful SSR</p>', '<p>Useful SSR</p><hson-scout hidden>invalid whitespace</hson-scout>'));
let gate = new Promise(resolve => { releaseAsset = resolve; });
const pending = new Map();
let cacheExclusions = [];
try {
  server = createServer(async (req, res) => {
    try {
      if (req.url === deployment + '/scout-hosted.js') { runtimeRequests++; await gate; res.writeHead(runtimeFailure ? 503 : 200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(runtimeFailure ? '' : runtimeAsset); return; }
      if (req.url === deployment + '/scout-auto.js') { assets++; res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' }); res.end(asset); return; }
      if (req.url.startsWith('/manual.js')) {res.writeHead(200,{'content-type':'text/javascript'});res.end(manual.outputFiles[0].text);return;}
      if (req.url === '/manual-setup' || req.url === '/manual-page') {
        const session=await locus.session.create({libraries:['manual']}); const now=session.now({html:'manual'});
        res.writeHead(200,{'content-type':req.url === '/manual-page'?'text/html':'application/json','cache-control':'no-store'});
        res.end(req.url === '/manual-page'?now.html:JSON.stringify({now,credential:session.credential,document:'manual'})); return;
      }
      if (req.url === '/canonical.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(`globalThis.canonicalScriptRuns = (globalThis.canonicalScriptRuns || 0) + 1;
if (!globalThis.scoutLifecycleListeners) {
 globalThis.scoutOrdering = [];
 let removed = false, yielded = false, linked = false, subjectLinked = false;
 const removeElement = Element.prototype.remove, setWeak = WeakMap.prototype.set;
 Element.prototype.remove = function() {
   if (this.localName === 'hson-scout' && this === document.querySelector('hson-scout')) {
     removed = true; queueMicrotask(() => { yielded = true; });
   }
   return removeElement.call(this);
 };
 WeakMap.prototype.set = function(key, value) {
   if (key === document.documentElement && value === 'preparing') scoutOrdering.push(!!document.querySelector('hson-scout') && !!document.querySelector('[data-hson-scout-loader]'));
   if (!linked && key === document.documentElement && value && typeof value === 'object' && value.$_tag) {
     linked = true; scoutOrdering.push(removed && !yielded && !document.querySelector('hson-scout,[data-hson-scout-loader]'));
   }
   if (!subjectLinked && key?.id === 'message' && value && typeof value === 'object' && value.$_tag) {
     subjectLinked = true; globalThis.scoutSubjectAdopted = key === globalThis.scoutOriginalSubject && !yielded;
   }
   return setWeak.call(this, key, value);
 };

 globalThis.scoutLifecycleListeners = new Set();
 const add=window.addEventListener, remove=window.removeEventListener;
 window.addEventListener=function(type,listener,options){if(type==='pagehide'||type==='pageshow')scoutLifecycleListeners.add(listener);return add.call(this,type,listener,options)};
 window.removeEventListener=function(type,listener,options){scoutLifecycleListeners.delete(listener);return remove.call(this,type,listener,options)};
}`); return; }
      if (req.url === '/harness') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head></head><body></body></html>'); return; }
      if (pages.has(req.url)) { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'private, no-store' }); res.end(pages.get(req.url)); return; }
      if (!req.url.startsWith('/_hson')) { res.writeHead(404); res.end(); return; }
      requests++;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const abort = new AbortController(); res.on('close', () => abort.abort());
      if (req.url === '/_hson/sync' && JSON.parse(Buffer.concat(chunks).toString()).type === 'recover') { recoveryResponses.add(res); res.on('close', () => recoveryResponses.delete(res)); }
      const response = await binding.handle(new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method, headers: req.headers, body: Buffer.concat(chunks), signal: abort.signal,
      }), {});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) { if (res.destroyed) break; res.write(chunk); }
      res.end();
    } catch { if (!res.destroyed) { res.writeHead(500); res.end(); } }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.HSON_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
  chrome.stderr.on('data', chunk => { stderr += chunk; });
  let port;
  for (let i = 0; i < 400; i++) { try { const candidate = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; if (/^[0-9]+$/.test(candidate)) { port = candidate; break; } } catch { if (chrome.exitCode !== null) throw Error(stderr); } await delay(50); }
  assert.ok(port, 'Chrome did not initialize: ' + stderr);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.once('open', resolve));
  let sequence = 0;
  socket.on('message', data => { const message = JSON.parse(String(data)); if (message.method === 'Page.backForwardCacheNotUsed') cacheExclusions = message.params.notRestoredExplanations; const task = pending.get(message.id);
    if (task) { clearTimeout(task.timeout); pending.delete(message.id); if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error(`Chrome timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, 'Browser evaluation failed'); return result.result.value;
  };
  const until = async (expression, name) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(50); } throw Error(name); };
  await command('Page.enable');
  await command('Network.enable');
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  for (const name of ['empty', 'ineligible']) {
    await command('Page.navigate', { url: base + '/' + name });
    await until(`location.pathname === '/${name}' && document.readyState === 'complete' && !!customElements.get('hson-scout')`, 'lightweight registration');
    await delay(100);
    assert.equal(runtimeRequests, 0, 'No eligible Scout must mean no runtime request');
  }
  await command('Page.navigate', { url: base + '/harness' });
  await until("location.pathname === '/harness' && document.readyState === 'complete'", 'harness');
  await evaluate(`globalThis.framesUnderTest = ['one','two'].map(name => { const f = document.createElement('iframe'); f.src = '/' + name; document.body.append(f); return f; }); true`);
  await until("framesUnderTest.every(f => f.contentDocument?.querySelector('hson-scout'))", 'SSR frames');
  await until("framesUnderTest.every(f => !!f.contentWindow.customElements.get('hson-scout'))", 'registration before runtime');
  for (let i = 0; i < 100 && runtimeRequests < 2; i++) await delay(20);
  assert.equal(runtimeRequests, 2, 'Both registered Scouts requested only the relative companion');
  assert.equal(requests, 0, 'Deferred runtime must not attach before import resolves');
  assert.equal(await evaluate("framesUnderTest.every(f => f.contentDocument.documentElement.title === 'R' && f.contentDocument.body.textContent.includes('Useful SSR'))"), true);
  await evaluate("globalThis.originals = framesUnderTest.map(f => { const d = f.contentDocument; f.contentWindow.scoutOriginalSubject=d.getElementById('message'); return [d.documentElement, d.body, d.querySelector('p'), d.querySelector('script'), d.querySelector('style'), d.querySelector('p').getAttribute('hson:quid')]; }); true");
  await evaluate("framesUnderTest.forEach(f => { const d=f.contentDocument, duplicate=d.querySelector('hson-scout').cloneNode(true); d.body.append(duplicate); }); true");
  assert.equal(await evaluate("framesUnderTest.every(f => f.contentDocument.querySelectorAll('hson-scout').length === 1)"), true);
  assert.equal(runtimeRequests, 2, 'Duplicates crossed the import boundary');
  await locus.stage(w => w.doc.page.at([]).asElement().attrs.set('title', 'R+1'));
  releaseAsset();
  await until("framesUnderTest.every(f => f.contentDocument.documentElement.title === 'R+1')", 'automatic synchronization');
  const identities = "framesUnderTest.every((f,i) => { const d = f.contentDocument, o = originals[i]; return d.documentElement === o[0] && d.body === o[1] && d.querySelector('p') === o[2] && d.querySelector('script') === o[3] && !d.querySelector('hson-scout,[data-hson-scout-loader]') && d.body.childNodes.length === 1 && d.documentElement.childNodes.length === 2 && f.contentWindow.canonicalScriptRuns === 1 && d.querySelector('style') === o[4] && f.contentWindow.scoutSubjectAdopted && !!d.getElementById('message').getAttribute('hson:quid') && f.contentWindow.getComputedStyle(d.getElementById('message')).color === 'rgb(10, 20, 30)' && f.contentWindow.scoutOrdering?.length === 2 && f.contentWindow.scoutOrdering.every(Boolean); })";
  assert.equal(await evaluate(identities), true, JSON.stringify(await evaluate("framesUnderTest.map((f,i) => ({same:[f.contentDocument.documentElement,f.contentDocument.body,f.contentDocument.querySelector('p'),f.contentDocument.querySelector('script')].map((n,j)=>n===originals[i][j]), counts:[f.contentDocument.body.childNodes.length,f.contentDocument.documentElement.childNodes.length,f.contentWindow.canonicalScriptRuns], ordering:f.contentWindow.scoutOrdering, styleSame:f.contentDocument.querySelector('style') === originals[i][4], quid:f.contentDocument.querySelector('p').getAttribute('hson:quid'), color:f.contentWindow.getComputedStyle(f.contentDocument.getElementById('message')).color, subjectAdopted:f.contentWindow.scoutSubjectAdopted}))")));
  await locus.stage(w => w.doc.page.at([]).asElement().attrs.set('title', 'later'));
  await until("framesUnderTest.every(f => f.contentDocument.documentElement.title === 'later')", 'two-session update');
  assert.equal(await evaluate(identities), true);
  // The same lifecycle signals used by BFCache suspend/resume the existing owner.
  await evaluate("framesUnderTest.forEach(f => f.contentWindow.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); true");
  await locus.stage(w => w.doc.page.at([]).asElement().attrs.set('title', 'restored'));
  await evaluate("framesUnderTest.forEach(f => f.contentWindow.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); true");
  await until("framesUnderTest.every(f => f.contentDocument.documentElement.title === 'restored')", 'BFCache lifecycle recovery');
  assert.equal(await evaluate(identities), true);
  assert.equal(locus.session.debug().reattachmentCount, 4, 'Exactly one continuation per restored session');
  console.log('Scout auto: unchanged published module, exact DOM identity, R to R+1, two live sessions, loader removal, canonical script and BFCache lifecycle passed.');
  for (const response of recoveryResponses) response.destroy();
  await locus.stage(w => w.doc.page.at([]).asElement().attrs.set('title', 'after-interruption'));
  await until("framesUnderTest.every(f => f.contentDocument.documentElement.title === 'after-interruption')", 'transient HTTP interruption recovery');
  assert.equal(await evaluate("framesUnderTest.every(f=>f.contentWindow.scoutLifecycleListeners.size === 2)"),true);
  await locus.stage(w => w.doc.page.at([]).asElement().attrs.set('title', 'restored'));
  await until("framesUnderTest.every(f => f.contentDocument.documentElement.title === 'restored')",'restored after interruption');
  const beforeConflict = locus.session.debug().reattachmentCount;
  // Independently bundled public continuation must see the automatic root claim.
  assert.equal(await evaluate(`(async()=>{const w=framesUnderTest[0].contentWindow;
    const api=await w.eval("import('/manual.js')");
    try{await api.start(w.document.documentElement);return false}catch(error){return /already has/.test(error.message)}})()`),true);
  assert.equal(locus.session.debug().reattachmentCount, beforeConflict, 'Competing runtime must reject before attachment');
  sessionsByPage.get('one').revoke();
  await until("framesUnderTest[0].contentWindow.scoutLifecycleListeners.size === 0", 'terminal owner cleanup');
  assert.equal(await evaluate("framesUnderTest[0].contentDocument.querySelector('p').textContent === 'Useful SSR'"),true);
  // Preparation in a separate bundle excludes another copy, and disposal releases it.
  await evaluate(`globalThis.manualFrame=document.createElement('iframe');manualFrame.src='/manual-page';document.body.append(manualFrame);true`);
  await until("manualFrame.contentDocument?.querySelector('p') && manualFrame.contentDocument.readyState === 'complete'",'manual fixture');
  assert.equal(await evaluate(`(async()=>{const w=manualFrame.contentWindow;
    const a=await w.eval("import('/manual.js')"), b=await w.eval("import('/manual.js?copy')");
    let release;const gate=new w.Promise(r=>release=r);const pending=a.start(w.document.documentElement,gate);
    await new Promise(r=>setTimeout(r,150));
    let excluded=false;try{await b.start(w.document.documentElement)}catch(error){excluded=/already has/.test(error.message)}
    release();const owner=await pending;const active=owner.mirror.status==='active';owner.dispose();
    const next=await b.start(w.document.documentElement);const released=next.mirror.status==='active';next.dispose();
    return excluded&&active&&released;})()`),true);
  await evaluate("framesUnderTest[1].contentWindow.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));true");
  await delay(800);
  assert.ok(locus.session.debug().expiredSessionCount >= 1, 'Suspended session did not expire');
  await evaluate("framesUnderTest[1].contentWindow.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));true");
  await until("framesUnderTest[1].contentWindow.scoutLifecycleListeners.size === 0", 'expired-session owner cleanup');
  console.log('Scout repairs: cross-bundle active/preparing exclusion, release and terminal revocation/expiry cleanup passed.');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: "addEventListener('pageshow', e => { globalThis.wasRestored = e.persisted; });" });
  await command('Page.navigate', { url: base + '/bfcache' });
  await until("location.pathname === '/bfcache' && document.documentElement.title === 'restored'", 'BFCache initial continuation');
  await evaluate("globalThis.beforeCache = [document.documentElement, document.body, document.querySelector('p')]; true");
  await command('Page.navigate', { url: base + '/harness' });
  await until("location.pathname === '/harness' && document.readyState === 'complete'", 'navigation away');
  await locus.stage(w => w.doc.page.at([]).asElement().attrs.set('title', 'back'));
  await evaluate("history.back(); true");
  await until("location.pathname === '/bfcache' && document.documentElement.title === 'back'", 'real BFCache restore');
  if (await evaluate("wasRestored")) {
    assert.equal(await evaluate("beforeCache[0] === document.documentElement && beforeCache[1] === document.body && beforeCache[2] === document.querySelector('p')"), true);
    console.log('Scout auto: actual BFCache restoration retained DOM identity.');
  } else {
    assert.ok(cacheExclusions.some(reason => reason.reason.includes('CacheControlNoStore')));
    assert.equal(await evaluate("!document.querySelector('hson-scout,[data-hson-scout-loader]')"), true);
    console.log('Scout auto: Chrome excludes credential-bearing no-store responses from BFCache; history reload recovered one owner. Persisted lifecycle recovery tested separately.');
  }
  let foreignExecutions=0;
  const foreign=createServer((_req,res)=>{foreignExecutions++;res.writeHead(200,{'content-type':'text/javascript','access-control-allow-origin':'*'});res.end('globalThis.foreignModuleRan=true;');});
  await new Promise(resolve=>foreign.listen(0,'127.0.0.1',resolve));
  try {
    const hostile=hsonLiveMap.locus.create({page:{document:`<html <head <base href="http://127.0.0.1:${foreign.address().port}/"/>/> <body <p "Safe fallback"/>/>/>`,access:'shared'},ui:{parts:{scout:{kind:'document',document:'<hson-scout hson:part hidden "%{payload}"/>'}},access:'private'}},{authorizeProjection:()=>({libraries:['page']})});
    try {const session=await hostile.session.create({libraries:['page']});
      assert.throws(()=>deliver_scout(session,session.now({html:'page'}),hostile.parts.ui.scout,{endpoint:'/_hson',module:'/scout-auto.js'}),/relative base/);
      pages.set('/hostile-base','<!doctype html><html><head></head><body><p>Safe fallback</p></body></html>');
      await command('Page.navigate',{url:base+'/hostile-base'});
      await until("location.pathname === '/hostile-base' && document.readyState === 'complete'",'hostile-base fallback');
      assert.equal(await evaluate("!globalThis.foreignModuleRan && document.querySelector('p').textContent === 'Safe fallback'"),true);
      assert.equal(foreignExecutions,0);
    } finally {hostile.dispose();}
  } finally {foreign.closeAllConnections();await new Promise(resolve=>foreign.close(resolve));}
  console.log('Scout repairs: hostile-base delivery rejected before any foreign module request; no credentials delivered.');
  // Hold native runtime imports after registration, then invalidate each claim.
  gate = new Promise(resolve => { releaseAsset = resolve; });
  for (const name of ['pending-cancel', 'pending-hide']) {
    const runtimeBefore = runtimeRequests, before = requests;
    await command('Page.navigate', { url: base + '/' + name });
    await until(`location.pathname === '/${name}' && !!customElements.get('hson-scout')`, name + ' registration');
    for (let i = 0; i < 100 && runtimeRequests === runtimeBefore; i++) await delay(20);
    assert.equal(runtimeRequests, runtimeBefore + 1);
    await evaluate(name === 'pending-hide'
      ? "dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true})); true"
      : "document.querySelector('hson-scout').remove(); true");
    await delay(0);
    assert.equal(await evaluate("scoutLifecycleListeners.size"), 0, 'Cancelled import retained lifecycle resources');
    releaseAsset();
    await delay(200);
    assert.equal(requests, before, 'Late import revived a cancelled Scout');
    assert.equal(await evaluate("document.querySelector('p').textContent === 'Useful SSR' && document.documentElement.title === 'R'"), true);
    gate = new Promise(resolve => { releaseAsset = resolve; });
  }
  releaseAsset();
  runtimeFailure = true;
  const failedBefore = requests;
  await command('Page.navigate', { url: base + '/runtime-failure' });
  await until("location.pathname === '/runtime-failure' && document.readyState === 'complete' && !!customElements.get('hson-scout')", 'runtime failure');
  await until("scoutLifecycleListeners.size === 0", 'failed import cleanup');
  assert.equal(requests, failedBefore);
  assert.equal(await evaluate("document.querySelector('p').textContent === 'Useful SSR' && !!document.querySelector('hson-scout')"), true);
  runtimeFailure = false;
  console.log('Scout split: registration before runtime, absent/ineligible no download, cancelled/pagehidden/503 imports preserve SSR and release listeners, nested path with base passed.');
  await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['*scout-hosted.js'] });
  await command('Page.navigate', { url: base + '/blocked' });
  await until("location.pathname === '/blocked' && document.readyState === 'complete'", 'blocked module');
  assert.equal(await evaluate("document.querySelector('p').textContent === 'Useful SSR' && getComputedStyle(document.querySelector('hson-scout')).display === 'none'"), true);
  await until("!!customElements.get('hson-scout') && scoutLifecycleListeners.size === 0", 'blocked runtime cleanup');
  await command('Network.setBlockedURLs', { urls: [] });
  await command('Emulation.setScriptExecutionDisabled', { value: true });
  const before = requests;
  await command('Page.navigate', { url: base + '/nojs' });
  await until("location.pathname === '/nojs' && document.readyState === 'complete'", 'no JS');
  assert.equal(await evaluate("document.querySelector('p').textContent === 'Useful SSR' && !customElements.get('hson-scout')"), true);
  assert.equal(requests, before);
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  for (const name of ['invalid', 'mismatch', 'destination', 'credential', 'association']) {
    const count = requests;
    await command('Page.navigate', { url: base + '/' + name });
    await until(`location.pathname === '/${name}' && document.readyState === 'complete'`, name);
    await delay(250);
    if (['invalid', 'mismatch', 'destination'].includes(name)) assert.equal(requests, count, 'Malformed startup must fail before attachment');
    else assert.ok(requests > count, 'Credential/association rejection must reach Locus');
    assert.equal(await evaluate("document.querySelector('p') !== null && document.documentElement.title === 'R'"), true);
  }
  assert.ok(assets >= 1);
  console.log('Scout auto: blocked module, disabled JavaScript, invalid ignition and correspondence failure preserve SSR; no unauthorized attachment.');
} finally {
  releaseAsset();
  for (const task of pending.values()) clearTimeout(task.timeout);
  socket?.close();
  if (chrome && chrome.exitCode === null) { const closed = new Promise(resolve => chrome.once('close', resolve)); chrome.kill('SIGTERM'); await closed; }
  binding.dispose(); locus.dispose();
  server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { hsonLiveMap } from '../src/index.ts';
import { bind_locus_http } from '../src/api/locus/index.ts';
import { receiving_handoff_fixture } from '../tests/fixtures/echo-receiving-handoff-cases.mts';
import { node } from '../tests/fixtures/locus-scoped-ssr-cases.mts';
import { locus_map_internal } from '../src/internal/governor-maps.ts';
import { lookup_document_quad_internal } from '../src/api/livemap/livemap.document.quad.ts';
import { internal_livemap_aggregate_authority as owner } from '../src/api/livemap/livemap.internal.ts';
import { validate_document_path } from '../src/api/livemap/livemap.document.path.ts';
import { hosted_flat_subject_fixture } from '../tests/fixtures/hosted-styled-part-ssr-cases.mts';

async function topology_fixture() {
  const locus = hsonLiveMap.locus.create({
    private: [{ name: 'parts', definition: { parts: { bare: { kind: 'document', document: '<aside "Bare"/>' } } } }],
    shared: [{ name: 'page', definition: { document: '<html <head/> <body <hson-part lib="parts" at="bare"/>/>/>' } },
      { name: 'flat', definition: { document: '<html <head/> <body <p "Flat"/>/>/>' } },
      { name: 'live', definition: { document: '<main <hson-part lib="parts" at="bare"/>/>' } }],
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: ['flat', 'page', 'live'] }),
  });
  await locus.stage(w => w.lib('page').at([1,0]).delete());
  const session = await locus.session.create({ libraries: ['page','flat','live'] });
  return { locus, session, cut: session.now({ html: 'page' }) };
}
async function flat_fixture(rollback = false) {
  const parents = ['p', 'q'].map(id => `<section id="rollback-${id}" <span id="${id}-one" "One"/> <span id="${id}-two" "Two"/> <span id="${id}-three" "Three"/>/>`).join(' ');
  const fixture = await hosted_flat_subject_fixture('<button @:a id="hosted-a" "Styled"/> <button @:b id="hosted-b" "Styled"/> <em id="hosted-disposable" "Disposable"/>' + (rollback ? parents : ''));
  const aggregate = owner(locus_map_internal(fixture.locus)), identity = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(e => e.name === 'page')];
  aggregate.acquireLocalDocumentIdentity(identity, validate_document_path([0,0,1,0,2]), '123456789');
  await fixture.locus.stage(w => w.lib('page').css.sel('[hson\\:quid="123456789"]').setProp('color','rgb(90,80,70)'));
  return { ...fixture, cut: fixture.session.now({ html: 'page' }) };
}
const fixtures = [await receiving_handoff_fixture(), await flat_fixture(), await receiving_handoff_fixture(), await topology_fixture(), await flat_fixture(true)];
const pages = await Promise.all(fixtures.map(async (fixture, i) => {
  const second = await fixture.locus.session.create({ libraries: fixture.session.now().libs.libraries.map(e => e.name) });
  const endpoint = `/echo-${i}`;
  return { ...fixture, path: `/page-${i}`, endpoint, binding: bind_locus_http(fixture.locus, { endpoint }),
    owners: [fixture.session, second], sessions: [fixture.session, second].map(session => ({ cut: session.now({ html: 'page' }), credential: session.credential })) };
}));
const bundle = await build({ entryPoints: ['tests/browser/hosted-continuation.entry.mjs'], bundle: true,
  write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
const profile = await mkdtemp(join(tmpdir(), 'hson-hosted-continuation-chrome-'));
let chrome, socket, server, stderr = '';
try {
  server = createServer(async (req, res) => {
    try {
      if (req.url === "/harness") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><html><head></head><body></body></html>"); return; }
      const page = pages.find(p => p.path === req.url.split('?')[0]);
      if (page) { res.writeHead(200, { 'content-type': 'text/html' });
        const selected = new URL(req.url, 'http://fixture').searchParams.get('document');
        res.end(selected ? page.owners[0].now({ html: selected }).html : page.cut.html); return; }
      const binding = pages.find(p => req.url.startsWith(p.endpoint))?.binding;
      if (!binding) { res.writeHead(404); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const abort = new AbortController(); res.on('close', () => abort.abort());
      const result = await binding.handle(new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method, headers: req.headers, signal: abort.signal,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      }), {});
      res.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body) for await (const chunk of result.body) { if (res.destroyed) break; res.write(chunk); }
      res.end();
    } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end(String(error)); } }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.HSON_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
  chrome.stderr.on('data', chunk => { stderr += chunk; });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { if (chrome.exitCode !== null) throw Error(stderr); await delay(100); }
  }
  assert.ok(port, stderr);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0; const pending = new Map();
  socket.on('message', data => {
    const message = JSON.parse(String(data)), request = pending.get(message.id);
    if (request) { clearTimeout(request.timeout); pending.delete(message.id);
      if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error(`Chrome timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  await command('Page.enable');
  for (const [i, page] of pages.entries()) {
    if (i === 4) {
      await command('Page.navigate', { url: base + '/harness' });
      for (let j = 0; j < 100; j++) { if (await evaluate("location.pathname === '/harness' && document.readyState === 'complete'")) break; await delay(50); }
      await evaluate(bundle.outputFiles[0].text);
      const map = locus_map_internal(page.locus), aggregate = owner(map), identity = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(e => e.name === 'page')];
      aggregate.acquireLocalDocumentIdentity(identity, validate_document_path([0,0,1,0,5]), '444444444');
      await page.locus.stage(w => w.lib('page').at([1,0]).asElement().attrs.set('title', 'earlier-recovery'));
      await page.locus.stage(w => {
        w.lib('page').at([1,0]).asElement().attrs.set('title', 'replayed');
        w.lib('page').at([1,0]).asElement().flags.set('disabled');
        w.lib('page').at([1,0,0]).replace('Recovered text');
        w.lib('page').at([1,2]).delete();
        w.lib('page').at([1]).asElement().insert(2,node('<p id="recovery-insert" "Inserted during recovery"/>'));
        w.lib('page').css.stylesheet('[hson\\:quid="444444444"]{color:rgb(77,88,99)}');
      });
      await page.locus.stage(w => {
        for (const [index, id] of [[3, 'p'], [4, 'q']]) {
          for (let child = 2; child >= 0; child--) w.lib('page').at([1,index,child]).delete();
          for (let child = 0; child < 3; child++) w.lib('page').at([1,index]).asElement().insert(child,
            node(`<span id="recovery-${id}-${child}" "New child"/>`));
        }
        w.lib('page').at([1]).asElement().insert(3, node('<p id="recovery-extra-one" "Extra one"/>'));
        w.lib('page').at([1]).asElement().insert(4, node('<p id="recovery-extra-two" "Extra two"/>'));
      });
      const revision = page.locus.rev;
      console.log(await evaluate(`hostedFailures(${JSON.stringify({ session: page.sessions[0], endpoint: base + page.endpoint, url: base + page.path, recovered: true, flat: true, nativeFaults: true, revision })})`));
      assert.equal(page.locus.rev, revision, 'Failed browser takeover does not roll back accepted Locus revisions');
      continue;
    }
    if (i === 3) {
      await command('Page.navigate', { url: base + '/harness' });
      for (let j = 0; j < 100; j++) { if (await evaluate("location.pathname === '/harness' && document.readyState === 'complete'")) break; await delay(50); }
      await evaluate(bundle.outputFiles[0].text);
      for (const document of ['flat','live','page']) {
        const session = await page.locus.session.create({ libraries: ['page','flat','live'] });
        const variants = [{ cut: session.now({ html: document }), credential: session.credential,
          url: base + page.path + '?document=' + document, document }];
        console.log(await evaluate(`hostedTopologies(${JSON.stringify({ variants, endpoint: base + page.endpoint })})`));
      }
      assert.match(page.locus.lib('flat').render(), /title="browser"/);
      continue;
    }
    await command('Emulation.setScriptExecutionDisabled', { value: true });
    await command('Page.navigate', { url: base + page.path });
    let ready;
    for (let j = 0; j < 100; j++) { ready = await evaluate(`document.readyState === 'complete' && location.pathname === '${page.path}' && !!document.querySelector('button')`); if (ready) break; await delay(50); }
    assert.ok(ready);
    const paint = await evaluate(`(() => {
      const css = selector => { const s = getComputedStyle(document.querySelector(selector)); return [s.color,s.marginLeft,s.paddingLeft,s.borderTopWidth]; };
      return { a:css(${JSON.stringify(i !== 1 ? '#left' : '#hosted-a')}), b:css(${JSON.stringify(i !== 1 ? '#right' : '#hosted-b')}),
        leaf:${i !== 1 ? "css('#left button span')" : 'null'}, outside:css(${JSON.stringify(i !== 1 ? '#outside' : '#hosted-outside')}),
        markers:[...document.querySelectorAll('*')].filter(e=>e.hasAttribute('hson:quad')).map(e=>e.getAttribute('hson:quad')), scripts:document.scripts.length }; })()`);
    assert.equal(paint.scripts, 0);
    const source = page.cut.libs.libraries.find(e => e.name === 'page');
    assert.deepEqual(paint.markers.sort(), (source.scopes?.subjects ?? source.quads).map(s => s.name).sort());
    if (i !== 1) { assert.equal(paint.a[1], '11px'); assert.equal(paint.b[1], '13px'); assert.equal(paint.a[3], '3px'); assert.equal(paint.leaf[0], 'rgb(10, 20, 30)'); assert.equal(paint.outside[0], 'rgb(40, 50, 60)'); }
    else { assert.equal(paint.a[0], 'rgb(12, 34, 56)'); assert.equal(paint.b[0], 'rgb(12, 34, 56)'); assert.equal(paint.outside[0], 'rgb(0, 0, 0)'); }
    await command('Emulation.setScriptExecutionDisabled', { value: false });
    await command('Page.navigate', { url: base + '/harness' });
    for (let j = 0; j < 100; j++) { if (await evaluate("location.pathname === '/harness' && document.readyState === 'complete'")) break; await delay(50); }
    await evaluate(bundle.outputFiles[0].text);
    if (i === 2) {
      const args = { session: page.sessions[0], endpoint: base + page.endpoint, url: base + page.path };
      console.log(await evaluate(`hostedFailures(${JSON.stringify(args)})`));
      await page.locus.stage(w => {
        w.lib('page').at([1,0]).asElement().attrs.set('title', 'replayed');
        w.lib('page').at([1,0,0]).asElement().flags.set('disabled');
        w.lib('page').at([1,0,0,0,0]).replace('Recovered text');
        w.lib('page').at([1,1]).delete();
        w.lib('page').at([1]).asElement().insert(1,node('<p id="recovery-insert" "Inserted during recovery"/>'));
        w.lib('page').css.sel('#left').setProp('color', 'rgb(77,88,99)');
      });
      console.log(await evaluate(`hostedFailures(${JSON.stringify({ ...args, recovered: true })})`));
      continue;
    }
    const result = await evaluate(`hostedContinuationStart(${JSON.stringify({ sessions: page.sessions, endpoint: base + page.endpoint, url: base + page.path, scoped: i !== 1 })})`);
    const changed = async (phase, run) => {
      console.log(`Chrome ${i}: ${phase}`);
      await run(); await evaluate(`hostedRevision(${page.locus.rev})`);
      await evaluate(`hostedCheckLive(${JSON.stringify(phase)})`);
    };
    await changed('attrs', () => page.locus.stage(w => {
      w.lib('page').at([1,0]).asElement().attrs.set('title','authoritative');
      w.lib('page').at(i !== 1 ? [1,0,0] : [1,0]).asElement().flags.set('disabled');
    }));
    let flatDemand = false;
    const subject = lookup_document_quad_internal(locus_map_internal(page.locus).lib('page'), i !== 1 ? 'left' : 'a');
    await changed('content', () => page.locus.stage(w => {
      w.lib('page').at(i !== 1 ? [1,0,0,0,0] : [1,0,0]).replace('Changed');
      w.lib('page').at([1]).asElement().insert(2, node('<p id="inserted" "Inserted"/>'));
      if (i === 1) w.lib('page').css.stylesheet(`[hson\\:quid="${subject.quid}"]{color:rgb(21,43,65)}[hson\\:quid="${lookup_document_quad_internal(locus_map_internal(page.locus).lib('page'), 'b').quid}"]{color:rgb(12,34,56)}[hson\\:quid="123456789"]{color:rgb(90,80,70)}${flatDemand ? '[hson\\:quid="222222222"]{color:rgb(22,44,66)}' : ''}`);
      else w.lib('page').css.sel(`[hson\\:quid="${subject.quid}"]`).setProp('color','rgb(21,43,65)');
    }));
    if (i === 1) {
      const aggregate = owner(locus_map_internal(page.locus));
      const before = page.locus.rev;
      aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(e => e.name === 'page')], validate_document_path([0,0,1,0,2]), '222222222');
      assert.equal(page.locus.rev, before);
      flatDemand = true;
      await changed('demand', () => page.locus.stage(w => w.lib('page').css.sel('[hson\\:quid="222222222"]').setProp('color','rgb(22,44,66)')));
    }
    await changed('move', () => page.locus.stage(w => w.lib('page').at([1]).asElement().move(0,1)));
    await changed('remove', () => page.locus.stage(w => {
      if (i === 1) w.lib('page').css.stylesheet(`[hson\\:quid="${lookup_document_quad_internal(locus_map_internal(page.locus).lib('page'), 'b').quid}"]{color:rgb(12,34,56)}[hson\\:quid="123456789"]{color:rgb(90,80,70)}${flatDemand ? '[hson\\:quid="222222222"]{color:rgb(22,44,66)}' : ''}`);
      else w.lib('page').css.sel(`[hson\\:quid="${subject.quid}"]`).drop();
      w.lib('page').at([1,1]).delete();
    }));
    await changed('replace', () => page.locus.stage(w => w.lib('page').at([1]).asElement().insert(1,
      node(i !== 1 ? '<hson-part lib="parts" at="panel" id="replacement"/>' : '<button id="replacement" "New"/>'))));
    if (i === 1) {
      await changed('graph-first-cleanup', () => page.locus.stage(w => {
        w.lib('page').at([1,3]).delete();
        w.lib('page').css.stylesheet(`[hson\\:quid="${lookup_document_quad_internal(locus_map_internal(page.locus).lib('page'), 'b').quid}"]{color:rgb(12,34,56)}[hson\\:quid="222222222"]{color:rgb(22,44,66)}`);
      }));
      await evaluate('hostedArmRejection()');
      await page.locus.stage(w => w.lib('page').at([1,0]).asElement().attrs.set('data-rejected', 'accepted-authority'));
      await evaluate('hostedRejected()');
      console.log('Chrome rejected correspondence preserved DOM/CSS and ledger');
    }
    await evaluate('hostedPause()');
    await page.locus.stage(w => w.lib('page').at([1,0]).asElement().attrs.set('title', 'missed'));
    await evaluate(`hostedResume(${page.locus.rev})`);
    console.log("Chrome replay/reconciliation passed");
    await page.owners[0].update({ libraries: [] });
    await evaluate('hostedRefresh()');
    await evaluate('hostedReduced()');
    console.log('Chrome projection reduction passed');
    page.owners[1].revoke();
    await evaluate('hostedRevoked()');
    console.log('Chrome revocation passed');
    await evaluate("hostedContinuationDispose()");
    console.log(`${i !== 1 ? 'Scoped' : 'Flat'} Chrome public continuation passed: ${JSON.stringify(result)}`);
  }
} finally {
  socket?.close(); if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => chrome.once('exit', resolve)); }
  pages.forEach(p => { p.binding.dispose(); p.locus.dispose(); });
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(profile, { recursive: true, force: true });
}

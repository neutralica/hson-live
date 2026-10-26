import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { bind_locus_http } from '../src/api/locus/index.ts';
import { receiving_handoff_fixture } from '../tests/fixtures/echo-receiving-handoff-cases.mts';
import { hosted_flat_subject_fixture } from '../tests/fixtures/hosted-styled-part-ssr-cases.mts';

const fixtures = [await receiving_handoff_fixture(), await hosted_flat_subject_fixture()];
const pages = await Promise.all(fixtures.map(async (fixture, i) => {
  const second = await fixture.locus.session.create({ libraries: ['page'] });
  const endpoint = `/echo-${i}`;
  return { ...fixture, path: `/page-${i}`, endpoint, binding: bind_locus_http(fixture.locus, { endpoint }),
    sessions: [fixture.session, second].map(session => ({ cut: session.now({ html: 'page' }), credential: session.credential })) };
}));
const bundle = await build({ entryPoints: ['tests/browser/echo-receiving-handoff.entry.mjs'], bundle: true,
  write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
const profile = await mkdtemp(join(tmpdir(), 'hson-receiving-handoff-chrome-'));
let chrome, socket, server, stderr = '';
try {
  server = createServer(async (req, res) => {
    try {
      const page = pages.find(p => p.path === req.url);
      if (page) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page.cut.html); return; }
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
    await command('Emulation.setScriptExecutionDisabled', { value: true });
    await command('Page.navigate', { url: base + page.path });
    let ready;
    for (let j = 0; j < 100; j++) { ready = await evaluate(`document.readyState === 'complete' && location.pathname === '${page.path}' && !!document.querySelector('button')`); if (ready) break; await delay(50); }
    assert.ok(ready);
    const paint = await evaluate(`(() => {
      const css = selector => { const s = getComputedStyle(document.querySelector(selector)); return [s.color,s.marginLeft,s.paddingLeft,s.borderTopWidth]; };
      return { a:css(${JSON.stringify(i === 0 ? '#left' : '#hosted-a')}), b:css(${JSON.stringify(i === 0 ? '#right' : '#hosted-b')}),
        leaf:${i === 0 ? "css('#left button span')" : 'null'}, outside:css(${JSON.stringify(i === 0 ? '#outside' : '#hosted-outside')}),
        markers:[...document.querySelectorAll('*')].filter(e=>e.hasAttribute('hson:quad')).map(e=>e.getAttribute('hson:quad')), scripts:document.scripts.length }; })()`);
    assert.equal(paint.scripts, 0);
    const source = page.cut.libs.libraries.find(e => e.name === 'page');
    assert.deepEqual(paint.markers.sort(), (source.scopes?.subjects ?? source.quads).map(s => s.name).sort());
    if (i === 0) { assert.equal(paint.a[1], '11px'); assert.equal(paint.b[1], '13px'); assert.equal(paint.a[3], '3px'); assert.equal(paint.leaf[0], 'rgb(10, 20, 30)'); assert.equal(paint.outside[0], 'rgb(40, 50, 60)'); }
    else { assert.equal(paint.a[0], 'rgb(12, 34, 56)'); assert.equal(paint.b[0], 'rgb(12, 34, 56)'); assert.equal(paint.outside[0], 'rgb(0, 0, 0)'); }
    await command('Emulation.setScriptExecutionDisabled', { value: false });
    await evaluate(bundle.outputFiles[0].text);
    const result = await evaluate(`receivingHandoffPreflight(${JSON.stringify({ sessions: page.sessions, endpoint: base + page.endpoint })})`);
    console.log(`${i === 0 ? 'Scoped' : 'Flat'} Chrome first paint and aborting preflight passed: ${JSON.stringify(result)}`);
  }
} finally {
  socket?.close(); if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => chrome.once('exit', resolve)); }
  pages.forEach(p => { p.binding.dispose(); p.locus.dispose(); });
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(profile, { recursive: true, force: true });
}

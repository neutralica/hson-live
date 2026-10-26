import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

// Source-only native regressions: no distribution build or repository output.
const bundle = await build({ stdin: {
  contents: `import { css_selector_browser_cases } from './tests/fixtures/css-selector-browser-cases.mts';
    import { universal_css_map_browser_cases } from './tests/fixtures/universal-css-map-browser-cases.mts';
    import { document_css_reconciliation_browser_cases, document_css_reentrancy_browser_cases } from './tests/fixtures/document-css-reconciliation-browser-cases.mts';
    globalThis.reconciliationResult = (async () => [
      ...await universal_css_map_browser_cases(), ...await css_selector_browser_cases(), ...await document_css_reconciliation_browser_cases(), ...await document_css_reentrancy_browser_cases()
    ])();`,
  resolveDir: process.cwd(), loader: 'ts',
}, bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
const html = `<!doctype html><html><body><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const profile = await mkdtemp(join(tmpdir(), 'hson-css-reconciliation-'));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html);
});
let chrome, socket;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  let stderr = '';
  chrome = spawn(process.env.HSON_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ]);
  chrome.stderr.on('data', chunk => { stderr += chunk; });
  chrome.on('error', error => { stderr += error.message; });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { if (chrome.exitCode !== null) throw Error(`Chrome exited: ${stderr}`); await delay(100); }
  }
  assert.ok(port, `Chrome debugging port unavailable: ${stderr}`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(String(raw)), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timeout);
    if (message.error) request.reject(Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error(`Chrome command timed out: ${method}`)); }, 20_000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await command('Page.bringToFront');
  await command('Page.navigate', { url: `http://127.0.0.1:${address.port}/` });
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    const evaluation = await command('Runtime.evaluate', { expression: 'globalThis.reconciliationResult', awaitPromise: true, returnByValue: true });
    if (evaluation.exceptionDetails) throw Error(JSON.stringify(evaluation.exceptionDetails));
    if (evaluation.result.type !== 'undefined') { result = evaluation.result.value; break; }
    await delay(50);
  }
  assert.ok(Array.isArray(result) && result.length > 0, 'Native reconciliation cases did not complete.');
  for (const check of result) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.error ? `: ${check.error}` : ''}`);
  assert.equal(result.filter(check => !check.pass).length, 0, 'Native reconciliation cases failed.');
  console.log(`Native document CSS reconciliation passed (${result.length} checks).`);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise(resolve => chrome.once('close', resolve)); chrome.kill('SIGTERM'); await closed;
  }
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

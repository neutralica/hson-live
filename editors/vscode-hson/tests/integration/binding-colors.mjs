import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';

export async function binding_color_port() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 75));
/** Inspect only the isolated test window's rendered token colors. No workbench
 * service injection or theme-rule reimplementation: these are computed CSS values. */
export function monitor_binding_colors(workspace, port) {
  let stopped = false, socket, requestId = 0;
  const pending = new Map();
  const reports = [];
  async function connect() {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(target => target.type === 'page' && target.url.includes('workbench'));
    if (!target) throw new Error('Test workbench renderer unavailable');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const reply = JSON.parse(event.data), handler = pending.get(reply.id);
      if (handler) { pending.delete(reply.id); reply.error ? handler.reject(new Error(reply.error.message)) : handler.resolve(reply.result); }
    });
    socket.addEventListener('close', () => { for (const handler of pending.values()) handler.reject(new Error('Test renderer closed')); pending.clear(); });
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  }
  async function sample(request) {
    if (!socket) await connect();
    const id = ++requestId;
    const expression = `(${function (request) {
      const normalize = text => text.replaceAll('\u00a0', ' ').replaceAll('\u200b', '');
      const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
      return request.tokens.map(token => {
        const line = lines.find(line => normalize(line.textContent) === token.lineText);
        if (!line) return null;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const colors = new Set();
        let node, offset = 0;
        while ((node = walker.nextNode())) {
          const length = normalize(node.textContent).length;
          if (offset < token.character + token.length && offset + length > token.character) colors.add(getComputedStyle(node.parentElement).color);
          offset += length;
        }
        return colors.size === 1 ? [...colors][0] : null;
      });
    }.toString()})(${JSON.stringify(request)})`;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    return (await response).result.value;
  }
  const done = (async () => {
    let last;
    while (!stopped) {
      let request;
      try { request = JSON.parse(await readFile(join(workspace, 'binding-color-request.json'), 'utf8')); } catch {}
      if (!request || request.id === last) { await pause(); continue; }
      last = request.id;
      let colors, error;
      for (let attempt = 0; attempt < 120 && !stopped; attempt++) {
        try {
          colors = await sample(request);
          const valid = colors?.length === request.tokens.length && colors.every(Boolean)
            && request.pairs.every(([a, b]) => colors[a] === colors[b])
            && request.tokens.every((token, index) => !token.expected || colors[index] === token.expected);
          if (valid) { error = undefined; break; }
          error = 'Rendered colors do not match: ' + JSON.stringify(colors);
        } catch (cause) { error = String(cause); }
        await pause();
      }
      reports.push({ ...request, colors, error });
      await writeFile(join(workspace, 'binding-color-report.json'), JSON.stringify(reports, null, 2));
      await writeFile(join(workspace, 'binding-color-response.json'), JSON.stringify({ id: request.id, colors, error }));
    }
  })();
  return { done, stop() { stopped = true; socket?.close(); } };
}

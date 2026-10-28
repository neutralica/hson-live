import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decode_native_tokens, decode_native_response, read_native_tokens, isRecord, nativeTokenTypes, nativeTokenModifiers,
  NATIVE_SEMANTIC_COMMAND, NATIVE_SEMANTIC_PROTOCOL, NATIVE_REQUEST_LIMIT, type SemanticDocument } from "../src/native-semantic-tokens.js";

function document(text: string): SemanticDocument {
  const offsets = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) offsets.push(match.index + match[0].length);
  return { lineCount: offsets.length,
    lineAt: line => ({ text: text.slice(offsets[line], offsets[line + 1] ?? text.length).replace(/[\r\n]+$/, ''), range: { start: { line, character: 0 } } }),
    offsetAt: position => offsets[position.line]! + position.character };
}
const legend = { tokenTypes: nativeTokenTypes, tokenModifiers: nativeTokenModifiers };
const request = { start: 0, length: 20, textHash: 'digest', requestId: 'request' };
function packet(data: unknown, changes: Record<string, unknown> = {}) {
  return { type: 'response', success: true, body: { protocol: NATIVE_SEMANTIC_PROTOCOL, ...request, project: 'test', projectVersion: '1', legend, data, ...changes } };
}

async function run() {
  const doc = document('const native = 1;\r\nconst other = 2;');
  const valid = [0, 6, 6, 7, 9, 1, 6, 5, 7, 1];
  const decoded = decode_native_tokens(doc, legend, valid);
  assert.deepEqual(decoded?.map(token => [token.type, token.modifiers]), [['variable', ['declaration', 'readonly']], ['variable', ['declaration']]]);
  assert.equal(decoded?.[1]?.start, 25);
  for (const data of [
    [0, 6, 6, 7], [0, 6, 6, 12, 0], [0, 6, 6, 7, 64], [99, 0, 1, 7, 0],
    [0, 6, 99, 7, 0], [0, 6, 0, 7, 0], [0, 6, 6, 7, 0, 0, 1, 1, 7, 0],
    [1, 6, 5, 7, 0, -1, 0, 1, 7, 0], [0, .5, 1, 7, 0], [0, 0, NaN, 7, 0],
    [0, 0, 1, 7, -1], [0, 0, 1, 7, 2 ** 32], {}, null, 'tokens',
  ]) assert.equal(decode_native_tokens(doc, legend, data), undefined, JSON.stringify(data));
  assert.equal(decode_native_tokens(document('😀name'), legend, [0, 1, 1, 7, 0]), undefined, 'no split surrogate');
  assert.equal(decode_native_tokens(document('😀name'), legend, [0, 0, 2, 7, 0])?.[0]?.length, 2);
  // Equal legend lengths and valid indices do not establish an association.
  const first = { tokenTypes: ['variable', 'class'], tokenModifiers: ['readonly', 'declaration'] };
  const second = { tokenTypes: ['class', 'variable'], tokenModifiers: ['declaration', 'readonly'] };
  assert.equal(decode_native_tokens(doc, first, [0, 6, 6, 0, 1])?.[0]?.type, 'variable');
  assert.equal(decode_native_tokens(doc, second, [0, 6, 6, 1, 2])?.[0]?.type, 'variable');
  for (const selected of [first, second]) assert.equal(decode_native_response(doc, request, packet([0, 6, 6, 0, 1], { legend: selected })), undefined);
  for (const change of [{ textHash: 'changed' }, { requestId: 'other' }, { start: 1 }, { length: 21 }, { protocol: 'other' }]) {
    assert.equal(decode_native_response(doc, request, packet(valid, change)), undefined);
  }
  for (const value of [undefined, {}, { data: valid }, { type: 'response', success: false }, packet({})]) {
    assert.equal(decode_native_response(doc, request, value), undefined);
  }
  const long = document('x'.repeat(NATIVE_REQUEST_LIMIT + 20));
  const calls: number[] = [];
  const read = async (item: typeof request) => { calls.push(item.length); return packet([], item); };
  assert.deepEqual(await read_native_tokens(long, NATIVE_REQUEST_LIMIT + 20, 'digest', 'request', read, () => false), []);
  assert.deepEqual(calls, [NATIVE_REQUEST_LIMIT, 20]);
  let changed = false;
  assert.equal(await read_native_tokens(doc, 20, 'digest', 'request', async () => { changed = true; return packet(valid); }, () => changed), undefined);
  assert.equal(await read_native_tokens(doc, 20, 'digest', 'request', async () => undefined, () => false), undefined);
  assert.equal(await read_native_tokens(doc, 20, 'digest', 'request', async () => { throw new Error('provider unavailable'); }, () => false), undefined);
  assert.equal(await read_native_tokens(doc, 20, 'digest', 'request', async () => { throw new Error('must not read'); }, () => true), undefined);
  let count = 0;
  assert.equal(await read_native_tokens(long, NATIVE_REQUEST_LIMIT + 20, 'digest', 'request', async item =>
    ++count === 1 ? packet([], item) : packet([0, 0, 1, 999, 0], item), () => false), undefined, 'a late invalid stream invalidates the whole attempt');
  count = 0;
  assert.equal(await read_native_tokens(long, NATIVE_REQUEST_LIMIT + 20, 'digest', 'request', async item =>
    packet([], { ...item, projectVersion: String(++count) }), () => false), undefined, 'dependency/project changes invalidate an attempt');
  count = 0;
  assert.equal(await read_native_tokens(long, NATIVE_REQUEST_LIMIT + 20, 'digest', 'request', async item =>
    ++count === 1 ? packet([], item) : undefined, () => false), undefined, 'a provider becoming unavailable cannot publish the first chunk');
  console.log('ok - complete native stream validation, legend association, bounded requests and stale/unavailable reads');
  await serverProbe();
}

async function serverProbe() {
  const directory = await mkdtemp(join(tmpdir(), 'hson-native-semantic-'));
  const file = join(directory, 'native.ts');
  const text = 'import { Hson, type Part } from "hson-live";\r\nclass Deck { readonly title = "😀"; render(){ return this.title; } }\r\nconst deck = new Deck();\r\nexport const parts = { card: Hson.document`<p hson:part blocks:data="%{blocks}" <hson-part at="^{block.kind}"/>/>`, renderCard() { let value = deck.title; return value; } };\r\nconst part: Part = { name: "card" };\r\nconst view = Hson.document`<p "^{local}">${deck.render()}/>`;';
  await writeFile(file, text);
  await writeFile(join(directory, 'hson.d.ts'), 'declare module "hson-live" { export interface Part { name: string; } export const Hson: { document(strings: TemplateStringsArray, ...values: unknown[]): string; }; }');
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true }, include: ['*.ts'] }));
  const require = createRequire(__filename);
  const child = spawn(process.execPath, [require.resolve('typescript/lib/tsserver.js'), '--globalPlugins', 'hson-schema-typescript-plugin',
    '--pluginProbeLocations', resolve(__dirname, '..'), '--disableAutomaticTypingAcquisition'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, { finish(value: unknown): void; fail(error: Error): void }>();
  let sequence = 0, buffer = Buffer.alloc(0), stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const boundary = buffer.indexOf('\r\n\r\n'); if (boundary < 0) return;
      const length = Number(buffer.subarray(0, boundary).toString().match(/Content-Length: (\d+)/)?.[1]);
      if (buffer.length < boundary + 4 + length) return;
      const value: unknown = JSON.parse(buffer.subarray(boundary + 4, boundary + 4 + length).toString());
      buffer = buffer.subarray(boundary + 4 + length);
      if (isRecord(value) && value.type === 'response' && typeof value.request_seq === 'number') {
        pending.get(value.request_seq)?.finish(value); pending.delete(value.request_seq);
      }
    }
  });
  child.on('error', error => { for (const item of pending.values()) item.fail(error); });
  child.on('exit', () => { for (const item of pending.values()) item.fail(new Error('tsserver exited: ' + stderr)); });
  function send(command: string, args: unknown): Promise<unknown> {
    return new Promise((accept, reject) => {
      const seq = ++sequence;
      const timeout = setTimeout(() => { pending.delete(seq); reject(new Error('tsserver timed out: ' + command + stderr)); }, 20_000);
      pending.set(seq, { finish(value) { clearTimeout(timeout); accept(value); }, fail(error) { clearTimeout(timeout); reject(error); } });
      child.stdin.write(JSON.stringify({ seq, type: 'request', command, arguments: args }) + '\n');
    });
  }
  try {
    await send('updateOpen', { openFiles: [{ file, fileContent: text }] });
    const args = { file, start: 0, length: text.length, textHash: createHash('sha256').update(text).digest('hex'), requestId: 'real-server' };
    const response = await send(NATIVE_SEMANTIC_COMMAND, args);
    const tokens = decode_native_response(document(text), args, response);
    assert.ok(tokens, JSON.stringify(response));
    for (const [name, type] of [['Deck', 'class'], ['deck', 'variable'], ['render', 'method']]) {
      assert.ok(tokens.some(token => token.start === text.indexOf(name!) && token.type === type), name);
    }
    for (const [name, type] of [['card:', 'property'], ['renderCard', 'method'], ['document`', 'method'],
      ['parts', 'variable'], ['Part =', 'interface']]) {
      assert.ok(tokens.some(token => token.start === text.indexOf(name!) && token.type === type), `native ${name}: ${type}`);
    }
    for (const keyword of ['export', 'const', 'let', 'return']) {
      const start = text.indexOf(keyword);
      assert.ok(tokens.every(token => token.start >= start + keyword.length || token.end <= start), `${keyword} remains lexical TypeScript syntax`);
    }
    const hole = text.indexOf('${deck.render()}');
    assert.ok(tokens.some(token => token.start === hole + 2 && token.type === 'variable'));
    assert.ok(tokens.some(token => token.start === hole + 7 && token.type === 'method'));
    assert.ok(tokens.some(token => token.start === text.indexOf('title') && token.modifiers.includes('readonly')));
    assert.equal(decode_native_response(document(text), args, await send(NATIVE_SEMANTIC_COMMAND, { ...args, textHash: 'stale' })), undefined);
    assert.equal(decode_native_response(document(text), args, await send(NATIVE_SEMANTIC_COMMAND, { ...args, length: NATIVE_REQUEST_LIMIT + 1 })), undefined);
    console.log('ok - real tsserver plugin returns one content-bound token/legend snapshot with native classes, methods, modifiers and interpolation');
  } finally {
    child.kill();
    await rm(directory, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

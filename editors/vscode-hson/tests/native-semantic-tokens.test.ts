import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { event_source_text_hash } from "../src/event-source-evidence.js";
import { PROJECT_DISCOVERY_COMMAND } from "../src/typescript-project-discovery.js";
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
  const text = 'import { Hson, type Part } from "hson-live";\r\nclass Deck { readonly title = "😀"; render(){ return this.title; } }\r\nconst deck = new Deck();\r\nexport const parts = { card: Hson.document`<p hson:part data:blocks="%{blocks}" <hson-part at="^{block.kind}"/>/>`, renderCard() { let value = deck.title; return value; } };\r\nconst part: Part = { name: "card" };\r\nconst view = Hson.document`<p "^{local}">${deck.render()}/>`;';
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
    const project = join(directory, "events"), eventFile = join(project, "app.ts");
    // The Schema overlay shifts this import in the real service program.
    const source = 'export const Label = Hson.schema`<type "data" root "string">`;\n'
      + 'import { Hson, hsonLiveMap as maps } from "hson-live";\n'
      + 'const keep: number = "bad";\n'
      + 'maps.fromLibraries({bits:{parts:{card:{kind:"document",document:Hson.document`<button hson:part event:go/>`,'
      + 'events:{go:Hson.event`<hson:event on:click local:go v:str=^{missing} <> >`}}}}});';
    await mkdir(project);
    await writeFile(eventFile, source);
    await writeFile(join(project, "package.json"), '{"type":"module"}');
    const record = { fileName: eventFile, textHash: event_source_text_hash(source), importOffsets: [source.indexOf("Hson, hsonLiveMap")] };
    await writeFile(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", strict: true,
      types: [], paths: { "hson-live": [resolve("../../src/index.ts")] },
      plugins: [{ name: "hson-schema-typescript-plugin", eventSources: [record] }] }, files: ["app.ts"] }));
    await send("updateOpen", { openFiles: [{ file: eventFile, fileContent: source }] });
    const verify = async (expected: number[]) => {
      const result = await send("semanticDiagnosticsSync", { file: eventFile });
      assert.ok(isRecord(result) && result.success && Array.isArray(result.body));
      assert.deepEqual(result.body.map(d => d.code).filter(code => code === 2322 || code === 95002), expected);
    };
    await writeFile(join(project, "shim.ts"), 'export const Hson = {event: String.raw};');
    const alternate = join(project, "tsconfig.disputed.json");
    await writeFile(alternate, JSON.stringify({ compilerOptions: { module: "NodeNext", types: [],
      paths: { "hson-live": ["./shim.ts"] } }, files: ["app.ts"] }));
    const discover = async () => {
      const reply = await send(PROJECT_DISCOVERY_COMMAND, { roots: [project], openFiles: [[eventFile, source]] });
      assert.ok(isRecord(reply) && isRecord(reply.body) && typeof reply.body.sessionId === "string");
      assert.ok(isRecord(reply.body.projects) && Array.isArray(reply.body.projects.sources));
      const observed = reply.body.projects.sources.find(item => item.fileName === eventFile);
      assert.ok(observed);
      return { sessionId: reply.body.sessionId, observed };
    };
    const disputed = await discover();
    assert.equal(disputed.observed.owners.length, 2);
    assert.equal(disputed.observed.eventEvidence, undefined);
    await verify([2322]);
    await rm(alternate);
    const { sessionId, observed } = await discover();
    assert.deepEqual(observed.eventEvidence, record);
    const configure = (eventSources: unknown[], id = sessionId) => child.stdin.write(JSON.stringify({ seq: ++sequence, type: "request",
      command: "configurePlugin", arguments: { pluginName: "hson-schema-typescript-plugin", configuration: { sessionId: id, eventSources } } }) + "\n");
    await verify([2322]);
    configure([]); await verify([2322]);
    configure([record], "old-session"); await verify([2322]);
    configure([observed.eventEvidence]);
    await verify([2322, 95002]);
    configure([]); await verify([2322]);
    await send("reloadProjects", {}); await verify([2322]);
    console.log("ok - real tsserver requires workspace evidence at startup and follows supply and withdrawal");
  } finally {
    child.kill();
    await rm(directory, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

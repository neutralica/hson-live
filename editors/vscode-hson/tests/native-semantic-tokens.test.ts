import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  return { type: 'response', success: true, body: { protocol: NATIVE_SEMANTIC_PROTOCOL, ...request, revision: 'test:1', legend, data, ...changes } };
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
  assert.deepEqual(await read_native_tokens(long, NATIVE_REQUEST_LIMIT + 20, 'digest', 'request', read, () => false), { revision: 'test:1', tokens: [] });
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
    packet([], { ...item, revision: "test:" + ++count }), () => false), undefined, 'dependency/project changes invalidate an attempt');
  count = 0;
  assert.equal(await read_native_tokens(long, NATIVE_REQUEST_LIMIT + 20, 'digest', 'request', async item =>
    ++count === 1 ? packet([], item) : undefined, () => false), undefined, 'a provider becoming unavailable cannot publish the first chunk');
  console.log('ok - complete native stream validation, legend association, bounded requests and stale/unavailable reads');
  await serverProbe();
  await serverProbe("after");
  await serverProbe("before");
}

async function serverProbe(forwarder?: "before" | "after") {
  const directory = await mkdtemp(join(tmpdir(), 'hson-native-semantic-'));
  const file = join(directory, 'native.ts');
  const text = 'import { Hson, type Part } from "hson-live";\r\nclass Deck { readonly title = "😀"; render(){ return this.title; } }\r\nconst deck = new Deck();\r\nexport const parts = { card: Hson.document`<p hson:part data:blocks="%{blocks}" <hson-part at="^{block.kind}"/>/>`, renderCard() { let value = deck.title; return value; } };\r\nconst part: Part = { name: "card" };\r\nconst view = Hson.document`<p "^{local}">${deck.render()}/>`;';
  await writeFile(file, text);
  await writeFile(join(directory, 'hson.d.ts'), 'declare module "hson-live" { export interface Part { name: string; } export const Hson: { document(strings: TemplateStringsArray, ...values: unknown[]): string; }; }');
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true }, include: ['*.ts'] }));
  const require = createRequire(__filename);
  const sdk = process.env.HSON_TEST_HOST_TYPESCRIPT;
  const server = sdk === undefined ? require.resolve("typescript/lib/tsserver.js") : join(dirname(require.resolve(sdk)), "tsserver.js");
  const hson = "hson-schema-typescript-plugin", sibling = "hson-test-service-forwarder";
  const install = join(directory, "node_modules", hson), forwarding = join(directory, "node_modules", sibling);
  const trace = join(directory, "wrappers.jsonl");
  await mkdir(install, { recursive: true });
  await writeFile(trace, "");
  await writeFile(join(install, "package.json"), '{"main":"index.cjs"}');
  let bundle = await readFile(resolve(__dirname, "..", "node_modules", hson, "dist/index.cjs"), "utf8");
  for (const [anchor, probe] of [
    ["const service = create_schema_language_service(modules.typescript, info.languageService,", 'trace("install", info.project.getProjectName());'],
    ["proxy.getSemanticDiagnostics = (file) => {", 'trace("diagnostic", file);'],
    ["service.dispose = () => {", 'trace("dispose", info.project.getProjectName());'],
  ] as const) {
    assert.equal(bundle.split(anchor).length, 2, anchor);
    bundle = anchor.startsWith("const") ? bundle.replace(anchor, probe + anchor) : bundle.replace(anchor, anchor + probe);
  }
  await writeFile(join(install, "index.cjs"), 'const trace = (kind, file) => require("node:fs").appendFileSync('
    + JSON.stringify(trace) + ', JSON.stringify({ kind, file }) + "\\n");\n'
    + bundle);
  if (forwarder) {
    await mkdir(forwarding, { recursive: true });
    await writeFile(join(forwarding, "package.json"), '{"main":"index.cjs"}');
    await writeFile(join(forwarding, "index.cjs"), `
      module.exports = () => ({ create({ languageService }) {
        const proxy = Object.create(null);
        for (let object = languageService; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
          for (const name of Object.getOwnPropertyNames(object)) {
            if (name in proxy) continue;
            const value = languageService[name];
            proxy[name] = typeof value === "function" ? value.bind(languageService) : value;
          }
        }
        return proxy;
      } });
    `);
  }
  const traces = async (): Promise<{ kind: string; file: string }[]> =>
    (await readFile(trace, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
  const pluginOrder = forwarder === "before" ? [sibling, hson] : forwarder ? [hson, sibling] : [hson];
  const log = join(directory, "tsserver.log");
  const startServer = (log: string) => {
    const child = spawn(process.execPath, [server, '--globalPlugins', pluginOrder.join(","),
      '--pluginProbeLocations', directory, '--disableAutomaticTypingAcquisition', '--noGetErrOnBackgroundUpdate',
      '--logVerbosity', 'verbose', '--logFile', log],
      { stdio: ['pipe', 'pipe', 'pipe'] });
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
    return { send, close: () => child.kill() };
  };
  const firstServer = startServer(log);
  const { send } = firstServer;
  try {
    await send('updateOpen', { openFiles: [{ file, fileContent: text }] });
    const args = { file, start: 0, length: text.length, textHash: createHash('sha256').update(text).digest('hex'), requestId: 'real-server' };
    const response = await send(NATIVE_SEMANTIC_COMMAND, args);
    const tokens = decode_native_response(document(text), args, response);
    assert.ok(tokens, JSON.stringify(response));
    const probe = await send(NATIVE_SEMANTIC_COMMAND, { file, probe: true });
    assert.ok(isRecord(response) && isRecord(response.body));
    assert.ok(isRecord(probe) && isRecord(probe.body));
    assert.deepEqual(probe.body, { protocol: NATIVE_SEMANTIC_PROTOCOL, revision: response.body.revision });
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
    const configPath = join(project, "tsconfig.json");
    await writeFile(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", strict: true,
      types: [], paths: { "hson-live": [resolve("../../src/index.ts")] },
      plugins: forwarder ? undefined : [{ name: hson }] }, files: ["app.ts"] }));
    await send("updateOpen", { openFiles: [{ file: eventFile, fileContent: source }] });
    const verify = async () => {
      const before = (await traces()).length;
      const result = await send("semanticDiagnosticsSync", { file: eventFile });
      assert.ok(isRecord(result) && result.success && Array.isArray(result.body));
      assert.deepEqual(result.body.map(d => d.code).filter(code => code === 2322 || code === 95002), [2322, 95002]);
      assert.deepEqual((await traces()).slice(before).filter(row => row.kind === "diagnostic"),
        [{ kind: "diagnostic", file: eventFile }]);
    };
    await verify();
    for (let n = 0; n < 5; n++) {
      await send("reloadProjects", {});
      await verify();
    }
    for (const config of [join(directory, "tsconfig.json"), configPath]) {
      assert.equal((await traces()).filter(row => row.kind === "install" && row.file === config).length, 1, config);
    }
    const external = join(directory, "external.project");
    const externalFile = join(directory, "external.ts");
    await writeFile(externalFile, 'const keep: number = "external";');
    for (let lifetime = 1; lifetime <= 2; lifetime++) {
      const opened = await send("openExternalProject", { projectFileName: external, rootFiles: [{ fileName: externalFile }], options: { types: [] } });
      assert.ok(isRecord(opened) && opened.success);
      const before = (await traces()).length;
      const diagnostics = await send("semanticDiagnosticsSync", { file: externalFile });
      assert.ok(isRecord(diagnostics) && diagnostics.success && Array.isArray(diagnostics.body));
      assert.deepEqual(diagnostics.body.map(issue => issue.code), [2322]);
      const observed = await traces();
      assert.equal(observed.filter(row => row.kind === "install" && row.file === external).length, lifetime);
      assert.deepEqual(observed.slice(before).filter(row => row.kind === "diagnostic"), [{ kind: "diagnostic", file: externalFile }]);
      const closed = await send("closeExternalProject", { projectFileName: external });
      assert.ok(isRecord(closed) && closed.success);
      await verify();
    }
    console.log("ok - scoped diagnostics survive five reloads and external project disposal", forwarder ?? "none");
    if (forwarder) return;

    const lifecycle = join(directory, "file-lifecycle");
    const producer = join(lifecycle, "producer.ts"), consumer = join(lifecycle, "consumer.ts");
    const eventText = 'import { Hson } from "hson-live";\r\n'
      + 'export const go = Hson.event`<hson:event on:key:down local:go note:str="é🧪" v:str=^{missing} <> >`;\r\n'
      + 'Hson.event`<div/>`;';
    const consumerText = 'import { Hson, hsonLiveMap } from "hson-live";\n'
      + 'import { go } from "./producer.js";\n'
      + 'hsonLiveMap.fromLibraries({bits:{parts:{card:{kind:"document",document:Hson.document`<button hson:part event:go/>`,events:{go}}}}});';
    await mkdir(lifecycle);
    await writeFile(join(lifecycle, "package.json"), '{"type":"module"}');
    await writeFile(join(lifecycle, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", strict: true,
      types: [], paths: { "hson-live": [resolve("../../src/index.ts")] } }, files: ["consumer.ts"] }));
    const encoded = Buffer.from("\uFEFF" + eventText, "utf16le");
    await writeFile(producer, encoded);
    await writeFile(consumer, consumerText);
    await send("updateOpen", { openFiles: [{ file: consumer, fileContent: consumerText }] });
    let closedContextualRange: unknown;
    const verifySource = async (buffer: string | undefined, dirty: boolean, present: boolean) => {
      const discovery = await send(PROJECT_DISCOVERY_COMMAND, {
        roots: [lifecycle], openFiles: [[consumer, consumerText, false], ...buffer === undefined ? [] : [[producer, buffer, dirty]]],
      });
      assert.ok(isRecord(discovery) && isRecord(discovery.body) && Array.isArray(discovery.body.sources), JSON.stringify(discovery));
      assert.equal(discovery.body.sources.some(item => item.fileName === producer), present, "imported source inventory");
      const result = await send("semanticDiagnosticsSync", { file: consumer });
      assert.ok(isRecord(result) && result.success && Array.isArray(result.body));
      assert.equal(result.body.some(issue => issue.code === 2307), !present, "TypeScript resolution in the unchanged consumer");
      const definition = await send("definition", { file: consumer, line: 2, offset: 10 });
      assert.ok(isRecord(definition) && definition.success);
      assert.equal(Array.isArray(definition.body) && definition.body.some(item => item.file === producer), present);
      if (present) {
        const contextual = await send("semanticDiagnosticsSync", { file: producer });
        assert.ok(isRecord(contextual) && contextual.success && Array.isArray(contextual.body));
        const issue = contextual.body.find(issue => issue.code === 95002 && issue.text.includes('local declaration "missing"'));
        assert.ok(issue, "the current Program proves the attachment");
        if (issue !== undefined) {
          const range = [issue.start, issue.end];
          if (buffer === undefined) closedContextualRange = range;
          else if (buffer === eventText) assert.deepEqual(range, closedContextualRange, "closed and open Event contextual coordinates agree");
        }
      }
    };
    await verifySource(undefined, false, true);
    await send("updateOpen", { openFiles: [{ file: producer, fileContent: eventText }] });
    await verifySource(eventText, false, true);
    await rm(producer);
    await verifySource(eventText, false, false);
    const editorRequest = await send("getApplicableRefactors", { file: producer, line: 2, offset: 15 });
    assert.ok(isRecord(editorRequest) && editorRequest.success, JSON.stringify(editorRequest));
    await writeFile(producer, encoded);
    await verifySource(eventText, false, true);
    // A dirty open source is an input to the current Program.
    await rm(producer);
    const dirty = "// unsaved\n" + eventText;
    await send("updateOpen", { changedFiles: [{ fileName: producer, textChanges: [{
      start: { line: 1, offset: 1 }, end: { line: 1, offset: 1 }, newText: "// unsaved\n",
    }] }] });
    await verifySource(dirty, true, true);
    await writeFile(producer, Buffer.from("\uFEFF" + dirty, "utf16le"));
    await verifySource(dirty, false, true);
    await verify();
    console.log("ok - real tsserver drops deleted clean sources and restores resolution and contextual diagnostics");
  } finally {
    firstServer.close();
    await rm(directory, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

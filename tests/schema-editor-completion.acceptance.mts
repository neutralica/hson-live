import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TrustedSchemaClient } from "../editors/vscode-hson/src/trusted-schema-client.ts";
import { cases, caseFile } from "./fixtures/schema-d3-cases.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
let checks = 0;
const check = async (name: string, f: () => unknown) => { await f(); console.log(`ok ${++checks} - ${name}`); };
const options = { moduleUrl: new URL('./fixtures/schema-d6-schemas.fixture.mts', import.meta.url).href,
  hsonModuleUrl: new URL('../src/hson.ts', import.meta.url).href, runtimeEntry: fileURLToPath(new URL('../src/internal/trusted-schema-diagnostics/node-runtime-entry.ts', import.meta.url)),
  execArgv: ['--loader', 'ts-node/esm'], startupDeadlineMs: 10_000 };
const fileName = fileURLToPath(new URL('./fixtures/d6-author.ts', import.meta.url));
const doc = (text: string, version = 1) => ({ text, version, fileName, uri: pathToFileURL(fileName).href, languageId: 'typescript' });
const authored = (body: string, schema = 'UserSchema') => `import { Hson } from "hson-live/hson"; import { ${schema} } from "./schema-d6-schemas.fixture.mts"; const value=1; const source=Hson\`${body}\`; Hson.validate(${schema},source);`;
const client = new TrustedSchemaClient({ ...options, trust: { workspaceTrusted: true, enabled: true } });
const complete = (marked: string, version = 1) => client.complete(doc(marked.replace('|', ''), version), marked.indexOf('|'), () => true);
const labels = async (marked: string) => (await complete(marked)).completion?.items.map(i => i.label) ?? [];
try {
  await check('completion alone never starts project', async () => { assert.equal((await complete(authored('< |>'))).status, 'waiting'); assert.equal(client.supervisor.generation, 0); });
  await client.validate(doc(authored('<>')), () => true);
  await check('D2 manual member request', async () => assert.deepEqual(await labels(authored('< |>')), ['name', 'role', 'enabled']));
  await check('finite literal request', async () => assert.deepEqual(await labels(authored('<role |>')), ['"user"', '"admin"']));
  await check('snippet insertion text', async () => assert.equal((await complete(authored('< |>'))).completion?.items.find(i => i.label === 'name')?.insertText, 'name ${1}'));
  await check('required ordering', async () => { const items = (await complete(authored('< |>'))).completion!.items; assert.ok(items.find(i => i.label === 'name')!.sortText < items.find(i => i.label === 'enabled')!.sortText); });
  await check('source edit changes filtering', async () => assert.deepEqual(await labels(authored('<name "A" |>')), ['role', 'enabled']));
  await check('incomplete recoverable source', async () => assert.deepEqual(await labels(authored('<enabled |>')), ['true', 'false']));
  await check('document attribute and flag', async () => assert.deepEqual(await labels(authored('<div |/>', 'DocumentSchema')), ['hidden', 'id', 'button']));
  await check('document child tag', async () => assert.deepEqual(await labels(authored('<div < |/>/>', 'DocumentSchema')), ['button']));
  await check('expression exclusion', async () => assert.deepEqual(await labels(authored('<enabled ${val|ue}>')), []));
  await check('unrelated expression exclusion', async () => assert.deepEqual(await labels(authored('<>').replace('value=1', 'value=|1')), []));
  await check('fromHson strings deliberately excluded', async () => { const text = authored('< |>').replace('Hson`< |>`', 'hson.liveMap.fromHson("< |>")'); assert.deepEqual(await labels(text), []); });
  await check('two independent contracts are ambiguous', async () => assert.equal((await complete(authored('< |>') + ' Hson.validate(UserSchema,source);')).status, 'ambiguous'));
  await check('cancellation before request', async () => assert.equal((await client.complete(doc(authored('<>')), 0, () => false)).status, 'stale'));
  await check('superseded request never publishes', async () => { const marked = authored('< |>'); const document = doc(marked.replace('|', '')); const a = client.complete(document, marked.indexOf('|'), () => true); const b = client.complete(document, marked.indexOf('|'), () => true); assert.equal((await a).status, 'stale'); assert.ok((await b).completion?.items.length); });
  await check('source cancellation during IPC', async () => { let current = true; const marked = authored('< |>'); const pending = client.complete(doc(marked.replace('|', '')), marked.indexOf('|'), () => current); current = false; assert.equal((await pending).status, 'stale'); });
  await check('interpolation-independent literal segment needs no runtime substitution', async () => assert.deepEqual(await labels(authored('<name ${value} |>')), ['role', 'enabled']));
  await check('document attr hole independent of header completion', async () => assert.deepEqual(await labels(authored('<div id=${value} |/>','DocumentSchema')), ['hidden','button']));
  await check('unknown discriminator never selects a branch', async () => assert.deepEqual(await labels(authored('<kind ${value} |>', 'TaggedSchema')), []));
  await check('unknown discriminator allows finite discriminator-slot alternatives only on literal slots', async () => assert.deepEqual(await labels(authored('<alpha ${value} kind |>', 'TaggedSchema')), ['"a"', '"b"']));
  await check('trust/enablement closed means no process', async () => { for (const [workspaceTrusted, enabled] of [[false,true],[true,false]]) { const c = new TrustedSchemaClient({ ...options, trust: { workspaceTrusted: workspaceTrusted!, enabled: enabled! } }); assert.equal((await c.complete(doc(authored('<>')), 0, () => true)).status, 'off'); assert.equal(c.supervisor.generation, 0); c.dispose(); } });
  await check('generation retirement discards in-flight completion without restart', async () => { const marked = authored('< |>'); const pending = client.complete(doc(marked.replace('|', '')), marked.indexOf('|'), () => true); client.invalidate(); assert.equal((await pending).status, 'stale'); assert.equal((await complete(marked)).status, 'waiting'); assert.equal(client.supervisor.generation, 1); });
} finally { client.dispose(); }
const d3 = new TrustedSchemaClient({ ...options, moduleUrl: new URL('./fixtures/schema-d3-runtime.fixture.mts', import.meta.url).href, trust: { workspaceTrusted: true, enabled: true } });
try {
  const document = (name: string, text = cases[name]!) => ({ ...doc(text), fileName: caseFile(name), uri: pathToFileURL(caseFile(name)).href });
  await d3.validate(document('direct'), () => true);
  await check('natural D3 map.schema.use supplies member completion', async () => { const text = cases.direct!.replace('<age "37">', '< >'); const result = await d3.complete(document('direct',text), text.indexOf('< >') + 2, () => true); assert.deepEqual(result.completion?.items.map(i => i.label), ['age']); });
  await check('D3 mutated relationship unavailable', async () => { const text = cases.mutated!.replace('<age "37">', '< >'); assert.equal((await d3.complete(document('mutated',text), text.indexOf('< >') + 2, () => true)).completion, undefined); });
  await check('D4 proven static lifecycle still has no completion',async()=> { const text=cases.staticDirect!; assert.equal((await d3.complete(document('staticDirect',text),text.indexOf('<age')+5,()=>true)).completion,undefined); });
  await check('D3 two-map ambiguity', async () => { const text = cases.two!.replace('<age "37">', '< >'); assert.equal((await d3.complete(document('two',text), text.indexOf('< >') + 2, () => true)).status, 'ambiguous'); });
} finally { d3.dispose(); }
// Importing the fixture here obtains the same source descriptors used by its
// separately supervised runtime; no runtime Schema object crosses IPC.
const { cases: interpolatedCases, caseFile: interpolatedFile } = await import('./fixtures/schema-d6-runtime.fixture.mts');
const d5 = new TrustedSchemaClient({ ...options, moduleUrl:new URL('./fixtures/schema-d6-runtime.fixture.mts',import.meta.url).href, trust:{workspaceTrusted:true,enabled:true} });
try {
  const document = (name: keyof typeof interpolatedCases, text=interpolatedCases[name], version=1) => ({ ...doc(text,version), fileName:interpolatedFile(name), uri:pathToFileURL(interpolatedFile(name)).href });
  await d5.validate(document('fresh'),()=>true);
  await check('fresh D5 discriminator selects actual branch',async()=> { const d=document('fresh'); assert.deepEqual((await d5.complete(d,d.text.indexOf(' >')+1,()=>true)).completion?.items.map(i=>i.label),['alpha']); });
  await check('stale D5 value cannot select old branch',async()=> { const d=document('fresh',interpolatedCases.fresh.replace(' >','  >'),2); d5.invalidateDocument(d); assert.deepEqual((await d5.complete(d,d.text.indexOf('  >')+1,()=>true)).completion?.items,[]); });
  await check('multiple current D5 evaluations are ambiguous',async()=> { const d=document('repeated'); assert.equal((await d5.complete(d,d.text.indexOf(' >')+1,()=>true)).status,'ambiguous'); });
} finally { d5.dispose(); }
emit_hson_live_test_completion('schema-editor-completion', checks, checks, 0);

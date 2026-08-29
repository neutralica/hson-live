import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { TrustedSchemaClient } from "../editors/vscode-hson/src/trusted-schema-client.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
const fileName = fileURLToPath(new URL('./fixtures/d6-benchmark.ts', import.meta.url));
const doc = (schema: string, body: string) => ({ fileName, uri: pathToFileURL(fileName).href, version: 1, languageId: 'typescript',
  text: `import { Hson } from "hson-live/hson"; import { ${schema} } from "./schema-d6-schemas.fixture.mts"; const source=Hson\`${body}\`; Hson.validate(${schema},source);` });
const client = new TrustedSchemaClient({ trust: { workspaceTrusted: true, enabled: true }, moduleUrl: new URL('./fixtures/schema-d6-schemas.fixture.mts', import.meta.url).href,
  hsonModuleUrl: new URL('../src/hson.ts', import.meta.url).href, runtimeEntry: fileURLToPath(new URL('../src/internal/trusted-schema-diagnostics/node-runtime-entry.ts', import.meta.url)),
  execArgv: ['--loader','ts-node/esm'], startupDeadlineMs: 10_000 });
let checks = 0;
const p50 = (values: number[]) => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]!;
try {
  await client.validate(doc('UserSchema','<>'),()=>true);
  const cases = [
    ['projected', 'UserSchema', '< |>'], ['literal', 'UserSchema', '<role |>'],
    ['attrs', 'DocumentSchema', '<div |/>'], ['child', 'DocumentSchema', '<div < |/>/>'],
    ['recurse', 'RecursiveSchema', '<child <child < |>>>'],
    ['larger', 'LargeSchema', '<' + Array.from({length:180},(_,i)=>`field${i} "value ${i}"`).join(' ') + ' |>'],
  ];
  for (const [name,schema,marked] of cases) {
    const document = doc(schema!,marked!.replace('|',''));
    const offset = document.text.indexOf('Hson`')+5+marked!.indexOf('|');
    const samples: Record<string,number>[] = [];
    for (let i=0;i<12;i++) {
      const requestStarted = performance.now();
      const result = await client.complete(document,offset,()=>true);
      const requestMs = performance.now()-requestStarted;
      assert.ok(result.completion?.items.length, `${name}: ${JSON.stringify(result)}`);
      const ipcStart = performance.now(); await client.supervisor.request({type:'ping'}); const ipcMs=performance.now()-ipcStart;
      const { measurement, completion } = result;
      samples.push({ ...measurement!, ...completion.timings!, ipcMs, requestMs });
    }
    const keys = Object.keys(samples[0]!);
    console.log('# D6 warmed p50 ms '+JSON.stringify({name, bytes:document.text.length, ...Object.fromEntries(keys.map(key=>[key,p50(samples.slice(2).map(s=>s[key]!))])), maxEndToEndMs: Math.max(...samples.map(s=>s.endToEndMs!))}));
    if (samples.some(s=>s.endToEndMs!>=1000)) console.log('# WARNING: warmed completion approached seconds');
    console.log(`ok ${++checks} - warmed ${name} completion and separate stage timings`);
  }
} finally { client.dispose(); }
emit_hson_live_test_completion('schema-completion-performance',checks,checks,0);

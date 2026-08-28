import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { discover_static_from_hson_sources } from "../src/internal/embedded-hson/discover-static-from-hson-sources.ts";
import { map_static_hson_point } from "../src/internal/embedded-hson/static-hson-source.ts";
import { produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.ts";
import { TrustedSchemaClient, type D2Measurement } from "../editors/vscode-hson/src/trusted-schema-client.ts";
import { cases, caseFile } from "./fixtures/schema-d3-cases.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const source = 'import { hsonLiveMap } from "hson-live/livemap";\n' + Array.from({length:40},(_,i)=>`hsonLiveMap.fromHson("<item value=\\x22${i}\\x22/>");`).join('\n');
const sample = (run: () => void) => { for(let i=0;i<3;i++) run(); const values:number[]=[]; for(let i=0;i<12;i++){const start=performance.now();run();values.push(performance.now()-start);} return values.sort((a,b)=>a-b)[6]!; };
const discoveryMs = sample(()=>{ assert.equal(discover_static_from_hson_sources('/project/perf.ts',source).sources.length,40); });
const discovered = discover_static_from_hson_sources('/project/perf.ts',source).sources;
const mappingMs = sample(()=>{ for(const item of discovered) assert.ok(map_static_hson_point(item,0)); });
const parseMs = sample(()=>{ for(const item of discovered) parse_hson(item.runtimeText,{allowTopLevelTextFragment:true}); });
const endToEndMs = sample(()=>{ assert.deepEqual(produce_document_diagnostics({languageId:'typescript',fileName:'/project/perf.ts',text:source}),[]); });
for(const [name,value] of Object.entries({discoveryMs,mappingMs,parseMs,endToEndMs})) { assert.ok(value<2_000); console.log(`ok ${++checks} - warmed ${name} ${value.toFixed(3)}ms for 40 static sources`); }
console.log('# D4 p50 milliseconds '+JSON.stringify({sources:40,discoveryMs,mappingMs,parseMs,endToEndMs,debounceMs:150,perceivedMs:endToEndMs+150}));

const moduleUrl = new URL('./fixtures/schema-d3-runtime.fixture.mts',import.meta.url).href;
const hsonModuleUrl = new URL('../src/hson.ts',import.meta.url).href;
const runtimeEntry = fileURLToPath(new URL('../src/internal/trusted-schema-diagnostics/node-runtime-entry.ts',import.meta.url));
const client = new TrustedSchemaClient({trust:{workspaceTrusted:true,enabled:true},moduleUrl,hsonModuleUrl,runtimeEntry,execArgv:['--loader','ts-node/esm'],startupDeadlineMs:5_000});
try {
  const document=(version:number)=>({fileName:caseFile('staticDirect'),uri:pathToFileURL(caseFile('staticDirect')).href,languageId:'typescript',version,text:cases.staticDirect!});
  await client.validate(document(1),()=>true);
  const measurements:D2Measurement[]=[];
  for(let version=2;version<11;version++){const result=await client.validate(document(version),()=>true);assert.equal(result.status,'current-invalid');measurements.push(result.measurement!);}
  const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]!;
  const trusted={discoveryMs:median(measurements.map(value=>value.discoveryMs)),lifecycleMs:median(measurements.map(value=>value.lifecycleMs!)),roundTripMs:median(measurements.map(value=>value.roundTripMs)),endToEndMs:median(measurements.map(value=>value.endToEndMs))};
  for(const [name,value] of Object.entries(trusted)){assert.ok(value<2_000);console.log(`ok ${++checks} - warmed trusted static ${name} ${value.toFixed(3)}ms`);}
  console.log('# D4 trusted p50 milliseconds '+JSON.stringify(trusted));
} finally { client.dispose(); }
emit_hson_live_test_completion('schema-d4-performance',checks,checks,0);

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath,pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { Hson } from "../src/hson-authoring.ts";
import { capture_interpolation,reset_interpolation_captures,read_interpolation_captures } from "../src/internal/trusted-schema-diagnostics/interpolation-capture.ts";
import { interpolation_site,map_interpolation_range } from "../src/internal/trusted-schema-diagnostics/interpolation-source.ts";
import { discover_hson_tagged_templates } from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { instrument_trusted_schema_map_sources } from "../src/internal/trusted-schema-diagnostics/instrument-map-sources.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { TrustedSchemaClient,type D2Measurement } from "../editors/vscode-hson/src/trusted-schema-client.ts";
import { cases,caseFile } from "./fixtures/schema-d5-cases.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
const {build}=createRequire(new URL('../editors/vscode-hson/package.json',import.meta.url))('esbuild');
const original=execFileSync('git',['show','HEAD:src/api/transform/hson-admission.ts'],{encoding:'utf8'});
const compile=async(contents:string)=>{
  const result=await build({stdin:{contents,resolveDir:fileURLToPath(new URL('../src/api/transform',import.meta.url)),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',minify:true});
  return (await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))).admit_hson as typeof Hson;
};
const before=await compile(original);
const after=await compile('export { admit_hson } from "./hson-admission.ts";');
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]!;
const sample=(run:()=>unknown,iterations=1000)=>{const results:number[]=[];for(let batch=0;batch<15;batch++){const start=performance.now();for(let i=0;i<iterations;i++)run();if(batch>3)results.push((performance.now()-start)/iterations);}return median(results);};
const text='import { Hson } from "hson-live/hson"; Hson`<user <age ${value}>>`;';
const site=interpolation_site(discover_hson_tagged_templates('/project/perf.ts',text).interpolated[0]!,'file:///project/perf.ts');
const traced=(strings:TemplateStringsArray,...values:readonly (string|number|boolean|null)[])=>capture_interpolation(site,Hson,strings,values).canonical;
const tagMsBefore=sample(()=>before`<user <age ${'37'}>>`);
const tagMsAfter=sample(()=>after`<user <age ${'37'}>>`);
const ordinaryMs=sample(()=>Hson`<user <age ${'37'}>>`);
const tracedMs=sample(()=>{reset_interpolation_captures();return traced`<user <age ${'37'}>>`;});
const capture=read_interpolation_captures()[0]!;
const traceSamples:number[]=[];
for(let i=0;i<200;i++){reset_interpolation_captures();traced`<user <age ${'37'}>>`;traceSamples.push(read_interpolation_captures()[0]!.timings.traceMs);}
const instrumentationMs=sample(()=>instrument_trusted_schema_map_sources(caseFile('direct'),cases.direct!,'file:///helper.js'),1);
const provenanceMs=sample(()=>parse_hson_with_provenance(capture.source));
const mappingMs=sample(()=>map_interpolation_range(site,capture.segments,{precision:'exact',start:11,end:15}),1000);
const options={moduleUrl:new URL('./fixtures/schema-d5-runtime.fixture.mts',import.meta.url).href,hsonModuleUrl:new URL('../src/hson.ts',import.meta.url).href,
  runtimeEntry:fileURLToPath(new URL('../src/internal/trusted-schema-diagnostics/node-runtime-entry.ts',import.meta.url)),execArgv:['--loader','ts-node/esm'],startupDeadlineMs:10_000,trust:{workspaceTrusted:true,enabled:true}};
const client=new TrustedSchemaClient(options);
const doc={fileName:caseFile('direct'),uri:pathToFileURL(caseFile('direct')).href,languageId:'typescript',version:1,text:cases.direct!};
let coldMs=0,reloadMs=0; const measurements:D2Measurement[]=[]; const documentMeasurements:D2Measurement[]=[]; const ipc:number[]=[];
try{
  const cold=await client.validate(doc,()=>true);assert.equal(cold.status,'current-invalid',cold.message);coldMs=cold.measurement!.endToEndMs;
  for(let i=0;i<15;i++){const r=await client.validate(doc,()=>true);assert.equal(r.status,'current-invalid');measurements.push(r.measurement!);const start=performance.now();await client.supervisor.request({type:'ping'});ipc.push(performance.now()-start);}
  const documentCase={...doc,fileName:caseFile('document'),uri:pathToFileURL(caseFile('document')).href,text:cases.document!};
  for(let i=0;i<10;i++){const r=await client.validate(documentCase,()=>true);assert.equal(r.status,'current-invalid');documentMeasurements.push(r.measurement!);}
  client.invalidate();const reloaded=await client.validate(doc,()=>true);assert.equal(reloaded.status,'current-invalid');reloadMs=reloaded.measurement!.endToEndMs;
}finally{client.dispose();}
const timings={tagMsBefore,tagMsAfter,productionRatio:tagMsAfter/tagMsBefore,ordinaryMs,tracedMs,traceCompositionMs:median(traceSamples),instrumentationMs,provenanceMs,mappingMs,
  schemaMs:median(measurements.map(m=>m.stages[0]!.validateMs)),lowerAndMapMs:median(measurements.map(m=>m.stages[0]!.lowerMs)),ipcMs:median(ipc),roundTripMs:median(measurements.map(m=>m.roundTripMs)),
  documentSchemaMs:median(documentMeasurements.map(m=>m.stages[0]!.validateMs)),documentLowerAndMapMs:median(documentMeasurements.map(m=>m.stages[0]!.lowerMs)),documentEndToEndMs:median(documentMeasurements.map(m=>m.endToEndMs)),
  warmedEndToEndMs:median(measurements.map(m=>m.endToEndMs)),coldMs,reloadMs};
let checks=0;
for(const [name,value] of Object.entries(timings)){assert.ok(Number.isFinite(value));if(!['coldMs','reloadMs','productionRatio'].includes(name))assert.ok(value<2_000);console.log(`ok ${++checks} - ${name}: ${value.toFixed(6)}`);}
console.log('# D5 p50 milliseconds '+JSON.stringify(timings));
emit_hson_live_test_completion('schema-d5-performance',checks,checks,0);

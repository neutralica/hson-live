// Focused architectural measurement, deliberately separate from the ordinary gate.
// Instrument a temporary bundle; production code has no counters or cache state.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import assert from "node:assert/strict";

const directory = await mkdtemp(join(tmpdir(), "hson-part-measure-"));
const baseline = process.argv.includes('--baseline');
const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const changed = new Set(execFileSync('git',['diff','--name-only','--','src'],{encoding:'utf8'}).trim().split('\n'));
const entry = `
import { hsonLiveMap } from './src/api/livemap/index.ts';
import { internal_livemap_aggregate_authority as owner } from './src/api/livemap/livemap.internal.ts';
import { performance } from 'node:perf_hooks';
globalThis.partCounts = { catalogs: 0, members: 0 };
export async function run(runtime) {
  const results = [];
  for (const size of [10, 100]) for (const css of [false, true]) {
    const paragraph = '<p title="%{title}" "A fixed paragraph with a receiving title and repeated immutable body text."/>';
    const parts = Object.fromEntries(Array.from({length: size}, (_, i) => ['p' + i, {
      kind: 'document', document: '<article hson:part @:root ' + paragraph.repeat(40)
        + (i < 3 ? '<hson-part lib="parts" at="p' + (i + 1) + '" title="Nested"/>' : '') + '/>',
      ...(css ? {css: {'@:root': {color:'red',display:'block'}}, stylesheet:'p{margin:0}'} : {})
    }]));
    const definition = {kind:'document', document:'<b hson:part "Added"/>'};
    const make = (withPage = false) => hsonLiveMap.fromLibraries({parts:{parts},...(withPage?{page:{document:'<main/>'}}:{})});
    for (const operation of ['admission','observations','fresh-write','retained-write','addition','composition','locus-setter']) {
      const timings = [], counts = [];
      for (let sample = -1; sample < 3; sample++) {
        const map = operation === 'admission' || operation === 'locus-setter' ? undefined : make(operation === 'composition');
        const loc = operation === 'locus-setter' ? hsonLiveMap.locus.create({parts:{parts}}) : undefined;
        const retained = operation === 'retained-write' ? map.parts.parts.p3 : undefined;
        globalThis.partCounts = {catalogs:0, members:0};
        const start = performance.now();
        if (operation === 'admission') make();
        else if (operation === 'observations') {
          map.parts.parts.p3.snap(); map.parts.parts.p3.kind(); map.parts.parts.root(); map.capture(); map.rev;
        }
        else if (operation === 'fresh-write') map.parts.parts.p3.write({title:'Title'});
        else if (operation === 'retained-write') retained.write({title:'Title'});
        else if (operation === 'addition') map.parts.parts.at([]).object.setKey('added',definition);
        else if (operation === 'composition') {
          const authority = owner(map), page = authority.libraries()[1];
          authority.commit([{target:authority.target(page,[]),kind:'graph',operation:{domain:'graph',op:'insert-content',
            target:{kind:'path',path:[0,0,1,0]},index:1,
            content:{$_tag:'hson-part',$_attrs:{lib:'parts',at:'p0',title:'Title'},$_content:[]}}}]);
        }
        else await loc.parts.parts.at([]).object.setKey('added',definition);
        const elapsed = performance.now() - start;
        if (sample >= 0) { timings.push(elapsed); counts.push({...globalThis.partCounts}); }
        loc?.dispose();
      }
      timings.sort((a,b)=>a-b);
      results.push({runtime,size,css,operation,medianMs:+timings[1].toFixed(3),minMs:+timings[0].toFixed(3),maxMs:+timings[2].toFixed(3),counts});
    }
  }
  return results;
}`;
try {
  const bundle = join(directory, "measure.mjs");
  await build({ stdin: {contents:entry,resolveDir:resolve('.'),sourcefile:'part-measure.ts',loader:'ts'},
    outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',
    plugins:[{name:'part-validation-counts',setup(build) {
      build.onLoad({filter:/\.ts$/},async args => {
        const path = relative(resolve('.'),args.path);
        const historical = baseline && changed.has(path);
        const instrument = /livemap\.parts\.ts$/.test(args.path);
        if (!historical && !instrument) return;
        let contents = historical ? execFileSync('git',['show','HEAD:'+path],{encoding:'utf8'}) : await readFile(args.path,'utf8');
        if (!instrument) return {contents,loader:'ts'};
        contents = contents.replace(/(export function validate_part_collection\([^\n]+\{)/,
          '$1 globalThis.partCounts.catalogs++;');
        contents = contents.replace('assert_hson_identifier_name(key, "Part");',
          'globalThis.partCounts.members++; assert_hson_identifier_name(key, "Part");');
        return {contents,loader:'ts'};
      });
    }}]});
  // External dependencies resolve from the repository, including in a real Worker.
  const { symlink } = await import('node:fs/promises');
  await symlink(resolve('node_modules'), join(directory,'node_modules'),'dir');
  const nodeResults = await (await import(pathToFileURL(bundle).href)).run('node');
  const workerEntry = join(directory,'worker.mjs');
  await writeFile(workerEntry, `import {parentPort} from 'node:worker_threads'; import {run} from './measure.mjs'; parentPort.postMessage(await run('worker'));`);
  const worker = new Worker(pathToFileURL(workerEntry));
  const workerResults = await new Promise((resolve,reject) => {
    worker.once('message',resolve); worker.once('error',reject);
    worker.once('exit',code=>{if(code!==0) reject(Error('Worker exit '+code));});
  });
  await worker.terminate();
  const results = [...nodeResults,...workerResults];
  if (process.argv.includes('--assert-targets')) for (const result of results) {
    for (const count of result.counts) {
      assert.equal(count.catalogs,result.operation==='admission'?1:0,JSON.stringify(result));
      if (result.operation==='addition' || result.operation==='locus-setter') assert.equal(count.members,1,JSON.stringify(result));
    }
  }
  console.log(JSON.stringify({node:process.version,revision,baseline,samples:3,paragraphsPerDefinition:40,results},null,2));
} finally { await rm(directory,{recursive:true,force:true}); }

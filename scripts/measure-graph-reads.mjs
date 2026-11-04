// Focused Boundary A reads; no mutation or repository gate work is timed.
// Run committed/current separately with: node --expose-gc scripts/measure-graph-reads.mjs [--baseline]
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { Session } from "node:inspector";
import { promisify } from "node:util";
import { execFileSync } from "node:child_process";
const baseline = process.argv.includes("--baseline");
const directory = await mkdtemp(join(tmpdir(), "hson-graph-reads-"));
try {
  const output = join(directory, "measure.mjs");
  await build({ stdin: { contents: `
    import { hsonLiveMap } from './src/api/livemap/index.ts';
    import { project_live_path } from './src/api/livemap/livemap.editor.ts';
    import { materialize_projected_value } from './src/core/projected-value-materialization.ts';
    export function fixture(size) {
      const rows = Array.from({length:size}, (_,i)=>({id:i,score:i+.5,detail:{label:'row-'+i,flags:[true,false,null]},tags:['a','b']}));
      const map = hsonLiveMap.fromLibraries({state:{data:{rows,catalog:Object.fromEntries(rows.map((r,i)=>['r'+i,r]))}}});
      const library = map.data.must('state'), index = Math.floor(size/2);
      const row = library.at(['rows',index]), scalar = library.at(['rows',index,'score']);
      const object = library.at(['catalog']).asObject(), array = library.at(['rows']).asArray();
      const root = library.root();
      return {
        scalar:()=>scalar.snap(), subtree:()=>row.snap(), kind:()=>library.at(['catalog']).kind(),
        keys:()=>object.object.keys(), presence:()=>object.object.hasKey('r'+index),
        length:()=>array.array.length(), indexed:()=>array.array.at(index),
        snap:()=>library.snap(), hson:()=>row.hson(),
        graphOrderedSnap:()=>materialize_projected_value(project_live_path(root,[])),
      };
    }
  `, resolveDir: process.cwd(), loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', target:'node22',
    plugins: baseline ? [{name:'committed-source',setup(builder) {
      builder.onLoad({filter:/\/src\/.*\.ts$/}, args => ({
        contents:execFileSync('git',['show','HEAD:'+relative(process.cwd(),args.path)],{encoding:'utf8'}),loader:'ts',
      }));
    }}] : [] });
  const {fixture} = await import(pathToFileURL(output).href);
  const session = new Session(); session.connect();
  const post = promisify(session.post.bind(session));
  await post('HeapProfiler.enable');
  const results = [];
  let sink;
  for (const size of [64,512,2048]) {
    const reads = fixture(size);
    for (const [operation, read] of Object.entries(reads)) {
      const iterations = operation === 'snap' || operation === 'graphOrderedSnap' ? Math.max(8,Math.floor(8192/size)) : operation === 'keys' ? 300 : 1500;
      for(let i=0;i<Math.min(iterations,300);i++) sink=read();
      const samples=[];
      for(let sample=0;sample<7;sample++) {
        globalThis.gc?.();
        const start=performance.now();
        for(let i=0;i<iterations;i++) sink=read();
        samples.push((performance.now()-start)*1000/iterations);
      }
      samples.sort((a,b)=>a-b);
      globalThis.gc?.();
      await post('HeapProfiler.startSampling',{samplingInterval:16384,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
      for(let i=0;i<iterations;i++) sink=read();
      const {profile}=await post('HeapProfiler.stopSampling');
      const bytes = node=>node.selfSize+node.children.reduce((n,c)=>n+bytes(c),0);
      results.push({size,operation,iterations,minUs:samples[0],medianUs:samples[3],maxUs:samples[6],sampledBytesPerRead:bytes(profile.head)/iterations});
    }
  }
  session.disconnect();
  process.stdout.write(JSON.stringify({mode:baseline?'committed':'working-tree',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,samples:7,allocation:'V8 statistical allocation sampling, includes collected objects; estimates, not exact counts',results},null,2)+'\n');
} finally { await rm(directory,{recursive:true,force:true}); }

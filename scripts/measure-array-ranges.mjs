// Focused read comparison; all generated code is temporary, outside the checkout.
// node --expose-gc scripts/measure-array-ranges.mjs [--baseline | --source-dir=/path/to/snapshot]
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline=process.argv.includes('--baseline');
const snapshot=process.argv.find(arg=>arg.startsWith('--source-dir='))?.slice(13);
const directory=await mkdtemp(join(tmpdir(),'hson-range-'));
try {
 const outfile=join(directory,'api.mjs');
 await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`export {hsonLiveMap} from './src/api/livemap/index.ts';`},outfile,bundle:true,format:'esm',platform:'node',target:'node22',logLevel:'silent',plugins:baseline||snapshot?[{name:'selected-source',setup(b){b.onLoad({filter:/\/src\/.*\.ts$/},async a=>({contents:baseline?execFileSync('git',['show','166cb26b54f9dffa565f8d76da9e2ee213223902:'+relative(process.cwd(),a.path)],{encoding:'utf8'}):await readFile(join(snapshot,relative(process.cwd(),a.path)),'utf8'),loader:'ts'}));}}]:[]});
 const {hsonLiveMap}=await import(pathToFileURL(outfile));
 const scenarios=[['short-small',8,0,0,0,2],['large',4096,0,0,0,4096],['deep',512,0,12,0,512],['wide-original',512,2048,0,0,512],['empty',0,0,0,0,0],['negative-boundary',512,64,2,-32,1024],['outside',512,64,0,999,1000]];
 const results=[];let sink;
 for(const [name,size,width,depth,start,end] of scenarios){
  const values=Array.from({length:size},(_,i)=>({n:i,zero:-0}));let data=values,path=[];
  for(let d=0;d<depth;d++){data={nested:data};path.unshift('nested');}
  data=Object.fromEntries([...Array.from({length:width},(_,i)=>['p'+i,i]),['selected',data]]);path.unshift('selected');
  const library=hsonLiveMap.fromLibraries({state:{data}}).data.must('state');const api=library.at(path).asArray().array;
  const read=()=>api.slice(start,end);assert.deepEqual(read(),values.slice(start,end));
  for(let i=0;i<20;i++)sink=read();const samples=[];
  for(let b=0;b<7;b++){globalThis.gc?.();const t=performance.now();for(let i=0;i<15;i++)sink=read();samples.push((performance.now()-t)*1000/15);}
  samples.sort((a,b)=>a-b);results.push({name,size,width,depth,start,end,minUs:samples[0],medianUs:samples[3],maxUs:samples[6]});
 }
 process.stdout.write(JSON.stringify({mode:baseline?'R1':snapshot?'pre-correction':'corrected',node:process.version,samples:7,iterations:15,results},null,2)+'\n');
} finally {await rm(directory,{recursive:true,force:true});}

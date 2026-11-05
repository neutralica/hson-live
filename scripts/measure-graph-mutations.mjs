// Boundary B comparison. Bundles committed HEAD or current source into a temporary directory.
// Run separately: node --expose-gc scripts/measure-graph-mutations.mjs [--baseline]
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';
const baseline = process.argv.includes('--baseline');
const memoryOnly = process.argv.includes('--memory-only');
const allocationsOnly = process.argv.includes('--allocations-only');
const investigationOnly = process.argv.includes('--investigation-only');
const directory = await mkdtemp(join(tmpdir(), 'hson-graph-mutations-'));
const source = `
import { Hson, hsonLiveMap, enable_interactions, add_interaction, replace_interaction } from './src/index.ts';
import { internal_livemap_aggregate_authority } from './src/api/livemap/livemap.internal.ts';
import { create_locus_hosted_aggregate_internal } from './src/api/locus/locus.aggregate.ts';
import { compose_client_portable_aggregate_internal } from './src/api/echo/echo.projection.ts';
import { create_echo_aggregate_replica_capability_internal } from './src/api/echo/echo.aggregate-replica.lifecycle.ts';
import { make_portable_aggregate_snapshot, make_portable_aggregate_commit } from './src/api/livemap/livemap.hosted.ts';
const schema = Hson.schema\`<type "data" content <rows <array "number">>>\`;
export function fixture(size, operation) {
  const rows = Array.from({length:size},(_,i)=>({id:i,score:i+.5,detail:{label:'row-'+i,flags:[true,false,null]},tags:['a','b']}));
  const value = operation==='investigation-leaf'
    ? {rows:Array.from({length:size},(_,id)=>({id,label:'row'+id,score:-0})),flag:true}
    : operation==='schema' ? {rows:rows.map(r=>r.score)} : {rows, small:{a:0,b:0,c:0,d:0}, names:{a:1,b:2,c:3}};
  const map = hsonLiveMap.fromLibraries({state:{data:value,...(operation==='schema'?{schema}:{})}});
  const library=map.data.must('state'), engine=internal_livemap_aggregate_authority(map), index=Math.floor(size/2);
  let counter=0, toggle=false, host, replica, client;
  if(operation==='locus' || operation==='echo') host=create_locus_hosted_aggregate_internal({map});
  if(operation==='echo') {
    client=compose_client_portable_aggregate_internal(make_portable_aggregate_snapshot(engine.captureHosted()), []);
    replica=create_echo_aggregate_replica_capability_internal(client);
  }
  const action=()=> {
    counter++; toggle=!toggle;
    switch(operation) {
      case 'investigation-leaf': return library.at(['rows',size-1,'score']).replace(counter);
      case 'leaf': return library.at(['rows',index,'score']).set(counter);
      case 'root': return library.at([]).replace({...value,small:{a:counter,b:0,c:0,d:0}});
      case 'four-independent': for(const k of ['a','b','c','d']) library.at(['small',k]).set(counter); return;
      case 'four-batch': return map.batch(d=>{for(const k of ['a','b','c','d']) d.data.must('state').at(['small',k]).set(counter)});
      case 'constructive': return library.at(['small']).set({a:counter,b:counter});
      case 'rename': return library.at(['names']).asObject().object.renameKey(toggle?'a':'x',toggle?'x':'a');
      case 'move': return library.at(['rows']).asArray().array.move(0,size-1);
      case 'splice': return library.at(['rows']).asArray().array.splice(index,1,{...rows[index],score:counter});
      case 'schema': return library.at(['rows',index]).set(counter);
      case 'locus': return host.stage(d=>d.data.must('state').at(['rows',index,'score']).set(counter));
      case 'echo': return host.stage(d=>d.data.must('state').at(['rows',index,'score']).set(counter)).then(c=>replica.replayHosted(make_portable_aggregate_commit(c),c.prevRev));
    }
  };
  return {action,dispose:()=>{host?.dispose();replica?.dispose();}, map};
}
export function interactionFixture() {
  const map=hsonLiveMap.fromLibraries({page:{document:'<main/>'}});enable_interactions(map);
  const descriptor={id:'button',subject:{library:'page',path:[0]},listener:{event:'click',target:'element',capture:false,once:false,passive:false,missingTarget:'throw',preventDefault:false,stopPropagation:false,stopImmediatePropagation:false},kind:'browser',key:'run',args:null};
  add_interaction(map,descriptor);let i=0;
  return {action:()=>replace_interaction(map,{...descriptor,args:++i}),dispose:()=>{},map};
}
export function prepared(size) {
  const {map}=fixture(size,'leaf'), engine=internal_livemap_aggregate_authority(map), identity=engine.libraries()[0];
  const tokens=[];
  return {map,tokens,prepare:()=>{const t=engine.prepare([{target:engine.target(identity,['rows',0,'score']),kind:'set',value:9999}]);tokens.push(t);return t;},discard:t=>engine.discard(t)};
}
export async function held(size) {
  const {map}=fixture(size,'leaf');let release,entered,token;
  const ready=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
  const host=create_locus_hosted_aggregate_internal({map,gate:input=>{token=input.transition;entered();return gate;}});
  const pending=host.stage(d=>d.data.must('state').at(['rows',0,'score']).set(9999));
  await ready;
  return {map,get token(){return token},release:async()=>{release();await pending;host.dispose();}};
}
`;
try {
  const output=join(directory,'measure.mjs');
  await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',target:'node22',
    plugins:baseline?[{name:'committed-source',setup(b){b.onLoad({filter:/\/src\/.*\.ts$/},args=>({contents:execFileSync('git',['show','HEAD:'+relative(process.cwd(),args.path)],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
  const api=await import(pathToFileURL(output).href);
  const inspector=new Session();inspector.connect();const post=promisify(inspector.post.bind(inspector));await post('HeapProfiler.enable');
  const results=[];let sink;
  const gc=()=>{globalThis.gc?.();globalThis.gc?.();};
  async function measure(f, size, operation, iterations) {
    for(let i=0;i<3;i++) sink=await f.action();
    const times=[],peaks=[],allocations=[];
    for(let sample=0;sample<(allocationsOnly?0:7);sample++) {
      gc();const before=process.memoryUsage().heapUsed;let peak=before;const start=performance.now();
      for(let i=0;i<iterations;i++){sink=await f.action();peak=Math.max(peak,process.memoryUsage().heapUsed);}
      times.push((performance.now()-start)/iterations);peaks.push(peak-before);
    }
    for(let sample=0;sample<3;sample++) {
      gc();await post('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
      for(let i=0;i<iterations;i++) sink=await f.action();
      const {profile}=await post('HeapProfiler.stopSampling');const bytes=n=>n.selfSize+n.children.reduce((sum,c)=>sum+bytes(c),0);
      allocations.push(bytes(profile.head)/iterations);
    }
    times.sort((a,b)=>a-b);peaks.sort((a,b)=>a-b);allocations.sort((a,b)=>a-b);
    results.push({size,operation,iterations,minMs:times[0],medianMs:times[3],maxMs:times[6],
      sampledBytesPerOperation:{min:allocations[0],median:allocations[1],max:allocations[2]},
      observedHeapGrowthBytes:{min:peaks[0],median:peaks[3],max:peaks[6]}});
    f.dispose();
  }
  if(!memoryOnly) {
    for(const size of [64,512,2048]) for(const operation of investigationOnly ? ['investigation-leaf']
      : ['leaf','root','four-independent','four-batch','constructive','rename','move','splice','schema','locus','echo']) {
      // The established hosted snapshot byte bound excludes this large Echo fixture.
      if(size===2048 && operation==='echo') continue;
      process.stderr.write(size+' '+operation+'\n');
      await measure(api.fixture(size,operation),size,operation,size===2048?3:5);
    }
    if(!investigationOnly) await measure(api.interactionFixture(),1,'interaction',10);
  }
  const memory=[];
  for(let trial=0;!investigationOnly && trial<5;trial++) {
    gc();const start=process.memoryUsage().heapUsed;let p=api.prepared(2048);gc();const installed=process.memoryUsage().heapUsed;
    const token=p.prepare();gc();const prepared=process.memoryUsage().heapUsed;
    p.discard(token);await new Promise(r=>setImmediate(r));gc();const discarded=process.memoryUsage().heapUsed;
    p=undefined;gc();const beforeHeld=process.memoryUsage().heapUsed;let h=await api.held(2048);gc();const held=process.memoryUsage().heapUsed;
    await h.release();await new Promise(r=>setImmediate(r));gc();const settled=process.memoryUsage().heapUsed;
    memory.push({trial,installedBytes:installed-start,preparedAdditionalBytes:prepared-installed,discardedAdditionalBytesWithTokenHeld:discarded-installed,heldMapAndCandidateBytes:held-beforeHeld,settledMapBytes:settled-beforeHeld});h=undefined;
  }
  const peakTrials=[];
  if(!allocationsOnly && !investigationOnly) for(const operation of ['leaf','root','four-batch','held']) for(let trial=0;trial<3;trial++) {
    const code = `import * as api from ${JSON.stringify(pathToFileURL(output).href)};
      globalThis.gc();const before=process.memoryUsage().heapUsed;
      if(${JSON.stringify(operation)}==='held') {
        const h=await api.held(2048);globalThis.gc();const held=process.memoryUsage().heapUsed;
        await h.release();globalThis.gc();
        console.log(JSON.stringify({heldBytes:held-before,settledBytes:process.memoryUsage().heapUsed-before,peakRssBytes:process.resourceUsage().maxRSS*1024}));
      } else {
        const f=api.fixture(2048,${JSON.stringify(operation)});
        for(let i=0;i<5;i++) await f.action();globalThis.gc();
        console.log(JSON.stringify({retainedBytes:process.memoryUsage().heapUsed-before,peakRssBytes:process.resourceUsage().maxRSS*1024}));
      }`;
    peakTrials.push({operation,trial,...JSON.parse(execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',code],{encoding:'utf8'}))});
  }
  inspector.disconnect();
  process.stdout.write(JSON.stringify({mode:baseline?'committed':'working-tree',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,samples:7,allocation:'V8 statistical allocation sampling includes collected objects; estimated bytes, not exact counts',memoryMethod:'Forced GC deltas, five trials. Heap growth is observed between completed operations, a lower bound on peak live heap. Held uses the real Locus asynchronous acceptance gate; persistence I/O excluded.',results,memory,peakTrials,peakProcessRssBytes:process.resourceUsage().maxRSS*1024},null,2)+'\n');
} finally {await rm(directory,{recursive:true,force:true});}

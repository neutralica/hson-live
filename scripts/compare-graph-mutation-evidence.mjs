// Compare accepted transport bytes against committed HEAD without a checkout.
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {relative,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'hson-mutation-evidence-'));
const source=`
import {Hson,hsonLiveMap,enable_interactions,add_interaction,replace_interaction} from './src/index.ts';
import {internal_livemap_aggregate_authority} from './src/api/livemap/livemap.internal.ts';
import {make_portable_aggregate_commit} from './src/api/livemap/livemap.hosted.ts';
export function run(){
 const map=hsonLiveMap.fromLibraries({state:{data:Hson.data.fromSource('{"10":-0,"2":2,"small":{"a":1,"b":2},"rows":[{"n":1},{"n":1},{"n":3}]}')},page:{document:'<main/>'}});
 enable_interactions(map);
 const engine=internal_livemap_aggregate_authority(map), state=map.data.state, captures=[];
 engine.observe(c=>{const wire=make_portable_aggregate_commit(c.hosted);captures.push(JSON.stringify({...wire,authority:{logicalMapId:'fixture',incarnationId:'fixture'}}));});
 state.at(['10']).set(0);state.at(['10']).set(-0);state.at(['2']).set(Number.MAX_VALUE);
 state.at(['2']).set(Number.MIN_VALUE);state.at(['small']).set({a:4});
 state.at(['small']).asObject().object.setKey('10',10);state.at(['small']).asObject().object.setKey('2',2);
 state.at(['small']).asObject().object.renameKey('a','b');
 state.at(['rows']).asArray().array.move(0,1);state.at(['rows']).asArray().array.splice(-1,1,{n:4});
 map.batch(d=>{d.data.state.at(['small']).set({b:9,extra:7});d.data.state.at(['small','extra']).delete();d.data.state.at(['rows',0]).replace({n:11});});
 state.at(['small']).replace({literal:'<x 1>',zero:-0});
 const descriptor={id:'button',subject:{library:'page',path:[0]},listener:{event:'click',target:'element',capture:false,once:false,passive:false,missingTarget:'throw',preventDefault:false,stopPropagation:false,stopImmediatePropagation:false},kind:'browser',key:'run',args:null};
 add_interaction(map,descriptor);replace_interaction(map,{...descriptor,args:{'10':-0,'2':3}});
 return {captures,hson:state.hson(),revision:map.rev};
}`;
let prior;
try {
for(const mode of ['baseline','current']){
 const output=dir+'/wire-'+mode+'.mjs';
 await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,format:'esm',platform:'node',target:'node22',plugins:mode==='baseline'?[{name:'committed',setup(b){b.onLoad({filter:/\/src\/.*\.ts$/},a=>({contents:execFileSync('git',['show','HEAD:'+relative(process.cwd(),a.path)],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
 const result=(await import(pathToFileURL(output).href)).run();
 if(prior) assert.deepEqual(result,prior);prior=result;
}
console.log('Byte-exact portable commits match:',prior.captures.length,'normalized authority IDs; final exact Hson and revision match.');
} finally {await rm(dir,{recursive:true,force:true});}

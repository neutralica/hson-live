import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "livemap.structured-css-declarations", title: "Structured CSS source and emitted declarations", category: "LiveMap", runtime: "node", tags: Object.freeze(["css", "types", "entrypoints"]) });
const root=resolve(import.meta.dirname,'..');
const directory=await mkdtemp(join(tmpdir(),'hson-css-declarations-'));
function config(path: string) {
  const input=ts.readConfigFile(path,ts.sys.readFile);assert.equal(input.error,undefined);
  return ts.parseJsonConfigFileContent(input.config,ts.sys,resolve(path,'..'));
}
function clean(program: ts.Program, consumerOnly = false) {
  // Source implementation uses the repository compiler mode; consumer contracts use both modes.
  const errors=ts.getPreEmitDiagnostics(program).filter(error => !consumerOnly || error.file?.fileName === join(root,"tests/structured-css.types.ts"));
  assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
}
try {
  await symlink(join(root,"node_modules"),join(directory,"node_modules"),"dir");
  await writeFile(join(directory,"package.json"),JSON.stringify({type:"module"}));
  const source=config(join(root,'tsconfig.json'));
  const compiler=ts.createProgram(source.fileNames,{...source.options,outDir:directory,sourceMap:false,declarationMap:false});
  clean(compiler);assert.equal(compiler.emit().emitSkipped,false);
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  for(const emitted of [false,true]) {
    const paths: Record<string,string[]>={};
    for(const [key,value] of Object.entries<{types:string;import:string}>(pkg.exports)) {
      paths[key==='.'?'hson-live':`hson-live${key.slice(1)}`]=[emitted ? join(directory,value.types.slice('./dist/'.length))
        : join(root,value.import.replace('./dist/','./src/').replace(/\.js$/,'.ts'))];
    }
    for(const exactOptionalPropertyTypes of [false,true]) {
      clean(ts.createProgram([join(root,'tests/structured-css.types.ts')],{
        ...source.options,noEmit:true,rootDir:undefined,allowImportingTsExtensions:true,paths,baseUrl:root,exactOptionalPropertyTypes,
      }), !emitted);
      if(emitted) for(const name of ['public','hson-worker','transform-worker','livemap-worker','locus-worker','ssr-worker','livehost-node','livetree-browser']) {
        const entry=config(join(root,`tests/entrypoints/tsconfig.${name}.json`));
        clean(ts.createProgram(entry.fileNames,{...entry.options,noEmit:true,paths,baseUrl:root,exactOptionalPropertyTypes}));
      }
      console.log(`PASS ${emitted?'emitted':'source'} CSS declarations; exactOptionalPropertyTypes=${exactOptionalPropertyTypes}`);
    }
  }
} finally {await rm(directory,{recursive:true,force:true});}

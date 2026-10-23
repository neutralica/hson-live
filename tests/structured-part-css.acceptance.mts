import assert from 'node:assert/strict';
import { structured_css_cases } from './fixtures/structured-part-css-cases.mts';
import { repository_typescript_worker } from './helpers/repository-typescript-worker.mts';
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "livemap.structured-part-css", title: "Structured Part CssMap", category: "LiveMap", runtime: "node", tags: Object.freeze(["css", "parts", "worker", "ssr", "atomicity"]) });
let count=0;
await structured_css_cases(async(name,run)=>{await run();count++;console.log(`PASS ${name}`);});
const worker=repository_typescript_worker(new URL('./fixtures/structured-part-css.worker.mts',import.meta.url));
try { const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error(`Worker ${code}`));});});assert.equal(result,count); }
finally {await worker.terminate();}
console.log(`Structured CSS passed (${count} Node and ${count} Worker groups).`);

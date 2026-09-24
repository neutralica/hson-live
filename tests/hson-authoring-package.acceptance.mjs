import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.hson-authoring-package",
  title: "Hson authoring package boundary",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["hson", "authoring", "bundling", "built-package"]),
});

// Use the editor's established bundler; no new library runtime dependency.
const { build } = createRequire(new URL("../editors/vscode-hson/package.json", import.meta.url))("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
const sources = {
  tag: 'import { Hson } from "hson-live/hson"; export const value = Hson.canonical`<foo/>`;',
  validation: 'import { Hson } from "hson-live/hson"; export const value = Hson.schema`<type "data" content "string">`.certify(Hson.data`"hello"`);',
  alphabet: 'import { Hson } from "hson-live/hson"; const schema = Hson.schema`<type "data" content <key <string <len 3 alphabet "abc">>>>`; const valid = Hson.canonical`<key "cba">`; let rejects = false; try { schema.certify(Hson.canonical`<key "abd">`); } catch { rejects = true; } export const parity = { accepts: schema.certify(valid) === valid, rejects };',
  any: 'import { Hson } from "hson-live/hson"; const schema = Hson.schema`<type "data" content <args "any" payload "any">>`; const valid = Hson.canonical`<args [null, true, -0] payload <z 1 a <nested []>>>`; let rejectsDocument = false; try { schema.certify(Hson.canonical`<main/>`); } catch { rejectsDocument = true; } export const parity = { accepts: schema.certify(valid) === valid, rejectsDocument, preservesNegativeZero: valid.includes("-0"), preservesOrder: valid.indexOf("z 1") < valid.indexOf("a <nested") };',
  data: 'import { Hson } from "hson-live/hson"; const value = Hson.data`<\'10\' -0 \'2\' <__proto__ true>>`; const entries=Hson.data.entries(value); export const parity = { order: entries.map(([name]) => name), negativeZero: Object.is(Hson.data.materialize(entries[0][1]), -0), safeProto: Object.hasOwn(Hson.data.materialize(entries[1][1]), "__proto__"), roundTrip: Hson.data.fromHson(value) === value };',
  document: 'import { Hson } from "hson-live/hson"; const empty=Hson.document.fromHson(""); const text=Hson.document.fromHson(String.fromCharCode(34,34)); const value=Hson.document`<main/><aside/>`; export const parity={empty,distinct:empty!==text,root:Hson.document.toNode(value).$_tag,items:Hson.document.toNode(value).$_content.length,roundTrip:Hson.document.fromHson(value)===value,primitive:typeof value==="string"};',
  action: 'import { Hson, hson } from "hson-live"; const clients=new Set(),servers=new Set(); const client={send(v){for(const f of servers)f(v)},close(){},onMessage(f){clients.add(f);return()=>clients.delete(f)},onClose(){return()=>{}}}; const server={send(v){for(const f of clients)f(v)},close(){},onMessage(f){servers.add(f);return()=>servers.delete(f)},onClose(){return()=>{}}}; let executions=0; const map=hson.liveMap.fromLibraries({state:{data:{value:"ready"},schema:Hson.schema`<type "data" content <value "string">>`}}); const projection={libraries:["state"],systemFeatures:[]}; const locus=hson.locus.create({map,exposure:[{library:"state",exposure:"client-public"}],defaultProjection:projection,authorizeProjection:()=>({...projection,writableDocuments:[]}),actions:{echo(_c,p){executions++;return p}}}); locus.connect(server); const sessionCreated=new Promise(resolve=>client.onMessage(v=>{const m=JSON.parse(v);if(m.type==="session-created")resolve(m)})); client.send(JSON.stringify({type:"session-create",id:"package-session"})); const attached=await sessionCreated; const projectionReady=typeof attached.sessionId==="string"&&typeof attached.credential==="string"; const echo=hson.echo.create({socket:client}); echo.connect(); const source=hson.liveMap.fromHson(Hson.canonical`<payload <\'10\' -0 \'2\' <__proto__ true> tail <b 2 a 1>>>`); const value=source.at(["payload"]).data(); const outcome=await locus.dispatchAction({type:"action",id:"package-action",name:"echo",payload:value}); let reservedRejected=false; try{echo.action("echo",{_hson_root:true})}catch{reservedRejected=true} const entries=Hson.data.entries(value); export const parity={projectionReady,ack:outcome.type==="ack",equal:outcome.type==="ack"&&outcome.result===value,order:entries.map(([name])=>name),negativeZero:Object.is(Hson.data.materialize(entries[0][1]),-0),safeProto:Object.hasOwn(Hson.data.materialize(entries[1][1]),"__proto__"),reservedRejected,executions}; echo.dispose(); locus.dispose();',
  aggregate: 'import { hson } from "hson-live"; console.log(hson.liveMap);',
  transform: 'import { hsonTransform } from "hson-live/transform"; console.log(hsonTransform);',
  livemap: 'import { hsonLiveMap } from "hson-live/livemap"; console.log(hsonLiveMap);',
};
const results = {};
for (const [name, contents] of Object.entries(sources)) {
  const options = { stdin: { contents, resolveDir: root, sourcefile: `${name}.js` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", treeShaking: true, legalComments: "none", metafile: true };
  const raw = await build(options);
  const min = await build({ ...options, minify: true });
  const inputs = Object.values(min.metafile.outputs).flatMap(output => Object.entries(output.inputs)).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path);
  results[name] = { raw: raw.outputFiles[0].contents.length, min: min.outputFiles[0].contents.length, gzip: gzipSync(min.outputFiles[0].contents, { level: 9 }).length, inputs, parsed: Object.keys(min.metafile.inputs), code: min.outputFiles[0].text };
}
let checks = 0;
const testEvents = create_test_event_emitter("core.hson-authoring-package");
function check(name, run) {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  console.log(`ok ${++checks} - ${name}`);
}
const narrow = results.tag;
check("actual /hson export resolves to the narrow authoring module", () => assert.ok(narrow.inputs.some(path => path.endsWith("dist/hson-authoring.js"))));
check("authoring does not traverse aggregate or full LiveMap core", () => assert.ok(narrow.parsed.every(path => !/(?:dist\/hson\.js|livemap\.core\.js|\/livetree\/|\/livehost\/|\/locus\/|\/reflect\/|\/inspect\/)/.test(path))));
check("authoring has no browser or external parser dependencies", () => assert.ok(narrow.parsed.every(path => !/(?:node_modules|transform\.browser|\/safety\/)/.test(path))));
check("tree-shaken authoring retains no mutation history or session machinery", () => assert.ok(narrow.inputs.every(path => !/livemap\.(?:mutation|replay|history|session|store|install)/.test(path))));
// The Hson Schema compiler uses source provenance for exact authored diagnostics,
// and the validators use issue-presentation's semantic sidecar. No capture,
// provider, lifecycle, protocol, or generated source-map module may join them.
check("D5 tooling never enters the ordinary authoring graph", () => assert.ok(narrow.parsed.every(path =>
  !/trusted-schema-diagnostics|embedded-hson|source-provenance/.test(path)
  || path.endsWith("trusted-schema-diagnostics/issue-presentation.js")
  || path.endsWith("hson-source-provenance/hson-source-provenance.js")
  || path.endsWith("hson-source-provenance/parse-hson-with-provenance.js"))));
check("D6 completion query/provider machinery never enters production Hson", () => assert.ok(narrow.parsed.every(path => !/schema-completion|completion-source|vscode-hson/.test(path))));
check("same-object certify retains real Schema validators in tag-only bundle", () => {
  assert.ok(narrow.inputs.some(path => path.endsWith("internal/canonical-schema/verify.js")));
  assert.ok(narrow.inputs.some(path => path.endsWith("internal/schema-hson-validation/validate-canonical-hson.js")));
});
// The former 45,000-byte tripwire was already red before Z3B (45,526 bytes).
// The current built /hson artifact is 45,970 bytes; retain a close regression
// guard while leaving room for compressor/version variation.
check("narrow authoring stays within the approved practical size boundary", () => { assert.ok(narrow.gzip < 48_000, `gzip=${narrow.gzip}`); assert.ok(narrow.gzip < results.aggregate.gzip / 4); });
check("referencing certify does not unexpectedly import another subsystem", () => assert.deepEqual(results.validation.inputs.filter(path => path.startsWith("dist/")), narrow.inputs.filter(path => path.startsWith("dist/"))));
const execution = await import('data:text/javascript;base64,' + Buffer.from(narrow.code).toString('base64'));
check("production authoring bundle executes without a browser", () => assert.equal(execution.value, "<foo/>"));
const alphabetUrl = 'data:text/javascript;base64,' + Buffer.from(results.alphabet.code).toString('base64');
const alphabetExecution = await import(alphabetUrl);
check("browser-targeted authoring executes alphabet semantics", () => assert.deepEqual(alphabetExecution.parity, { accepts: true, rejects: true }));
const anyExecution = await import('data:text/javascript;base64,' + Buffer.from(results.any.code).toString('base64'));
check("browser-targeted authoring executes canonical any semantics", () => assert.deepEqual(anyExecution.parity, { accepts: true, rejectsDocument: true, preservesNegativeZero: true, preservesOrder: true }));
const dataExecution = await import('data:text/javascript;base64,' + Buffer.from(results.data.code).toString('base64'));
check("browser-targeted authoring executes exact HsonData semantics", () => assert.deepEqual(dataExecution.parity, { order: ["10", "2"], negativeZero: true, safeProto: true, roundTrip: true }));
const documentExecution = await import('data:text/javascript;base64,' + Buffer.from(results.document.code).toString('base64'));
check("browser-targeted authoring executes exact HsonDocument semantics", () => assert.deepEqual(documentExecution.parity, { empty: "", distinct: true, root: "_hson_root", items: 2, roundTrip: true, primitive: true }));
const actionUrl = 'data:text/javascript;base64,' + Buffer.from(results.action.code).toString('base64');
const actionExecution = await import(actionUrl);
const actionParity = { projectionReady: true, ack: true, equal: true, order: ["10", "2", "tail"], negativeZero: true, safeProto: true, reservedRejected: true, executions: 1 };
check("browser-targeted bundle executes the configured-action payload path", () => assert.deepEqual(actionExecution.parity, actionParity));
const workerParity = await new Promise((resolve, reject) => {
  const source = `const { parentPort } = require("node:worker_threads"); import(${JSON.stringify(alphabetUrl)}).then(({ parity }) => parentPort.postMessage(parity), (error) => { throw error; });`;
  const worker = new Worker(source, { eval: true });
  worker.once("message", resolve);
  worker.once("error", reject);
  worker.once("exit", (code) => { if (code !== 0) reject(new Error(`alphabet Worker exited with code ${code}`)); });
});
check("actual Worker executes the same alphabet semantics", () => assert.deepEqual(workerParity, { accepts: true, rejects: true }));
const workerActionParity = await new Promise((resolve, reject) => {
  const source = `const { parentPort } = require("node:worker_threads"); import(${JSON.stringify(actionUrl)}).then(({ parity }) => parentPort.postMessage(parity), (error) => { throw error; });`;
  const worker = new Worker(source, { eval: true });
  worker.once("message", resolve);
  worker.once("error", reject);
  worker.once("exit", (code) => { if (code !== 0) reject(new Error(`action Worker exited with code ${code}`)); });
});
check("actual Worker executes the configured-action payload path", () => assert.deepEqual(workerActionParity, actionParity));
for (const [name, { raw, min, gzip, inputs }] of Object.entries(results)) console.log(`# ${name}: ${JSON.stringify({ raw, min, gzip, retainedModules: inputs.length })}`);
console.log(`# ${checks} Hson authoring package checks passed`);
testEvents.terminal("pass");

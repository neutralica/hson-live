import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

import { produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.ts";
import { TrustedSchemaClient } from "../editors/vscode-hson/src/trusted-schema-client.ts";
import { cases, caseFile } from "./fixtures/schema-d3-cases.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = async (name: string, body: () => unknown) => { await body(); console.log(`ok ${++checks} - ${name}`); };
const syntax = (text: string) => produce_document_diagnostics({ languageId: "typescript", fileName: "/project/source.ts", text });
const imports = 'import { hson, hsonTransform, hsonLiveMap, hsonLiveTree } from "hson-live";\n';
const moduleUrl = new URL("./fixtures/schema-d3-runtime.fixture.mts", import.meta.url).href;
const hsonModuleUrl = new URL("../src/hson.ts", import.meta.url).href;
const runtimeEntry = fileURLToPath(new URL("../src/internal/trusted-schema-diagnostics/node-runtime-entry.ts", import.meta.url));
const client = new TrustedSchemaClient({ trust: { workspaceTrusted: true, enabled: true }, moduleUrl, hsonModuleUrl, runtimeEntry, execArgv: ["--loader", "ts-node/esm"], startupDeadlineMs: 5_000 });
const document = (name: string, text = cases[name]!, version = 1) => ({ fileName: caseFile(name), uri: pathToFileURL(caseFile(name)).href, languageId: "typescript", version, text });

try {
  await check("secure direct LiveMap syntax diagnostic", () => assert.equal(syntax(imports + 'hsonLiveMap.fromHson("+1");').length, 1));
  await check("secure direct Transform syntax diagnostic", () => assert.equal(syntax(imports + 'hsonTransform.fromHson("+1");').length, 1));
  await check("secure direct LiveTree syntax diagnostic", () => assert.equal(syntax(imports + 'hsonLiveTree.fromHson("+1");').length, 1));
  await check("escaped syntax diagnostic maps complete escape", () => { const text=imports+'hsonLiveMap.fromHson("\\x2b1");'; const d=syntax(text)[0]!; assert.equal(text.slice(d.range.start,d.range.end),'\\x2b'); });
  await check("const alias maps back to literal", () => { const text=imports+'const a="\\x2b1"; const b=a; hsonLiveMap.fromHson(b);'; const d=syntax(text)[0]!; assert.equal(text.slice(d.range.start,d.range.end),'\\x2b'); });
  await check("LiveMap document interpretation admits mixed text", () => assert.deepEqual(syntax(imports+'hson.liveMap.fromHson(`"before" <em/>`);'),[]));
  await check("Transform interpretation rejects mixed text", () => assert.equal(syntax(imports+'hson.fromHson(`"before" <em/>`);').length,1));
  await check("interpolated ordinary template is unavailable", () => assert.deepEqual(syntax(imports+'hsonLiveMap.fromHson(`<a ${value}>`);'),[]));
  await check("concatenation is unavailable", () => assert.deepEqual(syntax(imports+'hsonLiveMap.fromHson("+"+"1");'),[]));
  await check("wrong package has no authority", () => assert.deepEqual(syntax('import { hsonLiveMap } from "other"; hsonLiveMap.fromHson("+1");'),[]));
  await check("local lookalike has no authority", () => assert.deepEqual(syntax('const x={fromHson(v:string){return v}}; x.fromHson("+1");'),[]));
  await check("secure syntax correction clears immediately", () => { const bad=imports+'hsonLiveMap.fromHson("+1");'; assert.equal(syntax(bad).length,1); assert.deepEqual(syntax(bad.replace('+1','<a/>')),[]); });
  await check("failed attachment retains projected Schema authority", async () => assert.equal((await client.validate(document("staticDirect"),()=>true)).status,"current-invalid"));
  await check("projected exact issue maps inside static literal", async () => { const r=await client.validate(document("staticDirect"),()=>true); assert.equal(cases.staticDirect!.slice(r.diagnostics[0]!.range.start,r.diagnostics[0]!.range.end),'"37"'); });
  await check("escaped projected issue maps complete endpoint escapes", async () => { const r=await client.validate(document("staticEscaped"),()=>true); assert.equal(cases.staticEscaped!.slice(r.diagnostics[0]!.range.start,r.diagnostics[0]!.range.end),'\\x2237\\x22'); });
  await check("unsaved static correction validates", async () => assert.equal((await client.validate(document("staticDirect",cases.staticDirect!.replace('"37"','37'),2),()=>true)).status,"current-valid"));
  await check("projected missing structure uses anchor", async () => { const r=await client.validate(document("staticDirect",cases.staticDirect!.replace('<age "37">','<>'),2),()=>true); assert.ok(r.diagnostics.some(d=>d.precision==='anchor')); });
  await check("document exact issue maps into static literal", async () => { const r=await client.validate(document("staticDocument"),()=>true); assert.ok(r.diagnostics.some(d=>d.precision==='exact'&&cases.staticDocument!.slice(d.range.start,d.range.end)==='"bad"')); });
  await check("document missing structure uses anchor", async () => { const r=await client.validate(document("staticDocument"),()=>true); assert.ok(r.diagnostics.some(d=>d.precision==='anchor')); });
  await check("document fragment classification is preserved", async () => assert.equal((await client.validate(document("staticFragment"),()=>true)).status,"current-invalid"));
  await check("top-level text fragment classification is preserved", async () => assert.equal((await client.validate(document("staticText"),()=>true)).status,"current-valid"));
  await check("actual mutation suppresses static attribution", async () => assert.equal((await client.validate(document("staticMutated"),()=>true)).status,"unavailable"));
  await check("mutate-revert suppresses static attribution", async () => assert.equal((await client.validate(document("staticReverted"),()=>true)).status,"unavailable"));
  await check("multiple maps retain independent diagnostics", async () => assert.equal((await client.validate(document("staticTwo"),()=>true)).diagnostics.length,2));
  await check("stale publication returns no diagnostic", async () => { const r=await client.validate(document("staticDirect"),()=>false); assert.equal(r.status,'stale'); assert.deepEqual(r.diagnostics,[]); });
  await check("trust closure does not affect secure syntax", () => assert.equal(syntax(imports+'hsonLiveMap.fromHson("+1");').length,1));
} finally { client.dispose(); }

emit_hson_live_test_completion("schema-d4-editor", checks, checks, 0);

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { TrustedSchemaDiagnosticRuntime } from "../src/internal/trusted-schema-diagnostics/runtime.ts";
import { TrustedSchemaClient } from "../editors/vscode-hson/src/trusted-schema-client.ts";
import { start_schema_diagnostics } from "../editors/vscode-hson/src/schema-diagnostics.ts";
import type { DiagnosticHost } from "../editors/vscode-hson/src/diagnostics.ts";
import type { TrustedSchemaDirectSource, TrustedSchemaRequest } from "../src/internal/trusted-schema-diagnostics/protocol.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
let checks = 0;
const check = async (name: string, run: () => unknown | Promise<unknown>) => { await run(); console.log(`ok ${++checks} - ${name}`); };
const moduleUrl = new URL("./fixtures/schema-d2-runtime.fixture.mts", import.meta.url).href;
const hsonModuleUrl = new URL("../src/hson.ts", import.meta.url).href;
const runtimeEntry = fileURLToPath(new URL("../src/internal/trusted-schema-diagnostics/node-runtime-entry.ts", import.meta.url));
const envelope = { protocolVersion: 1, runtimeGeneration: 1, requestId: "runtime" };
const runtime = new TrustedSchemaDiagnosticRuntime(1);
const loaded = await runtime.handle({ ...envelope, type: "load", moduleUrl, hsonModuleUrl });
const source: TrustedSchemaDirectSource = { templateId: "t", callId: "c", templateRevision: 1, documentRevision: 1, associationRevision: 1, binding: { moduleUrl, exportName: "UserSchema" } };
const associate = (directSource = source, schemaId = "userHandle", associationId = "a") => runtime.handle({ ...envelope, type: "associate-source", associationId, schemaId, directSource });
const candidate = (overrides: Partial<Extract<TrustedSchemaRequest, { type: "validate" }>> = {}): Extract<TrustedSchemaRequest, { type: "validate" }> => ({ ...envelope, type: "validate", associationId: "a", schemaId: "userHandle", templateRevision: 1, candidateRevision: 1, directSource: source, source: '<user <age "37">>', ...overrides });
await check("exported object identity maps a differently named registration handle", () => { assert.equal(loaded.type, "loaded", loaded.message); assert.ok(loaded.bindings?.some(b => b.schemaId === "userHandle" && b.binding.exportName === "UserSchema")); });
await check("private same-object duplicate remains idempotent", async () => assert.equal((await associate({ ...source, binding: { moduleUrl: "file:///project/local.ts", localName: "Local", declarationStart: 40 } }, "localHandle", "local")).type, "associated"));
await check("different-object duplicate preserves conflict and rejects load", async () => { const r = new TrustedSchemaDiagnosticRuntime(1); const response = await r.handle({ ...envelope, type: "load", moduleUrl: moduleUrl + "?conflict", hsonModuleUrl }); assert.equal(response.error, "AMBIGUOUS_REGISTRATION"); assert.equal(response.schemaIds, undefined); });
await check("one source binding with different objects is ambiguous", async () => assert.equal((await associate({ ...source, binding: { moduleUrl: "file:///project/ambiguous.ts", localName: "Schema", declarationStart: 40 } }, "ambiguousA")).error, "AMBIGUOUS_REGISTRATION"));
await check("matching handle spelling alone never associates", async () => assert.equal((await associate({ ...source, binding: { moduleUrl, exportName: "userHandle" } })).error, "ASSOCIATION_UNAVAILABLE"));
await check("direct source association needs no lifecycle proposal", async () => { assert.deepEqual(loaded.associations, []); assert.equal((await associate()).type, "associated"); });
await check("current candidate validates before application execution", async () => { const r = await runtime.handle(candidate()); assert.equal(r.result?.status, "INVALID"); assert.deepEqual(r.result.diagnostics[0]?.path, ["user", "age"]); const d = r.result.diagnostics[0]!; assert.equal(candidate().source.slice(d.range.start, d.range.end), '"37"'); });
await check("valid changed candidate uses same Schema authority", async () => assert.equal((await runtime.handle(candidate({ source: '<user <age 37>>' }))).result?.status, "VALID"));
for (const key of ["templateId", "callId", "documentRevision", "templateRevision", "associationRevision"] as const) await check(`stale ${key} cannot validate`, async () => {
  const changed = { ...source, [key]: typeof source[key] === "string" ? "changed" : 2 };
  assert.equal((await runtime.handle(candidate({ directSource: changed }))).result?.status, "ASSOCIATION_UNAVAILABLE");
});
await check("stale runtime generation is unavailable", async () => assert.equal((await runtime.handle({ ...candidate(), runtimeGeneration: 2 })).error, "ASSOCIATION_UNAVAILABLE"));
await check("source binding revision cannot be substituted", async () => assert.equal((await runtime.handle(candidate({ directSource: { ...source, binding: { moduleUrl, exportName: "Stateful" } } }))).result?.status, "ASSOCIATION_UNAVAILABLE"));
await check("syntax failure is not a Schema failure", async () => assert.equal((await runtime.handle(candidate({ source: '<user' }))).result?.status, "CANDIDATE_INVALID"));
await check("dispose removes direct association", async () => { await runtime.handle({ ...envelope, type: "dispose", associationId: "a" }); assert.equal((await runtime.handle(candidate())).result?.status, "ASSOCIATION_UNAVAILABLE"); });
await check("two validation sites independently execute the same stateful object", async () => {
  const results: string[] = [];
  for (const callId of ["first", "second"]) {
    const directSource = { ...source, callId, binding: { moduleUrl, exportName: "Stateful" } };
    await associate(directSource, "stateHandle", callId);
    results.push((await runtime.handle(candidate({ associationId: callId, schemaId: "stateHandle", directSource, source: '1' }))).result!.status);
  }
  assert.deepEqual(results, ["INVALID", "VALID"]);
});
await check("document sidecar distinguishes flag and wrong tag", async () => {
  const directSource = { ...source, binding: { moduleUrl, exportName: "Document" } };
  await associate(directSource, "document", "doc");
  const request = candidate({ associationId: "doc", schemaId: "document", directSource, source: '<button count="bad"/>' });
  assert.equal((await runtime.handle(request)).result?.diagnostics[1]?.subject, "flag");
  assert.equal((await runtime.handle({ ...request, source: '<span/>' })).result?.diagnostics[0]?.subject, "tag");
});
const makeClient = (workspaceTrusted = true, enabled = true) => new TrustedSchemaClient({ trust: { workspaceTrusted, enabled }, moduleUrl, hsonModuleUrl, runtimeEntry, execArgv: ["--loader", "ts-node/esm"], startupDeadlineMs: 5_000 });
const document = (value = '"37"', schema = "UserSchema", calls = 1) => ({ uri: "file:///project/user.ts", fileName: "/project/user.ts", languageId: "typescript", version: 1,
  text: `import { HSON } from "hson-live"; import { ${schema} } from "${moduleUrl}"; const user = HSON\`<user <age ${value}>>\`; ${Array(calls).fill(`HSON.validate(${schema}, user);`).join('\n')}` });
// Use a relative source import whose resolved module is the fixture URL.
const editorDocument = (value = '"37"') => ({ ...document(value), uri: new URL("./fixtures/editor.ts", import.meta.url).href, fileName: fileURLToPath(new URL("./fixtures/editor.ts", import.meta.url)), text: document(value).text.replace(moduleUrl, "./schema-d2-runtime.fixture.mts") });
await check("both trust gates prevent spawn for all disabled combinations", async () => { for (const [trust, enabled] of [[false, false], [false, true], [true, false]]) { const c = makeClient(trust, enabled); try { assert.equal((await c.validate(editorDocument(), () => true)).status, "off"); assert.equal(c.supervisor.generation, 0); } finally { c.dispose(); } } });
const client = makeClient();
try {
  await check("persistent real client discovers maps validates lowers and presents", async () => { const result = await client.validate(editorDocument(), () => true); assert.equal(result.status, "current-invalid", result.message); assert.match(result.diagnostics[0]?.message ?? '', /Expected `age` to be a number, but this value is an HSON string/); });
  await check("multiple validation calls produce independently related diagnostics", async () => {
    const doc = editorDocument();
    const result = await client.validate({ ...doc, text: doc.text + '\nHSON.validate(UserSchema, user);' }, () => true);
    assert.equal(result.diagnostics.length, 2);
    assert.deepEqual(result.diagnostics[0]?.range, result.diagnostics[1]?.range);
    assert.notDeepEqual(result.diagnostics[0]?.related[0]?.range, result.diagnostics[1]?.related[0]?.range);
  });
  await check("local non-exported source binding reaches explicit private registration", async () => {
    const doc = { uri: "file:///project/local.ts", fileName: "/project/local.ts", languageId: "typescript", version: 1,
      text: 'import { HSON } from "hson-live"; const Local = makeSchema(); const user = HSON`"text"`; HSON.validate(Local, user);' };
    const result = await client.validate(doc, () => true);
    assert.equal(result.status, "current-invalid", result.message);
    assert.match(result.diagnostics[0]?.message ?? '', /to be a number/);
  });
  await check("unsaved correction clears diagnostics without application execution", async () => { const result = await client.validate({ ...editorDocument('37'), version: 2 }, () => true); assert.equal(result.status, "current-valid", result.message); assert.deepEqual(result.diagnostics, []); assert.equal(client.supervisor.generation, 1); });
  await check("superseded client request cannot return publishable diagnostics", async () => assert.equal((await client.validate(editorDocument(), () => false)).status, "stale"));
  await check("warmed stage instrumentation stays subsecond", async () => {
    const samples = [];
    for (let i = 0; i < 7; i++) { const result = await client.validate({ ...editorDocument(), version: i + 3 }, () => true); assert.equal(result.status, "current-invalid"); assert.ok(result.measurement); samples.push(result.measurement); }
    console.log('# D2 warm measurements ' + JSON.stringify(samples));
    assert.ok(samples.every(s => s.endToEndMs < 1_000));
    const doc = { ...editorDocument(), version: 20 };
    const host: DiagnosticHost = {
      openDocuments: () => [doc], onDidOpen: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), onDidClose: () => ({ dispose() {} }),
      setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>), reportUnexpected: error => { throw error; },
    };
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { controller.dispose(); reject(new Error("editor measurement timeout")); }, 2_000);
      const controller = start_schema_diagnostics(host, { set() {}, delete() {} }, { enabled: () => true, clientFor: () => client, status() {}, debounceMilliseconds: 150,
        measure(result, perceivedMs) { clearTimeout(deadline); controller.dispose(); assert.equal(result.status, "current-invalid"); assert.ok(perceivedMs >= 140); console.log(`# D2 perceived debounce=150ms elapsed=${perceivedMs.toFixed(2)}ms operation=${result.measurement?.endToEndMs.toFixed(2)}ms`); resolve(); },
      });
    });
  });
  await check("generation retirement immediately notifies editor owner", () => { let retired = 0; client.supervisor.onRetired(() => retired++); client.invalidate(); assert.equal(retired, 1); assert.equal(client.supervisor.activeGeneration, undefined); });
} finally { client.dispose(); }
emit_hson_live_test_completion("schema-d2-runtime", checks, checks, 0);

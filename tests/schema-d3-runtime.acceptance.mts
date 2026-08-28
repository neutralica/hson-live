import assert from "node:assert/strict";
import { TrustedSchemaDiagnosticRuntime } from "../src/internal/trusted-schema-diagnostics/runtime.ts";
import type { TrustedSchemaDirectSource, TrustedSchemaRequest } from "../src/internal/trusted-schema-diagnostics/protocol.ts";
import { discover_schema_validation_sources } from "../src/internal/trusted-schema-diagnostics/discover-validation-sources.ts";
import { same_map_flow } from "../src/internal/trusted-schema-diagnostics/source-binding.ts";
import { cases, caseFile } from "./fixtures/schema-d3-cases.mts";
import { read_embedded_hson_body } from "../src/internal/embedded-hson/embedded-hson-source.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
let checks = 0;
const check = async (name: string, f: () => unknown) => { await f(); console.log(`ok ${++checks} - ${name}`); };
const runtime = new TrustedSchemaDiagnosticRuntime(1);
const envelope = { protocolVersion: 1, runtimeGeneration: 1, requestId: 'd3' };
const moduleUrl = new URL('./fixtures/schema-d3-runtime.fixture.mts', import.meta.url).href;
const hsonModuleUrl = new URL('../src/hson.ts', import.meta.url).href;
const loaded = await runtime.handle({ ...envelope, type: 'load', moduleUrl, hsonModuleUrl });
assert.equal(loaded.type, 'loaded', loaded.message);
const sites = (name: string) => discover_schema_validation_sources(caseFile(name), cases[name]!);
const evidence = (name: string) => sites(name).map(site => loaded.associations!.find(record => same_map_flow(record.mapFlow, site.mapFlow))!);
let sequence = 0;
async function association(name: string, index = 0, body?: string) {
  const site = sites(name)[index]!, proof = evidence(name)[index]!;
  const directSource: TrustedSchemaDirectSource = { templateId: site.templateId, callId: site.callId, binding: site.binding, mapFlow: site.mapFlow,
    templateRevision: 2, documentRevision: 2, associationRevision: ++sequence };
  const associationId = `request:${sequence}`;
  const response = await runtime.handle({ ...envelope, type: 'associate-source', associationId, lifecycleId: proof.associationId, schemaId: proof.schemaId, directSource });
  const request: Extract<TrustedSchemaRequest, { type: 'validate' }> = { ...envelope, type: 'validate', associationId, schemaId: proof.schemaId,
    templateRevision: 2, candidateRevision: 2, directSource, source: body ?? read_embedded_hson_body(site.source) };
  return { response, request, result: await runtime.handle(request) };
}
await check('actual natural direct flow constructs one exact map', () => { const e = evidence('direct')[0]!; assert.equal(e.correspondence, 'direct'); assert.equal(e.constructedRevision, e.attemptRevision); assert.ok(e.applicationId); assert.ok(e.templateId); });
await check('failed initial attachment proposal remains recorded', () => { const e = evidence('direct')[0]!; assert.equal(e.attachment, 'rejected'); assert.equal(e.validationAttempted, true); });
await check('failed attachment validates current editor source with exact C1 span', async () => { const r = await association('direct'); assert.equal(r.result.result?.status, 'INVALID'); const d = r.result.result!.diagnostics[0]!; assert.equal(r.request.source.slice(d.range.start, d.range.end), '"37"'); });
await check('successful initial attachment also provides authority', async () => { assert.equal(evidence('valid')[0]!.attachment, 'attached'); assert.equal((await association('valid', 0, '<user <age "bad">>')).result.result?.status, 'INVALID'); });
await check('current unsaved candidate can correct failed original attachment', async () => assert.equal((await association('direct', 0, '<user <age 37>>')).result.result?.status, 'VALID'));
await check('actual graph mutation suppresses association', async () => { assert.equal((await association('documentMutated')).response.error, 'ASSOCIATION_UNAVAILABLE'); const e = evidence('mutated')[0]!; assert.ok(e.attemptRevision > e.constructedRevision); assert.equal(e.correspondence, 'unavailable'); assert.equal((await association('mutated')).response.error, 'ASSOCIATION_UNAVAILABLE'); });
await check('mutate then revert never recovers provenance', async () => { assert.equal((await association('documentReverted')).response.error, 'ASSOCIATION_UNAVAILABLE'); const e = evidence('reverted')[0]!; assert.ok(e.attemptRevision > e.constructedRevision); assert.equal(e.correspondence, 'unavailable'); assert.equal((await association('reverted')).response.error, 'ASSOCIATION_UNAVAILABLE'); });
await check('one occurrence has two separate map and attempt identities', () => { const [a,b] = evidence('two'); assert.equal(a!.templateId,b!.templateId); assert.notEqual(a!.applicationId,b!.applicationId); assert.notEqual(a!.associationId,b!.associationId); assert.notEqual(a!.schemaId,b!.schemaId); });
await check('two maps validate both current contracts', async () => { assert.equal((await association('two',0)).result.result?.status,'INVALID'); assert.equal((await association('two',1)).result.result?.status,'INVALID'); });
await check('one mutated map does not invalidate independent sibling', async () => { assert.equal((await association('independent',0)).response.error,'ASSOCIATION_UNAVAILABLE'); assert.equal((await association('independent',1)).result.result?.status,'INVALID'); });
await check('same-object idempotence records no new validation authority', async () => { const e = evidence('attempts'); assert.equal(e[0]!.validationAttempted,true); assert.equal(e[1]!.attachment,'attached'); assert.equal(e[1]!.validationAttempted,false); assert.equal((await association('attempts',1)).response.error,'ASSOCIATION_UNAVAILABLE'); });
await check('rejected replacement did not validate the graph', async () => { const e = evidence('attempts')[2]!; assert.equal(e.attachment,'rejected'); assert.equal(e.validationAttempted,false); assert.equal((await association('attempts',2)).response.error,'ASSOCIATION_UNAVAILABLE'); });
await check('different attempted Schemas after failed initial attachment both validate', async () => { assert.ok(evidence('retries').every(e => e.validationAttempted)); assert.equal((await association('retries',0)).result.result?.status,'INVALID'); assert.equal((await association('retries',1)).result.result?.status,'INVALID'); });
await check('document element uses C2 exact attribute diagnostics', async () => { const r = await association('document'); assert.equal(evidence('document')[0]!.rootMode,'element'); assert.equal(r.result.result?.status,'INVALID'); const d = r.result.result!.diagnostics.find(d => d.attributeName === 'count')!; assert.equal(d.range.precision,'exact'); assert.equal(r.request.source.slice(d.range.start,d.range.end),'"bad"'); });
await check('fragment root uses actual document classification', async () => { assert.equal(evidence('fragment')[0]!.rootMode,'fragment'); assert.equal((await association('fragment')).result.result?.status,'INVALID'); });
await check('text fromHson retains explicit document interpretation', async () => { assert.equal(evidence('text')[0]!.rootMode,'fragment'); assert.equal((await association('text')).result.result?.status,'VALID'); });
await check('projected string Schema is not silently used to reinterpret a document', async () => { assert.equal(evidence('scalar')[0]!.rootMode,'fragment'); assert.equal((await association('scalar')).result.result?.status,'INVALID'); });
await check('inline capture executes exact template and map boundary', async () => assert.equal((await association('inline')).result.result?.status,'INVALID'));
await check('canonical map and Schema aliases execute unchanged actual identities', async () => assert.equal((await association('aliases')).result.result?.status,'INVALID'));
await check('ordered graph validator still rejects reordered integer-looking keys', async () => assert.equal((await association('ordered')).result.result?.status,'INVALID'));
await check('stale construction use template context and binding cannot associate', async () => {
  const r = await association('direct');
  const original = r.request.directSource!;
  const stale: TrustedSchemaDirectSource[] = [
    { ...original, templateId: 'other-template' }, { ...original, callId: 'other-call' },
    ...['contextRevision', 'constructionId', 'templateId', 'callId', 'moduleUrl'].map(key => ({ ...original, mapFlow: { ...original.mapFlow!, [key]: 'changed' } })),
    { ...original, binding: { moduleUrl: original.binding.moduleUrl, exportName: 'OtherSchema' } },
  ];
  for (const directSource of stale) assert.equal((await runtime.handle({ ...envelope, type:'associate-source', associationId:'stale', schemaId:r.request.schemaId, lifecycleId:evidence('direct')[0]!.associationId, directSource })).error,'ASSOCIATION_UNAVAILABLE');
});
await check('generation change rejects old evidence', async () => { const r = await association('direct'); assert.equal((await runtime.handle({ ...r.request,runtimeGeneration:2 })).error,'ASSOCIATION_UNAVAILABLE'); });
await check('candidate revision and association disposal checked', async () => { const r = await association('direct'); assert.equal((await runtime.handle({ ...r.request,candidateRevision:3 })).result?.status,'ASSOCIATION_UNAVAILABLE'); await runtime.handle({ ...envelope,type:'dispose',associationId:r.request.associationId }); assert.equal((await runtime.handle(r.request)).result?.status,'ASSOCIATION_UNAVAILABLE'); });
await check('live mutation after association invalidates lifecycle at validation time', async () => { const r = await association('live'); const fixture = await import('./fixtures/schema-d3-runtime.fixture.mts'); fixture.executed.get('live')!.map!.set(['user','age'], 38); assert.equal((await runtime.handle(r.request)).result?.status,'ASSOCIATION_UNAVAILABLE'); });
await check('equal occurrences remain distinct and repeated source executions are ambiguous', async () => { const [a,b] = evidence('equal'); assert.notEqual(a!.templateId,b!.templateId); assert.equal(a!.canonical,b!.canonical); assert.equal((await association('repeated')).response.error,'AMBIGUOUS_REGISTRATION'); });
emit_hson_live_test_completion('schema-d3-runtime',checks,checks,0);

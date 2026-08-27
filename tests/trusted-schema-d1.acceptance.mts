import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { TrustedSchemaInfrastructureError, TrustedSchemaNodeSupervisor, type TrustedSchemaSupervisorOptions } from "../src/internal/trusted-schema-diagnostics/node-supervisor.ts";
import { TrustedSchemaDiagnosticRuntime } from "../src/internal/trusted-schema-diagnostics/runtime.ts";
import { TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION, type TrustedSchemaAssociationEvidence, type TrustedSchemaDiagnostic, type TrustedSchemaRequest, type TrustedSchemaResponse } from "../src/internal/trusted-schema-diagnostics/protocol.ts";

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).href;
const runtimeEntry = fileURLToPath(new URL("../src/internal/trusted-schema-diagnostics/node-runtime-entry.ts", import.meta.url));
const hsonModuleUrl = new URL("../src/hson.ts", import.meta.url).href;
const defaults: TrustedSchemaSupervisorOptions = {
  trust: { workspaceTrusted: true, enabled: true }, runtimeEntry,
  execArgv: ["--loader", "ts-node/esm"], validationDeadlineMs: 1_000, startupDeadlineMs: 3_000,
};
function supervisor(options: Partial<TrustedSchemaSupervisorOptions> = {}): TrustedSchemaNodeSupervisor {
  return new TrustedSchemaNodeSupervisor({ ...defaults, ...options });
}
async function loaded(s: TrustedSchemaNodeSupervisor): Promise<readonly TrustedSchemaAssociationEvidence[]> {
  const response = await s.request({ type: "load", moduleUrl: fixture("trusted-schema-d1-exported.fixture.mts"), hsonModuleUrl });
  assert.equal(response.type, "loaded", response.message);
  assert.ok(response.associations);
  return response.associations;
}
function evidence(records: readonly TrustedSchemaAssociationEvidence[], schemaId: string): TrustedSchemaAssociationEvidence {
  const record = records.find(record => record.schemaId === schemaId);
  assert.ok(record, `missing ${schemaId} application`);
  return record;
}
async function associate(s: TrustedSchemaNodeSupervisor, record: TrustedSchemaAssociationEvidence): Promise<void> {
  const result = await s.request({ type: "associate", associationId: record.associationId });
  assert.equal(result.type, "associated", result.message);
}
function candidate(record: TrustedSchemaAssociationEvidence, source = record.source, candidateRevision = 1): Extract<TrustedSchemaRequest, { type: "validate" }> {
  return { type: "validate", protocolVersion: 1, requestId: "direct", runtimeGeneration: 1,
    associationId: record.associationId, schemaId: record.schemaId, templateRevision: record.templateRevision, candidateRevision, source };
}
async function validate(s: TrustedSchemaNodeSupervisor, record: TrustedSchemaAssociationEvidence, source = record.source, revision = 1): Promise<TrustedSchemaResponse> {
  return s.request(candidate(record, source, revision));
}
function sourceSlice(diagnostic: TrustedSchemaDiagnostic | undefined, source: string, precision: "exact" | "anchor", expected: string): void {
  assert.ok(diagnostic);
  assert.equal(diagnostic.range.precision, precision);
  assert.equal(typeof diagnostic.range.start, "number");
  assert.equal(typeof diagnostic.range.end, "number");
  assert.equal(source.slice(diagnostic.range.start, diagnostic.range.end), expected);
}
async function withProject(run: (s: TrustedSchemaNodeSupervisor, records: readonly TrustedSchemaAssociationEvidence[]) => Promise<void>): Promise<void> {
  const s = supervisor();
  try { await run(s, await loaded(s)); } finally { s.dispose(); }
}
const infrastructure = (code: TrustedSchemaInfrastructureError["code"]) => (error: unknown): boolean => {
  assert.ok(error instanceof TrustedSchemaInfrastructureError);
  assert.equal(error.code, code);
  assert.equal("diagnostics" in error, false);
  return true;
};
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

await check("exported actual projected Schema validates fresh candidates and exact/anchor slices", () => withProject(async (s, records) => {
  const record = evidence(records, "age"); await associate(s, record);
  const source = `<age "bad" status "draft">`;
  const bad = await validate(s, record, source);
  assert.equal(bad.result?.status, "INVALID");
  assert.equal(bad.result.diagnostics[0]?.expected, "number");
  sourceSlice(bad.result.diagnostics[0], source, "exact", `"bad"`);
  assert.equal(bad.result.diagnostics[0]?.range.start, 5);
  const missingSource = `<status "draft">`;
  const missing = await validate(s, record, missingSource, 2);
  assert.equal(missing.result?.diagnostics[0]?.code, "MISSING_REQUIRED");
  sourceSlice(missing.result?.diagnostics[0], missingSource, "anchor", ">");
  const literal = await validate(s, record, `<age 1 status "pending">`, 3);
  assert.equal(literal.result?.diagnostics[0]?.code, "INVALID_LITERAL");
  const constrained = await validate(s, record, `<age -1 status "draft">`, 4);
  assert.equal(constrained.result?.diagnostics[0]?.code, "INVALID_CONSTRAINT");
  assert.equal(constrained.result?.diagnostics[0]?.expected, "positive age");
  assert.equal((await validate(s, record, `<age 1 status "draft">`, 5)).result?.status, "VALID");
}));

await check("local registration preserves exact non-exported Schema identity and replaceable captured state", async () => {
  const runtime = new TrustedSchemaDiagnosticRuntime(1);
  const moduleUrl = fixture("trusted-schema-d1-local.fixture.mts");
  const response = await runtime.handle({ type: "load", protocolVersion: 1, runtimeGeneration: 1, requestId: "load-local", moduleUrl, hsonModuleUrl });
  assert.equal(response.type, "loaded", response.message);
  const local = await import("./fixtures/trusted-schema-d1-local.fixture.mts");
  assert.deepEqual(Object.keys(local).sort(), ["constraintCalls", "replaceCapturedMinimum"]);
  const record = evidence(response.associations ?? [], "localOnly");
  assert.equal((await runtime.handle({ type: "associate", protocolVersion: 1, runtimeGeneration: 1, requestId: "associate-local", associationId: record.associationId })).type, "associated");
  const calls = local.constraintCalls();
  assert.equal((await runtime.handle(candidate(record))).result?.status, "VALID");
  local.replaceCapturedMinimum(3);
  const rejected = await runtime.handle(candidate(record));
  assert.equal(rejected.result?.status, "INVALID");
  assert.equal(rejected.result.diagnostics[0]?.code, "INVALID_CONSTRAINT");
  local.replaceCapturedMinimum(0);
  assert.equal((await runtime.handle(candidate(record))).result?.status, "VALID");
  assert.equal(local.constraintCalls(), calls + 3);
  // The fixture itself asserts registration.schema === localOnly and attachment.schema === localOnly.
});

await check("runtime origin rejects foreign capabilities, missing evidence, and unsupported configured instances", async () => {
  for (const name of ["mismatch", "foreign", "foreign-document", "missing-origin", "missing-registration-origin"]) {
    const s = supervisor();
    try {
      const response = await s.request({ type: "load", moduleUrl: fixture(`trusted-schema-d1-${name}.fixture.mts`), hsonModuleUrl });
      assert.equal(response.error, "RUNTIME_MISMATCH", `${name}: ${response.message}`);
      assert.equal(response.result, undefined);
      assert.equal(response.schemaIds, undefined);
    } finally { s.dispose(); }
  }
  const s = supervisor();
  try {
    const response = await s.request({ type: "load", moduleUrl: fixture("trusted-schema-d1-exported.fixture.mts"), hsonModuleUrl: fixture("trusted-schema-d1-mismatch.fixture.mts") });
    assert.equal(response.error, "RUNTIME_MISMATCH");
    assert.doesNotMatch(s.output.stdout, /D1_PROJECT_EXECUTED/);
  } finally { s.dispose(); }
});

await check("one real template occurrence supports two independent actual Schema applications", () => withProject(async (s, records) => {
  const first = evidence(records, "oneNumber"), second = evidence(records, "oneString");
  assert.equal(first.templateId, second.templateId);
  assert.notEqual(first.applicationId, second.applicationId);
  assert.notEqual(first.associationId, second.associationId);
  await associate(s, first); await associate(s, second);
  assert.equal((await validate(s, first)).result?.status, "INVALID");
  assert.equal((await validate(s, second)).result?.status, "VALID");
  assert.equal((await validate(s, first, first.source, 2)).result?.status, "INVALID");
  assert.equal((await s.request({ ...candidate(first), schemaId: second.schemaId })).result?.status, "ASSOCIATION_UNAVAILABLE");
}));

await check("equal canonical strings retain distinct real template occurrences and associations", () => withProject(async (s, records) => {
  const first = evidence(records, "equalNumber"), second = evidence(records, "equalString");
  assert.equal(first.canonical, second.canonical);
  assert.notEqual(first.templateId, second.templateId);
  assert.notEqual(first.applicationId, second.applicationId);
  assert.notEqual(first.associationId, second.associationId);
  await associate(s, first); await associate(s, second);
  assert.equal((await validate(s, second)).result?.status, "VALID");
  assert.equal((await validate(s, first)).result?.status, "INVALID");
  assert.equal((await validate(s, second, second.source, 2)).result?.status, "VALID");
}));

await check("actual rejected attachment retains authoritative diagnostics and successful attachment is unchanged", () => withProject(async (s, records) => {
  const failed = evidence(records, "oneNumber"), successful = evidence(records, "oneString");
  assert.equal(failed.attachment, "rejected");
  assert.equal(successful.attachment, "attached");
  await associate(s, failed); await associate(s, successful);
  const result = await validate(s, failed);
  assert.equal(result.result?.status, "INVALID");
  assert.equal(result.result.diagnostics[0]?.expected, "number");
  assert.equal(result.result.diagnostics[0]?.code, "TYPE_MISMATCH");
  assert.deepEqual(result.result.diagnostics[0]?.path, ["name"]);
  sourceSlice(result.result.diagnostics[0], failed.source, "exact", `"x"`);
  assert.equal((await validate(s, successful)).result?.status, "VALID");
  // Fixture asserts actual LiveMapSchemaError, unchanged capture, absent/preserved schema.get().
}));

await check("real intervening mutation and mutate-then-revert automatically suppress attribution", () => withProject(async (s, records) => {
  const direct = evidence(records, "string");
  assert.equal(direct.constructedRevision, direct.attemptRevision);
  await associate(s, direct);
  assert.equal((await validate(s, direct)).result?.status, "VALID");
  for (const id of ["mutated", "roundtrip"]) {
    const record = evidence(records, id);
    assert.ok(record.attemptRevision > record.constructedRevision);
    assert.equal(record.correspondence, "unavailable");
    assert.equal((await s.request({ type: "associate", associationId: record.associationId })).error, "ASSOCIATION_UNAVAILABLE");
    assert.equal((await validate(s, record)).result?.status, "ASSOCIATION_UNAVAILABLE");
  }
  // No request supplies a mutation verdict or a caller-invented direct association.
  assert.equal((await s.request({ type: "associate", associationId: "invented" })).error, "ASSOCIATION_UNAVAILABLE");
}));

await check("actual document Schema validates fresh candidates with exact and anchored C2 slices", () => withProject(async (s, records) => {
  const record = evidence(records, "document"); await associate(s, record);
  const source = `<button count="bad"/>`;
  const result = await validate(s, record, source);
  assert.equal(result.result?.status, "INVALID");
  assert.equal(result.result.diagnostics[0]?.attributeName, "count");
  sourceSlice(result.result.diagnostics[0], source, "exact", `"bad"`);
  assert.equal(result.result.diagnostics[0]?.range.start, 14);
  assert.equal(result.result.diagnostics[1]?.code, "MISSING_REQUIRED");
  sourceSlice(result.result.diagnostics[1], source, "anchor", "/>");
  const wrong = await validate(s, record, `<span/>`, 2);
  sourceSlice(wrong.result?.diagnostics[0], `<span/>`, "exact", `<span/>`);
  assert.equal((await validate(s, record, record.source, 3)).result?.status, "VALID");
}));

await check("syntax failure and stale template revisions remain distinct from Schema mismatch", () => withProject(async (s, records) => {
  const record = evidence(records, "age"); await associate(s, record);
  assert.equal((await validate(s, record, `<age`)).result?.status, "CANDIDATE_INVALID");
  assert.equal((await s.request({ ...candidate(record), templateRevision: record.templateRevision + 1 })).result?.status, "ASSOCIATION_UNAVAILABLE");
}));

await check("actual document root-mode issue transports unresolved without fabricated offsets", () => withProject(async (s, records) => {
  const record = evidence(records, "fragment"); await associate(s, record);
  const response = await validate(s, record, `<div/>`);
  assert.equal(response.type, "result");
  assert.equal(response.error, undefined);
  assert.equal(response.result?.status, "INVALID");
  assert.equal(response.result.diagnostics[0]?.code, "TYPE_MISMATCH");
  assert.equal(response.result.diagnostics[0]?.expected, "fragment document root");
  assert.deepEqual(response.result.diagnostics[0]?.range, { precision: "unresolved" });
}));

await check("all trust combinations guard spawn, project import, registration, and execution", async () => {
  for (const workspaceTrusted of [false, true]) for (const enabled of [false, true]) {
    let spawns = 0;
    const s = supervisor({ trust: { workspaceTrusted, enabled }, spawnRuntime: (entry, options) => { spawns += 1; return fork(entry, [], options); } });
    try {
      if (workspaceTrusted && enabled) {
        const records = await loaded(s); const record = evidence(records, "string");
        await associate(s, record);
        assert.equal((await validate(s, record)).result?.status, "VALID");
        assert.equal(spawns, 1);
        assert.match(s.output.stdout, /D1_PROJECT_EXECUTED/);
        assert.match(s.output.stdout, /D1_SCHEMA_REGISTERED/);
      } else {
        await assert.rejects(() => s.start(), infrastructure("TRUST_REQUIRED"));
        await assert.rejects(() => loaded(s), infrastructure("TRUST_REQUIRED"));
        assert.equal(spawns, 0);
        assert.equal(s.generation, 0);
        assert.equal(s.running, false);
        assert.deepEqual(s.output, { stdout: "", stderr: "" });
      }
    } finally { s.dispose(); }
  }
});

await check("constraint throw remains validation-execution failure rather than Schema mismatch", () => withProject(async (s, records) => {
  const record = evidence(records, "throwing"); await associate(s, record);
  const response = await validate(s, record, `<value 99>`);
  assert.equal(response.type, "error");
  assert.equal(response.error, "VALIDATION_THROW");
  assert.equal(response.message, "fixture constraint throw");
  assert.equal(response.result, undefined);
}));

await check("blocking constraint is killed at deadline, recovers validation, and exhausts a real restart budget", async () => {
  const children: ChildProcess[] = [];
  const s = supervisor({ maxRestarts: 1, spawnRuntime: (entry, options) => { const child = fork(entry, [], options); children.push(child); return child; } });
  try {
    const record = evidence(await loaded(s), "hang"); await associate(s, record);
    const child = children[0]; assert.ok(child);
    const exited = once(child, "exit");
    const oldGeneration = s.generation;
    let responsive = false;
    const responsiveTimer = setTimeout(() => { responsive = true; }, 20);
    let publications = 0;
    const started = performance.now();
    await assert.rejects(() => s.request(candidate(record, `<value 99>`), 120).then(result => { publications += 1; return result; }), infrastructure("REQUEST_TIMEOUT"));
    clearTimeout(responsiveTimer);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 100 && elapsed < 2_000, `external deadline took ${elapsed}ms`);
    assert.equal(responsive, true);
    assert.match(s.output.stdout, /D1_CONSTRAINT_ENTERED/);
    assert.equal(child.killed, true);
    assert.equal(s.running, false);
    assert.equal(s.activeGeneration, undefined);
    assert.equal(child.listenerCount("message"), 0);
    const exitResult = await exited;
    assert.equal(exitResult[1], "SIGKILL");
    const recoveryStart = performance.now();
    await s.start();
    assert.ok(performance.now() - recoveryStart < 3_500);
    assert.ok(s.generation > oldGeneration);
    assert.equal(s.restarts, 1);
    const recovered = evidence(await loaded(s), "string"); await associate(s, recovered);
    const validationStart = performance.now();
    assert.equal((await validate(s, recovered)).result?.status, "VALID");
    process.stdout.write(`# D1 recovery timeout=${elapsed.toFixed(2)}ms validation=${(performance.now() - validationStart).toFixed(2)}ms\n`);
    child.emit("message", { ...candidate(record), runtimeGeneration: oldGeneration, type: "result", result: { status: "VALID", diagnostics: [] } });
    await turn(); assert.equal(publications, 0);
    s.terminate();
    await assert.rejects(() => s.request({ type: "ping" }), infrastructure("RESTART_BUDGET_EXHAUSTED"));
    await assert.rejects(() => s.start(), infrastructure("RESTART_BUDGET_EXHAUSTED"));
    assert.equal(children.length, 2);
    assert.equal(s.restarts, 1);
    assert.equal(s.running, false);
  } finally { s.dispose(); }
});

class ControlledRuntime extends EventEmitter {
  connected = true;
  killed = false;
  readonly requests: TrustedSchemaRequest[] = [];
  send(request: TrustedSchemaRequest, callback: (error: Error | null) => void): void {
    this.requests.push(request); callback(null);
    if (request.type === "handshake") queueMicrotask(() => this.deliver(request, { type: "ready" }));
  }
  kill(): void { this.killed = true; this.connected = false; this.emit("exit", null, "SIGKILL"); }
  deliver(request: TrustedSchemaRequest, override: Partial<TrustedSchemaResponse> = {}): void {
    this.emit("message", { protocolVersion: 1, requestId: request.requestId, runtimeGeneration: request.runtimeGeneration, type: "result", result: { status: "VALID", diagnostics: [] }, ...override });
  }
}
await check("late dead-generation responses cannot publish even with the current request ID", async () => {
  const children: ControlledRuntime[] = [];
  const s = supervisor({ spawnRuntime: () => { const child = new ControlledRuntime(); children.push(child); return child; } });
  try {
    await s.start();
    const first = children[0]; assert.ok(first);
    const publications: TrustedSchemaResponse[] = [];
    const pending = s.request({ type: "ping" }).then(result => { publications.push(result); return result; });
    const rejected = assert.rejects(pending, infrastructure("RUNTIME_RETIRED"));
    await turn();
    const oldRequest = first.requests.at(-1); assert.ok(oldRequest);
    const alreadyQueued = first.listeners("message");
    assert.equal(alreadyQueued.length, 1);
    s.terminate(); await rejected;
    await s.start();
    const second = children[1]; assert.ok(second);
    let accepted = false;
    const current = s.request({ type: "ping" }).then(result => { accepted = true; publications.push(result); return result; });
    await turn();
    const currentRequest = second.requests.at(-1); assert.ok(currentRequest);
    assert.notEqual(oldRequest.runtimeGeneration, currentRequest.runtimeGeneration);
    first.deliver(oldRequest);
    const stale: TrustedSchemaResponse = { protocolVersion: 1, requestId: currentRequest.requestId, runtimeGeneration: oldRequest.runtimeGeneration, type: "result", result: { status: "INVALID", diagnostics: [] } };
    for (const listener of alreadyQueued) listener({ ...stale, requestId: oldRequest.requestId });
    second.emit("message", stale); // Matching CURRENT request ID deliberately removes that alternative explanation.
    await turn();
    assert.equal(accepted, false); assert.deepEqual(publications, []);
    second.deliver(currentRequest);
    assert.equal((await current).runtimeGeneration, s.generation);
    assert.equal(publications.length, 1);
  } finally { s.dispose(); }
  // A failed replacement spawn consumes its slot as well; stabilization never resets budget.
  let spawns = 0;
  const failed = supervisor({ maxRestarts: 1, spawnRuntime: () => { spawns += 1; if (spawns > 1) throw new Error("fixture spawn failure"); return new ControlledRuntime(); } });
  try {
    await failed.start(); failed.terminate();
    await assert.rejects(() => failed.start(), /fixture spawn failure/);
    assert.equal(failed.restarts, 1);
    await assert.rejects(() => failed.start(), infrastructure("RESTART_BUDGET_EXHAUSTED"));
    assert.equal(spawns, 2);
  } finally { failed.dispose(); }
});

await check("all public entrypoints exclude D1 values, types, registry, and diagnostic sidecars", () => {
  const packagePath = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const entries: string[] = [];
  function collect(value: unknown): void {
    if (typeof value === "string") {
      assert.doesNotMatch(value, /trusted-schema-diagnostics/);
      entries.push(fileURLToPath(new URL(value.replace(/^\.\/dist\//, "./src/").replace(/\.d\.ts$|\.js$/, ".ts"), packagePath)));
    } else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  collect(pkg.exports);
  const program = ts.createProgram([...new Set(entries)], { noEmit: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext, skipLibCheck: true });
  const checker = program.getTypeChecker();
  for (const path of new Set(entries)) {
    const file = program.getSourceFile(path); assert.ok(file, path);
    const module = checker.getSymbolAtLocation(file); assert.ok(module, path);
    for (const exported of checker.getExportsOfModule(module)) {
      assert.doesNotMatch(exported.name, /TrustedSchema|trusted_schema|TRUSTED_SCHEMA|is_owned_projected_schema/);
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      for (const declaration of symbol.declarations ?? []) assert.doesNotMatch(declaration.getSourceFile().fileName, /trusted-schema-diagnostics/);
    }
  }
});

await check("executed warm-path instrumentation reports load, first, constrained repeats, and document stages", () => withProjectTimings());
async function withProjectTimings(): Promise<void> {
  const s = supervisor();
  try {
    const started = performance.now(); const records = await loaded(s); const loadMs = performance.now() - started;
    const simple = evidence(records, "string"), projected = evidence(records, "age"), document = evidence(records, "document");
    await associate(s, simple); await associate(s, projected); await associate(s, document);
    const firstStart = performance.now(); const first = await validate(s, simple); const firstMs = performance.now() - firstStart;
    assert.equal(first.result?.status, "VALID");
    const samples: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      const start = performance.now(); const result = await validate(s, projected, projected.source, index);
      samples.push(performance.now() - start); assert.equal(result.result?.status, "VALID");
    }
    const ordered = [...samples].sort((a, b) => a - b);
    const docStart = performance.now(); const doc = await validate(s, document, `<button count="bad"/>`); const docMs = performance.now() - docStart;
    assert.equal(doc.result?.status, "INVALID"); assert.ok(doc.result.timings);
    for (const value of Object.values(doc.result.timings)) assert.ok(Number.isFinite(value) && value >= 0);
    const { parseMs, validateMs, lowerMs } = doc.result.timings;
    process.stdout.write(`# D1 timings load=${loadMs.toFixed(1)}ms simple-first=${firstMs.toFixed(2)}ms constrained-warm-p50=${ordered[4].toFixed(2)}ms warm-max=${ordered[8].toFixed(2)}ms document=parse:${parseMs.toFixed(2)} validate:${validateMs.toFixed(2)} lower:${lowerMs.toFixed(2)}ms document-e2e=${docMs.toFixed(2)}ms\n`);
  } finally { s.dispose(); }
}

process.stdout.write(`# ${checks} trusted Schema D1 checks passed\n`);
emit_hson_live_test_completion("trusted-schema-d1", checks, checks, 0);

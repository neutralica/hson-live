import assert from "node:assert/strict";
import { start_schema_diagnostics, type SchemaDiagnosticClient } from "../editors/vscode-hson/src/schema-diagnostics.ts";
import type { DiagnosticDocument, DiagnosticHost } from "../editors/vscode-hson/src/diagnostics.ts";
import type { SchemaClientResult, SchemaStatus } from "../editors/vscode-hson/src/trusted-schema-client.ts";
import type { DocumentDiagnosticSpec } from "../editors/vscode-hson/src/document-diagnostics.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { schema_provider_source_changed } from "../editors/vscode-hson/src/schema-source-revision.ts";

let checks = 0;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const check = async (name: string, run: () => unknown | Promise<unknown>) => { await run(); console.log(`ok ${++checks} - ${name}`); };
function setup(initial = true) {
  let enabled = initial;
  const documents = new Map<string, DiagnosticDocument>();
  const changes = new Set<(d: DiagnosticDocument) => void>(), opens = new Set<(d: DiagnosticDocument) => void>(), closes = new Set<(d: DiagnosticDocument) => void>();
  const timers = new Map<number, () => void>(); let timerId = 0;
  const published = new Map<string, readonly DocumentDiagnosticSpec[]>();
  const statuses = new Map<string, SchemaStatus>();
  const pending: { doc: DiagnosticDocument; current: () => boolean; resolve: (r: SchemaClientResult) => void; reject: (e: Error) => void }[] = [];
  const client: SchemaDiagnosticClient = { validate: (doc, current) => new Promise((resolve, reject) => pending.push({ doc, current, resolve, reject })) };
  let clientAvailable = true, requests = 0;
  const subscribe = (set: Set<(d: DiagnosticDocument) => void>, listener: (d: DiagnosticDocument) => void) => { set.add(listener); return { dispose: () => { set.delete(listener); } }; };
  const host: DiagnosticHost = {
    openDocuments: () => [...documents.values()], onDidOpen: l => subscribe(opens, l), onDidChange: l => subscribe(changes, l), onDidClose: l => subscribe(closes, l),
    setTimer: callback => { timers.set(++timerId, callback); return timerId; }, clearTimer: id => { if (typeof id === "number") timers.delete(id); }, reportUnexpected: e => { throw e; },
  };
  const controller = start_schema_diagnostics(host, { set: (doc, specs) => { published.set(doc.uri, specs); }, delete: uri => { published.delete(uri); } }, {
    enabled: () => enabled, clientFor: () => { requests++; return clientAvailable ? client : undefined; }, status: (doc, status) => { statuses.set(doc.uri, status); },
  });
  const open = (version = 1, uri = "file:///project/user.ts", text = `source-${version}`) => { const doc = { uri, fileName: "/project/user.ts", languageId: "typescript", version, text }; documents.set(uri, doc); for (const listener of opens) listener(doc); return doc; };
  const edit = (doc: DiagnosticDocument, text = "edited") => { const next = { ...doc, version: doc.version + 1, text }; documents.set(doc.uri, next); for (const listener of changes) listener(next); return next; };
  const flush = () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(fn => fn()); };
  const close = (doc: DiagnosticDocument) => { documents.delete(doc.uri); for (const listener of closes) listener(doc); };
  const invalid: SchemaClientResult = { status: "current-invalid", diagnostics: [{ message: "Expected number", range: { start: 1, end: 2 }, precision: "exact", source: "HSON", related: [] }] };
  return { controller, open, edit, flush, close, pending, published, statuses, timers, documents, invalid,
    enable: (value: boolean) => { enabled = value; }, unavailable: () => { clientAvailable = false; }, requests: () => requests };
}
await check("disabled trust gate never requests a client", () => { const s = setup(false); const d = s.open(); s.flush(); assert.equal(s.requests(), 0); assert.equal(s.statuses.get(d.uri), "off"); s.controller.dispose(); });
await check("open document waits for asynchronous debounce", () => { const s = setup(); s.open(); assert.equal(s.pending.length, 0); assert.equal(s.timers.size, 1); s.flush(); assert.equal(s.pending.length, 1); s.controller.dispose(); });
await check("current invalid publishes", async () => { const s = setup(); const d = s.open(); s.flush(); s.pending[0]!.resolve(s.invalid); await turn(); assert.equal(s.published.get(d.uri)?.length, 1); assert.equal(s.statuses.get(d.uri), "current-invalid"); s.controller.dispose(); });
await check("source edit clears old diagnostics immediately", async () => { const s = setup(); const d = s.open(); s.flush(); s.pending[0]!.resolve(s.invalid); await turn(); s.edit(d); assert.equal(s.published.has(d.uri), false); s.controller.dispose(); });
await check("new edit invalidates pending request before debounce", () => { const s = setup(); const d = s.open(); s.flush(); s.edit(d); assert.equal(s.pending[0]!.current(), false); s.controller.dispose(); });
await check("late response cannot flash after newer edit", async () => { const s = setup(); const d = s.open(); s.flush(); s.edit(d); s.pending[0]!.resolve(s.invalid); await turn(); assert.equal(s.published.has(d.uri), false); s.controller.dispose(); });
await check("new valid result clears old invalid result", async () => { const s = setup(); const d = s.open(); s.flush(); s.edit(d); s.flush(); s.pending[1]!.resolve({ status: "current-valid", diagnostics: [] }); await turn(); s.pending[0]!.resolve(s.invalid); await turn(); assert.deepEqual(s.published.get(d.uri), []); assert.equal(s.statuses.get(d.uri), "current-valid"); s.controller.dispose(); });
await check("rapid edits coalesce to one request", () => { const s = setup(); let d = s.open(); for (let i = 0; i < 5; i++) d = s.edit(d); s.flush(); assert.equal(s.pending.length, 1); assert.equal(s.pending[0]!.doc.version, 6); s.controller.dispose(); });
await check("closing document cancels pending publication", async () => { const s = setup(); const d = s.open(); s.flush(); s.close(d); s.pending[0]!.resolve(s.invalid); await turn(); assert.equal(s.published.has(d.uri), false); s.controller.dispose(); });
await check("closing document cancels scheduled request", () => { const s = setup(); const d = s.open(); s.close(d); s.flush(); assert.equal(s.pending.length, 0); s.controller.dispose(); });
await check("reopened same-version document has new identity ticket", async () => { const s = setup(); const d = s.open(); s.flush(); s.close(d); s.open(); s.pending[0]!.resolve(s.invalid); await turn(); assert.equal(s.published.has(d.uri), false); s.controller.dispose(); });
await check("trust disable clears pending and published results", async () => { const s = setup(); const d = s.open(); s.flush(); s.enable(false); s.controller.retire(); s.pending[0]!.resolve(s.invalid); await turn(); assert.equal(s.published.has(d.uri), false); assert.equal(s.statuses.get(d.uri), "off"); s.controller.dispose(); });
await check("generation retirement cancels every document result", async () => { const s = setup(); const d = s.open(); s.flush(); s.controller.retire(); s.pending[0]!.resolve(s.invalid); await turn(); assert.equal(s.published.has(d.uri), false); assert.equal(s.statuses.get(d.uri), "stale"); s.controller.dispose(); });
await check("timeout status is infrastructure, not content diagnostic", () => { const s = setup(); const d = s.open(); s.controller.retire("runtime-failed", "Timed out"); assert.equal(s.statuses.get(d.uri), "runtime-failed"); assert.equal(s.published.has(d.uri), false); s.controller.dispose(); });
await check("missing mapping is unavailable, never valid", async () => { const s = setup(); const d = s.open(); s.flush(); s.pending[0]!.resolve({ status: "unavailable", diagnostics: [] }); await turn(); assert.equal(s.statuses.get(d.uri), "unavailable"); s.controller.dispose(); });
await check("ambiguous mapping is distinct", async () => { const s = setup(); const d = s.open(); s.flush(); s.pending[0]!.resolve({ status: "ambiguous", diagnostics: [] }); await turn(); assert.equal(s.statuses.get(d.uri), "ambiguous"); s.controller.dispose(); });
await check("runtime rejection does not create authored errors", async () => { const s = setup(); const d = s.open(); s.flush(); s.pending[0]!.reject(new Error("crash")); await turn(); assert.equal(s.published.has(d.uri), false); assert.equal(s.statuses.get(d.uri), "runtime-failed"); s.controller.dispose(); });
await check("unconfigured runtime does not imply validity", () => { const s = setup(); const d = s.open(); s.unavailable(); s.flush(); assert.equal(s.statuses.get(d.uri), "unavailable"); assert.equal(s.pending.length, 0); s.controller.dispose(); });
await check("dispose prevents late publication", async () => { const s = setup(); const d = s.open(); s.flush(); s.controller.dispose(); s.pending[0]!.resolve(s.invalid); await turn(); assert.equal(s.published.has(d.uri), false); });
await check("independent documents do not supersede one another", async () => { const s = setup(); const a = s.open(); const b = s.open(1, "file:///project/other.ts"); s.flush(); s.pending[0]!.resolve(s.invalid); s.pending[1]!.resolve({ status: "current-valid", diagnostics: [] }); await turn(); assert.equal(s.published.get(a.uri)?.length, 1); assert.equal(s.published.get(b.uri)?.length, 0); s.controller.dispose(); });
await check("provider candidate-only edit does not retire current Schema", () => { const before = 'import { hson } from "hson-live"; const Schema = define(); const value = hson`<age "37">`;'; assert.equal(schema_provider_source_changed('/project/provider.ts', before, before.replace('"37"', '37')), false); });
await check("provider declaration edit invalidates mapped Schema", () => { const before = 'import { hson } from "hson-live"; const Schema = define(); const value = hson`<age "37">`;'; assert.equal(schema_provider_source_changed('/project/provider.ts', before, before.replace('define()', 'otherSchema()')), true); });
emit_hson_live_test_completion("schema-d2-editor", checks, checks, 0);

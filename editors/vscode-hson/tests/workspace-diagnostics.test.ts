import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DIAGNOSTIC_SOURCE, type DocumentDiagnosticSpec } from "../src/document-diagnostics.js";
import type { DiagnosticDocument, DiagnosticPublisher, Disposable } from "../src/diagnostics.js";
import { discover_typescript_projects } from "../src/typescript-project-discovery.js";
import {
  start_workspace_diagnostics,
  type WorkspaceDiagnosticHost,
  type WorkspaceDiagnosticSource,
  type WorkspaceSourceChange,
} from "../src/workspace-diagnostics.js";

let checks = 0;
async function check(name: string, body: () => void | Promise<void>): Promise<void> {
  await body();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function fixture(root: string, relative: string, text = "export {};"): string {
  const fileName = join(root, relative);
  mkdirSync(join(fileName, ".."), { recursive: true });
  writeFileSync(fileName, text);
  return fileName;
}

class Publisher implements DiagnosticPublisher {
  readonly values = new Map<string, readonly DocumentDiagnosticSpec[]>();
  readonly writes: string[] = [];
  set(document: DiagnosticDocument, diagnostics: readonly DocumentDiagnosticSpec[]): void {
    this.values.set(document.uri, diagnostics);
    this.writes.push(`${document.uri}:${diagnostics[0]?.message ?? "clear"}`);
  }
  delete(uri: string): void { this.values.delete(uri); this.writes.push(`${uri}:delete`); }
}

type DocumentListener = (document: DiagnosticDocument) => void;
class Host implements WorkspaceDiagnosticHost {
  documents: DiagnosticDocument[] = [];
  discovered: WorkspaceDiagnosticSource[] = [];
  readonly contents = new Map<string, string>();
  readonly opens = new Set<DocumentListener>();
  readonly changes = new Set<DocumentListener>();
  readonly closes = new Set<DocumentListener>();
  readonly sourceChanges = new Set<(changes: readonly WorkspaceSourceChange[]) => void>();
  readonly projectChanges = new Set<() => void>();
  readonly timers = new Map<number, () => void>();
  readonly readGates = new Map<string, Promise<string>>();
  readonly unexpected: unknown[] = [];
  private timerId = 0;
  openDocuments(): readonly DiagnosticDocument[] { return this.documents; }
  async discoverSources(): Promise<readonly WorkspaceDiagnosticSource[]> { return this.discovered; }
  async readSource(source: WorkspaceDiagnosticSource): Promise<string> { return this.readGates.get(source.uri) ?? this.contents.get(source.uri) ?? ""; }
  onDidOpen(listener: DocumentListener): Disposable { return this.add(this.opens, listener); }
  onDidChange(listener: DocumentListener): Disposable { return this.add(this.changes, listener); }
  onDidClose(listener: DocumentListener): Disposable { return this.add(this.closes, listener); }
  onDidChangeSources(listener: (changes: readonly WorkspaceSourceChange[]) => void): Disposable { return this.add(this.sourceChanges, listener); }
  onDidChangeProjects(listener: () => void): Disposable { return this.add(this.projectChanges, listener); }
  setTimer(callback: () => void): unknown { const id = ++this.timerId; this.timers.set(id, callback); return id; }
  clearTimer(timer: unknown): void { this.timers.delete(Number(timer)); }
  async yield(): Promise<void> {}
  reportUnexpected(error: unknown): void { this.unexpected.push(error); }
  fire<T>(listeners: Set<(value: T) => void>, value: T): void { for (const listener of listeners) listener(value); }
  runTimers(): void { const callbacks = [...this.timers.values()]; this.timers.clear(); for (const callback of callbacks) callback(); }
  private add<T>(listeners: Set<T>, listener: T): Disposable { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; }
}

function source(fileName: string, languageId: WorkspaceDiagnosticSource["languageId"] = "typescript"): WorkspaceDiagnosticSource {
  return { uri: pathToFileURL(fileName).href, fileName, languageId };
}

function document(value: WorkspaceDiagnosticSource, text: string, version: number): DiagnosticDocument {
  return { ...value, text, version };
}

const produce = (input: { text: string }): readonly DocumentDiagnosticSpec[] => input.text === "valid" ? [] : [{
  message: input.text,
  range: { start: 0, end: input.text.length },
  source: DIAGNOSTIC_SOURCE,
  precision: "fallback",
  related: [],
}];

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function main(): Promise<void> {
  await check("TypeScript discovery honors extends, include/exclude, references, outputs, generated files, declarations, and duplicate ownership", () => {
    const root = mkdtempSync(join(tmpdir(), "hson-projects-"));
    fixture(root, "base.json", JSON.stringify({ compilerOptions: { strict: true } }));
    fixture(root, "tsconfig.json", JSON.stringify({ extends: "./base.json", include: ["src/**/*.ts", "shared/**/*.tsx"], exclude: ["src/excluded/**"], compilerOptions: { outDir: "build" }, references: [{ path: "./referenced" }] }));
    fixture(root, "tsconfig.second.json", JSON.stringify({ include: ["shared/**/*.tsx"] }));
    fixture(root, "referenced/tsconfig.json", JSON.stringify({ include: ["src/**/*.ts"] }));
    const main = fixture(root, "src/main.ts");
    const shared = fixture(root, "shared/view.tsx");
    const referenced = fixture(root, "referenced/src/ref.ts");
    fixture(root, "src/excluded/no.ts");
    fixture(root, "build/output.ts");
    fixture(root, "src/types.d.ts");
    fixture(root, "src/user.Foo.hson-schema.generated.ts");
    fixture(root, "node_modules/pkg/index.ts");
    const discovery = discover_typescript_projects([root]);
    assert.deepEqual(discovery.errors, []);
    assert.deepEqual(discovery.sources.map(item => item.fileName).sort(), [main, referenced, shared].sort());
    assert.equal(discovery.sources.find(item => item.fileName === shared)?.owners.length, 2);
  });

  await check("startup diagnoses unopened TS and standalone Hson without Schema systems", async () => {
    const host = new Host(); const publisher = new Publisher();
    const tsSource = source("/workspace/unopened.ts");
    const hsonSource = source("/workspace/unopened.hson", "hson");
    host.discovered = [tsSource, hsonSource];
    host.contents.set(tsSource.uri, "Hson bad"); host.contents.set(hsonSource.uri, "bad");
    const controller = start_workspace_diagnostics(host, publisher, { produce, readConcurrency: 1 });
    await settle();
    assert.equal(publisher.values.get(tsSource.uri)?.[0]?.message, "Hson bad");
    assert.equal(publisher.values.get(hsonSource.uri)?.[0]?.message, "bad");
    controller.dispose();
  });

  await check("file pragma suppresses unopened, open, closed, and reopened ordinary diagnostics independent of Schema Watch", async () => {
    const host = new Host(); const publisher = new Publisher();
    const ignored = source("/workspace/ignored.hson", "hson");
    const ordinary = source("/workspace/ordinary.hson", "hson");
    const ignoredText = "// @hson-diagnostics-ignore-file\n+1";
    host.discovered = [ignored, ordinary];
    host.contents.set(ignored.uri, ignoredText); host.contents.set(ordinary.uri, "+1");
    const controller = start_workspace_diagnostics(host, publisher, { readConcurrency: 1 });
    await settle();
    assert.deepEqual(publisher.values.get(ignored.uri), []);
    assert.equal(publisher.values.get(ordinary.uri)?.length, 1);

    const opened = document(ignored, ignoredText, 1);
    host.documents = [opened]; host.fire(host.opens, opened);
    assert.deepEqual(publisher.values.get(ignored.uri), []);
    host.documents = []; host.fire(host.closes, opened); await settle();
    assert.deepEqual(publisher.values.get(ignored.uri), []);
    const reopened = document(ignored, ignoredText, 2);
    host.documents = [reopened]; host.fire(host.opens, reopened);
    assert.deepEqual(publisher.values.get(ignored.uri), []);
    controller.dispose();
  });

  await check("open text is unique authority, unsaved edits win, and close restores disk", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/value.ts");
    host.discovered = [value]; host.contents.set(value.uri, "Hson disk");
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    const opened = document(value, "Hson open", 1); host.documents = [opened]; host.fire(host.opens, opened);
    assert.equal(publisher.values.get(value.uri)?.[0]?.message, "Hson open");
    const dirty = document(value, "valid", 2); host.documents = [dirty]; host.fire(host.changes, dirty); host.runTimers();
    assert.deepEqual(publisher.values.get(value.uri), []);
    host.fire(host.sourceChanges, [{ uri: value.uri, kind: "change" }]); await settle();
    assert.deepEqual(publisher.values.get(value.uri), []);
    host.documents = []; host.fire(host.closes, dirty); await settle();
    assert.equal(publisher.values.get(value.uri)?.[0]?.message, "Hson disk");
    assert.equal(publisher.writes.filter(write => write === `${value.uri}:Hson open`).length, 1);
    controller.dispose();
  });

  await check("change, create, delete, rename, and membership refresh touch relevant URIs", async () => {
    const host = new Host(); const publisher = new Publisher(); const first = source("/a/first.ts"); const second = source("/b/second.hson", "hson");
    host.discovered = [first]; host.contents.set(first.uri, "Hson bad");
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    host.contents.set(first.uri, "valid"); host.fire(host.sourceChanges, [{ uri: first.uri, kind: "change" }]); await settle();
    assert.deepEqual(publisher.values.get(first.uri), []);
    host.discovered = [first, second]; host.contents.set(second.uri, "new"); host.fire(host.sourceChanges, [{ uri: second.uri, kind: "create" }]); host.runTimers(); await settle();
    assert.equal(publisher.values.get(second.uri)?.[0]?.message, "new");
    host.fire(host.sourceChanges, [{ uri: first.uri, kind: "delete" }]); await settle();
    assert.equal(publisher.values.has(first.uri), false);
    host.discovered = [second]; host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    assert.equal(publisher.values.has(first.uri), false); assert.equal(publisher.values.has(second.uri), true);
    controller.dispose();
  });

  await check("stale disk work cannot overwrite newer editor or disk state", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/race.ts");
    let resolveOld: (text: string) => void = () => {};
    host.readGates.set(value.uri, new Promise(resolve => { resolveOld = resolve; })); host.discovered = [value];
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    const opened = document(value, "Hson editor", 1); host.documents = [opened]; host.fire(host.opens, opened);
    resolveOld("Hson stale"); await settle();
    assert.equal(publisher.values.get(value.uri)?.[0]?.message, "Hson editor");
    controller.dispose();
  });

  process.stdout.write(`ok - ${checks} workspace diagnostics checks passed\n`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

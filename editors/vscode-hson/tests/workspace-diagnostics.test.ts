import assert from "node:assert/strict";
import { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { discover_hson_tagged_templates, hson_source_alias_target, hson_source_syntactic_eligibility } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";

import { DIAGNOSTIC_SOURCE, produce_document_diagnostics, type DocumentDiagnosticSpec } from "../src/document-diagnostics.js";
import type { DiagnosticDocument, DiagnosticPublisher, Disposable } from "../src/diagnostics.js";
import { discover_typescript_projects, TypeScriptProjectScanner } from "../src/typescript-project-discovery.js";
import { event_source_imports } from "../src/event-source-evidence.js";
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
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

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
  readonly reads: WorkspaceDiagnosticSource[] = [];
  readonly discoveryGates: Promise<readonly WorkspaceDiagnosticSource[]>[] = [];
  readonly unexpected: unknown[] = [];
  private timerId = 0;
  openDocuments(): readonly DiagnosticDocument[] { return this.documents; }
  async discoverSources(): Promise<readonly WorkspaceDiagnosticSource[]> { return this.discoveryGates.shift() ?? this.discovered; }
  async readSource(source: WorkspaceDiagnosticSource): Promise<string> {
    this.reads.push(source);
    return this.readGates.get(source.uri) ?? this.contents.get(source.uri) ?? "";
  }
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
  // Drain promise continuations; all race ordering is controlled by explicit gates.
  await new Promise<void>(resolve => setImmediate(resolve));
}

async function main(): Promise<void> {
  const invalid = 'import { Hson } from "hson-live";\nHson.data`+1`;\nHson.document`<main @:x @:y/>`;';
  const valid = invalid.replace('+1', '1').replace(' @:y', '');
  await check("ordinary diagnostics have exact source parity across TypeScript formats and exclude non-sources", () => {
    const expected = produce_document_diagnostics({ fileName: '/workspace/source.ts', languageId: 'typescript', text: invalid });
    assert.deepEqual(expected.map(value => value.code), ['HSON_NUMBER_LEADING_PLUS', 'HSON_LIBRARY_QUAD_DUPLICATE']);
    assert.deepEqual(expected[0]?.range, { start: invalid.indexOf('+1'), end: invalid.indexOf('+1') + 1 });
    assert.deepEqual(expected[1]?.range, { start: invalid.indexOf('@:y'), end: invalid.indexOf('@:y') + 1 });
    assert.deepEqual(expected[1]?.related[0]?.range, { start: invalid.indexOf('@:x'), end: invalid.indexOf('@:x') + 1 });
    for (const ext of ['ts', 'tsx', 'mts', 'cts']) {
      const input = { fileName: `/workspace/source.${ext}`, languageId: ext === 'tsx' ? 'typescriptreact' : 'typescript', text: invalid };
      assert.deepEqual(produce_document_diagnostics(input), expected, ext);
      assert.deepEqual(produce_document_diagnostics({ ...input, text: valid }), []);
    }
    for (const name of ['source.d.ts', 'source.d.mts', 'source.d.cts', 'source.S.hson-schema.generated.ts', 'source.S.hson-schema.generated.mts', 'source.js', 'source.mtsx', 'node_modules/pkg/source.cts']) {
      assert.deepEqual(produce_document_diagnostics({ fileName: `/workspace/${name}`, languageId: 'typescript', text: invalid }), [], name);
    }
  });

  for (const ext of ['mts', 'cts']) await check(`unopened .${ext} creation, modification, rename and deletion clear real diagnostics`, async () => {
    const host = new Host(); const publisher = new Publisher();
    const first = source(`/workspace/source.${ext}`); const renamed = source(`/workspace/renamed.${ext}`);
    const controller = start_workspace_diagnostics(host, publisher);
    await settle();
    host.discovered = [first]; host.contents.set(first.uri, invalid);
    host.fire(host.sourceChanges, [{ uri: first.uri, kind: 'create' }]); host.runTimers(); await settle();
    assert.deepEqual(publisher.values.get(first.uri)?.map(value => value.code), ['HSON_NUMBER_LEADING_PLUS', 'HSON_LIBRARY_QUAD_DUPLICATE']);
    host.contents.set(first.uri, valid); host.fire(host.sourceChanges, [{ uri: first.uri, kind: 'change' }]); await settle();
    assert.deepEqual(publisher.values.get(first.uri), []);
    host.discovered = [renamed]; host.contents.delete(first.uri); host.contents.set(renamed.uri, invalid);
    host.fire(host.sourceChanges, [{ uri: first.uri, kind: 'delete' }, { uri: renamed.uri, kind: 'create' }]); host.runTimers(); await settle();
    assert.equal(publisher.values.has(first.uri), false);
    assert.equal(publisher.values.get(renamed.uri)?.length, 2);
    host.discovered = []; host.contents.delete(renamed.uri);
    host.fire(host.sourceChanges, [{ uri: renamed.uri, kind: 'delete' }]); host.runTimers(); await settle();
    assert.equal(publisher.values.has(renamed.uri), false);
    assert.deepEqual(host.unexpected, []);
    controller.dispose();
  });

  await check("TypeScript discovery honors extends, include/exclude, references, outputs, generated files, declarations, and duplicate ownership", () => {
    const root = mkdtempSync(join(tmpdir(), "hson-projects-"));
    fixture(root, "base.json", JSON.stringify({ compilerOptions: { strict: true } }));
    fixture(root, "tsconfig.json", JSON.stringify({ extends: "./base.json", include: ["src/**/*", "shared/**/*.tsx"], exclude: ["src/excluded/**"], compilerOptions: { outDir: "build" }, references: [{ path: "./referenced" }] }));
    fixture(root, "tsconfig.second.json", JSON.stringify({ include: ["shared/**/*.tsx"] }));
    fixture(root, "referenced/tsconfig.json", JSON.stringify({ include: ["src/**/*.ts"] }));
    const main = fixture(root, "src/main.ts");
    const esm = fixture(root, "src/esm.mts");
    const cjs = fixture(root, "src/cjs.cts");
    const shared = fixture(root, "shared/view.tsx");
    const referenced = fixture(root, "referenced/src/ref.ts");
    fixture(root, "src/excluded/no.ts");
    fixture(root, "build/output.ts");
    fixture(root, "src/types.d.ts");
    fixture(root, "src/types.d.mts");
    fixture(root, "src/types.d.cts");
    fixture(root, "src/user.Foo.hson-schema.generated.mts");
    fixture(root, "src/user.Foo.hson-schema.generated.cts");
    fixture(root, "src/user.Foo.hson-schema.generated.ts");
    fixture(root, "node_modules/pkg/index.ts");
    const discovery = discover_typescript_projects([root]);
    assert.deepEqual(discovery.errors, []);
    assert.deepEqual(discovery.sources.map(item => item.fileName).sort(), [main, esm, cjs, referenced, shared].sort());
    assert.equal(discovery.sources.find(item => item.fileName === shared)?.owners.length, 2);
  });

  await check("Event proof covers imported application files and follows resolution and exact snapshots", () => {
    const root = mkdtempSync(join(tmpdir(), "hson-project-event-proof-"));
    try {
      fixture(root, "package.json", '{"type":"module"}');
      fixture(root, "node_modules/hson-live/package.json",
        '{"name":"hson-live","type":"module","exports":{"./hson":"./dist/hson-authoring.d.ts"}}');
      fixture(root, "node_modules/hson-live/dist/hson-authoring.d.ts",
        "export declare const Hson: { event: typeof String.raw };");
      const config = { compilerOptions: { module: "NodeNext", allowJs: true }, files: ["app.ts"] };
      const first = fixture(root, "tsconfig.json", JSON.stringify(config));
      const remap = { ...config, compilerOptions: { ...config.compilerOptions, paths: { "hson-live/hson": ["./shim.ts"] } } };
      const second = fixture(root, "tsconfig.alternate.json", JSON.stringify(remap));
      fixture(root, "app.ts", 'import "./bridge.js";');
      fixture(root, "bridge.js", 'export { go } from "./defs/event.js";');
      const text = 'import { Hson as E } from "hson-live/hson"; export const go = E.event`<div/>`;';
      const producer = fixture(root, "defs/event.ts", text);
      const scanner = new TypeScriptProjectScanner();
      const inspect = (snapshots = new Map<string, string>(), changedFiles?: readonly string[]) => {
        const scan = scanner.scan([root], snapshots, changedFiles);
        let step = scan.next();
        while (!step.done) step = scan.next();
        return step.value.sources.find(item => item.fileName === producer)!;
      };
      const initial = inspect();
      assert.deepEqual(initial.owners, [second, first]);
      const proof = initial.eventEvidence!;
      assert.deepEqual(proof.importOffsets, [text.indexOf("E }")]);
      const imports = event_source_imports([proof], true);
      assert.equal(imports(producer, text).size, 1);
      assert.equal(imports(producer, " " + text).size, 0);
      const shim = fixture(root, "shim.ts", "export const Hson = {event: String.raw};");
      assert.deepEqual(inspect().owners, initial.owners);
      assert.equal(inspect().eventEvidence, undefined);
      assert.equal(inspect(new Map([[shim, 'export { Hson } from "hson-live/hson";']]), [shim]).eventEvidence, undefined, "a remap cycle cannot prove an export");
      rmSync(first);
      assert.deepEqual(inspect().owners, [second]);
      assert.equal(inspect().eventEvidence, undefined, "sole remapped project");
      rmSync(shim);
      assert.deepEqual(inspect().eventEvidence, proof, "the unchanged importer regains proof");
      assert.deepEqual(inspect(new Map([[producer, " " + text]]), [producer]).eventEvidence?.importOffsets, [text.indexOf("E }") + 1]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  await check("Event admission follows the configured exported value, ambient roots and type packages", () => {
    const root = mkdtempSync(join(tmpdir(), "hson-exported-event-"));
    try {
      fixture(root, "package.json", '{"type":"module"}');
      fixture(root, "pkg/package.json", JSON.stringify({ name: "hson-live", type: "module",
        exports: { ".": "./dist/index.d.ts", "./hson": "./dist/hson-authoring.d.ts" } }));
      fixture(root, "pkg/dist/index.d.ts", 'export { Hson, other } from "./hson-authoring.js";');
      fixture(root, "pkg/dist/hson-authoring.d.ts", 'declare const Hson: { event: typeof String.raw }, other: typeof Hson; export { Hson, other };');
      mkdirSync(join(root, "node_modules"));
      symlinkSync(join(root, "pkg"), join(root, "node_modules/hson-live"), "junction");
      const text = 'import {Hson as A} from "hson-live/hson"; import {Hson} from "hson-live";\n'
        + 'A.event`<div/>`; Hson.event`<div/>`; function shadow(A: typeof Hson) { A.event`<div/>`; }';
      const file = fixture(root, "app.ts", text);
      const ambient = 'declare module "hson-live/hson" { export const Hson: {event: typeof String.raw}; }';
      fixture(root, "node_modules/@types/overrides/index.d.ts", ambient);
      fixture(root, "ambient.d.ts", ambient);
      const config = (options = {}, files = ["app.ts"]) => fixture(root, "tsconfig.json", JSON.stringify({
        compilerOptions: { strict: true, module: "NodeNext", types: [], ...options }, files,
      }));
      const checkBinding = (expected: boolean, expectedNative: number[] = [], rootEvent = true, sourceText = text) => {
        writeFileSync(file, sourceText);
        const { fileNames, options } = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {},
          { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")) })!;
        const program = ts.createProgram(fileNames, options);
        assert.deepEqual(program.getSemanticDiagnostics(program.getSourceFile(file)).map(d => d.code), expectedNative);
        const sites = [...expected ? ["A.event"] : [], ...rootEvent ? ["Hson.event"] : []];
        const scan = discover_typescript_projects([root]).sources.find(source => source.fileName === file)!;
        const imports = new Set(scan.eventEvidence?.importOffsets);
        const aliasOffset = sourceText.indexOf("A}"), rootOffset = sourceText.indexOf("Hson}");
        assert.deepEqual([...imports], [...expected ? [aliasOffset] : [], ...rootEvent ? [rootOffset] : []]);
        for (const tags of [discover_hson_tagged_templates(file, sourceText, program), discover_hson_tagged_templates(file, sourceText),
          discover_hson_tagged_templates(file, sourceText, program, undefined, ts, new Set([aliasOffset, rootOffset])),
          discover_hson_tagged_templates(file, sourceText, undefined, undefined, ts, imports)]) {
          assert.deepEqual(tags.sources.map(site => sourceText.slice(site.tagRange.start, site.tagRange.end)), sites);
        }
        const diagnostics = produce_document_diagnostics({ fileName: file, text: sourceText, languageId: "typescript", eventImports: imports });
        assert.deepEqual(diagnostics.map(issue => issue.code), sites.map(() => "HSON_DECLARATIVE_ROOT_REQUIRED"));
        return program;
      };
      config({ preserveSymlinks: true }); checkBinding(true);
      for (const erased of ["type A = number;", "interface A { marker: string }"]) {
        checkBinding(true, [], true, erased + "\n" + text);
        checkBinding(true, [], true, text + "\n" + erased);
      }
      checkBinding(false, [1361], true, text.replace("import {Hson as A}", "import type {Hson as A}"));
      checkBinding(false, [2339], true, text.replace("{Hson as A}", "* as A"));
      checkBinding(true, [1454], true, text.replace('"hson-live/hson";', '"hson-live/hson" with { "resolution-mode": "import" };'));
      checkBinding(true, [2322], true, text + '\nconst unrelated: number = "bad";');
      checkBinding(true, [], true, text + '\n// @ts-expect-error\nconst unrelated: number = "bad";');
      config({ noCheck: true }); checkBinding(true);
      config({ paths: { "hson-live/hson": ["./bridge.cts"] } });
      fixture(root, "bridge.cts", 'export {Hson} from "hson-live"; export = {};'); checkBinding(false);
      fixture(root, "bridge.cts", 'export {Hson} from "hson-live"; export = { Hson: { event: String.raw } };'); checkBinding(false);
      fixture(root, "bridge.cts", 'export {Hson} from "hson-live";'); checkBinding(true);
      config({ module: "Node16", paths: { "hson-live/hson": ["./bridge.cts"] } });
      fixture(root, "bridge.cts", '// @ts-ignore\nexport {Hson} from "hson-live";'); checkBinding(true);
      fixture(root, "bridge.cts", '// @ts-nocheck\nexport {Hson} from "hson-live";'); checkBinding(true);
      const paths = { "hson-live/hson": ["./bridge.mts"] };
      config({ paths, verbatimModuleSyntax: true });
      fixture(root, "sibling.mts", 'export const present = 1;');
      const missingImport = 'import { present, missing } from "./sibling.mjs"; export { present };';
      for (const [sibling, native] of [
        ['export { missing };', [2304]],
        ['export { missing } from "./sibling.mjs";', [2305]],
        ['import { missing } from "./sibling.mjs"; export { missing };', [2305]],
        ['import { present } from "./sibling.mjs" with { "resolution-mode": "import" }; export { present };', [1454]],
        [missingImport, [2305]],
        ['export { present } from "./sibling.mjs" with { type: "json" };', []],
        ['// @ts-ignore\nexport { missing };', []],
        ['export const unrelated: number = "bad";', [2322]],
        ['export type { missing };', [2304]],
        ['export { present, type missing } from "./sibling.mjs";', [2305]],
        ['export { type missing } from "./absent.mjs";', [2307]],
        ['import { present } from "./sibling.mjs"; export { present };', []],
        ['export { present } from "./sibling.mjs";', []],
      ] as const) {
        const bridge = fixture(root, "bridge.mts", 'export { Hson } from "hson-live";\n' + sibling);
        const program = checkBinding(true);
        const source = program.getSourceFile(bridge);
        assert.ok(source, sibling);
        assert.deepEqual(program.getSemanticDiagnostics(source).map(d => d.code), native, sibling);
      }
      config({ paths });
      fixture(root, "bridge.mts", 'export { Hson } from "hson-live";\n' + missingImport); checkBinding(true);
      fixture(root, "bridge.mts", 'export { Hson, missing } from "hson-live";'); checkBinding(true);
      fixture(root, "bridge.mts", 'import { Hson, missing } from "hson-live"; export { Hson };'); checkBinding(true);
      fixture(root, "bridge.mts", 'import { Hson as H, other as H } from "hson-live"; export { H as Hson };'); checkBinding(false);
      fixture(root, "bridge.mts", 'export { Hson } from "hson-live"; export namespace Hson { export const x = 0; }');
      checkBinding(false, [2339]);
      fixture(root, "bridge.mts", 'export { missing as Hson } from "./sibling.mjs";'); checkBinding(false);
      for (const erased of ["type Ink = number;", "interface Ink {}"]) {
        fixture(root, "bridge.mts", erased + ' import { Hson as Ink } from "hson-live"; export { Ink as Hson };');
        checkBinding(true);
      }
      const forbidden = 'import { Hson as Ink } from "hson-live"; declare global { export { Ink as GlobalInk }; }';
      fixture(root, "bridge.mts", forbidden + ' export { GlobalInk as Hson };');
      checkBinding(false);
      fixture(root, "bridge.mts", 'export { GlobalInk as Hson };');
      fixture(root, "official.mts", forbidden);
      fixture(root, "lookalike.mts", 'export const Ink = { event: String.raw }; declare global { export { Ink as GlobalInk }; }');
      for (const order of [["official.mts", "lookalike.mts"], ["lookalike.mts", "official.mts"]]) {
        config({ paths }, [...order, "app.ts"]);
        const program = checkBinding(false);
        for (const name of order) assert.deepEqual(program.getSemanticDiagnostics(program.getSourceFile(join(root, name)))
          .map(issue => issue.code).sort(), [2300, 2666]);
      }
      config({ paths });
      fixture(root, "bridge.mts", '// @ts-ignore\nimport defer { Hson } from "hson-live"; export { Hson };'); checkBinding(false);
      fixture(root, "bridge.mts", 'export type { Hson } from "hson-live";'); checkBinding(false, [1362]);
      config({ baseUrl: ".", paths: { "hson-live/hson": ["shim.ts"] } });
      fixture(root, "shim.ts", 'export {Hson} from "hson-live"; export default 1; export default 2;'); checkBinding(true);
      fixture(root, "shim.ts", 'export {Hson} from "hson-live";'); checkBinding(true);
      fixture(root, "bridge.ts", 'export {Hson as Other} from "hson-live";');
      fixture(root, "shim.ts", 'export {Other as Hson} from "./bridge.js";'); checkBinding(true);
      fixture(root, "shim.ts", 'import type * as NS from "hson-live"; export import Hson = NS.Hson;');
      checkBinding(false, [1361]);
      fixture(root, "local.ts", 'export const Hson = {event: String.raw};');
      for (const modules of [["hson-live", "./local.js"], ["./local.js", "hson-live"]]) {
        fixture(root, "shim.ts", modules.map(name => `export { Hson } from "${name}";`).join("\n"));
        checkBinding(false);
        fixture(root, "shim.ts", modules.map(name => `export * from "${name}";`).join("\n"));
        checkBinding(false);
      }
      fixture(root, "shim.ts", 'export * as Hson from "hson-live";'); checkBinding(false, [2339]);
      fixture(root, "shim.ts", 'export {other as Hson} from "hson-live";'); checkBinding(false);
      fixture(root, "shim.ts", 'export const Hson = {event: String.raw};'); checkBinding(false);
      const augmentation = 'import { other } from "hson-live"; declare module "./shim.js" { export { other as ';
      fixture(root, "shim.ts", 'export {Hson} from "hson-live";');
      config({ paths: { "hson-live/hson": ["./shim.ts"] }, skipLibCheck: true }, ["app.ts", "augment.d.ts"]);
      fixture(root, "augment.d.ts", augmentation + 'Hson }; }'); checkBinding(false);
      fixture(root, "augment.d.ts", augmentation + 'sibling }; }'); checkBinding(true);
      for (const erased of ["interface Hson {}", "type Hson = number;"]) {
        fixture(root, "augment.d.ts", 'export {}; declare module "./shim.js" { ' + erased + ' }');
        for (const files of [["app.ts", "augment.d.ts"], ["augment.d.ts", "app.ts"]]) {
          config({ paths: { "hson-live/hson": ["./shim.ts"] } }, files);
          const program = checkBinding(true);
          const source = program.getSourceFile(file)!;
          const checker = program.getTypeChecker();
          const selected = (name: string) => {
            const symbol = checker.getSymbolsInScope(source, ts.SymbolFlags.Alias).find(symbol => symbol.name === name)!;
            const route = hson_source_alias_target(symbol, checker, hson_source_syntactic_eligibility(ts, program), ts,
              { valueOnly: true, selection: "named" });
            assert.ok(route?.eligible);
            return route.target.valueDeclaration;
          };
          assert.deepEqual(program.getSemanticDiagnostics(program.getSourceFile(join(root, "augment.d.ts"))), []);
          assert.ok(selected("Hson"));
          assert.equal(selected("A"), selected("Hson"));
        }
        // The merged checker symbol can also hide the invalid route to its value.
        fixture(root, "shim.ts", forbidden + ' export { GlobalInk as Hson };');
        checkBinding(false);
        fixture(root, "shim.ts", 'export { Hson } from "hson-live";');
      }
      fixture(root, "augment.d.ts", 'export {}; declare module "./shim.js" { const Hson: { event: typeof String.raw }; }');
      checkBinding(false);
      fixture(root, "shim.ts", "export {};");
      fixture(root, "augment.d.ts", 'import { Hson } from "hson-live"; declare module "./shim.js" { export { Hson }; }');
      checkBinding(false);
      config({ types: ["overrides"] }); checkBinding(false);
      config({ types: ["missing-override"] }); checkBinding(false, [], false);
      config({}, ["app.ts", "ambient.d.ts"]); checkBinding(false);
      config(); checkBinding(true);
      fixture(root, "pkg/dist/index.d.ts", "export declare const Hson: { document: typeof String.raw };");
      checkBinding(true, [2339, 2339], false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  await check("physical aliases share every project vote and publish evidence for each URI", () => {
    const root = mkdtempSync(join(tmpdir(), "hson-physical-event-"));
    try {
      const text = '/* 🧪 */ import { Hson } from "hson-live/hson"; Hson.event`<div/>`;';
      const source = fixture(root, "alias-src/consumer.ts", text), copy = fixture(root, "copy.ts", text);
      symlinkSync(join(root, "alias-src"), join(root, "mirror"), "junction");
      const mirror = join(root, "mirror/consumer.ts");
      fixture(root, "package.json", '{"type":"module"}');
      fixture(root, "node_modules/hson-live/package.json",
        '{"name":"hson-live","exports":{"./hson":"./dist/hson-authoring.d.ts"}}');
      fixture(root, "node_modules/hson-live/dist/hson-authoring.d.ts", "export declare const Hson: { event: typeof String.raw };");
      fixture(root, "shim.ts", "export const Hson = {event: String.raw};");
      const options = { module: "NodeNext", strict: true, types: [] };
      const first = fixture(root, "tsconfig.json", JSON.stringify({ compilerOptions: options,
        files: ["alias-src/consumer.ts", "copy.ts"], references: [{path: "./config/mirror.json"}] }));
      const configureMirror = (disputed: boolean, output = false) => fixture(root, "config/mirror.json", JSON.stringify({
        compilerOptions: { ...options, composite: true, preserveSymlinks: true,
          ...(output ? { noEmit: true, outDir: "../mirror" } : {}),
          ...(disputed ? { paths: { "hson-live/hson": ["../shim.ts"] } } : {}) }, files: ["../mirror/consumer.ts"],
      }));
      const second = configureMirror(false);
      const scanner = new TypeScriptProjectScanner();
      const verify = (official: boolean, buffers = new Map<string, string>(), changed?: string[], publishMirror = true) => {
        const scan = scanner.scan([root], buffers, changed);
        let step = scan.next();
        while (!step.done) step = scan.next();
        const { sources } = step.value;
        assert.deepEqual(sources.map(s => s.fileName).sort(), [source, copy, ...publishMirror ? [mirror] : []].sort());
        const proof = event_source_imports(sources.flatMap(s => s.eventEvidence ? [s.eventEvidence] : []), ts.sys.useCaseSensitiveFileNames);
        for (const entry of sources) {
          const snapshot = buffers.get(entry.fileName) ?? text;
          const admitted = entry.fileName === copy || official;
          assert.deepEqual(entry.owners, entry.fileName === copy ? [first] : [first, second].sort());
          assert.equal(entry.eventEvidence?.fileName, admitted ? entry.fileName : undefined);
          assert.deepEqual(produce_document_diagnostics({ ...entry, text: snapshot, eventImports: proof(entry.fileName, snapshot) })
            .map(d => d.code), admitted ? ["HSON_DECLARATIVE_ROOT_REQUIRED"] : []);
        }
      };
      verify(true);
      configureMirror(true); verify(false);
      configureMirror(false); verify(true);
      verify(false, new Map([[mirror, " " + text]]), [mirror]);
      verify(true, new Map(), [source]);
      configureMirror(true, true); verify(false, new Map(), undefined, false);
      rmSync(join(root, "mirror")); mkdirSync(join(root, "mirror")); linkSync(source, mirror);
      configureMirror(false); verify(true);
      configureMirror(true); verify(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
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

  await check("marker-only files remain candidates on disk and after deleting an open target", async () => {
    const host = new Host(); const publisher = new Publisher();
    const value = source("/workspace/stale-expectation.ts");
    const stale = "// @hson-expect-error SOME_CODE\n";
    host.discovered = [value]; host.contents.set(value.uri, stale);
    const controller = start_workspace_diagnostics(host, publisher);
    await settle();
    assert.deepEqual(publisher.values.get(value.uri)?.map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
    const text = 'import { Hson } from "hson-live";\n// @hson-expect-error HSON_INTERPOLATION_CANONICAL_STATIC_TYPE\nHson.canonical`${{}}`;';
    const opened = document(value, text, 1);
    host.documents = [opened]; host.fire(host.opens, opened);
    assert.deepEqual(publisher.values.get(value.uri), []);
    const removed = document(value, stale, 2);
    host.documents = [removed]; host.fire(host.changes, removed); host.runTimers();
    assert.deepEqual(publisher.values.get(value.uri)?.map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
    assert.deepEqual(host.unexpected, []);
    controller.dispose();
  });

  await check("deleting a final block target publishes its retained stale assertion", () => {
    const host = new Host(); const publisher = new Publisher();
    const value = source("/workspace/block-expectation.ts");
    const text = 'import { Hson } from "hson-live";\nfunction fixture() {\n// @hson-expect-error HSON_INTERPOLATION_CANONICAL_STATIC_TYPE\nHson.canonical`${{}}`;\n}';
    const opened = document(value, text, 1);
    host.documents = [opened];
    const controller = start_workspace_diagnostics(host, publisher);
    assert.deepEqual(publisher.values.get(value.uri), []);
    const stale = text.replace('Hson.canonical`${{}}`;\n', "");
    const removed = document(value, stale, 2);
    host.documents = [removed]; host.fire(host.changes, removed); host.runTimers();
    assert.deepEqual(publisher.values.get(value.uri)?.map(item => item.code), ["HSON_EXPECT_ERROR_UNUSED"]);
    assert.deepEqual(publisher.values.get(value.uri)?.[0]?.range,
      { start: stale.indexOf("@hson-expect-error"), end: stale.indexOf("\n}") });
    const malformed = document(value, stale.replace(" HSON_INTERPOLATION_CANONICAL_STATIC_TYPE", ""), 3);
    host.documents = [malformed]; host.fire(host.changes, malformed); host.runTimers();
    assert.deepEqual(publisher.values.get(value.uri)?.map(item => item.code), ["HSON_EXPECT_ERROR_INVALID"]);
    assert.deepEqual(host.unexpected, []);
    controller.dispose();
  });

  await check("workspace diagnostics publish positional failures from open TypeScript", () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/inferred-interpolation.ts");
    const text = 'import { Hson } from "hson-live"; const data = Hson.data`<main "">`; const route = "/"; Hson.document`<html <head <style "a>b"/> /> ${data} <body <iframe src=${route} title="Pulse"/> /> />`;';
    const opened = document(value, text, 1);
    host.documents = [opened];
    const controller = start_workspace_diagnostics(host, publisher);
    const diagnostic = publisher.values.get(value.uri)?.find(item => item.code === "HSON_INTERPOLATION_POSITION_INVALID");
    assert.equal(diagnostic?.message.includes("interpolation cannot appear in an unquoted attribute value"), true);
    assert.deepEqual(diagnostic?.range, { start: text.indexOf("${route}"), end: text.indexOf("${route}") + "${route}".length });
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

  await check("unchanged rediscovery preserves a pending source read and corrected text clears its diagnostic", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/pending.ts");
    const pending = gate<string>();
    host.discovered = [value]; host.readGates.set(value.uri, pending.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    host.discovered = [{ ...value }]; host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    pending.resolve("Hson pending"); await settle();
    assert.deepEqual(publisher.values.get(value.uri), produce({ text: "Hson pending" }));
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson pending`]);
    host.readGates.delete(value.uri); host.contents.set(value.uri, "valid");
    host.fire(host.sourceChanges, [{ uri: value.uri, kind: "change" }]); await settle();
    // The read requested by a membership-dependent change uses the original source identity.
    assert.equal(host.reads.length, 2); assert.equal(host.reads[0], value); assert.equal(host.reads[1], value);
    assert.deepEqual(publisher.values.get(value.uri), []);
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson pending`, `${value.uri}:clear`]);
    controller.dispose();
  });

  await check("actual modification supersedes a pending read across equivalent rediscovery", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/modified.ts");
    const old = gate<string>(); const changed = gate<string>();
    host.discovered = [value]; host.readGates.set(value.uri, old.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    host.readGates.set(value.uri, changed.promise);
    host.fire(host.sourceChanges, [{ uri: value.uri, kind: "change" }]);
    host.discovered = [{ ...value }]; host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    changed.resolve("valid"); await settle();
    old.resolve("Hson obsolete"); await settle();
    assert.deepEqual(publisher.values.get(value.uri), []);
    assert.deepEqual(publisher.writes, [`${value.uri}:clear`]);
    assert.equal(host.reads.length, 2); assert.ok(host.reads.every(read => read === value));
    controller.dispose();
  });

  await check("changed source metadata schedules a replacement read and fences the prior identity", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/metadata.ts");
    const replacement = { ...value, fileName: "/workspace/replacement.ts" };
    const old = gate<string>(); const fresh = gate<string>();
    host.discovered = [value]; host.readGates.set(value.uri, old.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    host.readGates.set(value.uri, fresh.promise); host.discovered = [replacement];
    host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    old.resolve("Hson obsolete"); await settle(); assert.deepEqual(publisher.writes, []);
    fresh.resolve("Hson replacement"); await settle();
    assert.equal(host.reads[0], value); assert.equal(host.reads[1], replacement);
    assert.deepEqual(publisher.values.get(value.uri), produce({ text: "Hson replacement" }));
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson replacement`]);
    controller.dispose();
  });

  await check("obsolete discovery cannot restore a removed project; unrelated diagnostics survive and re-addition works", async () => {
    const host = new Host(); const publisher = new Publisher();
    const removed = source("/removed/project.ts"); const kept = source("/kept/project.ts");
    host.discovered = [removed, kept]; host.contents.set(removed.uri, "Hson removed"); host.contents.set(kept.uri, "Hson kept");
    const controller = start_workspace_diagnostics(host, publisher, { produce, readConcurrency: 1 }); await settle();
    const keptDiagnostics = publisher.values.get(kept.uri);
    const old = gate<readonly WorkspaceDiagnosticSource[]>(); host.discoveryGates.push(old.promise);
    host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    host.discovered = [{ ...kept }]; host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    old.resolve([{ ...removed }, { ...kept }]); await settle();
    assert.deepEqual([...publisher.values.keys()], [kept.uri]);
    assert.equal(publisher.values.get(kept.uri), keptDiagnostics);
    const reads = host.reads.length;
    host.fire(host.sourceChanges, [{ uri: removed.uri, kind: "change" }]); await settle();
    assert.equal(host.reads.length, reads, "removed URI must be absent from current membership");
    assert.deepEqual(publisher.writes, [`${removed.uri}:Hson removed`, `${kept.uri}:Hson kept`, `${removed.uri}:delete`]);
    const readded = { ...removed };
    host.discovered = [readded, { ...kept }];
    host.fire(host.sourceChanges, [{ uri: removed.uri, kind: "create" }]); host.runTimers(); await settle();
    assert.equal(host.reads.at(-1), readded);
    assert.deepEqual(publisher.values.get(removed.uri), produce({ text: "Hson removed" }));
    assert.equal(publisher.values.get(kept.uri), keptDiagnostics);
    assert.deepEqual(publisher.writes, [`${removed.uri}:Hson removed`, `${kept.uri}:Hson kept`, `${removed.uri}:delete`, `${removed.uri}:Hson removed`]);
    controller.dispose();
  });

  await check("three concurrent refreshes completing in reverse order admit only the newest membership", async () => {
    const host = new Host(); const publisher = new Publisher();
    const values = [source("/old/a.ts"), source("/middle/b.ts"), source("/new/c.ts")];
    const gates = values.map(() => gate<readonly WorkspaceDiagnosticSource[]>());
    host.discoveryGates.push(...gates.map(value => value.promise));
    for (const value of values) host.contents.set(value.uri, "Hson current");
    const controller = start_workspace_diagnostics(host, publisher, { produce });
    host.fire(host.projectChanges, undefined); host.runTimers();
    host.fire(host.projectChanges, undefined); host.runTimers();
    for (const index of [2, 1, 0]) { gates[index]!.resolve([values[index]!]); await settle(); }
    const newest = values[2]!;
    assert.deepEqual([...publisher.values.keys()], [newest.uri]);
    assert.deepEqual(publisher.values.get(newest.uri), produce({ text: "Hson current" }));
    host.fire(host.sourceChanges, values.slice(0, 2).map(value => ({ uri: value.uri, kind: "change" })));
    await settle();
    assert.deepEqual(host.reads, [newest]);
    assert.deepEqual(publisher.writes, [`${newest.uri}:Hson current`]);
    controller.dispose();
  });

  await check("a project notification fences discovery before the debounce timer runs", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/debounce.ts");
    const old = gate<readonly WorkspaceDiagnosticSource[]>(); host.discoveryGates.push(old.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce });
    host.fire(host.projectChanges, undefined);
    old.resolve([value]); await settle();
    assert.deepEqual(host.reads, []); assert.deepEqual(publisher.writes, []);
    host.discovered = [value]; host.contents.set(value.uri, "Hson current"); host.runTimers(); await settle();
    assert.deepEqual(host.reads, [value]);
    assert.deepEqual(publisher.values.get(value.uri), produce({ text: "Hson current" }));
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson current`]);
    controller.dispose();
  });

  await check("deleting a not-yet-admitted source invalidates pending discovery and permits later creation", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/deleted.ts");
    const old = gate<readonly WorkspaceDiagnosticSource[]>(); host.discoveryGates.push(old.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce });
    host.fire(host.sourceChanges, [{ uri: value.uri, kind: "delete" }]);
    old.resolve([value]); await settle(); host.runTimers(); await settle();
    assert.deepEqual(host.reads, []); assert.equal(publisher.values.has(value.uri), false);
    assert.deepEqual(publisher.writes, [`${value.uri}:delete`]);
    host.discovered = [value]; host.contents.set(value.uri, "Hson recreated");
    host.fire(host.sourceChanges, [{ uri: value.uri, kind: "create" }]); host.runTimers(); await settle();
    assert.deepEqual(host.reads, [value]);
    assert.deepEqual(publisher.values.get(value.uri), produce({ text: "Hson recreated" }));
    assert.deepEqual(publisher.writes, [`${value.uri}:delete`, `${value.uri}:Hson recreated`]);
    controller.dispose();
  });

  await check("a removed queued batch entry cannot supersede a re-added source's pending read", async () => {
    const host = new Host(); const publisher = new Publisher();
    const blocking = source("/workspace/blocking.ts"); const value = source("/workspace/queued.ts");
    const blocker = gate<string>(); const fresh = gate<string>();
    host.discovered = [blocking, value]; host.readGates.set(blocking.uri, blocker.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce, readConcurrency: 1 }); await settle();
    host.discovered = []; host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    const readded = { ...value }; host.discovered = [readded]; host.readGates.set(value.uri, fresh.promise);
    host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    blocker.resolve("Hson obsolete"); await settle();
    fresh.resolve("Hson restored"); await settle();
    assert.equal(host.reads.length, 2); assert.equal(host.reads[1], readded);
    assert.deepEqual([...publisher.values.keys()], [value.uri]);
    assert.deepEqual(publisher.values.get(value.uri), produce({ text: "Hson restored" }));
    assert.deepEqual(publisher.writes, [`${blocking.uri}:delete`, `${value.uri}:delete`, `${value.uri}:Hson restored`]);
    controller.dispose();
  });

  await check("unsaved buffers supersede pending disk work through rediscovery, removal, re-addition and close", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/unsaved.ts");
    const old = gate<string>(); host.discovered = [value]; host.readGates.set(value.uri, old.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    const opened = document(value, "Hson unsaved", 1); host.documents = [opened]; host.fire(host.opens, opened);
    const dirty = document(value, "valid", 2); host.documents = [dirty]; host.fire(host.changes, dirty); host.runTimers();
    host.discovered = [{ ...value }]; host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    old.resolve("Hson stale disk"); await settle();
    host.discovered = []; host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    assert.deepEqual(publisher.values.get(value.uri), []);
    const readded = { ...value }; host.discovered = [readded];
    host.fire(host.projectChanges, undefined); host.runTimers(); await settle();
    host.fire(host.sourceChanges, [{ uri: value.uri, kind: "change" }]);
    assert.deepEqual(host.reads, [value], "open buffers prevent disk reads across membership changes");
    host.readGates.delete(value.uri); host.contents.set(value.uri, "Hson saved disk");
    host.documents = []; host.fire(host.closes, dirty); await settle();
    assert.equal(host.reads.at(-1), readded);
    assert.deepEqual(publisher.values.get(value.uri), produce({ text: "Hson saved disk" }));
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson unsaved`, `${value.uri}:clear`, `${value.uri}:Hson saved disk`]);
    controller.dispose();
  });

  for (const removal of ["project", "file"] as const) await check(`${removal} removal preserves a pending unsaved edit and close clears the removed source`, async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/open-removed.ts");
    const opened = document(value, "Hson open", 1); host.documents = [opened]; host.discovered = [value];
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    const dirty = document(value, "valid", 2); host.documents = [dirty]; host.fire(host.changes, dirty);
    host.discovered = [];
    if (removal === "project") {
      host.fire(host.projectChanges, undefined);
      // Run discovery first while deliberately retaining the pending document timer.
      const refresh = [...host.timers.entries()].at(-1)!; host.timers.delete(refresh[0]); refresh[1]();
      await settle();
    } else host.fire(host.sourceChanges, [{ uri: value.uri, kind: "delete" }]);
    host.runTimers(); await settle();
    assert.deepEqual(publisher.values.get(value.uri), []);
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson open`, `${value.uri}:clear`]);
    host.documents = []; host.fire(host.closes, dirty); await settle();
    assert.deepEqual(host.reads, []); assert.equal(publisher.values.has(value.uri), false);
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson open`, `${value.uri}:clear`, `${value.uri}:delete`]);
    controller.dispose();
  });

  for (const completion of ["resolve", "reject"] as const) await check(`disposed pending reads cannot ${completion} into a late publication`, async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/disposed.ts");
    const pending = gate<string>(); host.discovered = [value]; host.readGates.set(value.uri, pending.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce }); await settle();
    const opened = document(value, "Hson open", 1); host.documents = [opened]; host.fire(host.opens, opened);
    const dirty = document(value, "valid", 2); host.documents = [dirty]; host.fire(host.changes, dirty);
    host.documents = []; host.fire(host.closes, dirty);
    // Both startup and close reads share the pending gate; disposal must fence both.
    controller.dispose();
    if (completion === "resolve") pending.resolve("Hson late"); else pending.reject(new Error("late read failure"));
    host.runTimers(); await settle();
    assert.deepEqual(publisher.values.get(value.uri), produce({ text: "Hson open" }));
    assert.deepEqual(publisher.writes, [`${value.uri}:Hson open`]);
    assert.deepEqual(host.unexpected, []);
  });

  await check("disposal fences pending discovery and detaches refresh notifications", async () => {
    const host = new Host(); const publisher = new Publisher(); const value = source("/workspace/disposed-discovery.ts");
    const pending = gate<readonly WorkspaceDiagnosticSource[]>(); host.discoveryGates.push(pending.promise);
    const controller = start_workspace_diagnostics(host, publisher, { produce });
    host.fire(host.projectChanges, undefined); controller.dispose();
    pending.resolve([value]); host.runTimers(); await settle();
    assert.deepEqual(host.reads, []); assert.deepEqual([...publisher.values], []); assert.deepEqual(publisher.writes, []);
    assert.equal(host.timers.size, 0); assert.equal(host.projectChanges.size, 0); assert.equal(host.sourceChanges.size, 0);
  });

  await check('changing explicit standalone mode invalidates unchanged disk and open-source diagnostics', async () => {
    const host=new Host(),publisher=new Publisher();
    const file=source('/workspace/page.hson','hson'),text='<main @:title/>';
    host.discovered=[file];host.contents.set(file.uri,text);
    const controller=start_workspace_diagnostics(host,publisher);
    await settle();assert.equal(publisher.values.get(file.uri)?.[0]?.code,'HSON_ELEMENT_QUID_INVALID');
    host.discovered=[{...file,authoringMode:'document'}];host.fire(host.projectChanges,undefined);host.runTimers();
    await settle();assert.deepEqual(publisher.values.get(file.uri),[]);
    host.documents=[document({...file,authoringMode:'document'},text,1)];host.fire(host.opens,host.documents[0]!);
    host.documents=[document({...file,authoringMode:'canonical'},text,1)];host.fire(host.changes,host.documents[0]!);host.runTimers();
    assert.equal(publisher.values.get(file.uri)?.[0]?.code,'HSON_ELEMENT_QUID_INVALID');
    assert.deepEqual(host.unexpected,[]);controller.dispose();
  });
  process.stdout.write(`ok - ${checks} workspace diagnostics checks passed\n`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

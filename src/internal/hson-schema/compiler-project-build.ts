import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { schema_declaration_views } from "./declaration-view.js";
import { SchemaProjectSnapshot } from "./project-snapshot.js";
import { verify_schema_compiler_project } from "./compiler-project-watch.js";
import type { SourceRecord } from "./compiler-project.js";
import { SchemaSourceMapping } from "./source-mapping.js";
import { apply_source_edits, type SchemaSourceEdit } from "./source-transformation.js";

type Current = ReturnType<typeof verify_schema_compiler_project>;
type Emission = { path: string; text: string; source: string };

/** Runtime uses captured authored inputs; only declarations use the precise compiler view. */
export function check_schema_project(projectPath: string, current: Current, emit: boolean): void {
  const snapshot = new SchemaProjectSnapshot({ root: current.selected, files: current.files });
  const read = ts.readConfigFile(projectPath, snapshot.readFile);
  const authored = ts.parseJsonConfigFileContent(read.config, snapshot.host, dirname(projectPath), undefined, projectPath);
  if (read.error || authored.errors.length) diagnostics([...(read.error ? [read.error] : []), ...authored.errors]);
  const readGenerated = ts.readConfigFile(current.project, snapshot.readFile);
  const generated = ts.parseJsonConfigFileContent(readGenerated.config, snapshot.host, dirname(current.project), undefined, current.project);
  diagnostics([...(readGenerated.error ? [readGenerated.error] : []), ...generated.errors]);
  const baseProgram = ts.createProgram(generated.fileNames, generated.options, snapshot.compilerHost(generated.options));
  const declarationEnabled = authored.options.declaration || authored.options.composite || authored.options.emitDeclarationOnly;
  const origins = current.manifest.sources.flatMap((record: SourceRecord) => record.schemas.map(schema => ({
    source: join(current.selected, record.generated), name: schema.name, evidence: join(current.selected, schema.evidence),
  })));
  const views = declarationEnabled ? schema_declaration_views(baseProgram, origins) : new Map<string, { text: string; edits: readonly SchemaSourceEdit[] }>();
  const checkHost = snapshot.compilerHost(generated.options);
  const checkRead = checkHost.readFile;
  checkHost.readFile = path => views.get(resolve(path))?.text ?? checkRead(path);
  const program = views.size === 0 ? baseProgram : ts.createProgram(generated.fileNames, generated.options, checkHost);
  diagnostics(ts.getPreEmitDiagnostics(program));
  if (!emit) { assert_current(); return; }
  if (authored.options.outFile) throw new Error("Hson Schema split emission does not support outFile bundles.");
  const outputs = new Map<string, string>();
  const add = (path: string, text: string): void => {
    path = resolve(path);
    if (outputs.has(path)) throw new Error(`Conflicting Hson build outputs: ${path}`);
    if ([...authored.fileNames, ...current.manifest.sources.map((record: SourceRecord) => resolve(dirname(projectPath), record.source))].some(file => resolve(file) === path)) throw new Error(`Build would overwrite authored input: ${path}`);
    outputs.set(path, text);
  };
  if (!authored.options.emitDeclarationOnly) {
    const options = { ...authored.options, noEmit: false, noEmitOnError: false, declaration: false, declarationMap: false, composite: false, incremental: false, emitDeclarationOnly: false };
    const runtime = ts.createProgram(authored.fileNames.filter(file => !file.includes(".hson-schema.generated.")), options, snapshot.compilerHost(options));
    // Broad authored tags are intentionally not the checking authority. Syntactic/configuration
    // failures still fail; the precise generated program has already passed semantic checking.
    diagnostics([...runtime.getOptionsDiagnostics(), ...runtime.getSyntacticDiagnostics().filter(d => !d.file?.fileName.includes(".hson-schema.generated."))]);
    for (const file of runtime.getSourceFiles()) {
      if (file.isDeclarationFile || runtime.isSourceFileFromExternalLibrary(file) || file.fileName.includes(".hson-schema.generated.")) continue;
      const result = runtime.emit(file, (path, text, bom) => add(path, (bom ? "\uFEFF" : "") + text));
      diagnostics(result.diagnostics);
      if (result.emitSkipped) throw new Error(`Runtime emission was skipped: ${file.fileName}`);
    }
  }
  if (declarationEnabled) {
    emit_declarations(projectPath, current, authored, generated, program, views, snapshot, add);
  }
  // All outputs are prepared before touching output files. Both graphs must still belong
  // to the same selected source revision, including dependency and configuration reads.
  assert_current();
  for (const [path, text] of outputs) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
  function assert_current(): void {
    if (!snapshot.isCurrent() || verify_schema_compiler_project(projectPath).manifest.publication !== current.manifest.publication) throw new Error("Source/project revision changed during checking or build; no output published.");
  }
}

function emit_declarations(projectPath: string, current: Current, authored: ts.ParsedCommandLine, generated: ts.ParsedCommandLine, precise: ts.Program,
  views: ReadonlyMap<string, { text: string; edits: readonly SchemaSourceEdit[] }>, snapshot: SchemaProjectSnapshot,
  add: (path: string, text: string) => void): void {
  const records: readonly SourceRecord[] = current.manifest.sources;
  const root = dirname(projectPath);
  const origins = records.flatMap(record => record.schemas.map(schema => ({ source: join(current.selected, record.generated), name: schema.name, evidence: join(current.selected, schema.evidence) })));
  const options: ts.CompilerOptions = { ...generated.options, noEmit: false, declaration: true, emitDeclarationOnly: true, declarationMap: authored.options.declarationMap ?? false,
    stripInternal: authored.options.stripInternal ?? false, noEmitOnError: true, rootDir: current.selected, outDir: join(current.selected, "unused-output") };
  const host = snapshot.compilerHost(options);
  const originalRead = host.readFile;
  host.readFile = path => views.get(resolve(path))?.text ?? originalRead(path);
  const program = ts.createProgram(generated.fileNames, options, host);
  diagnostics(ts.getPreEmitDiagnostics(program));
  const emitted: Emission[] = [];
  const result = program.emit(undefined, (path, text, bom, _error, files) => {
    if (files?.length !== 1) throw new Error(`Cannot associate declaration output with one source: ${path}`);
    emitted.push({ path: resolve(path), text: (bom ? "\uFEFF" : "") + text, source: resolve(files[0]!.fileName) });
  });
  diagnostics(result.diagnostics);
  if (result.emitSkipped) throw new Error("Precise declaration emission was skipped.");
  const declarationConfig: ts.ParsedCommandLine = { ...authored, options: { ...authored.options, noEmit: false, declaration: true, emitDeclarationOnly: true }, fileNames: records.filter(record => !/\.d\.[cm]?ts$/.test(record.source)).map(record => join(root, record.source)) };
  const destinations = new Map<string, string>();
  for (const record of records) {
    if (/\.d\.[cm]?ts$/.test(record.source)) continue;
    const original = join(root, record.source);
    const destination = ts.getOutputFileNames(declarationConfig, original, !ts.sys.useCaseSensitiveFileNames).find(path => /\.d\.[cm]?ts$/.test(path));
    if (destination !== undefined) destinations.set(join(current.selected, record.generated), resolve(destination));
  }
  const outputRoot = authored.options.declarationDir ?? authored.options.outDir ?? root;
  for (const record of records.filter(record => /\.d\.[cm]?ts$/.test(record.source))) {
    const source = join(current.selected, record.generated);
    destinations.set(source, join(outputRoot, "internal", "hson-declarations", record.source));
    emitted.push({ path: source, text: precise.getSourceFile(source)!.text, source });
  }
  for (const origin of origins) destinations.set(origin.evidence, join(outputRoot, "internal", "hson-schema", relative(join(current.selected, "evidence"), origin.evidence).replace(/\.[cm]?ts$/, suffix => `.d${suffix}`)));
  const collision = new Set<string>();
  for (const destination of destinations.values()) {
    const key = destination.normalize("NFC").toLowerCase();
    if (collision.has(key)) throw new Error(`Evidence/declaration output collision: ${destination}`);
    collision.add(key);
  }
  const declarationEdits = new Map<string, { before: string; after: string; edits: SchemaSourceEdit[] }>();
  for (const output of emitted.filter(file => !file.path.endsWith(".map"))) {
    const destination = destinations.get(output.source);
    if (destination === undefined) throw new Error(`No published declaration destination for ${output.source}`);
    const source = ts.createSourceFile(output.path, output.text, ts.ScriptTarget.Latest, true);
    const edits: SchemaSourceEdit[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node
        || ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent) || ts.isExternalModuleReference(node.parent))) {
        const resolved = ts.resolveModuleName(node.text, output.source, generated.options, host).resolvedModule;
        const target = resolved === undefined ? undefined : destinations.get(resolve(resolved.resolvedFileName));
        if (target !== undefined) edits.push({ start: node.getStart(), end: node.end, text: JSON.stringify(module_path(relative(dirname(destination), target.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.ts$/, ".js")))) });
        else if (resolved?.resolvedFileName.startsWith(current.selected + sep)) throw new Error(`Declaration dependency is not in the published closure: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    // Relative map references follow their relocated declaration, never the compiler-input tree.
    const match = /\/\/# sourceMappingURL=[^\r\n]+/.exec(output.text);
    if (match) edits.push({ start: match.index, end: match.index + match[0].length, text: precise.getSourceFile(output.source)?.isDeclarationFile ? "" : `//# sourceMappingURL=${basename(destination)}.map` });
    const text = apply_source_edits(output.text, edits);
    declarationEdits.set(output.source, { before: output.text, after: text, edits });
    assert_no_generated_path(text);
    add(destination, text);
  }
  for (const output of emitted.filter(file => file.path.endsWith(".map"))) {
    const destination = destinations.get(output.source)! + ".map";
    const record = records.find(record => join(current.selected, record.generated) === output.source);
    const generatedSource = precise.getSourceFile(output.source)!;
    const namedSource = program.getSourceFile(output.source)!;
    const naming = new SchemaSourceMapping(generatedSource.text, views.get(output.source)?.edits ?? []);
    const originalText = record === undefined ? generatedSource.text : snapshot.readFile(join(root, record.source))!;
    const association = new SchemaSourceMapping(originalText, record?.edits ?? []);
    const edited = declarationEdits.get(output.source)!;
    const relocation = new SchemaSourceMapping(edited.before, edited.edits);
    const beforeDeclaration = ts.createSourceFile("output.d.ts", edited.before, ts.ScriptTarget.Latest);
    const afterDeclaration = ts.createSourceFile("output.d.ts", edited.after, ts.ScriptTarget.Latest);
    const authoredSource = ts.createSourceFile("authored.ts", originalText, ts.ScriptTarget.Latest);
    const map = JSON.parse(output.text);
    const decoded = decode_mappings(map.mappings);
    const next: number[][][] = [];
    for (let line = 0; line < decoded.length; line++) for (const segment of decoded[line]!) {
      const generatedPosition = relocation.to_transformed(beforeDeclaration.getPositionOfLineAndCharacter(line, segment[0]!));
      const position = afterDeclaration.getLineAndCharacterOfPosition(generatedPosition);
      const target = next[position.line] ?? (next[position.line] = []);
      if (segment.length < 4) { target.push([position.character]); continue; }
      const namedPosition = namedSource.getPositionOfLineAndCharacter(segment[2]!, segment[3]!);
      const inGenerated = naming.to_authored({ start: namedPosition, length: 0 });
      const inAuthored = inGenerated === undefined ? undefined : association.to_authored(inGenerated);
      if (inAuthored === undefined) { target.push([position.character]); continue; }
      const original = authoredSource.getLineAndCharacterOfPosition(inAuthored.start);
      target.push([position.character, 0, original.line, original.character]);
    }
    const sourceName = record === undefined ? basename(destination).replace(/\.d\.([cm]?ts)\.map$/, ".$1") : module_path(relative(dirname(destination), join(root, record.source)));
    const text = JSON.stringify({ version: 3, file: basename(destination, ".map"), sourceRoot: "", sources: [sourceName], names: [], mappings: encode_mappings(next), ...(record === undefined ? { sourcesContent: [originalText] } : {}) });
    assert_no_generated_path(text);
    add(destination, text);
  }
}
function diagnostics(entries: readonly ts.Diagnostic[]): void {
  if (entries.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(entries, { getCurrentDirectory: ts.sys.getCurrentDirectory, getCanonicalFileName: path => path, getNewLine: () => "\n" }));
}
function module_path(path: string): string { const value = path.split(sep).join("/"); return value.startsWith(".") ? value : `./${value}`; }
function assert_no_generated_path(text: string): void { if (/(?:^|[\s"'/\\])\.hson[\/\\]/.test(text)) throw new Error("Development .hson path leaked into declaration output."); }
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decode_mappings(value: string): number[][][] {
  let source = 0, line = 0, column = 0, name = 0;
  return value.split(";").map(row => {
    let generated = 0;
    return row ? row.split(",").map(part => {
      const values: number[] = []; let bits = 0, shift = 0;
      for (const char of part) { const digit = alphabet.indexOf(char); bits += (digit & 31) * 2 ** shift; if (digit & 32) shift += 5; else { values.push(bits & 1 ? -(bits >> 1) : bits >> 1); bits = shift = 0; } }
      generated += values[0]!;
      if (values.length === 1) return [generated];
      source += values[1]!; line += values[2]!; column += values[3]!;
      if (values[4] !== undefined) name += values[4];
      return [generated, source, line, column];
    }) : [];
  });
}
function encode_mappings(rows: number[][][]): string {
  let source = 0, line = 0, column = 0;
  const vlq = (value: number): string => { let bits = value < 0 ? -value * 2 + 1 : value * 2, result = ""; do { let digit = bits % 32; bits = Math.floor(bits / 32); if (bits) digit |= 32; result += alphabet[digit]; } while (bits); return result; };
  return Array.from({ length: rows.length }, (_, index) => {
    let generated = 0;
    return (rows[index] ?? []).map(segment => {
      const values = [segment[0]! - generated]; generated = segment[0]!;
      if (segment.length > 1) { values.push(segment[1]! - source, segment[2]! - line, segment[3]! - column); source = segment[1]!; line = segment[2]!; column = segment[3]!; }
      return values.map(vlq).join("");
    }).join(",");
  }).join(";");
}

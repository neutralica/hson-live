#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import * as ts from "typescript";
import type { CompiledHsonSchema } from "../src/internal/hson-schema/compiler.ts";

const packagedRuntime = existsSync(new URL("../dist/internal/hson-schema/compiler.js", import.meta.url));
const runtimeBase = packagedRuntime ? "../dist" : "../src";
const { compile_hson_schema, HSON_SCHEMA_MVP_COMPATIBILITY_VERSION } = await import(`${runtimeBase}/internal/hson-schema/compiler.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/compiler.ts");
const { encode_canonical_schema_graph_hson } = await import(`${runtimeBase}/internal/canonical-schema/encode-hson.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/canonical-schema/encode-hson.ts");
const { generate_hson_schema_types } = await import(`${runtimeBase}/internal/hson-schema/generate-types.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/generate-types.ts");
const { projected_value_from_hson_node } = await import(`${runtimeBase}/core/projected-value-graph.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/core/projected-value-graph.ts");
const { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } = await import(`${runtimeBase}/internal/canonical-schema/evaluate.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/canonical-schema/evaluate.ts");
const { parse_hson_with_provenance } = await import(`${runtimeBase}/internal/hson-source-provenance/parse-hson-with-provenance.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-source-provenance/parse-hson-with-provenance.ts");
const { resolve_projected_schema_issue_source } = await import(`${runtimeBase}/internal/projected-schema-source-lowering/projected-schema-source-lowering.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/projected-schema-source-lowering/projected-schema-source-lowering.ts");
const { resolve_document_schema_issue_source } = await import(`${runtimeBase}/internal/document-schema-source-lowering/document-schema-source-lowering.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/document-schema-source-lowering/document-schema-source-lowering.ts");

type Mode = "generate" | "verify" | "check" | "build" | "watch";
type SchemaDeclaration = Readonly<{ sourceFile: ts.SourceFile; statement: ts.VariableStatement; declaration: ts.VariableDeclaration; name: string; source: string; compiled: CompiledHsonSchema }>;
type Artifact = Readonly<{ path: string; content: string; metadataPath: string; metadata: string; reexport: string; schemaAssociation: string; generatedBytes: number; proofNodeCount: number }>;
type Diagnostic = Readonly<{ file?: string; start?: number; message: string }>;
type Overlay = Readonly<{ file: string; start: number; end: number; text: string }>;

const GENERATED_EXPORTS_START = "// @hson-schema generated type exports";
const GENERATED_EXPORTS_END = "// @hson-schema end generated type exports";

const args = process.argv.slice(2);
const mode = (args[0] ?? "verify") as Mode;
const projectArg = value_after("--project") ?? "tsconfig.json";
const projectPath = resolve(projectArg);
if (!["generate", "verify", "check", "build", "watch"].includes(mode)) fail(`Unknown Hson Schema mode ${JSON.stringify(mode)}.`);

if (mode === "watch") {
  run_cycle("check");
  console.log("Hson Schema watch active. Press Ctrl+C to stop.");
  let fingerprint = tree_fingerprint(dirname(projectPath));
  setInterval(() => {
    const next = tree_fingerprint(dirname(projectPath));
    if (next === fingerprint) return;
    fingerprint = next;
    try { run_cycle("check"); } catch (error) { console.error(error instanceof Error ? error.message : error); }
  }, 500);
} else {
  run_cycle(mode);
}

function run_cycle(selected: Exclude<Mode, "watch">): void {
  const started = performance.now();
  const config = read_config(projectPath);
  const coldStart = performance.now();
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const schemaDeclarations = discover_schemas(program, checker);
  reject_schema_reexports(program, checker, schemaDeclarations);
  if (schemaDeclarations.length > 0 && (config.options.strict !== true || config.options.exactOptionalPropertyTypes !== true || config.options.noUncheckedIndexedAccess !== true)) {
    fail("Hson Schema requires strict, exactOptionalPropertyTypes, and noUncheckedIndexedAccess to be true.");
  }
  const artifacts = schemaDeclarations.map(make_artifact);
  const diagnostics: Diagnostic[] = [];
  reconcile_generated_lifecycle(config, schemaDeclarations, artifacts, selected, diagnostics);

  for (let index = 0; index < schemaDeclarations.length; index += 1) {
    const declaration = schemaDeclarations[index] as SchemaDeclaration;
    const artifact = artifacts[index] as Artifact;
    if (selected === "generate") {
      write_if_changed(artifact.path, artifact.content);
      write_if_changed(artifact.metadataPath, artifact.metadata);
    } else {
      verify_artifact(declaration, artifact, diagnostics);
    }
  }

  const staticStarted = performance.now();
  const staticAnalysis = analyze_static_hson(program, checker, schemaDeclarations, diagnostics);
  const staticCount = staticAnalysis.count;
  const staticMs = performance.now() - staticStarted;
  const warmStarted = performance.now();
  const warmDiagnostics: Diagnostic[] = [];
  analyze_static_hson(program, checker, schemaDeclarations, warmDiagnostics);
  const analyzerWarmMs = performance.now() - warmStarted;
  diagnostics.push(...warmDiagnostics);
  if (diagnostics.length > 0) report_and_fail(diagnostics);

  let tsMs = 0;
  let tsIncrementalMs = 0;
  if (selected === "check" || selected === "build") {
    const tsStarted = performance.now();
    const command = check_with_overlays(config, staticAnalysis.overlays, selected === "build");
    tsMs = performance.now() - tsStarted;
    if (!command.ok) fail(command.message);
    if (selected === "check") {
      const incrementalStarted = performance.now();
      const incremental = ts.getPreEmitDiagnostics(command.program);
      tsIncrementalMs = performance.now() - incrementalStarted;
      if (incremental.length > 0) fail(incremental.map((entry) => format_ts_diagnostic(entry)).join("\n"));
    }
  }
  const graphNodes = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.canonicalNodeCount, 0);
  const documentGraphNodes = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.graph.nodes.filter((node) => node.kind.startsWith("document-")).length, 0);
  const generatedBytes = artifacts.reduce((count, artifact) => count + artifact.generatedBytes, 0);
  const proofNodes = artifacts.reduce((count, artifact) => count + artifact.proofNodeCount, 0);
  const refinementCount = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.graph.nodes.filter((node) => node.kind === "projected-refinement").length, 0);
  const definitionCount = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.definitions.length, 0);
  const referenceCount = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.referenceUses.length, 0);
  const recursiveSccCount = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.recursiveSccCount, 0);
  const documentRepeatCount = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.documentRepeatCount, 0);
  const documentExactCountCount = schemaDeclarations.reduce((count, declaration) => count + declaration.compiled.documentExactCountCount, 0);
  const freshnessBytes = artifacts.reduce((count, artifact) => count + Buffer.byteLength(artifact.metadata), 0);
  const memory = process.memoryUsage();
  const sourceProvenanceBytes = schemaDeclarations.reduce((count, declaration) => count + Buffer.byteLength(declaration.source), 0);
  console.log(JSON.stringify({ hsonSchema: selected, schemas: schemaDeclarations.length, defs: definitionCount, refs: referenceCount, recursiveSccs: recursiveSccCount, documentRepeatNodes: documentRepeatCount, documentExactCountNodes: documentExactCountCount, canonicalNodes: graphNodes, canonicalDocumentNodes: documentGraphNodes, refinementCount, generatedDeclarationBytes: generatedBytes, proofNodes, staticHsonValidations: staticCount, staticDocumentValidations: staticAnalysis.documentCount, analyzerColdMs: round(performance.now() - coldStart), analyzerWarmMs: round(analyzerWarmMs), staticValidationMs: round(staticMs), typescriptColdMs: round(tsMs), typescriptIncrementalMs: round(tsIncrementalMs), checkerHeapBytes: memory.heapUsed, checkerRssBytes: memory.rss, freshnessArtifactBytes: freshnessBytes, sourceProvenanceBytes, totalMs: round(performance.now() - started) }));
}

function discover_schemas(program: ts.Program, checker: ts.TypeChecker): SchemaDeclaration[] {
  const output: SchemaDeclaration[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(`${sep}node_modules${sep}`) || sourceFile.fileName.includes(".hson-schema.generated.")) continue;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) continue;
      const declaration = statement.declarationList.declarations[0];
      if (declaration === undefined || !ts.isIdentifier(declaration.name) || declaration.type === undefined || !ts.isTypeReferenceNode(declaration.type) || !ts.isIdentifier(declaration.type.typeName)) continue;
      if (!official_binding(declaration.type.typeName, "HsonSchema", checker)) continue;
      if (declaration.initializer === undefined || !ts.isTaggedTemplateExpression(declaration.initializer) || !ts.isIdentifier(declaration.initializer.tag) || !official_binding(declaration.initializer.tag, "Hson", checker) || !ts.isNoSubstitutionTemplateLiteral(declaration.initializer.template)) {
        throw new Error(`${sourceFile.fileName}: ${declaration.name.text} must use a direct substitution-free official Hson tagged template.`);
      }
      const source = raw_template(declaration.initializer.template, sourceFile);
      const compiled = compile_hson_schema(source);
      if (!compiled.ok) throw new Error(`${sourceFile.fileName}: ${declaration.name.text}: ${compiled.issues.map((issue) => issue.message).join(" ")}`);
      output.push(Object.freeze({ sourceFile, statement, declaration, name: declaration.name.text, source, compiled: compiled.value }));
    }
  }
  return output;
}

function reject_schema_reexports(program: ts.Program, checker: ts.TypeChecker, schemas: readonly SchemaDeclaration[]): void {
  const declarations = new Set<ts.Declaration>(schemas.map((schema) => schema.declaration));
  for (const sourceFile of program.getSourceFiles()) for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined || statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      let symbol = checker.getSymbolAtLocation(element.name);
      if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
      if (symbol?.declarations?.some((declaration) => declarations.has(declaration)) === true) throw new Error(`${sourceFile.fileName}: Hson Schema declarations cannot be reexported.`);
    }
  }
}

function make_artifact(schema: SchemaDeclaration): Artifact {
  const extension = extname(schema.sourceFile.fileName);
  const stem = schema.sourceFile.fileName.slice(0, -extension.length);
  const artifactPath = `${stem}.${schema.name}.hson-schema.generated.ts`;
  const generated = generate_hson_schema_types(schema.name, schema.compiled.semantic, schema.compiled.definitions);
  const header = `/* Generated by Hson Schema ${HSON_SCHEMA_MVP_COMPATIBILITY_VERSION}. Do not edit. */`;
  const numberImport = generated.declarations.includes("HsonNumber") ? 'import type { HsonNumber } from "hson-live";\n' : "";
  const content = `${header}\n${numberImport}import type { HsonCanonical } from "hson-live/hson";\n${generated.declarations}\n`;
  const identity = `${relative(dirname(projectPath), schema.sourceFile.fileName).split(sep).join("/")}#${schema.name}`;
  const graphHson = encode_canonical_schema_graph_hson(schema.compiled.graph);
  const metadataObject = {
    compatibilityVersion: HSON_SCHEMA_MVP_COMPATIBILITY_VERSION,
    declarationIdentity: identity,
    sourceDigest: digest(schema.source),
    semanticGraphDigest: digest(graphHson),
    generatedDeclarationDigest: digest(content),
    graphHson,
  };
  const metadata = `${JSON.stringify(metadataObject, null, 2)}\n`;
  const runtimeExtension = extension === ".mts" ? ".mjs" : extension === ".cts" ? ".cjs" : ".js";
  const generatedSpecifier = `./${stem.slice(stem.lastIndexOf(sep) + 1)}.${schema.name}.hson-schema.generated${runtimeExtension}`;
  const generatedNames = `${schema.name}Type, ${schema.name}Hson`;
  const localBinding = `import type { ${generatedNames} } from ${JSON.stringify(generatedSpecifier)};`;
  const reexport = has_export(schema.statement)
    ? `${localBinding}\nexport type { ${generatedNames} };`
    : localBinding;
  const annotation = schema_annotation(schema);
  const schemaAssociation = `${annotation.typeName.getText(schema.sourceFile)}<${schema.name}Type, ${JSON.stringify(schema_mode(schema))}>`;
  return Object.freeze({ path: artifactPath, content, metadataPath: `${stem}.${schema.name}.hson-schema.generated.json`, metadata, reexport, schemaAssociation, generatedBytes: Buffer.byteLength(content), proofNodeCount: generated.proofNodeCount });
}

function schema_mode(schema: SchemaDeclaration): "data" | "document" {
  return schema.compiled.semantic.kind === "document" || schema.compiled.semantic.kind === "document-element"
    ? "document"
    : "data";
}

function schema_annotation(schema: SchemaDeclaration): ts.TypeReferenceNode {
  const annotation = schema.declaration.type;
  if (annotation !== undefined && ts.isTypeReferenceNode(annotation)) return annotation;
  throw new Error(`${schema.sourceFile.fileName}: ${schema.name} lost its HsonSchema annotation.`);
}

function artifact_source_path(schema: SchemaDeclaration): string {
  const extension = extname(schema.sourceFile.fileName);
  const stem = schema.sourceFile.fileName.slice(0, -extension.length);
  return `${stem}.${schema.name}.hson-schema.generated.ts`;
}

function analyze_static_hson(program: ts.Program, checker: ts.TypeChecker, schemas: readonly SchemaDeclaration[], diagnostics: Diagnostic[]): Readonly<{ count: number; documentCount: number; overlays: readonly Overlay[] }> {
  let count = 0;
  let documentCount = 0;
  const overlays: Overlay[] = [];
  const byArtifact = new Map(schemas.map((schema) => [resolve(artifact_source_path(schema)), schema]));
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(`${sep}node_modules${sep}`) || sourceFile.fileName.includes(".hson-schema.generated.")) continue;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) continue;
      const declaration = statement.declarationList.declarations[0];
      if (declaration === undefined || declaration.type === undefined || !ts.isTypeReferenceNode(declaration.type) || !ts.isIdentifier(declaration.type.typeName)) continue;
      const typeName = declaration.type.typeName.text;
      const associations = resolve_generated_associations(declaration.type.typeName, checker, byArtifact);
      if (associations.length === 0 || declaration.initializer === undefined) continue;
      if (associations.length !== 1) { diagnostics.push({ file: sourceFile.fileName, start: declaration.type.getStart(), message: `Ambiguous Schema-bound type association for ${typeName}.` }); continue; }
      const schema = associations[0] as SchemaDeclaration;
      if (ts.isTaggedTemplateExpression(declaration.initializer)) {
        if (!ts.isIdentifier(declaration.initializer.tag) || !official_binding(declaration.initializer.tag, "Hson", checker) || !ts.isNoSubstitutionTemplateLiteral(declaration.initializer.template)) {
          diagnostics.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(), message: "Schema-bound Hson requires a direct substitution-free official Hson tagged template." });
          continue;
        }
        validate_candidate(schema, raw_template(declaration.initializer.template, sourceFile), sourceFile, declaration.initializer, diagnostics);
        overlays.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(sourceFile), end: declaration.initializer.getEnd(), text: `(${declaration.initializer.getText(sourceFile)} as unknown as ${declaration.type.getText(sourceFile)})` });
        count += 1;
        if (schema.compiled.semantic.kind === "document") documentCount += 1;
      } else if (ts.isCallExpression(declaration.initializer) && is_certify_call(declaration.initializer, checker)) {
        if (declaration.initializer.typeArguments !== undefined) diagnostics.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(), message: "Explicit Hson.certify type arguments are unsupported." });
        const schemaArgument = declaration.initializer.arguments[0];
        if (schemaArgument === undefined || !ts.isIdentifier(schemaArgument) || !identifier_resolves_to(schemaArgument, checker, schema.declaration)) diagnostics.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(), message: `Hson.certify association must use ${schema.name} for ${typeName}.` });
        else overlays.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(sourceFile), end: declaration.initializer.getEnd(), text: `(${declaration.initializer.getText(sourceFile)} as unknown as ${declaration.type.getText(sourceFile)})` });
        count += 1;
        if (schema.compiled.semantic.kind === "document") documentCount += 1;
      }
    }
  }
  return Object.freeze({ count, documentCount, overlays: Object.freeze(overlays) });
}

function resolve_generated_associations(identifier: ts.Identifier, checker: ts.TypeChecker, byArtifact: ReadonlyMap<string, SchemaDeclaration>): readonly SchemaDeclaration[] {
  let symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  const output = new Set<SchemaDeclaration>();
  for (const declaration of symbol?.declarations ?? []) {
    if (!ts.isTypeAliasDeclaration(declaration) || !declaration.name.text.endsWith("Hson")) continue;
    const schema = byArtifact.get(resolve(declaration.getSourceFile().fileName));
    if (schema !== undefined && declaration.name.text === `${schema.name}Hson`) output.add(schema);
  }
  return Object.freeze([...output]);
}

function identifier_resolves_to(identifier: ts.Identifier, checker: ts.TypeChecker, expected: ts.Declaration): boolean {
  let symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations?.includes(expected) === true;
}

function check_with_overlays(config: ts.ParsedCommandLine, overlays: readonly Overlay[], emit: boolean): Readonly<{ ok: true; program: ts.Program } | { ok: false; message: string }> {
  const grouped = new Map<string, Overlay[]>();
  for (const overlay of overlays) { const group = grouped.get(resolve(overlay.file)) ?? []; group.push(overlay); grouped.set(resolve(overlay.file), group); }
  const options: ts.CompilerOptions = { ...config.options, noEmit: !emit };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const sourceFile = original(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    const replacements = grouped.get(resolve(fileName));
    if (sourceFile === undefined || replacements === undefined) return sourceFile;
    let text = sourceFile.text;
    for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
    const scriptKind = sourceFile.languageVariant === ts.LanguageVariant.JSX ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    return ts.createSourceFile(fileName, text, languageVersion, true, scriptKind);
  };
  const checked = ts.createProgram(config.fileNames, options, host);
  const diagnostics = ts.getPreEmitDiagnostics(checked);
  if (diagnostics.length > 0) return { ok: false, message: diagnostics.map((entry) => format_ts_diagnostic(entry)).join("\n") };
  if (emit) {
    const result = checked.emit();
    if (result.emitSkipped) return { ok: false, message: result.diagnostics.map((entry) => format_ts_diagnostic(entry)).join("\n") || "TypeScript emit was skipped." };
  }
  return { ok: true, program: checked };
}

function format_ts_diagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.file === undefined || diagnostic.start === undefined) return message;
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
}

function validate_candidate(schema: SchemaDeclaration, source: string, sourceFile: ts.SourceFile, node: ts.Node, diagnostics: Diagnostic[]): void {
  try {
    const parsed = parse_hson_with_provenance(source);
    const result = schema.compiled.semantic.kind === "document"
      ? evaluate_canonical_document_schema(schema.compiled.graph, parsed.value)
      : evaluate_canonical_projected_schema(schema.compiled.graph, projected_value_from_hson_node(parsed.value));
    if (!result.ok) {
      const first = result.issues[0];
      const resolution = first === undefined ? undefined : schema.compiled.semantic.kind === "document"
        ? resolve_document_schema_issue_source(parsed.value, "document", parsed.provenance, first)
        : resolve_projected_schema_issue_source(parsed.value, parsed.provenance, first);
      const relativeStart = resolution === undefined || resolution.kind === "unresolved" ? 0 : resolution.range.start;
      diagnostics.push({ file: sourceFile.fileName, start: node.getStart() + 1 + relativeStart, message: `Static Hson does not satisfy ${schema.name}: ${first?.code ?? "validation failed"} at ${first?.path.join(".") || "root"}.` });
    }
  } catch (error) {
    diagnostics.push({ file: sourceFile.fileName, start: node.getStart(), message: error instanceof Error ? error.message : "Invalid static Hson." });
  }
}

function verify_artifact(schema: SchemaDeclaration, artifact: Artifact, diagnostics: Diagnostic[]): void {
  const checks = [[artifact.path, artifact.content, "generated declaration"], [artifact.metadataPath, artifact.metadata, "freshness evidence"]] as const;
  for (const [path, expected, label] of checks) {
    if (!existsSync(path)) diagnostics.push({ file: schema.sourceFile.fileName, start: schema.declaration.getStart(), message: `Generated Hson Schema types for ${schema.name} are missing (${label}). Run hson-schema generate --project ${projectArg}.` });
    else if (readFileSync(path, "utf8") !== expected) diagnostics.push({ file: path, message: `Stale or edited generated Hson Schema types for ${schema.name} (${label}). Run hson-schema generate --project ${projectArg}.` });
  }
}

function reconcile_generated_lifecycle(
  config: ts.ParsedCommandLine,
  schemas: readonly SchemaDeclaration[],
  artifacts: readonly Artifact[],
  selected: Exclude<Mode, "watch">,
  diagnostics: Diagnostic[],
): void {
  const expectedArtifacts = new Set(artifacts.flatMap((artifact) => [resolve(artifact.path), resolve(artifact.metadataPath)]));
  for (const path of generated_artifact_paths(config)) {
    if (expectedArtifacts.has(resolve(path))) continue;
    if (selected === "generate") unlinkSync(path);
    else diagnostics.push({ file: path, message: `Stale generated Hson Schema artifact has no current declaration. Run hson-schema generate --project ${projectArg}.` });
  }

  const exportsBySource = new Map<string, string[]>();
  const associationsBySource = new Map<string, Array<Readonly<{ declaration: ts.VariableDeclaration; text: string }>>>();
  for (let index = 0; index < schemas.length; index += 1) {
    const schema = schemas[index] as SchemaDeclaration;
    const artifact = artifacts[index] as Artifact;
    const entries = exportsBySource.get(schema.sourceFile.fileName) ?? [];
    entries.push(artifact.reexport);
    exportsBySource.set(schema.sourceFile.fileName, entries);
    const associations = associationsBySource.get(schema.sourceFile.fileName) ?? [];
    associations.push(Object.freeze({ declaration: schema.declaration, text: artifact.schemaAssociation }));
    associationsBySource.set(schema.sourceFile.fileName, associations);
  }
  for (const fileName of config.fileNames) {
    if (!/\.[cm]?tsx?$/.test(fileName) || fileName.includes(".hson-schema.generated.")) continue;
    const source = readFileSync(fileName, "utf8");
    const associated = apply_generated_schema_associations(
      source,
      associationsBySource.get(fileName) ?? [],
    );
    const expected = generated_exports_block(exportsBySource.get(fileName) ?? []);
    const actual = generated_exports_block_from_source(source);
    if (selected === "generate") {
      if (source === associated && actual === expected) continue;
      const without = remove_generated_exports_block(associated).trimEnd();
      const next = expected === "" ? `${without}\n` : `${without}\n\n${expected}`;
      if (next !== source) writeFileSync(fileName, next);
    } else {
      if (source !== associated) {
        diagnostics.push({ file: fileName, message: `Generated Hson Schema value associations are missing or stale. Run hson-schema generate --project ${projectArg}.` });
      }
      if (actual !== expected) {
        diagnostics.push({ file: fileName, message: `Generated Hson Schema type exports are missing or stale. Run hson-schema generate --project ${projectArg}.` });
      }
    }
  }
}

function apply_generated_schema_associations(
  source: string,
  associations: readonly Readonly<{ declaration: ts.VariableDeclaration; text: string }>[],
): string {
  let output = source;
  for (const association of [...associations].sort((left, right) => (
    (right.declaration.type?.getStart() ?? -1) - (left.declaration.type?.getStart() ?? -1)
 ))) {
    const annotation = association.declaration.type;
    if (annotation === undefined) continue;
    output = output.slice(0, annotation.getStart()) + association.text + output.slice(annotation.getEnd());
  }
  return output;
}

function generated_exports_block(exports: readonly string[]): string {
  if (exports.length === 0) return "";
  return `${GENERATED_EXPORTS_START}\n${[...exports].sort().join("\n")}\n${GENERATED_EXPORTS_END}\n`;
}

function generated_exports_block_from_source(source: string): string {
  const start = source.indexOf(GENERATED_EXPORTS_START);
  if (start < 0) return "";
  const end = source.indexOf(GENERATED_EXPORTS_END, start);
  if (end >= 0) return source.slice(start, end + GENERATED_EXPORTS_END.length + (source[end + GENERATED_EXPORTS_END.length] === "\n" ? 1 : 0));
  const legacy = source.slice(start).match(/^\/\/ @hson-schema generated type exports\n(?:export type \{[^\n]+\} from [^\n]+;\n?)*/)?.[0];
  return legacy ?? "";
}

function remove_generated_exports_block(source: string): string {
  const block = generated_exports_block_from_source(source);
  return block === "" ? source : source.replace(block, "");
}

function generated_artifact_paths(config: ts.ParsedCommandLine): readonly string[] {
  const output: string[] = [];
  const sourceStems = config.fileNames
    .filter((fileName) => /\.[cm]?tsx?$/.test(fileName) && !fileName.includes(".hson-schema.generated."))
    .map((fileName) => fileName.slice(0, -extname(fileName).length));
  const visit = (path: string): void => {
    for (const name of readdirSync(path)) {
      if (["node_modules", "dist", ".git"].includes(name)) continue;
      const child = join(path, name);
      const stat = statSync(child);
      if (stat.isDirectory()) visit(child);
      else if (/\.hson-schema\.generated\.(?:ts|json)$/.test(name) && sourceStems.some((stem) => child.startsWith(`${stem}.`))) output.push(child);
    }
  };
  visit(dirname(projectPath));
  return Object.freeze(output);
}

function official_binding(identifier: ts.Identifier, expected: string, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined) {
    const target = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
    if ((target.getName() === expected || expected === "Hson" && target.getName() === "admit_hson") && target.declarations?.some((declaration) => /(?:^|[/\\])(?:hson-authoring|index|hson-admission|transform\.types)\.(?:d\.)?[cm]?ts$/.test(declaration.getSourceFile().fileName)) === true) return true;
  }
  if (!identifier.parent || !ts.isImportSpecifier(identifier.parent)) return false;
  const importDeclaration = identifier.parent.parent.parent.parent;
  const importedName = identifier.parent.propertyName?.text ?? identifier.parent.name.text;
  return ts.isImportDeclaration(importDeclaration)
    && ts.isStringLiteral(importDeclaration.moduleSpecifier)
    && ["hson-live", "hson-live/hson"].includes(importDeclaration.moduleSpecifier.text)
    && importedName === expected;
}

function is_certify_call(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "certify" && ts.isIdentifier(call.expression.expression) && official_binding(call.expression.expression, "Hson", checker);
}
function has_export(statement: ts.VariableStatement): boolean { return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true; }
function raw_template(node: ts.NoSubstitutionTemplateLiteral, sourceFile: ts.SourceFile): string { const text = node.getText(sourceFile); return text.slice(1, -1); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function write_if_changed(path: string, content: string): void { if (!existsSync(path) || readFileSync(path, "utf8") !== content) writeFileSync(path, content); }
function value_after(flag: string): string | undefined { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; }
function read_config(path: string): ts.ParsedCommandLine { const read = ts.readConfigFile(path, ts.sys.readFile); if (read.error) fail(ts.flattenDiagnosticMessageText(read.error.messageText, "\n")); const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path)); if (parsed.errors.length > 0) fail(parsed.errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")).join("\n")); return parsed; }
function report_and_fail(diagnostics: readonly Diagnostic[]): never { fail(diagnostics.map((entry) => `${entry.file ?? "Hson Schema"}${entry.start === undefined ? "" : `:${entry.start}`}: ${entry.message}`).join("\n")); }
function fail(message: string): never { console.error(message); process.exitCode = 1; throw new Error(message); }
function round(value: number): number { return Math.round(value * 100) / 100; }
function tree_fingerprint(root: string): string { const entries: string[] = []; const visit = (path: string): void => { for (const name of readdirSync(path)) { if (["node_modules", "dist", ".git"].includes(name)) continue; const child = join(path, name); const stat = statSync(child); if (stat.isDirectory()) visit(child); else if (/\.(?:[cm]?ts|json)$/.test(name)) entries.push(`${child}:${stat.mtimeMs}:${stat.size}`); } }; visit(root); return digest(entries.sort().join("\n")); }

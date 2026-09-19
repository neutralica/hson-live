#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import type { CompiledHsonSchema } from "../src/internal/hson-schema/compiler.ts";

const packagedRuntime = existsSync(new URL("../dist/internal/hson-schema/compiler.js", import.meta.url))
  && existsSync(new URL("../dist/internal/hson-schema/generated-evidence.js", import.meta.url));
const runtimeBase = packagedRuntime ? "../dist" : "../src";
const { is_official_hson_package_binding } = await import(`${runtimeBase}/internal/embedded-hson/discover-hson-tagged-templates.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/embedded-hson/discover-hson-tagged-templates.ts");
const { compile_hson_schema, HSON_SCHEMA_MVP_COMPATIBILITY_VERSION } = await import(`${runtimeBase}/internal/hson-schema/compiler.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/compiler.ts");
const { generate_hson_schema_evidence } = await import(`${runtimeBase}/internal/hson-schema/generated-evidence.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/generated-evidence.ts");
const { projected_value_from_hson_node } = await import(`${runtimeBase}/core/projected-value-graph.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/core/projected-value-graph.ts");
const { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } = await import(`${runtimeBase}/internal/canonical-schema/evaluate.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/canonical-schema/evaluate.ts");
const { parse_hson_with_provenance } = await import(`${runtimeBase}/internal/hson-source-provenance/parse-hson-with-provenance.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-source-provenance/parse-hson-with-provenance.ts");
const { resolve_projected_schema_issue_source } = await import(`${runtimeBase}/internal/projected-schema-source-lowering/projected-schema-source-lowering.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/projected-schema-source-lowering/projected-schema-source-lowering.ts");
const { resolve_document_schema_issue_source } = await import(`${runtimeBase}/internal/document-schema-source-lowering/document-schema-source-lowering.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/document-schema-source-lowering/document-schema-source-lowering.ts");

type Mode = "generate" | "verify" | "check" | "build" | "watch";
type SchemaDeclaration = Readonly<{ sourceFile: ts.SourceFile; statement: ts.VariableStatement; declaration: ts.VariableDeclaration; tagged: ts.TaggedTemplateExpression; name: string; source: string; compiled: CompiledHsonSchema }>;
type Artifact = Readonly<{ path: string; content: string; metadataPath: string; metadata: string; reexport: string; schemaAssociation: string; generatedBytes: number; proofNodeCount: number }>;
type Diagnostic = Readonly<{ file?: string; start?: number; message: string }>;
type Overlay = Readonly<{ file: string; start: number; end: number; text: string }>;
type CycleSummary = Readonly<{ schemas: number; updates: number; inputs: readonly string[] }>;

const GENERATED_EXPORTS_START = "// @hson-schema generated type exports";
const GENERATED_EXPORTS_END = "// @hson-schema end generated type exports";
let configInputs: readonly string[] = Object.freeze([]);

const args = process.argv.slice(2);
const mode = (args[0] ?? "verify") as Mode;
const projectArg = value_after("--project") ?? "tsconfig.json";
const projectPath = resolve(projectArg);
const librarySourceRoot = resolve(fileURLToPath(new URL("../src/", import.meta.url)));
if (!["generate", "verify", "check", "build", "watch"].includes(mode)) fail(`Unknown Hson Schema mode ${JSON.stringify(mode)}.`);

if (mode === "watch") run_watch();
else try { run_cycle(mode); } catch (error) { console.error(error_message(error)); process.exitCode = 1; }

function run_watch(): void {
  console.log(`Hson Schema watch: checking ${projectPath}.`);
  let fingerprint = "";
  let inputs: readonly string[] = Object.freeze([projectPath]);
  const cycle = (): void => {
    try {
      const summary = run_cycle("generate");
      inputs = summary.inputs;
      console.log(`Hson Schema watch: current; ${summary.schemas} ${summary.schemas === 1 ? "Schema" : "Schemas"}; ${summary.updates} ${summary.updates === 1 ? "artifact" : "artifacts"} updated; watching.`);
    } catch (error) {
      console.error(`Hson Schema watch: stale/error; ${error_message(error)}`);
    } finally {
      fingerprint = watch_fingerprint(inputs);
    }
  };
  cycle();
  const timer = setInterval(() => {
    const next = watch_fingerprint(inputs);
    if (next === fingerprint) return;
    console.log("Hson Schema watch: checking changes.");
    cycle();
  }, 500);
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    process.exitCode = 0;
    console.log(`Hson Schema watch: stopped (${signal}).`);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

function run_cycle(selected: Exclude<Mode, "watch">): CycleSummary {
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
  let updates = reconcile_generated_lifecycle(config, schemaDeclarations, artifacts, selected, diagnostics);

  for (let index = 0; index < schemaDeclarations.length; index += 1) {
    const declaration = schemaDeclarations[index] as SchemaDeclaration;
    const artifact = artifacts[index] as Artifact;
    if (selected === "generate") {
      if (write_if_changed(artifact.path, artifact.content)) updates += 1;
      if (write_if_changed(artifact.metadataPath, artifact.metadata)) updates += 1;
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
    const schemaOverlays = schemaDeclarations.map((schema): Overlay => ({
      file: schema.sourceFile.fileName,
      start: schema.declaration.initializer!.getStart(schema.sourceFile),
      end: schema.declaration.initializer!.getEnd(),
      text: `(${schema.declaration.initializer!.getText(schema.sourceFile)} as unknown as ${schema.declaration.type!.getText(schema.sourceFile)})`,
    }));
    const command = check_with_overlays(config, [...staticAnalysis.overlays, ...schemaOverlays], selected === "build");
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
  return Object.freeze({ schemas: schemaDeclarations.length, updates, inputs: authoritative_watch_inputs(config) });
}

function discover_schemas(program: ts.Program, checker: ts.TypeChecker): SchemaDeclaration[] {
  const output: SchemaDeclaration[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.startsWith(`${librarySourceRoot}${sep}`) || sourceFile.fileName.includes(`${sep}node_modules${sep}`) || sourceFile.fileName.includes(".hson-schema.generated.")) continue;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) continue;
      const declaration = statement.declarationList.declarations[0];
      if (declaration === undefined || !ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const tagged = unwrap_tagged_schema(declaration.initializer);
      if (tagged === undefined || !is_official_hson_member_tag(tagged, "schema", checker)) continue;
      if (!ts.isNoSubstitutionTemplateLiteral(tagged.template)) throw new Error(`${sourceFile.fileName}: ${declaration.name.text} must use a substitution-free official Hson.schema tagged template.`);
      const source = raw_template(tagged.template, sourceFile);
      const compiled = compile_hson_schema(source);
      if (!compiled.ok) throw new Error(`${sourceFile.fileName}: ${declaration.name.text}: ${compiled.issues.map((issue) => issue.message).join(" ")}`);
      output.push(Object.freeze({ sourceFile, statement, declaration, tagged, name: declaration.name.text, source, compiled: compiled.value }));
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
  const identity = `${relative(dirname(projectPath), schema.sourceFile.fileName).split(sep).join("/")}#${schema.name}`;
  const evidence = generate_hson_schema_evidence(schema.name, schema.source, identity);
  const content = evidence.declaration, metadata = evidence.metadata;
  const runtimeExtension = extension === ".mts" ? ".mjs" : extension === ".cts" ? ".cjs" : ".js";
  const generatedSpecifier = `./${stem.slice(stem.lastIndexOf(sep) + 1)}.${schema.name}.hson-schema.generated${runtimeExtension}`;
  const evidenceName = `__${schema.name}Evidence`;
  const reexport = `import type { Evidence as ${evidenceName} } from ${JSON.stringify(generatedSpecifier)};`;
  const schemaAssociation = `__HsonSchema<${evidenceName}["value"], ${evidenceName}["mode"], ${evidenceName}["identity"]>`;
  return Object.freeze({ path: artifactPath, content, metadataPath: `${stem}.${schema.name}.hson-schema.generated.json`, metadata, reexport, schemaAssociation, generatedBytes: evidence.generatedBytes, proofNodeCount: evidence.proofNodeCount });
}

function schema_mode(schema: SchemaDeclaration): "data" | "document" {
  return schema.compiled.semantic.kind === "document" || schema.compiled.semantic.kind === "document-element"
    ? "document"
    : "data";
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
  const byDeclaration = new Map<ts.Declaration, SchemaDeclaration>(schemas.map((schema) => [schema.declaration, schema]));
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(`${sep}node_modules${sep}`) || sourceFile.fileName.includes(".hson-schema.generated.")) continue;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) continue;
      const declaration = statement.declarationList.declarations[0];
      if (declaration === undefined || declaration.type === undefined || !ts.isTypeReferenceNode(declaration.type) || !ts.isIdentifier(declaration.type.typeName)) continue;
      const typeName = declaration.type.typeName.text;
      if ((typeName !== "HsonData" && typeName !== "HsonDocument") || !official_binding(declaration.type.typeName, typeName, checker) || declaration.type.typeArguments?.length !== 1 || declaration.initializer === undefined) continue;
      const schemaReference = declaration.type.typeArguments[0];
      if (schemaReference === undefined || !ts.isTypeQueryNode(schemaReference) || !ts.isIdentifier(schemaReference.exprName)) continue;
      let schemaSymbol = checker.getSymbolAtLocation(schemaReference.exprName);
      if (schemaSymbol !== undefined && (schemaSymbol.flags & ts.SymbolFlags.Alias) !== 0) schemaSymbol = checker.getAliasedSymbol(schemaSymbol);
      const schema = schemaSymbol?.declarations?.map(item => byDeclaration.get(item)).find((item): item is SchemaDeclaration => item !== undefined);
      if (schema === undefined) continue;
      if (schema_mode(schema) !== (typeName === "HsonData" ? "data" : "document")) {
        diagnostics.push({ file: sourceFile.fileName, start: declaration.type.getStart(), message: `Schema mode does not match ${typeName}.` });
        continue;
      }
      if (ts.isTaggedTemplateExpression(declaration.initializer)) {
        if (!is_official_hson_member_tag(declaration.initializer, typeName === "HsonData" ? "data" : "document", checker) || !ts.isNoSubstitutionTemplateLiteral(declaration.initializer.template)) {
          diagnostics.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(), message: `Schema-bound ${typeName} requires a direct substitution-free official semantic Hson tag.` });
          continue;
        }
        const before = diagnostics.length;
        validate_candidate(schema, raw_template(declaration.initializer.template, sourceFile), sourceFile, declaration.initializer, diagnostics);
        if (diagnostics.length !== before) continue;
        overlays.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(sourceFile), end: declaration.initializer.getEnd(), text: `(${declaration.initializer.getText(sourceFile)} as unknown as ${declaration.type.getText(sourceFile)})` });
        count += 1;
        if (schema.compiled.semantic.kind === "document") documentCount += 1;
      }
    }
  }
  return Object.freeze({ count, documentCount, overlays: Object.freeze(overlays) });
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
): number {
  let updates = 0;
  const expectedArtifacts = new Set(artifacts.flatMap((artifact) => [resolve(artifact.path), resolve(artifact.metadataPath)]));
  for (const path of generated_artifact_paths(config)) {
    if (expectedArtifacts.has(resolve(path))) continue;
    if (selected === "generate") { unlinkSync(path); updates += 1; }
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
      if (next !== source) { writeFileSync(fileName, next); updates += 1; }
    } else {
      if (source !== associated) {
        diagnostics.push({ file: fileName, message: `Generated Hson Schema value associations are missing or stale. Run hson-schema generate --project ${projectArg}.` });
      }
      if (actual !== expected) {
        diagnostics.push({ file: fileName, message: `Generated Hson Schema type exports are missing or stale. Run hson-schema generate --project ${projectArg}.` });
      }
    }
  }
  return updates;
}

function apply_generated_schema_associations(
  source: string,
  associations: readonly Readonly<{ declaration: ts.VariableDeclaration; text: string }>[],
): string {
  let output = source;
  for (const association of [...associations].sort((left, right) => (
    (right.declaration.type?.getStart() ?? right.declaration.name.getEnd()) - (left.declaration.type?.getStart() ?? left.declaration.name.getEnd())
  ))) {
    const initializer = association.declaration.initializer;
    const tagged = initializer === undefined ? undefined : unwrap_tagged_schema(initializer);
    if (initializer !== undefined && tagged !== undefined) {
      const replacement = `(${tagged.getText()} as unknown as ${association.text})`;
      output = output.slice(0, initializer.getStart()) + replacement + output.slice(initializer.getEnd());
    }
    const annotation = association.declaration.type;
    if (annotation === undefined) {
      const position = association.declaration.name.getEnd();
      output = output.slice(0, position) + `: ${association.text}` + output.slice(position);
    } else {
      output = output.slice(0, annotation.getStart()) + association.text + output.slice(annotation.getEnd());
    }
  }
  return output;
}

function generated_exports_block(exports: readonly string[]): string {
  if (exports.length === 0) return "";
  return `${GENERATED_EXPORTS_START}\nimport type { HsonSchema as __HsonSchema } from "hson-live";\n${[...exports].sort().join("\n")}\n${GENERATED_EXPORTS_END}\n`;
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

function generated_artifact_paths(_config: ts.ParsedCommandLine): readonly string[] {
  const output: string[] = [];
  const visit = (path: string): void => {
    for (const name of readdirSync(path)) {
      if (["node_modules", "dist", ".git"].includes(name)) continue;
      const child = join(path, name);
      const stat = statSync(child);
      if (stat.isDirectory()) visit(child);
      else if (/\.hson-schema\.generated\.json$/.test(name) && authoritative_metadata(child)) {
        output.push(child);
        const declaration = child.slice(0, -4) + "ts";
        if (existsSync(declaration)) output.push(declaration);
      }
    }
  };
  visit(dirname(projectPath));
  return Object.freeze(output);
}

function authoritative_metadata(path: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null) return false;
    const metadata = value as Record<string, unknown>;
    if (metadata.compatibilityVersion !== HSON_SCHEMA_MVP_COMPATIBILITY_VERSION || typeof metadata.declarationIdentity !== "string" || typeof metadata.generatedDeclarationDigest !== "string") return false;
    const separatorIndex = metadata.declarationIdentity.lastIndexOf("#");
    if (separatorIndex <= 0) return false;
    const producer = resolve(dirname(projectPath), metadata.declarationIdentity.slice(0, separatorIndex));
    const schemaName = metadata.declarationIdentity.slice(separatorIndex + 1);
    const producerExtension = extname(producer);
    const expected = `${producer.slice(0, -producerExtension.length)}.${schemaName}.hson-schema.generated.json`;
    return resolve(path) === resolve(expected);
  } catch { return false; }
}

function official_binding(identifier: ts.Identifier, expected: "Hson" | "HsonData" | "HsonDocument", checker: ts.TypeChecker): boolean {
  return is_official_hson_package_binding(identifier, expected, checker, true);
}

function is_official_hson_member_tag(node: ts.TaggedTemplateExpression, member: string, checker: ts.TypeChecker): boolean {
  return ts.isPropertyAccessExpression(node.tag)
    && node.tag.name.text === member
    && ts.isIdentifier(node.tag.expression)
    && official_binding(node.tag.expression, "Hson", checker);
}
function unwrap_tagged_schema(node: ts.Expression): ts.TaggedTemplateExpression | undefined {
  if (ts.isTaggedTemplateExpression(node)) return node;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return unwrap_tagged_schema(node.expression);
  return undefined;
}
function raw_template(node: ts.NoSubstitutionTemplateLiteral, sourceFile: ts.SourceFile): string { const text = node.getText(sourceFile); return text.slice(1, -1); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function write_if_changed(path: string, content: string): boolean { if (existsSync(path) && readFileSync(path, "utf8") === content) return false; writeFileSync(path, content); return true; }
function value_after(flag: string): string | undefined { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; }
function read_config(path: string): ts.ParsedCommandLine {
  const consumed = new Set<string>([resolve(path)]);
  const host: ts.ParseConfigHost = { ...ts.sys, readFile(fileName): string | undefined { consumed.add(resolve(fileName)); return ts.sys.readFile(fileName); } };
  const read = ts.readConfigFile(path, host.readFile);
  if (read.error) fail(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, host, dirname(path), undefined, path);
  if (parsed.errors.length > 0) fail(parsed.errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")).join("\n"));
  for (const reference of parsed.projectReferences ?? []) {
    const referencePath = resolve(reference.path);
    const referenceConfig = existsSync(referencePath) && statSync(referencePath).isDirectory() ? join(referencePath, "tsconfig.json") : referencePath;
    collect_config_inputs(referenceConfig, consumed, new Set());
  }
  configInputs = Object.freeze([...consumed]);
  return parsed;
}
function collect_config_inputs(path: string, consumed: Set<string>, seen: Set<string>): void {
  const config = resolve(path);
  if (seen.has(config)) return;
  seen.add(config); consumed.add(config);
  const host: ts.ParseConfigHost = { ...ts.sys, readFile(fileName): string | undefined { consumed.add(resolve(fileName)); return ts.sys.readFile(fileName); } };
  const read = ts.readConfigFile(config, host.readFile);
  if (read.error) return;
  const parsed = ts.parseJsonConfigFileContent(read.config, host, dirname(config), undefined, config);
  for (const reference of parsed.projectReferences ?? []) {
    const referencePath = resolve(reference.path);
    collect_config_inputs(existsSync(referencePath) && statSync(referencePath).isDirectory() ? join(referencePath, "tsconfig.json") : referencePath, consumed, seen);
  }
}
function report_and_fail(diagnostics: readonly Diagnostic[]): never { fail(diagnostics.map((entry) => `${entry.file ?? "Hson Schema"}${entry.start === undefined ? "" : `:${entry.start}`}: ${entry.message}`).join("\n")); }
function fail(message: string): never { throw new Error(message); }
function error_message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function round(value: number): number { return Math.round(value * 100) / 100; }
function authoritative_watch_inputs(config: ts.ParsedCommandLine): readonly string[] {
  return Object.freeze([...new Set([
    ...configInputs,
    ...config.fileNames.filter(fileName => !fileName.includes(".hson-schema.generated.")),
  ].map(path => resolve(path)))].sort());
}
function watch_fingerprint(inputs: readonly string[]): string {
  const entries = inputs.map(path => existsSync(path) ? `${path}:${digest(readFileSync(path, "utf8"))}` : `${path}:missing`);
  return digest(entries.sort().join("\n"));
}

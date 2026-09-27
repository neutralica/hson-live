#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import type { CompiledHsonSchema } from "../src/internal/hson-schema/compiler.ts";

const packagedRuntime = import.meta.url.endsWith(".mjs") && existsSync(new URL("../dist/internal/hson-schema/compiler.js", import.meta.url))
  && existsSync(new URL("../dist/internal/hson-schema/generated-evidence.js", import.meta.url))
  && existsSync(new URL("../dist/internal/hson-schema/source-transformation.js", import.meta.url));
const runtimeBase = packagedRuntime ? "../dist" : "../src";
const { is_official_hson_package_binding } = await import(`${runtimeBase}/internal/embedded-hson/discover-hson-tagged-templates.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/embedded-hson/discover-hson-tagged-templates.ts");
const { compile_hson_schema } = await import(`${runtimeBase}/internal/hson-schema/compiler.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/compiler.ts");
const { library_schema_attachment_plan } = await import(`${runtimeBase}/internal/hson-schema/source-transformation.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/source-transformation.ts");
const { discover_hson_schema_declarations } = await import(`${runtimeBase}/internal/hson-schema/schema-discovery.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/schema-discovery.ts");
const { projected_value_from_hson_node } = await import(`${runtimeBase}/core/projected-value-graph.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/core/projected-value-graph.ts");
const { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } = await import(`${runtimeBase}/internal/canonical-schema/evaluate.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/canonical-schema/evaluate.ts");
const { parse_hson_with_provenance } = await import(`${runtimeBase}/internal/hson-source-provenance/parse-hson-with-provenance.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-source-provenance/parse-hson-with-provenance.ts");
const { resolve_projected_schema_issue_source } = await import(`${runtimeBase}/internal/projected-schema-source-lowering/projected-schema-source-lowering.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/projected-schema-source-lowering/projected-schema-source-lowering.ts");
const { resolve_document_schema_issue_source } = await import(`${runtimeBase}/internal/document-schema-source-lowering/document-schema-source-lowering.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/document-schema-source-lowering/document-schema-source-lowering.ts");

type Mode = "generate" | "verify" | "check" | "build" | "watch" | "migrate";
type SchemaDeclaration = Readonly<{ sourceFile: ts.SourceFile; statement: ts.VariableStatement; declaration: ts.VariableDeclaration; tagged: ts.TaggedTemplateExpression; name: string; source: string; compiled: CompiledHsonSchema }>;
type Diagnostic = Readonly<{ file?: string; start?: number; message: string }>;
type Overlay = Readonly<{ file: string; start: number; end: number; text: string }>;

const args = process.argv.slice(2);
const mode = (args[0] ?? "verify") as Mode;
const projectArg = value_after("--project") ?? "tsconfig.json";
const projectPath = resolve(projectArg);
const librarySourceRoot = resolve(fileURLToPath(new URL("../src/", import.meta.url)));
if (args.includes("--help") || mode === ("--help" as Mode)) {
  console.log(`hson-schema <generate|verify|check|build|watch|migrate> --project tsconfig.json
  generate: publish current compiler inputs; authored source is untouched
  verify: read-only ownership, compatibility and freshness verification
  check: verify, then precisely check the generated compiler project
  build: verify/check, then emit authored runtime and precise declarations from one revision
  watch: replace current compiler inputs; emit current JSON events; authoring errors are recoverable
  Normal workflows require current direct source. Legacy source/evidence requires migrate.
  migrate: preview recognized legacy association/artifact cleanup; --write applies it`);
} else try {
  if (!["generate", "verify", "check", "build", "watch", "migrate"].includes(mode)) fail(`Unknown Hson Schema mode ${JSON.stringify(mode)}.`);
  if (mode === "migrate") {
    const { migrate_schema_associations } = await import(`${runtimeBase}/internal/hson-schema/legacy-migration.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/legacy-migration.ts");
    console.log(JSON.stringify(migrate_schema_associations(projectPath, args.includes("--write"))));
  } else if (mode === "watch") await run_project(true);
  else if (mode === "generate") await run_project(false);
  else {
    const { verify_schema_compiler_project } = await import(`${runtimeBase}/internal/hson-schema/compiler-project-watch.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/compiler-project-watch.ts");
    const current = verify_schema_compiler_project(projectPath);
    if (mode !== "verify") {
      const { check_schema_project } = await import(`${runtimeBase}/internal/hson-schema/compiler-project-build.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/compiler-project-build.ts");
      check_schema_project(projectPath, current, mode === "build");
    }
    console.log(JSON.stringify({ hsonSchema: mode, project: current.project, revision: current.manifest.revision }));
  }
} catch (error) { console.error(error_message(error)); process.exitCode = 1; }

async function run_project(watch: boolean): Promise<void> {
  const { create_schema_compiler_project_watch } = await import(`${runtimeBase}/internal/hson-schema/compiler-project-watch.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/compiler-project-watch.ts");
  let published = false;
  let issues: readonly string[] = [];
  const watcher = create_schema_compiler_project_watch(projectPath, (config, program, configDiagnostics) => {
    const checker = program.getTypeChecker();
    const diagnostics: Diagnostic[] = [...configDiagnostics, ...program.getOptionsDiagnostics(), ...program.getSyntacticDiagnostics()].map(d => ({ message: format_ts_diagnostic(d) }));
    let schemas = discover_schemas(program, checker, diagnostics);
    try { require_schema_compiler_options(config, schemas.length); reject_schema_reexports(program, checker, schemas); }
    catch (error) { diagnostics.push({ message: error_message(error) }); schemas = []; }
    if (configDiagnostics.length) schemas = [];
    const analysis = analyze_static_hson(program, checker, schemas, diagnostics);
    const attachmentFacts = schemas.map(schema => Object.freeze({ declaration: schema.declaration, mode: schema_mode(schema) }));
    const attachments: Overlay[] = [];
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile || program.isSourceFileFromExternalLibrary(source)) continue;
      attachments.push(...library_schema_attachment_plan(source, checker, attachmentFacts).edits.map(edit => ({ file: source.fileName, ...edit })));
    }
    // Generated precision replaces ordinary broad-tag diagnostics; missing imports remain errors.
    const missingImports = program.getSemanticDiagnostics().filter(d => [2307, 2792, 7016].includes(d.code));
    diagnostics.push(...missingImports.map(d => ({ message: format_ts_diagnostic(d) })));
    return { schemas, overlays: [...analysis.overlays, ...attachments], diagnostics: diagnostics.map(d => `${d.file ?? ""}${d.file === undefined ? "" : ": "}${d.message}`) };
  }, event => {
    if (event.state === "current") { published = true; issues = event.diagnostics ?? []; }
    if (event.state !== "prepared") console.log(JSON.stringify({ hsonSchema: watch ? "watch" : "generate", ...event }));
  },
  // Acceptance-only IPC barrier: deterministic edits after preparation, before revision verification.
  process.env.HSON_SCHEMA_WATCH_TEST_BARRIER === "1" && process.send !== undefined ? async event => {
    process.send?.(event);
    await new Promise<void>(accept => process.once("message", () => accept()));
  } : undefined);
  let stopped = false;
  const stop = (): void => { stopped = true; watcher.stop(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (!stopped) {
      await watcher.poll();
      if (!watch && published) { if (issues.length) fail(issues.join("\n")); break; }
      if (!stopped) await new Promise<void>(accept => setTimeout(accept, 250));
    }
  } finally { watcher.stop(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

function require_schema_compiler_options(config: ts.ParsedCommandLine, schemas: number): void {
  if (schemas > 0 && (config.options.strict !== true || config.options.exactOptionalPropertyTypes !== true || config.options.noUncheckedIndexedAccess !== true)) {
    fail("Hson Schema requires strict, exactOptionalPropertyTypes, and noUncheckedIndexedAccess to be true.");
  }
}

function discover_schemas(program: ts.Program, checker: ts.TypeChecker, diagnostics?: Diagnostic[]): SchemaDeclaration[] {
  const output: SchemaDeclaration[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.startsWith(`${librarySourceRoot}${sep}`) || sourceFile.fileName.includes(`${sep}node_modules${sep}`)) continue;
    const reportedDuplicates = new Set<string>();
    for (const discovered of discover_hson_schema_declarations(ts, sourceFile, checker)) {
      const { statement, declaration, tagged, name } = discovered;
      if (discovered.ambiguous) {
        if (!reportedDuplicates.has(name)) diagnostics?.push({ file: sourceFile.fileName, message: `Duplicate Schema declaration ${name}; precise evidence withdrawn.` });
        reportedDuplicates.add(name);
        continue;
      }
      if (!discovered.complete || !ts.isNoSubstitutionTemplateLiteral(tagged.template)) {
        const message = `${sourceFile.fileName}: ${name} must use a complete substitution-free official Hson.schema tagged template.`;
        if (diagnostics === undefined) throw new Error(message);
        diagnostics.push({ message }); continue;
      }
      const source = raw_template(tagged.template, sourceFile);
      const compiled = compile_hson_schema(source);
      if (!compiled.ok) {
        const message = `${sourceFile.fileName}: ${name}: ${compiled.issues.map((issue) => issue.message).join(" ")}`;
        if (diagnostics === undefined) throw new Error(message);
        diagnostics.push({ message }); continue;
      }
      output.push(Object.freeze({ sourceFile, statement, declaration, tagged, name, source, compiled: compiled.value }));
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

function schema_mode(schema: SchemaDeclaration): "data" | "document" {
  return schema.compiled.semantic.kind === "document" || schema.compiled.semantic.kind === "document-element"
    ? "document"
    : "data";
}

function analyze_static_hson(program: ts.Program, checker: ts.TypeChecker, schemas: readonly SchemaDeclaration[], diagnostics: Diagnostic[]): Readonly<{ count: number; documentCount: number; overlays: readonly Overlay[] }> {
  let count = 0;
  let documentCount = 0;
  const overlays: Overlay[] = [];
  const byDeclaration = new Map<ts.Declaration, SchemaDeclaration>(schemas.map((schema) => [schema.declaration, schema]));
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(`${sep}node_modules${sep}`)) continue;
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

function official_binding(identifier: ts.Identifier, expected: "Hson" | "HsonData" | "HsonDocument", checker: ts.TypeChecker): boolean {
  return is_official_hson_package_binding(identifier, expected, checker, true);
}

function is_official_hson_member_tag(node: ts.TaggedTemplateExpression, member: string, checker: ts.TypeChecker): boolean {
  return ts.isPropertyAccessExpression(node.tag)
    && node.tag.name.text === member
    && ts.isIdentifier(node.tag.expression)
    && official_binding(node.tag.expression, "Hson", checker);
}

function raw_template(node: ts.NoSubstitutionTemplateLiteral, sourceFile: ts.SourceFile): string { const text = node.getText(sourceFile); return text.slice(1, -1); }
function value_after(flag: string): string | undefined { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; }
function fail(message: string): never { throw new Error(message); }
function error_message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

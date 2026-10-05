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
const { static_schema_candidate_diagnostics } = await import(`${runtimeBase}/internal/hson-schema/candidate-diagnostics.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/candidate-diagnostics.ts");
const { evaluate_static_schema_candidate } = await import(`${runtimeBase}/internal/hson-schema/candidate-evaluation.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/candidate-evaluation.ts");
const { resolve_immutable_schema } = await import(`${runtimeBase}/internal/hson-schema/schema-identity.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/schema-identity.ts");
const { resolve_hson_schema_annotation } = await import(`${runtimeBase}/internal/hson-schema/schema-annotation.${packagedRuntime ? "js" : "ts"}`) as typeof import("../src/internal/hson-schema/schema-annotation.ts");

type Mode = "generate" | "verify" | "check" | "build" | "watch";
type SchemaDeclaration = Readonly<{ sourceFile: ts.SourceFile; statement: ts.VariableStatement; declaration: ts.VariableDeclaration; tagged: ts.TaggedTemplateExpression; name: string; source: string; compiled: CompiledHsonSchema }>;
type Diagnostic = Readonly<{ file?: string; start?: number; message: string }>;
type Overlay = Readonly<{ file: string; start: number; end: number; text: string }>;

const args = process.argv.slice(2);
const mode = (args[0] ?? "verify") as Mode;
const projectArg = value_after("--project") ?? "tsconfig.json";
const projectPath = resolve(projectArg);
const librarySourceRoot = resolve(fileURLToPath(new URL("../src/", import.meta.url)));
if (args.includes("--help") || mode === ("--help" as Mode)) {
  console.log(`hson-schema <generate|verify|check|build|watch> --project tsconfig.json
  generate: publish current compiler inputs; authored source is untouched
  verify: read-only ownership, integrity and freshness verification
  check: verify, then precisely check the generated compiler project
  build: verify/check, then emit authored runtime and precise declarations from one revision
  watch: replace current compiler inputs; emit current JSON events; authoring errors are recoverable
  Stale generated state requires generate; unsupported artifacts must be removed and regenerated.`);
} else try {
  if (!["generate", "verify", "check", "build", "watch"].includes(mode)) fail(`Unknown Hson Schema mode ${JSON.stringify(mode)}.`);
  if (mode === "watch") await run_project(true);
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
    diagnostics.push(...static_schema_candidate_diagnostics(ts, program));
    const attachmentFacts = schemas.map(schema => Object.freeze({ declaration: schema.declaration, mode: schema_mode(schema) }));
    const attachments: Overlay[] = [];
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile || program.isSourceFileFromExternalLibrary(source)) continue;
      attachments.push(...library_schema_attachment_plan(source, checker, attachmentFacts).edits.map(edit => ({ file: source.fileName, ...edit })));
    }
    // Generated precision replaces ordinary broad-tag diagnostics; missing imports remain errors.
    const missingImports = program.getSemanticDiagnostics().filter(d => [2307, 2792, 7016].includes(d.code));
    diagnostics.push(...missingImports.map(d => ({ message: format_ts_diagnostic(d) })));
    return { schemas, overlays: [...analysis.overlays, ...attachments], diagnostics: diagnostics.map(d => {
      const source = d.file === undefined ? undefined : program.getSourceFile(d.file);
      const position = source === undefined || d.start === undefined ? undefined : source.getLineAndCharacterOfPosition(d.start);
      return `${d.file ?? ""}${d.file === undefined ? "" : position === undefined ? ": " : `:${position.line + 1}:${position.character + 1}: `}${d.message}`;
    }) };
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
      if (declaration === undefined || declaration.type === undefined || declaration.initializer === undefined) continue;
      const annotation = resolve_hson_schema_annotation(ts, checker, declaration.type);
      if (annotation === undefined || annotation.kind === "projected" || annotation.schema === undefined) continue;
      const typeName = annotation.kind === "data" ? "HsonData" : "HsonDocument";
      const schema = resolve_immutable_schema(ts, checker, annotation.schema, item => byDeclaration.get(item));
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
        const evaluated = evaluate_static_schema_candidate(schema.compiled, { source: raw_template(declaration.initializer.template, sourceFile), family: typeName === "HsonData" ? "data" : "document" });
        if (evaluated.kind !== "valid") {
          // Semantic failures are reported once by shared relationship analysis.
          if (evaluated.kind === "unknown" && evaluated.error !== undefined) diagnostics.push({ file: sourceFile.fileName, start: declaration.initializer.getStart(), message: evaluated.error });
          continue;
        }
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

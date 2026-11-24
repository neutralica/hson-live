import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { is_supported_document, produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.js";
import { local_hson_schema_diagnostics } from "../editors/vscode-hson/src/hson-schema-local.js";
import { produce_project_diagnostics } from "../editors/vscode-hson/src/schema-editor-view.js";
import { is_workspace_typescript_source, visit_configured_typescript_projects } from "../editors/vscode-hson/src/typescript-project-discovery.js";

const configurations = [
  "tsconfig.json",
  "tests/tsconfig.json",
  "scripts/tsconfig.json",
  "editors/vscode-hson/tsconfig.json",
  "editors/vscode-hson/tsconfig.plugin.json",
  "editors/vscode-hson/tests/diagnostics-project.json",
  "editors/vscode-hson/tests/fixtures/declarative-schema/tsconfig.json",
  "tests/entrypoints/public/tsconfig.json",
  "tests/entrypoints/worker/tsconfig.json",
  "tests/entrypoints/node/tsconfig.json",
  "tests/entrypoints/browser/tsconfig.json",
  "tests/fixtures/hson-schema-mvp/tsconfig.json",
  "tests/fixtures/hson-schema-document/tsconfig.json",
  "tests/fixtures/hson-schema-compiler-project/tsconfig.json",
  "experiments/schema2/tsconfig.json",
];
const sourceDirectories = ["src", "tests", "editors/vscode-hson/src", "editors/vscode-hson/tests", "experiments/schema2"];
const ignoredDirectories = ["node_modules", "dist", "out", ".hson", ".test-dist", "tmp", "historical", "runtime-probes", "_refactor"]
  .map(directory => `**/${directory}/**`);

type Issue = Readonly<{ start: number; end: number; code?: string; message: string }>;
type Fixture = Readonly<{ path: string; code: string; line: string }>;
const fixtureDirectory = "editors/vscode-hson/tests/fixtures/";
const publicEntrypoints = "tests/entrypoints/public/public-entrypoints.ts";
// The publication smoke fixtures must still publish their original diagnostics.
// The public type fixtures also exercise these two specific Hson errors.
const negativeFixtures: readonly Fixture[] = [
  { path: fixtureDirectory + "diagnostics-alias.ts", code: "HSON_NUMBER_LEADING_PLUS", line: "const page = markup.canonical`+1`;" },
  { path: fixtureDirectory + "diagnostics-smoke.ts", code: "HSON_CONTAINER_UNTERMINATED", line: "<<<<<<<<<<<<<<<<<<" },
  { path: fixtureDirectory + "injection.ts", code: "invalid-json-escape", line: 'const escaped = Hson.canonical`<message "host \\` tick"/>`;' },
  { path: publicEntrypoints, code: "HSON_TAGGED_TEMPLATE_REQUIRED", line: 'Hson.event`<hson:event on:click local:${"RUN"} <> >`;' },
  { path: fixtureDirectory + "diagnostics-schema-proof.ts", code: "HSON_SCHEMA_PROOF_UNRESOLVED",
    line: 'const unproved: HsonDocument<typeof Page> = Hson.document`<main "Ready"/>`;' },
  { path: fixtureDirectory + "declarative-schema/candidate.ts", code: "TYPE_MISMATCH",
    line: 'export const user: HsonData<typeof UserSchema> = Hson.data`<user <age "37">>`;' },
];
const removedTypeSubpaths = new Set(["hson-live/types", "hson-live/internal/trusted-schema-diagnostics/protocol"]);
const authoringExports = new Set(["Hson", "HsonSchema", "HsonData", "HsonDocument", "HsonValue", "HsonProjectedValue", "HsonFromSchema"]);

function needsBindingEvidence(module: string, name: string, typeOnly: boolean): boolean {
  if (typeOnly) return authoringExports.has(name);
  if (module !== "hson-live" && !module.startsWith("hson-live/")) return true;
  if (module === "hson-live") return authoringExports.has(name)
    || name === "hson" || name === "hsonTransform" || name === "hsonLiveMap" || name === "hsonLiveTree";
  if (module === "hson-live/hson") return authoringExports.has(name);
  return (module === "hson-live/transform" && name === "hsonTransform")
    || (module === "hson-live/livemap" && name === "hsonLiveMap")
    || (module === "hson-live/livetree" && name === "hsonLiveTree");
}

function authoredSources(root: string): readonly string[] {
  return sourceDirectories.flatMap(directory => ts.sys.readDirectory(resolve(root, directory),
    [".ts", ".tsx", ".mts", ".cts", ".hson"], ignoredDirectories))
    .filter(fileName => fileName.endsWith(".hson") || is_workspace_typescript_source(fileName));
}

/** Check resolution independently of TypeScript diagnostic suppression. An
 * absent module or value binding can otherwise remove an Hson producer's input. */
function checkImports(file: ts.SourceFile, checker: ts.TypeChecker, path: string, report: (issue: Issue) => void): void {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const module = statement.moduleSpecifier;
    if (module === undefined || !ts.isStringLiteralLike(module)) continue;
    if (path === publicEntrypoints && ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly
      && removedTypeSubpaths.has(module.text)) continue;
    if (checker.getSymbolAtLocation(module) === undefined) {
      report({ start: module.getStart(file), end: module.end, code: "HSON_ANALYSIS_IMPORT",
        message: `Could not resolve module ${module.getText(file)} in the configured TypeScript project.` });
      continue;
    }
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      if (!needsBindingEvidence(module.text, (binding.propertyName ?? binding.name).text,
        statement.importClause?.isTypeOnly === true || binding.isTypeOnly)) continue;
      const symbol = checker.getSymbolAtLocation(binding.name);
      if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
        && checker.getAliasedSymbol(symbol).declarations?.length) continue;
      report({ start: binding.getStart(file), end: binding.end, code: "HSON_ANALYSIS_IMPORT",
        message: `Could not resolve ${binding.getText(file)} from ${module.getText(file)} in the configured TypeScript project.` });
    }
  }
}

export function checkHsonDiagnostics(root: string, projectPaths = configurations, expectedSources = authoredSources(root),
  fixtures: readonly Fixture[] = negativeFixtures,
): Readonly<{ failures: readonly string[]; projects: number; sources: number; fixtures: number }> {
  const paths = (name: string) => relative(root, name).split(sep).join("/");
  const absoluteProjects = projectPaths.map(path => resolve(root, path));
  const failures = new Set<string>(), visitedProjects = new Set<string>(), analyzed = new Set<string>();
  const expectedDiagnostics = new Map<Fixture, Set<string>>(fixtures.map(fixture => [fixture, new Set()]));
  const report = (file: ts.SourceFile, issue: Issue, project?: string) => {
    const path = paths(file.fileName);
    const first = file.getLineAndCharacterOfPosition(issue.start);
    const last = file.getLineAndCharacterOfPosition(issue.end);
    const line = file.text.slice(file.getLineStarts()[first.line], file.getLineStarts()[first.line + 1]).trim();
    const message = `${path}:${first.line + 1}:${first.character + 1}-${last.line + 1}:${last.character + 1} [${issue.code ?? "Hson"}] ${issue.message}`;
    const expected = fixtures.find(fixture => fixture.path === path && fixture.code === issue.code && fixture.line === line);
    if (expected !== undefined) expectedDiagnostics.get(expected)?.add(message);
    else failures.add(project === undefined ? message : `${message} (project ${paths(project)})`);
  };
  const evidenceError = (fileName: string, code: string, message: string) => failures.add(`${paths(fileName)} [${code}] ${message}`);
  const projectErrors = visit_configured_typescript_projects(root, absoluteProjects, (project, parsed, program) => {
    visitedProjects.add(project);
    const reportTypeScript = (diagnostic: ts.Diagnostic, code: string) => {
      const message = `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
      if (diagnostic.file === undefined || diagnostic.start === undefined) evidenceError(project, code, message);
      else report(diagnostic.file, { start: diagnostic.start, end: diagnostic.start + (diagnostic.length ?? 0), code, message }, project);
    };
    const options = [...program.getConfigFileParsingDiagnostics(), ...program.getOptionsDiagnostics()];
    for (const diagnostic of options) reportTypeScript(diagnostic, "HSON_ANALYSIS_PROJECT");
    if (options.length > 0) return;

    for (const fileName of parsed.fileNames) {
      if (program.getSourceFile(fileName) === undefined) {
        evidenceError(fileName, "HSON_ANALYSIS_SOURCE", `Source is missing from ${paths(project)}.`);
      }
    }
    const checker = program.getTypeChecker();
    const sources = new Map<string, ts.SourceFile>();
    const outputDirectories = [parsed.options.outDir, parsed.options.declarationDir].filter(directory => directory !== undefined);
    for (const file of program.getSourceFiles()) {
      const { fileName, text } = file;
      const path = relative(root, fileName);
      if (path === ".." || path.startsWith(".." + sep) || isAbsolute(path) || program.isSourceFileFromExternalLibrary(file)
        || !is_workspace_typescript_source(fileName, outputDirectories)) continue;
      if (ts.sys.readFile(fileName) !== text) {
        evidenceError(fileName, "HSON_ANALYSIS_SOURCE", `Disk source is unavailable or differs from the program for ${paths(project)}.`);
        continue;
      }
      const syntax = program.getSyntacticDiagnostics(file);
      for (const diagnostic of syntax) reportTypeScript(diagnostic, "HSON_ANALYSIS_SOURCE");
      if (syntax.length > 0) continue;
      const languageId = fileName.toLowerCase().endsWith(".tsx") ? "typescriptreact" : "typescript";
      const input = { fileName, text, languageId, sourceProgram: program };
      if (!is_supported_document(input)) {
        evidenceError(fileName, "HSON_ANALYSIS_SOURCE", "File has no supported Hson diagnostic surface.");
        continue;
      }
      checkImports(file, checker, paths(fileName), diagnostic => report(file, diagnostic, project));
      for (const diagnostic of produce_document_diagnostics(input)) {
        report(file, { ...diagnostic.range, code: diagnostic.code, message: diagnostic.message });
      }
      for (const diagnostic of local_hson_schema_diagnostics(fileName, text, program)) report(file, diagnostic);
      sources.set(fileName, file);
      analyzed.add(paths(fileName));
    }
    for (const diagnostic of produce_project_diagnostics(ts, program)) {
      const source = sources.get(diagnostic.file);
      if (source !== undefined) report(source, diagnostic);
    }
  });
  for (const error of projectErrors) failures.add(`[HSON_ANALYSIS_PROJECT] ${error}`);
  for (const project of absoluteProjects) {
    if (!visitedProjects.has(project)) evidenceError(project, "HSON_ANALYSIS_PROJECT", "Configured TypeScript analysis did not run.");
  }
  if (analyzed.size === 0) failures.add("[HSON_ANALYSIS_SOURCE] No configured TypeScript sources were analyzed.");
  for (const fileName of expectedSources) {
    if (fileName.endsWith(".hson")) {
      const text = ts.sys.readFile(fileName);
      if (text === undefined) {
        evidenceError(fileName, "HSON_ANALYSIS_SOURCE", "Standalone source could not be read.");
        continue;
      }
      const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest);
      // The repository uses the extension's default standalone authoring mode.
      for (const diagnostic of produce_document_diagnostics({ fileName, text, languageId: "hson" })) {
        report(file, { ...diagnostic.range, code: diagnostic.code, message: diagnostic.message });
      }
      analyzed.add(paths(fileName));
    } else if (!analyzed.has(paths(fileName))) {
      evidenceError(fileName, "HSON_ANALYSIS_SOURCE", "No configured TypeScript project analyzed this source.");
    }
  }
  for (const [fixture, matches] of expectedDiagnostics) {
    if (matches.size !== 1) {
      failures.add(`${fixture.path} [${fixture.code}] Expected one diagnostic on ${fixture.line} (observed ${matches.size}).`);
      for (const message of matches) failures.add(message);
    }
  }
  return { failures: [...failures].sort(), projects: visitedProjects.size, sources: analyzed.size, fixtures: fixtures.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkHsonDiagnostics(resolve(import.meta.dirname, ".."));
  if (result.failures.length > 0) {
    for (const line of result.failures) console.error(line);
    process.exitCode = 1;
  } else {
    console.log(`Hson diagnostics passed for ${result.sources} source files in scope, ${result.projects} TypeScript projects, and ${result.fixtures} intentional diagnostic controls.`);
  }
}

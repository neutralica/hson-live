import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import {
  validate_embedded_hson_source,
  type EmbeddedHsonSource,
  type HostSourceRange,
} from "./embedded-hson-source.js";

const defaultTs = ts;
const syntaxOnlyPrograms = new WeakSet<ts.Program>();

const supportedPackageSpecifiers: ReadonlySet<string> = new Set([
  "hson-live",
  "hson-live/hson",
]);

function erased_type_declaration(typescript: typeof ts, symbol: ts.Symbol, site: ts.Declaration): boolean {
  return typescript.isTypeAliasDeclaration(site) || typescript.isInterfaceDeclaration(site)
    || typescript.isModuleDeclaration(site) && !(symbol.flags & typescript.SymbolFlags.ValueModule);
}

/** The lexical value or alias declaration of a checker symbol, including merged symbols. */
export function selected_hson_value_declaration(typescript: typeof ts, checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Declaration | undefined {
  if (!symbol || !(symbol.flags & (typescript.SymbolFlags.Alias | typescript.SymbolFlags.Value))) return undefined;
  // An imported type can share a local const's symbol. A type-only spelling
  // can still conflict with the const if the import target also declares a value.
  const alias = symbol.valueDeclaration && (symbol.flags & typescript.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : undefined;
  const erasedAlias = alias && (alias.flags & typescript.SymbolFlags.Type) && !(alias.flags & (typescript.SymbolFlags.Value | typescript.SymbolFlags.Alias));
  const sites = symbol.declarations?.filter(site => !erased_type_declaration(typescript, symbol, site)
    && !(erasedAlias && (typescript.isImportSpecifier(site) || typescript.isImportClause(site) || typescript.isExportSpecifier(site))));
  const site = sites?.length === 1 ? sites[0] : undefined;
  if (!site || !(symbol.flags & typescript.SymbolFlags.Alias) && site !== symbol.valueDeclaration) return undefined;
  // The binder can return only the first of two conflicting declarations, even
  // in a skipped .d.ts. Only diagnostics on the selected name affect identity.
  const file: ts.SourceFile & { bindDiagnostics?: readonly ts.Diagnostic[] } = site.getSourceFile();
  const name = typescript.getNameOfDeclaration(site);
  return name && file.bindDiagnostics && !hasOverlappingDiagnostic(file.bindDiagnostics, nodeRange(name, file)) ? site : undefined;
}

/** Require the lexical import binding, rather than a matching symbol name or filename. */
export function is_official_hson_package_binding(
  identifier: ts.Identifier,
  expected: "Hson" | "HsonDataValue" | "HsonData" | "HsonDocument" | "HsonAuthored" | "HsonFromSchema" | "JsonFromSchema",
  checker: ts.TypeChecker,
  requireResolvedOrigin = false,
  typescript: typeof ts = defaultTs,
  eligible?: (node: ts.Node) => boolean,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return false;
  const declaration = expected === "Hson" ? selected_hson_value_declaration(typescript, checker, symbol)
    : symbol.declarations?.length === 1 ? symbol.declarations[0] : undefined;
  if (declaration === undefined || !typescript.isImportSpecifier(declaration)) return false;
  const clause = declaration.parent.parent;
  const imported = clause.parent;
  const officialImport = typescript.isImportDeclaration(imported)
    && typescript.isStringLiteral(imported.moduleSpecifier)
    && supportedPackageSpecifiers.has(imported.moduleSpecifier.text)
    && (declaration.propertyName?.text ?? declaration.name.text) === expected
    && (expected !== "Hson" || !declaration.isTypeOnly && !clause.isTypeOnly);
  if (!officialImport) return false;
  if (!requireResolvedOrigin && !eligible) return true;
  const valueOnly = expected === "Hson";
  const route = hson_source_alias_target(symbol, checker, eligible, typescript, { valueOnly, selection: valueOnly ? "named" : undefined });
  if (!route?.eligible) return false;
  if (!requireResolvedOrigin) return true;
  const target = route.target;
  if (expected === "Hson") {
    const value = target.valueDeclaration;
    if (value === undefined || !typescript.isVariableDeclaration(value)) return false;
    const file = value.getSourceFile();
    if (!official_declaration_origin(file.fileName, expected)) return false;
    const module = checker.getSymbolAtLocation(file);
    const exported = module && checker.tryGetMemberInModuleExports(expected, module);
    if (exported === target) return true;
    const origin = exported && hson_source_alias_target(exported, checker, eligible, typescript, { valueOnly: true, selection: "named" });
    return origin?.eligible === true && origin.target.valueDeclaration === value;
  }
  return target.declarations?.some(item => official_declaration_origin(item.getSourceFile().fileName, expected)) === true;
}

/** Package ownership and package-relative location, shared by official binding recognizers. */
export function hson_package_declaration_path(fileName: string): string | undefined {
  let directory = dirname(resolve(fileName));
  while (true) {
    const manifestPath = resolve(directory, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (typeof manifest !== "object" || manifest === null || !("name" in manifest) || manifest.name !== "hson-live") return undefined;
      } catch { return undefined; }
      return relative(directory, resolve(fileName)).split(sep).join("/");
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function official_declaration_origin(fileName: string, expected: "Hson" | "HsonDataValue" | "HsonData" | "HsonDocument" | "HsonAuthored" | "HsonFromSchema" | "JsonFromSchema"): boolean {
  const path = hson_package_declaration_path(fileName);
  return path !== undefined && (expected === "Hson"
    ? ["src/index.ts", "src/hson-authoring.ts", "dist/index.d.ts", "dist/hson-authoring.d.ts"].includes(path)
    : ["src/index.ts", "src/hson-authoring.ts", "src/api/transform/transform.types.ts", "src/api/data/hson-data.ts",
      "dist/index.d.ts", "dist/hson-authoring.d.ts", "dist/api/transform/transform.types.d.ts", "dist/api/data/hson-data.d.ts"].includes(path));
}

export type InterpolatedEmbeddedHsonTemplate = Readonly<{
  authoringKind: HsonAuthoringKind;
  fileName: string;
  hostText: string;
  tagRange: HostSourceRange;
  templateRange: HostSourceRange;
  bodyRange: HostSourceRange;
  substitutionRanges: readonly HostSourceRange[];
  expressionRanges: readonly HostSourceRange[];
}>;

export type HsonAuthoringKind = "canonical" | "data" | "document" | "event" | "schema";
export type HsonTaggedTemplateSource = EmbeddedHsonSource & Readonly<{ authoringKind: HsonAuthoringKind }>;

/** Host files with an editor syntax-diagnostic surface for tagged Events. */
export function is_hson_typescript_source_file(fileName: string): boolean {
  return /\.(?:[cm]?ts|tsx)$/i.test(fileName)
    && !/\.d\.[cm]?ts$|\.hson-schema\.generated\.[cm]?tsx?$/i.test(fileName)
    && !fileName.replaceAll("\\", "/").split("/").includes("node_modules");
}

function is_hson_authoring_kind(value: string): value is HsonAuthoringKind {
  return value === "canonical" || value === "data" || value === "document" || value === "event" || value === "schema";
}

/** Read the supported member form. Callers still establish the receiver's import binding. */
export function hson_authoring_tag(typescript: typeof ts, node: ts.TaggedTemplateExpression): Readonly<{
  receiver: ts.Identifier; kind: HsonAuthoringKind;
}> | undefined {
  if ((node.flags & typescript.NodeFlags.OptionalChain) !== 0 || node.typeArguments !== undefined) return undefined;
  let tag = node.tag;
  if (typescript.isPropertyAccessExpression(tag) && tag.name.text === "parse"
    && typescript.isPropertyAccessExpression(tag.expression) && tag.expression.name.text === "data") tag = tag.expression;
  if (!typescript.isPropertyAccessExpression(tag) || !typescript.isIdentifier(tag.expression)
    || !is_hson_authoring_kind(tag.name.text)) return undefined;
  return { receiver: tag.expression, kind: tag.name.text };
}

export type HsonTaggedTemplateDiscoveryResult = Readonly<{
  sources: readonly HsonTaggedTemplateSource[];
  interpolated: readonly InterpolatedEmbeddedHsonTemplate[];
  /** Recovered Event editing regions, excluded from complete-source admission. */
  incompleteEvents: readonly (HsonTaggedTemplateSource | InterpolatedEmbeddedHsonTemplate)[];
}>;

export function create_hson_source_program(
  fileName: string,
  hostText: string,
  typeOptions: Pick<ts.CompilerOptions, "strictNullChecks" | "noImplicitAny"> = {},
  ts: typeof defaultTs = defaultTs,
): ts.Program {
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    ...typeOptions,
  };
  const compilerHost: ts.CompilerHost = {
    fileExists(candidate): boolean {
      return candidate === fileName;
    },
    getCanonicalFileName(candidate): string {
      return candidate;
    },
    getCurrentDirectory(): string {
      return "";
    },
    getDefaultLibFileName(): string {
      return "lib.d.ts";
    },
    getNewLine(): string {
      return "\n";
    },
    getSourceFile(candidate, languageVersion): ts.SourceFile | undefined {
      if (candidate !== fileName) return undefined;
      const scriptKind = /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      return ts.createSourceFile(fileName, hostText, languageVersion, true, scriptKind);
    },
    readFile(candidate): string | undefined {
      return candidate === fileName ? hostText : undefined;
    },
    useCaseSensitiveFileNames(): boolean {
      return true;
    },
    writeFile(): void {},
  };
  const program = ts.createProgram([fileName], options, compilerHost);
  syntaxOnlyPrograms.add(program);
  return program;
}

/** The workspace scanner and standalone snapshot reader use the same compiler host. */
export function create_hson_project_program(typescript: typeof ts,
  project: Pick<ts.ParsedCommandLine, "fileNames" | "options" | "projectReferences">,
  directory: string, readSnapshot: (fileName: string) => string | undefined,
): ts.Program {
  const { fileNames: rootNames, options, projectReferences } = project;
  const host = Object.assign(typescript.createCompilerHost(options), {
    getCurrentDirectory: () => directory,
    useSourceOfProjectReferenceRedirect: () => !options.disableSourceOfProjectReferenceRedirect,
  });
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = name => readSnapshot(name) ?? readFile(name);
  host.fileExists = name => readSnapshot(name) !== undefined || fileExists(name);
  return typescript.createProgram({ rootNames, options, projectReferences, host });
}

/** Import declaration offsets proven official for a particular authored snapshot. */
export type HsonEventImportEvidence = (fileName: string, text: string) => ReadonlySet<number>;

/** Prove the selected authoring value in this program. Other module members can have their own errors. */
export function is_official_hson_event_binding(typescript: typeof ts, receiver: ts.Identifier, program: ts.Program,
  eligible: (node: ts.Node) => boolean): boolean {
  // TS2688 means a requested type package is missing from this program.
  // Its ambient declarations could change the import's binding.
  if (program.getOptionsDiagnostics().some(diagnostic => diagnostic.code === 2688)) return false;
  const checker = program.getTypeChecker();
  if (!is_official_hson_package_binding(receiver, "Hson", checker, true, typescript, eligible)) return false;
  const member = checker.getPropertyOfType(checker.getTypeAtLocation(receiver), "event");
  return member !== undefined && checker.getTypeOfSymbolAtLocation(member, receiver).getCallSignatures().length > 0;
}

export function resolved_hson_event_imports(typescript: typeof ts, program: ts.Program, file: ts.SourceFile,
  eligible = hson_source_syntactic_eligibility(typescript, program),
): ReadonlySet<number> {
  const result = new Set<number>();
  const checker = program.getTypeChecker();
  for (const symbol of read_supported_hson_import_symbols(file, checker, program.getSyntacticDiagnostics(file), "Hson", typescript)) {
    const declaration = selected_hson_value_declaration(typescript, checker, symbol);
    if (declaration !== undefined && typescript.isImportSpecifier(declaration)
      && is_official_hson_event_binding(typescript, declaration.name, program, eligible)) {
      result.add(declaration.name.getStart(file));
    }
  }
  return result;
}

function inferred_hson_event_imports(typescript: typeof ts, fileName: string, hostText: string): ReadonlySet<number> {
  const directory = dirname(resolve(fileName));
  const tsConfig = typescript.findConfigFile(directory, typescript.sys.fileExists);
  const jsConfig = typescript.findConfigFile(directory, typescript.sys.fileExists, "jsconfig.json");
  const config = (jsConfig?.length ?? 0) > (tsConfig?.length ?? 0) ? jsConfig : tsConfig;
  const parsed = config === undefined ? undefined : typescript.getParsedCommandLineOfConfigFile(config, {}, {
    ...typescript.sys, onUnRecoverableConfigFileDiagnostic() {},
  });
  if (config !== undefined && (parsed === undefined || parsed.errors.some(error => error.code !== 18003))) return new Set();
  const options = parsed?.options ?? { jsx: typescript.JsxEmit.Preserve, module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.Bundler };
  const absolute = resolve(fileName);
  const virtualRoot = !typescript.sys.fileExists(absolute);
  const fileNames = parsed === undefined ? [absolute] : virtualRoot ? [...parsed.fileNames, absolute] : parsed.fileNames;
  const canonical = (name: string) => typescript.sys.useCaseSensitiveFileNames ? resolve(name) : resolve(name).toLowerCase();
  // Standalone discovery also accepts a virtual root supplied by its caller.
  const program = create_hson_project_program(typescript, {
    fileNames, options, projectReferences: parsed?.projectReferences,
  }, config === undefined ? directory : dirname(config), name => canonical(name) === canonical(absolute) ? hostText : undefined);
  const file = program.getSourceFile(absolute);
  return file?.text === hostText ? resolved_hson_event_imports(typescript, program, file) : new Set();
}

function diagnosticOverlapsRange(
  diagnostic: ts.Diagnostic,
  range: HostSourceRange,
): boolean {
  if (diagnostic.start === undefined) return true;
  const diagnosticEnd = diagnostic.start + (diagnostic.length ?? 0);
  if (diagnosticEnd === diagnostic.start) {
    return diagnostic.start >= range.start && diagnostic.start <= range.end;
  }
  return diagnostic.start < range.end && diagnosticEnd > range.start;
}

function nodeRange(node: ts.Node, sourceFile: ts.SourceFile): HostSourceRange {
  return Object.freeze({ start: node.getStart(sourceFile), end: node.getEnd() });
}

function hasOverlappingDiagnostic(
  diagnostics: readonly ts.Diagnostic[],
  range: HostSourceRange,
): boolean {
  return diagnostics.some((diagnostic) => diagnosticOverlapsRange(diagnostic, range));
}

/** Local syntax eligibility over the existing Program or syntax-only source host. */
export function hson_source_syntactic_eligibility(typescript: typeof ts = defaultTs, program?: ts.Program): (node: ts.Node) => boolean {
  const diagnostics = new Map<ts.SourceFile, readonly ts.Diagnostic[]>();
  return node => {
    const file = node.getSourceFile();
    let errors = diagnostics.get(file);
    if (errors === undefined) {
      const syntax = program ?? create_hson_source_program(file.fileName, file.text, {}, typescript);
      errors = syntax.getSyntacticDiagnostics(syntax.getSourceFile(file.fileName));
      diagnostics.set(file, errors);
    }
    return !hasOverlappingDiagnostic(errors, nodeRange(node, file));
  };
}

/** Check each supported import/export hop, including those hidden by checker recovery. */
export function hson_source_alias_eligible(symbol: ts.Symbol, checker: ts.TypeChecker, eligible: (node: ts.Node) => boolean,
  typescript: typeof ts = defaultTs, valueOnly = false, namespaceMember?: string): boolean {
  return hson_source_alias_target(symbol, checker, eligible, typescript, { valueOnly, namespaceMember })?.eligible === true;
}

/** Follow the checker's selected route. A package authoring import requires an explicit
 * named export. Ordinary imported constants may also have an established export-star route.
 * Ineligible syntax or erased imports can still supply a partial source observation. */
export function hson_source_alias_target(symbol: ts.Symbol, checker: ts.TypeChecker, eligible: ((node: ts.Node) => boolean) | undefined,
  typescript: typeof ts, { valueOnly, selection, namespaceMember }: {
    valueOnly: boolean; selection?: "named" | "resolved"; namespaceMember?: string;
  },
): Readonly<{ target: ts.Symbol; eligible: boolean }> | undefined {
  let proof = true;
  let mergedValue: ts.Declaration | undefined;
  const unalias = (value: ts.Symbol) => (value.flags & typescript.SymbolFlags.Alias) === 0 ? value : checker.getAliasedSymbol(value);
  const moduleExport = (specifier: ts.Expression, name: string, visited = new Set<ts.Symbol>()): ts.Symbol | undefined => {
    const module = checker.getSymbolAtLocation(specifier);
    if (module === undefined || visited.has(module) || visited.size >= 16) return undefined;
    const selected = checker.tryGetMemberInModuleExports(name, module);
    if (selected === undefined) return undefined;
    const key = typescript.escapeLeadingUnderscores(name);
    if (selection) {
      const bound = module.exports;
      if (!bound || bound.has(typescript.InternalSymbolName.ExportEquals)) return undefined;
      if (bound.has(key) || selection === "named") {
        if (bound.get(key) !== selected) return undefined;
        // A type-only augmentation can replace an export alias in the merged table
        // with its terminal value. Follow the original binder entry to check every hop.
        let binding: ts.Symbol | undefined;
        for (const declaration of module.declarations ?? []) {
          const site: ts.Declaration & { symbol?: ts.Symbol } = declaration;
          if (!site.symbol?.exports) return undefined;
          const member = site.symbol.exports.get(key);
          if (!member || member.declarations?.every(d => erased_type_declaration(typescript, member, d))) continue;
          if (binding && binding !== member) return undefined;
          if (!typescript.isSourceFile(site) && typescript.isExternalModule(site.getSourceFile())) return undefined;
          binding = member;
        }
        if (binding !== selected) {
          const value = selected_hson_value_declaration(typescript, checker, selected);
          if (!value || value !== selected.valueDeclaration || mergedValue && value !== mergedValue) return undefined;
          mergedValue = value;
        }
        return binding;
      }
    }
    const files = (module.declarations ?? []).filter(typescript.isSourceFile);
    if (selected.declarations?.some(declaration => files.includes(declaration.getSourceFile()))) return selected;
    // The checker elides export-star hops. Ordinary immutable sources and type
    // queries can use them when every contributing route selects the same binding.
    const next = new Set(visited); next.add(module);
    const routes = files.flatMap(file => file.statements.filter(typescript.isExportDeclaration).filter(statement => {
      if (statement.exportClause !== undefined || statement.moduleSpecifier === undefined) return false;
      const target = checker.getSymbolAtLocation(statement.moduleSpecifier);
      return target && checker.tryGetMemberInModuleExports(name, target);
    }));
    let binding: ts.Symbol | undefined;
    for (const route of routes) {
      if (eligible && !eligible(route) || valueOnly && route.isTypeOnly) proof = false;
      const member = route.moduleSpecifier && moduleExport(route.moduleSpecifier, name, next);
      if (!member || unalias(member) !== unalias(selected) || binding && binding !== member) return undefined;
      binding = member;
    }
    return binding;
  };
  const seen = new Set<ts.Symbol>();
  while (true) {
    if (seen.has(symbol) || seen.size >= 16 || !symbol.declarations?.length) return undefined;
    const selected = selection && selected_hson_value_declaration(typescript, checker, symbol);
    if (selection && !selected) return undefined;
    const followAlias = (symbol.flags & typescript.SymbolFlags.Alias) !== 0 && (!selected || selected !== symbol.valueDeclaration);
    if (selection && valueOnly && followAlias
      && (!("getTypeOnlyAliasDeclaration" in checker) || typeof checker.getTypeOnlyAliasDeclaration !== "function"
        || checker.getTypeOnlyAliasDeclaration(symbol, typescript.SymbolFlags.Value) !== undefined)) proof = false;
    let moduleBinding: ts.Symbol | undefined;
    seen.add(symbol);
    for (const declaration of selected ? [selected] : symbol.declarations) {
      if (selection && followAlias
        && !typescript.isImportSpecifier(declaration) && !typescript.isExportSpecifier(declaration)) return undefined;
      let dependency: ts.Node = declaration;
      if (typescript.isImportSpecifier(declaration) || typescript.isNamespaceImport(declaration) || typescript.isExportSpecifier(declaration)) {
        while (dependency.parent !== undefined && !typescript.isSourceFile(dependency.parent)
          && !typescript.isImportDeclaration(dependency) && !typescript.isExportDeclaration(dependency)) dependency = dependency.parent;
      }
      // A namespace's module contains unrelated declarations; only the selected
      // exported value and the import/export hops establish this dependency.
      if (!typescript.isSourceFile(dependency) && eligible && !eligible(dependency)) proof = false;
      // Check the owner of every selected alias, including local exports.
      // An augmentation can expose its first conflicting alias through recovery.
      if (selection && (typescript.isImportDeclaration(dependency) || typescript.isExportDeclaration(dependency))
        && !typescript.isSourceFile(dependency.parent)) {
        const block = dependency.parent;
        if (!typescript.isModuleBlock(block) || !typescript.isStringLiteral(block.parent.name)
          || !typescript.isSourceFile(block.parent.parent) || typescript.isExternalModule(block.parent.parent)) return undefined;
      }
      // A deferred import cannot introduce a named value binding.
      if (selection && valueOnly && typescript.isImportDeclaration(dependency) && dependency.importClause?.phaseModifier !== undefined) return undefined;
      if (valueOnly && (typescript.isImportDeclaration(dependency) && (dependency.importClause?.isTypeOnly
        || typescript.isImportSpecifier(declaration) && declaration.isTypeOnly)
        || typescript.isExportDeclaration(dependency) && (dependency.isTypeOnly || typescript.isExportSpecifier(declaration) && declaration.isTypeOnly))) proof = false;
      if ((typescript.isImportDeclaration(dependency) || typescript.isExportDeclaration(dependency)) && dependency.moduleSpecifier !== undefined) {
        const name = typescript.isImportSpecifier(declaration) || typescript.isExportSpecifier(declaration)
          ? (declaration.propertyName ?? declaration.name).text : typescript.isNamespaceImport(declaration) ? namespaceMember : undefined;
        if (name !== undefined) {
          const member = moduleExport(dependency.moduleSpecifier, name);
          if (!member) return undefined;
          if (selection) moduleBinding = member;
        }
      }
    }
    if (!followAlias) {
      if (mergedValue && mergedValue !== symbol.valueDeclaration) return undefined;
      return { target: symbol, eligible: proof };
    }
    const next: ts.Symbol | undefined = moduleBinding ?? checker.getImmediateAliasedSymbol(symbol);
    if (next === undefined) return undefined;
    symbol = next;
  }
}

export function read_supported_hson_import_symbols(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: readonly ts.Diagnostic[],
  facade: "Hson" | "hson" | "hsonTransform" | "hsonLiveMap" | "hsonLiveTree" = "Hson",
  typescript: typeof ts = defaultTs,
): ReadonlySet<ts.Symbol> {
  const symbols = new Set<ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!typescript.isImportDeclaration(statement)
      || statement.importClause === undefined
      || statement.importClause.isTypeOnly
      || !typescript.isStringLiteral(statement.moduleSpecifier)
      || !(facade === "Hson" ? supportedPackageSpecifiers.has(statement.moduleSpecifier.text)
        : facade === "hson" ? statement.moduleSpecifier.text === "hson-live"
        : facade === "hsonTransform" ? ["hson-live", "hson-live/transform"].includes(statement.moduleSpecifier.text)
        : facade === "hsonLiveMap" ? ["hson-live", "hson-live/livemap"].includes(statement.moduleSpecifier.text)
        : ["hson-live", "hson-live/livetree"].includes(statement.moduleSpecifier.text))
      || hasOverlappingDiagnostic(diagnostics, nodeRange(statement, sourceFile))) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (facade === "hsonLiveMap" && statement.moduleSpecifier.text === "hson-live/livemap"
      && bindings !== undefined && typescript.isNamespaceImport(bindings)) {
      const symbol = checker.getSymbolAtLocation(bindings.name);
      if (symbol !== undefined) symbols.add(symbol);
      continue;
    }
    if (bindings === undefined || !typescript.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName !== facade) continue;
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol !== undefined) symbols.add(symbol);
    }
  }
  return symbols;
}

export type HsonBindingReference = Readonly<{
  publicName: "Hson" | "hson";
  range: HostSourceRange;
  memberSeparatorRange?: HostSourceRange;
}>;

function directMemberSeparatorRange(
  node: ts.Identifier,
  sourceFile: ts.SourceFile,
): HostSourceRange | undefined {
  const parent = node.parent;
  if (!ts.isPropertyAccessExpression(parent)
    || parent.expression !== node
    || parent.questionDotToken !== undefined) {
    return undefined;
  }
  const separator = parent.getChildren(sourceFile).find(child => child.kind === ts.SyntaxKind.DotToken);
  return separator === undefined ? undefined : nodeRange(separator, sourceFile);
}

function isImportOrExportPosition(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current) || ts.isExportAssignment(current)) return true;
    if (ts.isSourceFile(current)) return false;
  }
  return false;
}

/** Discover literal usage references to official public Hson-live bindings. */
export function discover_hson_binding_references(
  fileName: string,
  hostText: string,
): readonly HsonBindingReference[] {
  if (typeof fileName !== "string" || typeof hostText !== "string" || !/\.tsx?$/.test(fileName)) {
    return Object.freeze([]);
  }
  const program = create_hson_source_program(fileName, hostText);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) return Object.freeze([]);
  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.some(diagnostic => diagnostic.start === undefined)) return Object.freeze([]);
  const checker = program.getTypeChecker();
  const symbols = {
    Hson: read_supported_hson_import_symbols(sourceFile, checker, diagnostics, "Hson"),
    hson: read_supported_hson_import_symbols(sourceFile, checker, diagnostics, "hson"),
  } as const;
  const result: HsonBindingReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)
      && (node.text === "Hson" || node.text === "hson")
      && !isImportOrExportPosition(node)
      && !hasOverlappingDiagnostic(diagnostics, nodeRange(node, sourceFile))) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && symbols[node.text].has(symbol)) {
        const memberSeparatorRange = node.text === "hson" ? directMemberSeparatorRange(node, sourceFile) : undefined;
        result.push(Object.freeze({
          publicName: node.text,
          range: nodeRange(node, sourceFile),
          ...(memberSeparatorRange === undefined ? {} : { memberSeparatorRange }),
        }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(result.sort((left, right) => left.range.start - right.range.start));
}

function validateTemplateDescriptor(
  fileName: string,
  hostText: string,
  tagRange: HostSourceRange,
  templateRange: HostSourceRange,
  bodyRange: HostSourceRange,
): EmbeddedHsonSource | undefined {
  if (hostText[templateRange.start] !== "`" || hostText[templateRange.end - 1] !== "`") {
    return undefined;
  }
  const validation = validate_embedded_hson_source({
    fileName,
    hostText,
    tagRange,
    templateRange,
    bodyRange,
  });
  return validation.status === "valid" ? validation.source : undefined;
}

export function read_template_substitution_ranges(
  template: ts.TemplateExpression,
  hostText: string,
  sourceFile: ts.SourceFile,
): readonly HostSourceRange[] | undefined {
  const ranges: HostSourceRange[] = [];
  let precedingLiteral: ts.TemplateLiteralLikeNode = template.head;
  for (const span of template.templateSpans) {
    const openingStart = precedingLiteral.getEnd() - 2;
    const closingStart = span.literal.getStart(sourceFile);
    if (hostText.slice(openingStart, openingStart + 2) !== "${"
      || hostText[closingStart] !== "}") {
      return undefined;
    }
    ranges.push(Object.freeze({ start: openingStart, end: closingStart + 1 }));
    precedingLiteral = span.literal;
  }
  return Object.freeze(ranges);
}

/** Recovered literal boundaries from the host AST; never authoring admission.
 * An unfinished hole masks its entire remaining expression. No suffix is guessed.
 */
function recover_interpolated_template(fileName: string, hostText: string, sourceFile: ts.SourceFile,
  tagged: ts.TaggedTemplateExpression, template: ts.TemplateExpression, authoringKind: "document" | "event",
): InterpolatedEmbeddedHsonTemplate | undefined {
  const templateRange = nodeRange(template, sourceFile);
  if (hostText[templateRange.start] !== "`") return undefined;
  const substitutionRanges: HostSourceRange[] = [];
  const expressionRanges: HostSourceRange[] = [];
  let preceding: ts.TemplateLiteralLikeNode = template.head;
  let bodyEnd = templateRange.end;
  for (const span of template.templateSpans) {
    const start = preceding.getEnd() - 2;
    if (hostText.slice(start, start + 2) !== "${") return undefined;
    const closingStart = span.literal.getStart(sourceFile);
    if (hostText[closingStart] !== "}") {
      bodyEnd = templateRange.end;
      substitutionRanges.push({ start, end: templateRange.end });
      expressionRanges.push({ start: start + 2, end: templateRange.end });
      break;
    }
    substitutionRanges.push({ start, end: closingStart + 1 });
    expressionRanges.push({ start: start + 2, end: closingStart });
    preceding = span.literal;
    bodyEnd = span.literal.getEnd() - (span.literal.isUnterminated ? 0 : 1);
  }
  return { fileName, hostText, authoringKind, tagRange: nodeRange(tagged.tag, sourceFile),
    templateRange, bodyRange: { start: templateRange.start + 1, end: bodyEnd }, substitutionRanges, expressionRanges };
}

/** Discover semantic member tags rooted in an official Hson import; a supplied program represents the same host text. */
export function discover_hson_tagged_templates(
  fileName: string,
  hostText: string,
  sourceProgram?: ts.Program,
  // Opt-in diagnostics only. Recovered templates never enter either admitted result list.
  onDocumentQuadRecovery?: (source: InterpolatedEmbeddedHsonTemplate) => void,
  ts: typeof defaultTs = defaultTs,
  eventImports?: ReadonlySet<number>,
): HsonTaggedTemplateDiscoveryResult {
  const empty = (): HsonTaggedTemplateDiscoveryResult => Object.freeze({
    sources: Object.freeze([]),
    interpolated: Object.freeze([]),
    incompleteEvents: Object.freeze([]),
  });
  if (typeof fileName !== "string"
    || typeof hostText !== "string"
    || !/\.(?:[cm]?ts|tsx)$/i.test(fileName)) {
    return empty();
  }

  const program = sourceProgram ?? create_hson_source_program(fileName, hostText, {}, ts);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile?.text !== hostText) return empty();
  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.some((diagnostic) => diagnostic.start === undefined)) return empty();
  const checker = program.getTypeChecker();
  const importSymbols = read_supported_hson_import_symbols(sourceFile, checker, diagnostics, "Hson", ts);
  if (importSymbols.size === 0) return empty();

  const sources: HsonTaggedTemplateSource[] = [];
  const interpolated: InterpolatedEmbeddedHsonTemplate[] = [];
  const incompleteEvents: (HsonTaggedTemplateSource | InterpolatedEmbeddedHsonTemplate)[] = [];
  let programImports: ReadonlySet<number> | undefined;
  const officialEvent = (symbol: ts.Symbol): boolean => {
    const declaration = selected_hson_value_declaration(ts, checker, symbol);
    if (!is_hson_typescript_source_file(fileName) || declaration === undefined || !ts.isImportSpecifier(declaration)) return false;
    const offset = declaration.name.getStart(sourceFile);
    if (eventImports !== undefined && !eventImports.has(offset)) return false;
    if (syntaxOnlyPrograms.has(program)) {
      eventImports ??= inferred_hson_event_imports(ts, fileName, hostText);
      return eventImports.has(offset);
    }
    programImports ??= resolved_hson_event_imports(ts, program, sourceFile);
    return programImports.has(offset);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = hson_authoring_tag(ts, node);
      const symbol = tag === undefined ? undefined : checker.getSymbolAtLocation(tag.receiver);
      const relevantRange = nodeRange(node, sourceFile);
      if (tag !== undefined && symbol !== undefined
        && importSymbols.has(symbol)
        && !hasOverlappingDiagnostic(diagnostics, nodeRange(node.tag, sourceFile))
        && (tag.kind !== "event" || officialEvent(symbol))) {
        const tagRange = nodeRange(node.tag, sourceFile);
        const templateRange = nodeRange(node.template, sourceFile);
        const bodyRange = Object.freeze({
          start: templateRange.start + 1,
          end: templateRange.end - 1,
        });
        const validated = hasOverlappingDiagnostic(diagnostics, relevantRange) ? undefined : validateTemplateDescriptor(
          fileName,
          hostText,
          tagRange,
          templateRange,
          bodyRange,
        );
        let discovered = false;
        if (validated !== undefined) {
          const authoringKind = tag.kind;
          if (ts.isNoSubstitutionTemplateLiteral(node.template)) {
            sources.push(Object.freeze({ ...validated, authoringKind }));
            discovered = true;
          } else {
            const substitutionRanges = read_template_substitution_ranges(node.template, hostText, sourceFile);
            if (substitutionRanges !== undefined) {
              discovered = true;
              interpolated.push(Object.freeze({
                authoringKind,
                fileName,
                hostText,
                tagRange: validated.tagRange,
                templateRange: validated.templateRange,
                bodyRange: validated.bodyRange,
                substitutionRanges,
                expressionRanges: Object.freeze(node.template.templateSpans.map(span => nodeRange(span.expression, sourceFile))),
              }));
            }
          }
        }
        if (!discovered && onDocumentQuadRecovery !== undefined && tag.kind === "document"
          && ts.isTemplateExpression(node.template)) {
          const recovered = recover_interpolated_template(fileName, hostText, sourceFile, node, node.template, "document");
          if (recovered !== undefined) onDocumentQuadRecovery(recovered);
        }
        if (!discovered && tag.kind === "event") {
          if (ts.isTemplateExpression(node.template)) {
            const recovered = recover_interpolated_template(fileName, hostText, sourceFile, node, node.template, "event");
            if (recovered !== undefined) incompleteEvents.push(recovered);
          } else if (node.template.isUnterminated && hostText[templateRange.start] === "`") {
            incompleteEvents.push({ authoringKind: "event", fileName, hostText, tagRange, templateRange,
              bodyRange: { start: bodyRange.start, end: templateRange.end } });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze({
    sources: Object.freeze(sources),
    interpolated: Object.freeze(interpolated),
    incompleteEvents: Object.freeze(incompleteEvents),
  });
}

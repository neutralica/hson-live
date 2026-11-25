import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import {
  validate_embedded_hson_source,
  type EmbeddedHsonSource,
  type HostSourceRange,
} from "./embedded-hson-source.js";

const defaultTs = ts;

/** A cold checker can exhaust its stack resolving a binding before our walk begins. */
export function hson_source_checker_lookup<T>(lookup: () => T): T | undefined {
  try {
    return lookup();
  } catch (cause) {
    if (cause instanceof RangeError && cause.message === "Maximum call stack size exceeded") return undefined;
    throw cause;
  }
}

const supportedPackageSpecifiers: ReadonlySet<string> = new Set([
  "hson-live",
  "hson-live/hson",
]);

function erased_type_declaration(typescript: typeof ts, symbol: ts.Symbol, site: ts.Declaration, eligible?: SourceEligibility): boolean {
  return typescript.isTypeAliasDeclaration(site) || typescript.isInterfaceDeclaration(site)
    || typescript.isModuleDeclaration(site) && (!(symbol.flags & typescript.SymbolFlags.ValueModule)
      || eligible?.erasedNamespace?.(site, eligible.charge) === true);
}

function erased_type_symbol(typescript: typeof ts, symbol: ts.Symbol, eligible?: SourceEligibility): boolean {
  const { Alias, Value, Type, NamespaceModule, ValueModule } = typescript.SymbolFlags;
  if (symbol.flags & Alias) return false;
  // A namespace without a value meaning can be erased without setting Type.
  if (!(symbol.flags & Value)) return (symbol.flags & (Type | NamespaceModule)) !== 0;
  return (symbol.flags & ValueModule) !== 0 && symbol.declarations?.length !== 0
    && symbol.declarations?.every(site => eligible?.charge?.() !== false && erased_type_declaration(typescript, symbol, site, eligible)) === true;
}

type ChargeSourceWork = (units?: number) => boolean;
export type SourceEligibility = ((node: ts.Node, charge?: ChargeSourceWork) => boolean) & {
  readonly charge?: ChargeSourceWork;
  readonly compilerOptions?: Pick<ts.CompilerOptions, "isolatedModules" | "verbatimModuleSyntax">;
  readonly erasedNamespace?: (site: ts.ModuleDeclaration, charge?: ChargeSourceWork) => boolean;
  readonly erasedRuntimeDeclaration?: (site: ts.Declaration) => boolean;
  readonly initializedRead?: (input: ts.Identifier, declaration: ts.VariableDeclaration, charge?: ChargeSourceWork) => boolean;
};

function value_declarations(typescript: typeof ts, checker: ts.TypeChecker, symbol: ts.Symbol, eligible?: SourceEligibility) {
  // An import targeting a runtime value can conflict even when written as import type.
  // The binder may omit valueDeclaration from the local half of an exported symbol.
  const alias = symbol.valueDeclaration && (symbol.flags & typescript.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : undefined;
  const namespaceConflict = alias && (alias.flags & typescript.SymbolFlags.Namespace) !== 0
    && (symbol.flags & typescript.SymbolFlags.Namespace) !== 0;
  const erasedAliasTarget = alias !== undefined && !namespaceConflict && erased_type_symbol(typescript, alias, eligible);
  // An erased target can coexist with the selected value only if the import is legal in this compiler mode.
  const options = eligible?.compilerOptions;
  const requiresExplicitTypeImports = options?.isolatedModules === true || options?.verbatimModuleSyntax === true;
  if (eligible?.charge?.(symbol.declarations?.length ?? 0) === false) return undefined;
  return symbol.declarations?.filter(site => !erased_type_declaration(typescript, symbol, site, eligible)
    && !((typescript.isImportSpecifier(site) || typescript.isImportClause(site) || typescript.isExportSpecifier(site))
      && erasedAliasTarget && (!requiresExplicitTypeImports || typescript.isTypeOnlyImportOrExportDeclaration(site))));
}

/** The lexical value or alias declaration of a checker symbol, including merged symbols. */
export function selected_hson_value_declaration(typescript: typeof ts, checker: ts.TypeChecker, symbol: ts.Symbol | undefined,
  eligible?: SourceEligibility): ts.Declaration | undefined {
  if (!symbol || !(symbol.flags & (typescript.SymbolFlags.Alias | typescript.SymbolFlags.Value))) return undefined;
  const sites = value_declarations(typescript, checker, symbol, eligible);
  const site = sites?.length === 1 ? sites[0] : undefined;
  if (!site || !(symbol.flags & typescript.SymbolFlags.Alias) && site !== symbol.valueDeclaration) return undefined;
  // The binder can return only the first of two conflicting declarations, even
  // in a skipped .d.ts. Only diagnostics on the selected name affect identity.
  const file: ts.SourceFile & { bindDiagnostics?: readonly ts.Diagnostic[] } = site.getSourceFile();
  const name = typescript.getNameOfDeclaration(site);
  if (!name || !file.bindDiagnostics || hasOverlappingDiagnostic(file.bindDiagnostics, nodeRange(name, file), eligible?.charge)) return undefined;
  if (typescript.isIdentifier(name) && symbol.valueDeclaration === site) {
    // Check both halves of an exported binding, including an alias-only local
    // symbol recovered from TS2395/TS2440.
    const lexical = checker.resolveName(name.text, site, typescript.SymbolFlags.Value | typescript.SymbolFlags.Alias, true);
    if (lexical !== symbol && lexical?.declarations &&
      (eligible?.charge?.(2 * lexical.declarations.length) === false || lexical.declarations.includes(site)
        && lexical.declarations.some(declaration => declaration !== site
          && !erased_type_declaration(typescript, lexical, declaration, eligible)))) return undefined;
  }
  return site;
}

/** Require the lexical import binding, rather than a matching symbol name or filename. */
export function is_official_hson_package_binding(
  identifier: ts.Identifier,
  expected: "Hson" | "HsonDataValue" | "HsonData" | "HsonDocument" | "HsonAuthored" | "HsonFromSchema" | "JsonFromSchema",
  checker: ts.TypeChecker,
  requireResolvedOrigin = false,
  typescript: typeof ts = defaultTs,
  eligible?: SourceEligibility,
  routeKind: "named" | "package" = "named",
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return false;
  const declaration = expected === "Hson" ? selected_hson_value_declaration(typescript, checker, symbol, eligible)
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
  const route = hson_source_alias_target(symbol, checker, eligible, typescript, { valueOnly, selection: valueOnly ? routeKind : undefined });
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
  eventValueImport?: true;
  fileName: string;
  hostText: string;
  tagRange: HostSourceRange;
  templateRange: HostSourceRange;
  bodyRange: HostSourceRange;
  substitutionRanges: readonly HostSourceRange[];
  expressionRanges: readonly HostSourceRange[];
}>;

export type HsonAuthoringKind = "canonical" | "data" | "document" | "event" | "schema";
export type HsonTaggedTemplateSource = EmbeddedHsonSource & Readonly<{ authoringKind: HsonAuthoringKind; eventValueImport?: true }>;

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
    allowJs: /\.(?:[cm]?js|jsx)$/i.test(fileName),
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
      const scriptKind = /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX
        : /\.jsx$/i.test(fileName) ? ts.ScriptKind.JSX
        : options.allowJs ? ts.ScriptKind.JS : ts.ScriptKind.TS;
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
  return ts.createProgram([fileName], options, compilerHost);
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

/** Prove the selected authoring value in this program. Other module members can have their own errors. */
export function is_official_hson_event_binding(typescript: typeof ts, receiver: ts.Identifier, program: ts.Program,
  eligible: SourceEligibility, routeKind: "named" | "package" = "named"): boolean {
  // TS2688 means a requested type package is missing from this program.
  // Its ambient declarations could change the import's binding.
  if (program.getOptionsDiagnostics().some(diagnostic => eligible.charge?.() === false || diagnostic.code === 2688)) return false;
  const checker = program.getTypeChecker();
  if (!is_official_hson_package_binding(receiver, "Hson", checker, true, typescript, eligible, routeKind)) return false;
  const member = checker.getPropertyOfType(checker.getTypeAtLocation(receiver), "event");
  return member !== undefined && checker.getTypeOfSymbolAtLocation(member, receiver).getCallSignatures().some(signature => {
    const file = signature.declaration?.getSourceFile();
    const path = file === undefined ? undefined : hson_package_declaration_path(file.fileName);
    return path === "src/hson-authoring.ts" || path === "dist/hson-authoring.d.ts";
  });
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
  charge?: SourceEligibility["charge"],
): boolean {
  return diagnostics.some((diagnostic) => charge?.() === false || diagnosticOverlapsRange(diagnostic, range));
}

type AliasRoute = Readonly<{ target: ts.Symbol; eligible: boolean; erased: boolean }>;
type AliasOptions = Readonly<{ valueOnly: boolean; selection?: "named" | "resolved" | "package" | "package-value"; namespaceMember?: string }>;
type AliasCache = WeakMap<ts.TypeChecker, Map<string, WeakMap<ts.Symbol, AliasRoute | undefined>>>;
// Eligibility captures the source snapshot. Only callbacks created here may
// reuse results, and only for the checker that proved them.
const sourceAliasCaches = new WeakMap<(node: ts.Node) => boolean, AliasCache>();

/** Local syntax eligibility over the existing Program or syntax-only source host. */
export function hson_source_syntactic_eligibility(typescript: typeof ts = defaultTs, program?: ts.Program): SourceEligibility {
  const diagnostics = new Map<ts.SourceFile, readonly ts.Diagnostic[]>();
  const eligible = (node: ts.Node, charge?: SourceEligibility["charge"]): boolean => {
    if (charge?.() === false) return false;
    const file = node.getSourceFile();
    let errors = diagnostics.get(file);
    if (errors === undefined) {
      const syntax = program ?? create_hson_source_program(file.fileName, file.text, {}, typescript);
      errors = syntax.getSyntacticDiagnostics(syntax.getSourceFile(file.fileName));
      diagnostics.set(file, errors);
    }
    return !hasOverlappingDiagnostic(errors, nodeRange(node, file), charge);
  };
  sourceAliasCaches.set(eligible, new WeakMap());
  if (program === undefined) return eligible;
  const compilerOptions = program.getCompilerOptions();
  const preserveConstEnums = compilerOptions.preserveConstEnums || compilerOptions.isolatedModules || compilerOptions.verbatimModuleSyntax;
  const isInstantiatedModule = "isInstantiatedModule" in typescript ? typescript.isInstantiatedModule : undefined;
  const namespaceErasure = new WeakMap<ts.ModuleDeclaration, boolean>();
  const erasedNamespace = (site: ts.ModuleDeclaration, charge?: ChargeSourceWork): boolean => {
    if (typeof isInstantiatedModule !== "function" || site.getSourceFile().isDeclarationFile
      || (typescript.getCombinedModifierFlags(site) & typescript.ModifierFlags.Ambient) !== 0) return false;
    const cached = charge ? undefined : namespaceErasure.get(site);
    if (cached !== undefined) return cached;
    // Use the compiler's emitter classification of this namespace body. A
    // const-enum-only body can have value meaning without producing a value.
    const erased = eligible(site, charge) && hson_source_checker_lookup(() => isInstantiatedModule(site, !!preserveConstEnums)) === false;
    if (!charge) namespaceErasure.set(site, erased);
    return erased;
  };
  // This concerns emit from implementation modules. A declaration file can
  // describe a runtime export. Emit erasure does not make a lexical merge legal.
  const erasedRuntimeDeclaration = (site: ts.Declaration): boolean => !site.getSourceFile().isDeclarationFile
    && ((typescript.getCombinedModifierFlags(site) & typescript.ModifierFlags.Ambient) !== 0 || !preserveConstEnums
      && typescript.isEnumDeclaration(site)
      && (typescript.getCombinedModifierFlags(site) & typescript.ModifierFlags.Const) !== 0);
  type DiagnosticChecker = ts.TypeChecker & {
    getDiagnostics?: (file: ts.SourceFile, token: ts.CancellationToken | undefined, nodes: readonly ts.Node[]) => readonly ts.Diagnostic[];
  };
  const checkedDiagnostics = (site: ts.Node, charge?: ChargeSourceWork) => {
    const file = site.getSourceFile();
    const range = nodeRange(site, file);
    // Read the selected lexical read before Program filters diagnostics.
    const checker: DiagnosticChecker = program.getTypeChecker();
    const errors = hson_source_checker_lookup(() => checker.getDiagnostics?.(file, undefined, []));
    if (errors === undefined) return undefined;
    // The checker stores the per-file diagnostics in source order. Restrict
    // this lookup to diagnostics starting on the selected read or call.
    let first = 0, last = errors.length;
    while (first < last) {
      if (charge?.() === false) return undefined;
      const mid = Math.floor((first + last) / 2);
      if ((errors[mid]!.start ?? -1) < range.start) first = mid + 1;
      else last = mid;
    }
    const local: ts.Diagnostic[] = [];
    for (let index = first; index < errors.length; index++) {
      if (charge?.() === false) return undefined;
      const error = errors[index]!;
      if ((error.start ?? -1) >= range.end) break;
      if (error.file === file) local.push(error);
    }
    return local;
  };
  const initializedReads = new WeakMap<ts.Identifier, boolean>();
  const initializedRead = (input: ts.Identifier, declaration: ts.VariableDeclaration, charge?: ChargeSourceWork): boolean => {
    const file = input.getSourceFile();
    if (file !== declaration.getSourceFile() || input.getStart(file) >= declaration.end) return true;
    const cached = charge ? undefined : initializedReads.get(input);
    if (cached !== undefined) return cached;
    // Position only limits when to ask. A forward read in a deferred body
    // can be valid. Query the exact read even when the file is unchecked.
    const errors = hson_source_checker_lookup(() => {
      program.getTypeChecker().getTypeAtLocation(input);
      return checkedDiagnostics(input, charge);
    });
    const initialized = errors?.every(error => charge?.() !== false && error.code !== 2448 && error.code !== 2454) === true;
    if (!charge) initializedReads.set(input, initialized);
    return initialized;
  };
  return Object.assign(eligible, { compilerOptions, erasedNamespace, erasedRuntimeDeclaration, initializedRead });
}

/** Check each supported import/export hop, including those hidden by checker recovery. */
export function hson_source_alias_eligible(symbol: ts.Symbol, checker: ts.TypeChecker, eligible: (node: ts.Node) => boolean,
  typescript: typeof ts = defaultTs, valueOnly = false, namespaceMember?: string): boolean {
  return hson_source_alias_target(symbol, checker, eligible, typescript, { valueOnly, namespaceMember })?.eligible === true;
}

/** Authenticate the public entrypoint and the package-owned route for an Event operand. */
export function package_value_import(typescript: typeof ts, checker: ts.TypeChecker, symbol: ts.Symbol,
  eligible: SourceEligibility, namespaceMember?: string): ts.Symbol | undefined {
  const site = selected_hson_value_declaration(typescript, checker, symbol, eligible);
  if (!site || !(typescript.isImportSpecifier(site) || typescript.isNamespaceImport(site))) return undefined;
  const clause = typescript.isImportSpecifier(site) ? site.parent.parent : site.parent;
  const statement = clause.parent;
  if (clause.isTypeOnly || !typescript.isImportDeclaration(statement) || !typescript.isStringLiteral(statement.moduleSpecifier)) return undefined;
  const specifier = statement.moduleSpecifier.text;
  const entry = specifier === "hson-live" ? "index" : specifier === "hson-live/livemap" ? "api/livemap/index"
    : specifier === "hson-live/hson" ? "hson-authoring" : undefined;
  const file = checker.getSymbolAtLocation(statement.moduleSpecifier)?.valueDeclaration;
  if (!entry || !file || !typescript.isSourceFile(file)) return undefined;
  const path = hson_package_declaration_path(file.fileName);
  if (path !== `src/${entry}.ts` && path !== `dist/${entry}.d.ts`) return undefined;
  const route = hson_source_alias_target(symbol, checker, eligible, typescript,
    { valueOnly: true, selection: "package-value", namespaceMember });
  return route?.eligible ? route.target : undefined;
}

/** Follow the selected alias and verify export-star contributions in its Program. */
export function hson_source_alias_target(symbol: ts.Symbol, checker: ts.TypeChecker, eligible: ((node: ts.Node) => boolean) | undefined,
  typescript: typeof ts, options: AliasOptions,
): Readonly<{ target: ts.Symbol; eligible: boolean }> | undefined {
  const cache = eligible && sourceAliasCaches.get(eligible);
  const trace = () => hson_source_checker_lookup(() => trace_source_alias(symbol, checker, eligible, typescript, options));
  if (!cache) return trace();
  let byMode = cache.get(checker);
  if (!byMode) { byMode = new Map(); cache.set(checker, byMode); }
  const mode = JSON.stringify([options.selection, options.valueOnly, options.namespaceMember]);
  let results = byMode.get(mode);
  if (!results) { results = new WeakMap(); byMode.set(mode, results); }
  if (!results.has(symbol)) results.set(symbol, trace());
  return results.get(symbol);
}

function trace_source_alias(symbol: ts.Symbol, checker: ts.TypeChecker, eligible: SourceEligibility | undefined,
  typescript: typeof ts, { valueOnly, selection, namespaceMember }: AliasOptions,
): AliasRoute | undefined {
  // Charge for aliases, modules, declarations and star edges. Recursion only
  // follows named alias dependencies. Star cycles are walked iteratively.
  let remaining = 4096;
  const charge = () => --remaining >= 0 && eligible?.charge?.() !== false;
  const activeAliases = new Set<ts.Symbol>();
  // Every contributing value route must fit the named-alias depth allowance.
  // A proof at one depth cannot establish a route at another depth.
  const finishedAliases = new Map<ts.Symbol, Map<number, AliasRoute>>();
  const finishedExports = new Map<ts.Symbol, Map<string, Map<number, AliasRoute>>>();
  const members = new Map<ts.Symbol, Map<string, ts.Symbol | undefined>>();
  const inValueSpace = valueOnly && selection === "resolved";
  const syntactic = (node: ts.Node) => eligible?.(node) ?? true;
  const selectedValue = (item: ts.Symbol) => selected_hson_value_declaration(typescript, checker, item, eligible);
  const unalias = (item: ts.Symbol) => (item.flags & typescript.SymbolFlags.Alias) === 0 ? item : checker.getAliasedSymbol(item);
  const erasedExport = (item: ts.Symbol): boolean => erased_type_symbol(typescript, item, eligible)
    || item.valueDeclaration !== undefined && eligible?.erasedRuntimeDeclaration?.(item.valueDeclaration) === true
      && !!item.declarations?.length && item.declarations.every(site => charge()
        && (erased_type_declaration(typescript, item, site, eligible) || eligible.erasedRuntimeDeclaration?.(site) === true));
  const getTypeOnlyAliasDeclaration = "getTypeOnlyAliasDeclaration" in checker ? checker.getTypeOnlyAliasDeclaration : undefined;
  // Verbatim module syntax rejects a type-only route even if the checker recovers a value behind it.
  const aliasMeaning = eligible?.compilerOptions?.verbatimModuleSyntax ? undefined : typescript.SymbolFlags.Value;
  const typeOnlyAlias = typeof getTypeOnlyAliasDeclaration === "function"
    ? (item: ts.Symbol, meaning?: ts.SymbolFlags) => getTypeOnlyAliasDeclaration.call(checker, item, meaning)
    : undefined;
  const erasedValueAlias = (item: ts.Symbol): boolean => {
    const site = typeOnlyAlias?.(item, typescript.SymbolFlags.Value);
    if (site === undefined) return false;
    const name = typescript.isImportSpecifier(site) || typescript.isImportClause(site) ? site.name : undefined;
    const local = name && checker.getSymbolAtLocation(name);
    // The recorded type-only import can share its lexical symbol with a
    // runtime declaration. Leave that contribution for the selected walk.
    return local?.valueDeclaration === undefined || erased_type_declaration(typescript, local, local.valueDeclaration, eligible);
  };
  const sameValue = (a: ts.Symbol, b: ts.Symbol): boolean => {
    if (a === b) return true;
    if (selection !== "resolved") return false;
    const declaration = selectedValue(a);
    return declaration !== undefined && declaration === selectedValue(b);
  };
  const memberAt = (module: ts.Symbol, name: string): ts.Symbol | undefined => {
    let names = members.get(module);
    if (!names) { names = new Map(); members.set(module, names); }
    if (!names.has(name)) names.set(name, checker.tryGetMemberInModuleExports(name, module));
    return names.get(name);
  };

  const boundExport = (module: ts.Symbol, key: ts.__String, selected: ts.Symbol, depth: number): AliasRoute | undefined => {
    if (module.exports?.get(key) !== selected) return undefined;
    // Recover the binder entry hidden by a legal type-only augmentation.
    let binding: ts.Symbol | undefined;
    for (const declaration of module.declarations ?? []) {
      if (!charge()) return undefined;
      const site: ts.Declaration & { symbol?: ts.Symbol } = declaration;
      if (!site.symbol?.exports) return undefined;
      const member = site.symbol.exports.get(key);
      if (!member || member.declarations?.every(d => eligible?.charge?.() !== false && erased_type_declaration(typescript, member, d, eligible))) continue;
      if (binding && binding !== member || !typescript.isSourceFile(site) && typescript.isExternalModule(site.getSourceFile())) return undefined;
      binding = member;
    }
    if (!binding) return undefined;
    const route = follow(binding, depth);
    if (!route) return undefined;
    if (binding !== selected) {
      const value = selectedValue(selected);
      if (!value || value !== selected.valueDeclaration || value !== route.target.valueDeclaration) return undefined;
    }
    return route;
  };

  const moduleExport = (module: ts.Symbol, name: string, depth: number): AliasRoute | undefined => {
    let names = finishedExports.get(module);
    if (!names) { names = new Map(); finishedExports.set(module, names); }
    let depths = names.get(name);
    if (!depths) { depths = new Map(); names.set(name, depths); }
    const cached = depths.get(depth);
    if (cached) return cached;
    const route = walkExports(module, name, depth);
    if (route) depths.set(depth, route);
    return route;
  };

  const walkExports = (module: ts.Symbol, name: string, depth: number): AliasRoute | undefined => {
    if (selection === "package") {
      const file = module.valueDeclaration;
      if (!file || !typescript.isSourceFile(file) || !official_declaration_origin(file.fileName, "Hson")) return undefined;
    }
    if (selection === "package-value") {
      const file = module.valueDeclaration;
      if (!file || !typescript.isSourceFile(file) || !hson_package_declaration_path(file.fileName)) return undefined;
    }
    const selected = memberAt(module, name);
    if (!selected) return undefined;
    const key = typescript.escapeLeadingUnderscores(name);
    const pending = [{ module, eligible: true }];
    // Charge each reachable syntax state once, independent of visit order.
    const visitedIntact = new Set<ts.Symbol>(), visitedDamaged = new Set<ts.Symbol>();
    let result: AliasRoute | undefined;
    while (pending.length > 0) {
      const entry = pending.pop()!;
      if (eligible?.charge?.() === false) return undefined;
      const visited = entry.eligible ? visitedIntact : visitedDamaged;
      if (visited.has(entry.module)) continue;
      if (!charge()) return undefined;
      visited.add(entry.module);
      const member = memberAt(entry.module, name);
      if (!member) continue;
      const bound = entry.module.exports;
      if (selection && (!bound || bound.has(typescript.InternalSymbolName.ExportEquals))) return undefined;
      const direct = selection ? bound?.has(key) || selection !== "resolved"
        : member.declarations?.some(declaration => entry.module.declarations?.includes(declaration.getSourceFile()));
      if (direct) {
        if (inValueSpace && entry.module !== module) {
          const site = selectedValue(member);
          // A proven erased branch cannot contribute, even when the value
          // behind it would exceed our proof budget.
          if (site && typescript.isExportSpecifier(site)
            && (site.isTypeOnly || site.parent.parent.isTypeOnly || erasedValueAlias(member))) continue;
        }
        // An erased member cannot contribute to the value search. A merged
        // alias can still lead to a value, so keep the selected alias check.
        if (inValueSpace && erasedExport(unalias(member))) continue;
        const route = selection ? boundExport(entry.module, key, member, depth) : { target: member, eligible: true, erased: false };
        if (!route) return undefined;
        if (entry.module === module) return route;
        if (inValueSpace && route.erased) continue;
        if (result && !sameValue(result.target, route.target)) return undefined;
        result = { target: route.target, eligible: (result?.eligible ?? true) && entry.eligible && route.eligible,
          erased: route.erased };
        continue;
      }
      const stars = bound?.get(typescript.InternalSymbolName.ExportStar)?.declarations ?? [];
      for (let index = stars.length - 1; index >= 0; index--) {
        if (!charge()) return undefined;
        const star = stars[index]!;
        if (!typescript.isExportDeclaration(star) || !star.moduleSpecifier || !typescript.isSourceFile(star.parent)) continue;
        if (inValueSpace && star.isTypeOnly) continue;
        const next = checker.getSymbolAtLocation(star.moduleSpecifier);
        if (next) pending.push({ module: next, eligible: entry.eligible && syntactic(star) && (!valueOnly || !star.isTypeOnly) });
      }
    }
    if (!selection) return result;
    const chosen = follow(selected, depth);
    if (!chosen || result && !sameValue(chosen.target, result.target)) return undefined;
    // A selected erased alias cannot gain value eligibility from another route.
    return { target: chosen.target, eligible: (result?.eligible ?? false) && chosen.eligible,
      erased: chosen.erased || inValueSpace && result === undefined };
  };

  function follow(current: ts.Symbol, depth: number): AliasRoute | undefined {
    if (depth >= 32 || activeAliases.has(current)) return undefined;
    const cached = finishedAliases.get(current)?.get(depth);
    if (cached) return cached;
    if (!charge() || !current.declarations?.length) return undefined;
    activeAliases.add(current);
    const route = readAlias(current, depth);
    activeAliases.delete(current);
    if (route) {
      let depths = finishedAliases.get(current);
      if (!depths) { depths = new Map(); finishedAliases.set(current, depths); }
      depths.set(depth, route);
    }
    return route;
  }

  function readAlias(current: ts.Symbol, depth: number): AliasRoute | undefined {
    const selected = selection && selectedValue(current);
    if (selection && !selected) {
      // A namespace export such as livemap.fromLibraries can end at one
      // package function with several overload declarations.
      const value = current.valueDeclaration;
      if (selection !== "package-value" || namespaceMember !== current.name || !value || !typescript.isFunctionDeclaration(value)
        || !current.declarations?.every(site => charge() && typescript.isFunctionDeclaration(site)
          && site.getSourceFile() === value.getSourceFile() && syntactic(site))) return undefined;
      return { target: current, eligible: true, erased: false };
    }
    const followAlias = (current.flags & typescript.SymbolFlags.Alias) !== 0 && (!selected || selected !== current.valueDeclaration);
    const checkTypeOnly = !!selection && valueOnly && followAlias;
    // Eligibility in verbatim mode and actual value contribution are separate.
    // A type-only half of a merged symbol can invalidate its selected alias
    // while the local value still competes with other exports.
    let erased = checkTypeOnly && erasedValueAlias(current);
    let proof = !checkTypeOnly || typeOnlyAlias !== undefined && typeOnlyAlias(current, aliasMeaning) === undefined;
    let selectedExport: AliasRoute | undefined;
    for (const declaration of selected ? [selected] : current.declarations ?? []) {
      if (!charge()) return undefined;
      if (selection && followAlias && !typescript.isImportSpecifier(declaration) && !typescript.isExportSpecifier(declaration)
        && !(selection === "package-value" && namespaceMember && typescript.isNamespaceImport(declaration))) return undefined;
      let dependency: ts.Node = declaration;
      if (typescript.isImportSpecifier(declaration) || typescript.isNamespaceImport(declaration) || typescript.isExportSpecifier(declaration)) {
        while (dependency.parent !== undefined && !typescript.isSourceFile(dependency.parent)
          && !typescript.isImportDeclaration(dependency) && !typescript.isExportDeclaration(dependency)) {
          if (eligible?.charge?.() === false) return undefined;
          dependency = dependency.parent;
      }
      }
      if (!typescript.isSourceFile(dependency)) proof &&= syntactic(dependency);
      if (!typescript.isImportDeclaration(dependency) && !typescript.isExportDeclaration(dependency)) continue;
      if (selection && !typescript.isSourceFile(dependency.parent)) {
        const block = dependency.parent;
        if (!typescript.isModuleBlock(block) || !typescript.isStringLiteral(block.parent.name)
          || !typescript.isSourceFile(block.parent.parent) || typescript.isExternalModule(block.parent.parent)) return undefined;
      }
      if (selection && valueOnly && typescript.isImportDeclaration(dependency) && dependency.importClause?.phaseModifier !== undefined) return undefined;
      erased ||= valueOnly && (typescript.isImportDeclaration(dependency) && (dependency.importClause?.isTypeOnly === true
        || typescript.isImportSpecifier(declaration) && declaration.isTypeOnly)
        || typescript.isExportDeclaration(dependency) && (dependency.isTypeOnly || typescript.isExportSpecifier(declaration) && declaration.isTypeOnly));
      if (dependency.moduleSpecifier === undefined) continue;
      const name = typescript.isImportSpecifier(declaration) || typescript.isExportSpecifier(declaration)
        ? (declaration.propertyName ?? declaration.name).text : typescript.isNamespaceImport(declaration) ? namespaceMember : undefined;
      if (name === undefined) continue;
      const module = checker.getSymbolAtLocation(dependency.moduleSpecifier);
      const route = module && moduleExport(module, name, depth + 1);
      if (!route) return undefined;
      proof &&= route.eligible;
      if (selection) selectedExport = route;
    }
    if (!followAlias) return { target: current, eligible: proof && !erased, erased };
    if (selectedExport === undefined) {
      const target = checker.getImmediateAliasedSymbol(current);
      selectedExport = target && follow(target, depth + 1);
    }
    if (!selectedExport) return undefined;
    return { target: selectedExport.target, eligible: proof && !erased && selectedExport.eligible, erased: erased || selectedExport.erased };
  }

  return follow(symbol, 0);
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
  tagged: ts.TaggedTemplateExpression, template: ts.TemplateExpression, authoringKind: HsonAuthoringKind,
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

/** Discover local authoring syntax in the current host snapshot. */
export function discover_hson_tagged_templates(
  fileName: string,
  hostText: string,
  sourceProgram?: ts.Program,
  // Opt-in diagnostics only. Recovered templates never enter either admitted result list.
  onDocumentQuadRecovery?: (source: InterpolatedEmbeddedHsonTemplate) => void,
  ts: typeof defaultTs = defaultTs,
  // Lexical editor regions may use incomplete literal bounds. They never enter admission.
  onEditingTemplate?: (source: HsonTaggedTemplateSource | InterpolatedEmbeddedHsonTemplate,
    closed: boolean, openSubstitution: boolean) => void,
): HsonTaggedTemplateDiscoveryResult {
  const empty = (): HsonTaggedTemplateDiscoveryResult => Object.freeze({
    sources: Object.freeze([]),
    interpolated: Object.freeze([]),
    incompleteEvents: Object.freeze([]),
  });
  if (typeof fileName !== "string"
    || typeof hostText !== "string"
    || !(/\.(?:[cm]?ts|tsx)$/i.test(fileName)
      || onEditingTemplate !== undefined && /\.(?:[cm]?js|jsx)$/i.test(fileName))) {
    return empty();
  }

  const program = sourceProgram ?? create_hson_source_program(fileName, hostText, {}, ts);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile?.text !== hostText) return empty();
  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.some((diagnostic) => diagnostic.start === undefined)) return empty();
  const checker = program.getTypeChecker();
  const importSymbols = read_supported_hson_import_symbols(sourceFile, checker, diagnostics, "Hson", ts);

  const sources: HsonTaggedTemplateSource[] = [];
  const interpolated: InterpolatedEmbeddedHsonTemplate[] = [];
  const incompleteEvents: (HsonTaggedTemplateSource | InterpolatedEmbeddedHsonTemplate)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = hson_authoring_tag(ts, node);
      const symbol = tag === undefined ? undefined : checker.getSymbolAtLocation(tag.receiver);
      const relevantRange = nodeRange(node, sourceFile);
      const imported = symbol !== undefined && importSymbols.has(symbol);
      const directEvent = tag?.kind === "event" && tag.receiver.text === "Hson";
      const candidate = tag !== undefined && (imported || directEvent)
        && !hasOverlappingDiagnostic(diagnostics, nodeRange(node.tag, sourceFile));
      const eventIntent = tag?.kind === "event" && imported ? { eventValueImport: true as const } : {};
      if (candidate && onEditingTemplate !== undefined) {
        const template = node.template;
        const templateRange = nodeRange(template, sourceFile);
        if (hostText[templateRange.start] === "`") {
          const tail = ts.isTemplateExpression(template) ? template.templateSpans.at(-1)?.literal : template;
          const closed = tail !== undefined && !tail.isUnterminated && hostText[templateRange.end - 1] === "`";
          const editable = ts.isTemplateExpression(template)
            ? recover_interpolated_template(fileName, hostText, sourceFile, node, template, tag.kind)
            : { authoringKind: tag.kind, fileName, hostText, tagRange: nodeRange(node.tag, sourceFile), templateRange,
                bodyRange: { start: templateRange.start + 1, end: templateRange.end - (closed ? 1 : 0) } };
          if (editable !== undefined) onEditingTemplate(editable, closed,
            ts.isTemplateExpression(template) && tail?.getWidth(sourceFile) === 0);
        }
      }
      if (candidate) {
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
            sources.push(Object.freeze({ ...validated, authoringKind, ...eventIntent }));
            discovered = true;
          } else {
            const substitutionRanges = read_template_substitution_ranges(node.template, hostText, sourceFile);
            if (substitutionRanges !== undefined) {
              discovered = true;
              interpolated.push(Object.freeze({
                authoringKind,
                ...eventIntent,
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
            if (recovered !== undefined) incompleteEvents.push({ ...recovered, ...eventIntent });
          } else if (node.template.isUnterminated && hostText[templateRange.start] === "`") {
            incompleteEvents.push({ authoringKind: "event", ...eventIntent, fileName, hostText, tagRange, templateRange,
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

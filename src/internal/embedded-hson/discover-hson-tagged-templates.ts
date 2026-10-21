import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import {
  validate_embedded_hson_source,
  type EmbeddedHsonSource,
  type HostSourceRange,
} from "./embedded-hson-source.js";

const defaultTs = ts;

const supportedPackageSpecifiers: ReadonlySet<string> = new Set([
  "hson-live",
  "hson-live/hson",
]);

/** Require the lexical import binding, rather than a matching symbol name or filename. */
export function is_official_hson_package_binding(
  identifier: ts.Identifier,
  expected: "Hson" | "HsonData" | "HsonDocument" | "HsonAuthored" | "HsonFromSchema" | "JsonFromSchema",
  checker: ts.TypeChecker,
  requireResolvedOrigin = false,
  typescript: typeof ts = defaultTs,
  eligible?: (node: ts.Node) => boolean,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined || symbol.declarations?.length !== 1) return false;
  const declaration = symbol.declarations[0];
  if (declaration === undefined || !typescript.isImportSpecifier(declaration)) return false;
  const clause = declaration.parent.parent;
  const imported = clause.parent;
  const officialImport = typescript.isImportDeclaration(imported)
    && typescript.isStringLiteral(imported.moduleSpecifier)
    && supportedPackageSpecifiers.has(imported.moduleSpecifier.text)
    && (declaration.propertyName?.text ?? declaration.name.text) === expected
    && (expected !== "Hson" || !declaration.isTypeOnly && !clause.isTypeOnly);
  if (!officialImport || eligible !== undefined && !hson_source_alias_eligible(symbol, checker, eligible, typescript, expected === "Hson")) return false;
  if (!requireResolvedOrigin) return officialImport;
  const target = checker.getAliasedSymbol(symbol);
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

function official_declaration_origin(fileName: string, expected: "Hson" | "HsonData" | "HsonDocument" | "HsonAuthored" | "HsonFromSchema" | "JsonFromSchema"): boolean {
  const path = hson_package_declaration_path(fileName);
  return path !== undefined && (expected === "Hson"
    ? ["src/index.ts", "src/hson-authoring.ts", "dist/index.d.ts", "dist/hson-authoring.d.ts"].includes(path)
    : ["src/index.ts", "src/hson-authoring.ts", "src/api/transform/transform.types.ts",
      "dist/index.d.ts", "dist/hson-authoring.d.ts", "dist/api/transform/transform.types.d.ts"].includes(path));
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

export type HsonAuthoringKind = "canonical" | "data" | "document" | "schema";
export type HsonTaggedTemplateSource = EmbeddedHsonSource & Readonly<{ authoringKind: HsonAuthoringKind }>;

function is_hson_authoring_kind(value: string): value is HsonAuthoringKind {
  return value === "canonical" || value === "data" || value === "document" || value === "schema";
}

export type HsonTaggedTemplateDiscoveryResult = Readonly<{
  sources: readonly HsonTaggedTemplateSource[];
  interpolated: readonly InterpolatedEmbeddedHsonTemplate[];
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
      const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
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

/** Check each supported import/export hop, rather than skipping to a recovered target. */
export function hson_source_alias_eligible(symbol: ts.Symbol, checker: ts.TypeChecker, eligible: (node: ts.Node) => boolean,
  typescript: typeof ts = defaultTs, valueOnly = false, namespaceMember?: string): boolean {
  const unalias = (value: ts.Symbol) => (value.flags & typescript.SymbolFlags.Alias) === 0 ? value : checker.getAliasedSymbol(value);
  // The checker elides export-star hops from alias symbols. Recover only the
  // selected value's routes from its module AST, preserving every possible hop.
  const moduleExportEligible = (specifier: ts.Expression, name: string, visited = new Set<ts.Symbol>()): boolean => {
    const module = checker.getSymbolAtLocation(specifier);
    if (module === undefined || visited.has(module) || visited.size >= 16) return false;
    const selected = checker.getExportsOfModule(module).find(value => value.name === name);
    if (selected === undefined) return false;
    const files = (module.declarations ?? []).filter(typescript.isSourceFile);
    if (selected.declarations?.some(declaration => files.includes(declaration.getSourceFile()))) return true;
    const next = new Set(visited); next.add(module);
    const routes = files.flatMap(file => file.statements.filter(typescript.isExportDeclaration).filter(statement => {
      if (statement.exportClause !== undefined || statement.moduleSpecifier === undefined) return false;
      const target = checker.getSymbolAtLocation(statement.moduleSpecifier);
      const exported = target === undefined ? undefined : checker.getExportsOfModule(target).find(value => value.name === name);
      return exported !== undefined && unalias(exported) === unalias(selected);
    }));
    return routes.length > 0 && routes.every(route => eligible(route) && (!valueOnly || !route.isTypeOnly)
      && route.moduleSpecifier !== undefined && moduleExportEligible(route.moduleSpecifier, name, next));
  };
  const seen = new Set<ts.Symbol>();
  while (true) {
    if (seen.has(symbol) || seen.size >= 16 || symbol.declarations === undefined || symbol.declarations.length === 0) return false;
    seen.add(symbol);
    for (const declaration of symbol.declarations) {
      let dependency: ts.Node = declaration;
      if (typescript.isImportSpecifier(declaration) || typescript.isNamespaceImport(declaration) || typescript.isExportSpecifier(declaration)) {
        while (dependency.parent !== undefined && !typescript.isSourceFile(dependency.parent)
          && !typescript.isImportDeclaration(dependency) && !typescript.isExportDeclaration(dependency)) dependency = dependency.parent;
      }
      // A namespace's module contains unrelated declarations; only the selected
      // exported value and the import/export hops establish this dependency.
      if (!typescript.isSourceFile(dependency) && !eligible(dependency)) return false;
      if (valueOnly && (typescript.isImportDeclaration(dependency) && (dependency.importClause?.isTypeOnly
        || typescript.isImportSpecifier(declaration) && declaration.isTypeOnly)
        || typescript.isExportDeclaration(dependency) && (dependency.isTypeOnly || typescript.isExportSpecifier(declaration) && declaration.isTypeOnly))) return false;
      if ((typescript.isImportDeclaration(dependency) || typescript.isExportDeclaration(dependency)) && dependency.moduleSpecifier !== undefined) {
        const name = typescript.isImportSpecifier(declaration) || typescript.isExportSpecifier(declaration)
          ? (declaration.propertyName ?? declaration.name).text : typescript.isNamespaceImport(declaration) ? namespaceMember : undefined;
        if (name !== undefined && !moduleExportEligible(dependency.moduleSpecifier, name)) return false;
      }
    }
    if ((symbol.flags & typescript.SymbolFlags.Alias) === 0) return true;
    const next = checker.getImmediateAliasedSymbol(symbol);
    if (next === undefined) return false;
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

/** Diagnostic-only literal boundaries from the host AST; never authoring admission.
 * An unfinished hole masks its entire remaining expression. No suffix is guessed.
 */
function document_quad_recovery_source(fileName: string, hostText: string, sourceFile: ts.SourceFile,
  tagged: ts.TaggedTemplateExpression, template: ts.TemplateExpression,
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
  return { fileName, hostText, authoringKind: "document", tagRange: nodeRange(tagged.tag, sourceFile),
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
): HsonTaggedTemplateDiscoveryResult {
  const empty = (): HsonTaggedTemplateDiscoveryResult => Object.freeze({
    sources: Object.freeze([]),
    interpolated: Object.freeze([]),
  });
  if (typeof fileName !== "string"
    || typeof hostText !== "string"
    || !/\.(?:[cm]?ts|tsx)$/.test(fileName)) {
    return empty();
  }

  const program = sourceProgram ?? create_hson_source_program(fileName, hostText, {}, ts);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) return empty();
  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.some((diagnostic) => diagnostic.start === undefined)) return empty();
  const checker = program.getTypeChecker();
  const importSymbols = read_supported_hson_import_symbols(sourceFile, checker, diagnostics, "Hson", ts);
  if (importSymbols.size === 0) return empty();

  const sources: HsonTaggedTemplateSource[] = [];
  const interpolated: InterpolatedEmbeddedHsonTemplate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)
      && ts.isPropertyAccessExpression(node.tag)
      && ts.isIdentifier(node.tag.expression)
      && is_hson_authoring_kind(node.tag.name.text)
      && (node.flags & ts.NodeFlags.OptionalChain) === 0
      && node.typeArguments === undefined) {
      const symbol = checker.getSymbolAtLocation(node.tag.expression);
      const relevantRange = nodeRange(node, sourceFile);
      if (symbol !== undefined
        && importSymbols.has(symbol)
        && !hasOverlappingDiagnostic(diagnostics, nodeRange(node.tag, sourceFile))) {
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
          const authoringKind = node.tag.name.text;
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
        if (!discovered && onDocumentQuadRecovery !== undefined && node.tag.name.text === "document"
          && ts.isTemplateExpression(node.template)) {
          const recovered = document_quad_recovery_source(fileName, hostText, sourceFile, node, node.template);
          if (recovered !== undefined) onDocumentQuadRecovery(recovered);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze({
    sources: Object.freeze(sources),
    interpolated: Object.freeze(interpolated),
  });
}

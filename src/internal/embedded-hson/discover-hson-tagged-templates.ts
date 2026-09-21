import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import {
  validate_embedded_hson_source,
  type EmbeddedHsonSource,
  type HostSourceRange,
} from "./embedded-hson-source.js";

const supportedPackageSpecifiers: ReadonlySet<string> = new Set([
  "hson-live",
  "hson-live/hson",
]);

/** Require the lexical import binding, rather than a matching symbol name or filename. */
export function is_official_hson_package_binding(
  identifier: ts.Identifier,
  expected: "Hson" | "HsonData" | "HsonDocument",
  checker: ts.TypeChecker,
  requireResolvedOrigin = false,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined || symbol.declarations?.length !== 1) return false;
  const declaration = symbol.declarations[0];
  if (declaration === undefined || !ts.isImportSpecifier(declaration)) return false;
  const clause = declaration.parent.parent;
  const imported = clause.parent;
  const officialImport = ts.isImportDeclaration(imported)
    && ts.isStringLiteral(imported.moduleSpecifier)
    && supportedPackageSpecifiers.has(imported.moduleSpecifier.text)
    && (declaration.propertyName?.text ?? declaration.name.text) === expected
    && (expected !== "Hson" || !declaration.isTypeOnly && !clause.isTypeOnly);
  if (!officialImport || !requireResolvedOrigin) return officialImport;
  const target = checker.getAliasedSymbol(symbol);
  return target.declarations?.some(item => official_declaration_origin(item.getSourceFile().fileName, expected)) === true;
}

function official_declaration_origin(fileName: string, expected: "Hson" | "HsonData" | "HsonDocument"): boolean {
  let directory = dirname(resolve(fileName));
  while (true) {
    const manifestPath = resolve(directory, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (typeof manifest !== "object" || manifest === null || !("name" in manifest) || manifest.name !== "hson-live") return false;
      } catch { return false; }
      const path = relative(directory, resolve(fileName)).split(sep).join("/");
      return expected === "Hson"
        ? ["src/index.ts", "src/hson-authoring.ts", "dist/index.d.ts", "dist/hson-authoring.d.ts"].includes(path)
        : ["src/index.ts", "src/hson-authoring.ts", "src/api/transform/transform.types.ts",
          "dist/index.d.ts", "dist/hson-authoring.d.ts", "dist/api/transform/transform.types.d.ts"].includes(path);
    }
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
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

export function create_hson_source_program(fileName: string, hostText: string): ts.Program {
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
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

export function read_supported_hson_import_symbols(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: readonly ts.Diagnostic[],
  facade: "Hson" | "hson" | "hsonTransform" | "hsonLiveMap" | "hsonLiveTree" = "Hson",
): ReadonlySet<ts.Symbol> {
  const symbols = new Set<ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || statement.importClause === undefined
      || statement.importClause.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !(facade === "Hson" ? supportedPackageSpecifiers.has(statement.moduleSpecifier.text)
        : facade === "hson" ? statement.moduleSpecifier.text === "hson-live"
        : facade === "hsonTransform" ? ["hson-live", "hson-live/transform"].includes(statement.moduleSpecifier.text)
        : facade === "hsonLiveMap" ? ["hson-live", "hson-live/livemap"].includes(statement.moduleSpecifier.text)
        : ["hson-live", "hson-live/livetree"].includes(statement.moduleSpecifier.text))
      || hasOverlappingDiagnostic(diagnostics, nodeRange(statement, sourceFile))) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
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

/** Discover semantic member tags rooted in an official Hson import. */
export function discover_hson_tagged_templates(
  fileName: string,
  hostText: string,
): HsonTaggedTemplateDiscoveryResult {
  const empty = (): HsonTaggedTemplateDiscoveryResult => Object.freeze({
    sources: Object.freeze([]),
    interpolated: Object.freeze([]),
  });
  if (typeof fileName !== "string"
    || typeof hostText !== "string"
    || !/\.tsx?$/.test(fileName)) {
    return empty();
  }

  const program = create_hson_source_program(fileName, hostText);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) return empty();
  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.some((diagnostic) => diagnostic.start === undefined)) return empty();
  const checker = program.getTypeChecker();
  const importSymbols = read_supported_hson_import_symbols(sourceFile, checker, diagnostics);
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
        && !hasOverlappingDiagnostic(diagnostics, relevantRange)) {
        const tagRange = nodeRange(node.tag, sourceFile);
        const templateRange = nodeRange(node.template, sourceFile);
        const bodyRange = Object.freeze({
          start: templateRange.start + 1,
          end: templateRange.end - 1,
        });
        const validated = validateTemplateDescriptor(
          fileName,
          hostText,
          tagRange,
          templateRange,
          bodyRange,
        );
        if (validated !== undefined) {
          const authoringKind = node.tag.name.text;
          if (ts.isNoSubstitutionTemplateLiteral(node.template)) {
            sources.push(Object.freeze({ ...validated, authoringKind }));
          } else {
            const substitutionRanges = read_template_substitution_ranges(node.template, hostText, sourceFile);
            if (substitutionRanges !== undefined) {
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

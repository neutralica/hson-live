import ts from "typescript";

import {
  validate_embedded_hson_source,
  type EmbeddedHsonSource,
  type HostSourceRange,
} from "./embedded-hson-source.js";

const supportedPackageSpecifiers: ReadonlySet<string> = new Set([
  "hson-live",
  "hson-live/hson",
]);

export type InterpolatedEmbeddedHsonTemplate = Readonly<{
  fileName: string;
  hostText: string;
  tagRange: HostSourceRange;
  templateRange: HostSourceRange;
  bodyRange: HostSourceRange;
  substitutionRanges: readonly HostSourceRange[];
  expressionRanges: readonly HostSourceRange[];
}>;

export type HsonTaggedTemplateDiscoveryResult = Readonly<{
  sources: readonly EmbeddedHsonSource[];
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
  facade: "HSON" | "hson" | "hsonTransform" | "hsonLiveMap" | "hsonLiveTree" = "HSON",
): ReadonlySet<ts.Symbol> {
  const symbols = new Set<ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || statement.importClause === undefined
      || statement.importClause.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !(facade === "HSON" ? supportedPackageSpecifiers.has(statement.moduleSpecifier.text)
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
  publicName: "HSON" | "hson";
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

/** Discover literal usage references to official public HSON-live bindings. */
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
    HSON: read_supported_hson_import_symbols(sourceFile, checker, diagnostics, "HSON"),
    hson: read_supported_hson_import_symbols(sourceFile, checker, diagnostics, "hson"),
  } as const;
  const result: HsonBindingReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)
      && (node.text === "HSON" || node.text === "hson")
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

function readSubstitutionRanges(
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

/** Discover direct official HSON tags in one original in-memory TS/TSX source. */
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

  const sources: EmbeddedHsonSource[] = [];
  const interpolated: InterpolatedEmbeddedHsonTemplate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)
      && ts.isIdentifier(node.tag)
      && (node.flags & ts.NodeFlags.OptionalChain) === 0
      && node.typeArguments === undefined) {
      const symbol = checker.getSymbolAtLocation(node.tag);
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
          if (ts.isNoSubstitutionTemplateLiteral(node.template)) {
            sources.push(validated);
          } else {
            const substitutionRanges = readSubstitutionRanges(node.template, hostText, sourceFile);
            if (substitutionRanges !== undefined) {
              interpolated.push(Object.freeze({
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

import ts from "typescript";

import {
  validate_embedded_hson_source,
  type EmbeddedHsonSource,
  type HostSourceRange,
} from "./embedded-hson-source.js";

const supportedPackageSpecifiers: ReadonlySet<string> = new Set([
  "hson-live",
  "hson-live/hson",
  "hson-live/transform",
]);

export type UnsupportedEmbeddedHsonTemplate = Readonly<{
  reason: "substitutions";
  fileName: string;
  hostText: string;
  tagRange: HostSourceRange;
  templateRange: HostSourceRange;
  bodyRange: HostSourceRange;
  substitutionRanges: readonly HostSourceRange[];
}>;

export type HsonTaggedTemplateDiscoveryResult = Readonly<{
  sources: readonly EmbeddedHsonSource[];
  unsupported: readonly UnsupportedEmbeddedHsonTemplate[];
}>;

function createProgram(fileName: string, hostText: string): ts.Program {
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

function readSupportedImportSymbols(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: readonly ts.Diagnostic[],
): ReadonlySet<ts.Symbol> {
  const symbols = new Set<ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || statement.importClause === undefined
      || statement.importClause.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !supportedPackageSpecifiers.has(statement.moduleSpecifier.text)
      || hasOverlappingDiagnostic(diagnostics, nodeRange(statement, sourceFile))) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName !== "hsonString") continue;
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol !== undefined) symbols.add(symbol);
    }
  }
  return symbols;
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

/** Discover direct official hsonString tags in one original in-memory TS/TSX source. */
export function discover_hson_tagged_templates(
  fileName: string,
  hostText: string,
): HsonTaggedTemplateDiscoveryResult {
  const empty = (): HsonTaggedTemplateDiscoveryResult => Object.freeze({
    sources: Object.freeze([]),
    unsupported: Object.freeze([]),
  });
  if (typeof fileName !== "string"
    || typeof hostText !== "string"
    || !/\.tsx?$/.test(fileName)) {
    return empty();
  }

  const program = createProgram(fileName, hostText);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) return empty();
  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.some((diagnostic) => diagnostic.start === undefined)) return empty();
  const checker = program.getTypeChecker();
  const importSymbols = readSupportedImportSymbols(sourceFile, checker, diagnostics);
  if (importSymbols.size === 0) return empty();

  const sources: EmbeddedHsonSource[] = [];
  const unsupported: UnsupportedEmbeddedHsonTemplate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)
      && ts.isIdentifier(node.tag)
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
              unsupported.push(Object.freeze({
                reason: "substitutions",
                fileName,
                hostText,
                tagRange: validated.tagRange,
                templateRange: validated.templateRange,
                bodyRange: validated.bodyRange,
                substitutionRanges,
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
    unsupported: Object.freeze(unsupported),
  });
}

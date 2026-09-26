import ts from "typescript";
import { read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";

export type SchemaSourceEdit = Readonly<{ start: number; end: number; text: string }>;
export type SchemaSourceAssociation = Readonly<{ declaration: ts.VariableDeclaration; text: string }>;
export type PreciseSchemaFact = Readonly<{ declaration: ts.Declaration; mode: "data" | "document" }>;
export type LibrarySchemaAttachmentFact = Readonly<{
  statement: ts.ExpressionStatement;
  map: ts.Identifier;
  library: ts.StringLiteral;
  schema: ts.Identifier;
  mode: "data" | "document";
}>;

// Split markers keep source-scanning migration tools from treating this helper as a legacy producer.
export const GENERATED_EXPORTS_START = "// @hson-schema" + " generated type exports";
export const GENERATED_EXPORTS_END = "// @hson-schema" + " end generated type exports";

/** Association planning for generated compiler inputs and in-memory editor views. */
export function schema_type_association(
  name: string,
  specifier: string,
  schemaTypeName = "__HsonSchema",
  evidenceName = `__${name}Evidence`,
): Readonly<{ reexport: string; schemaAssociation: string }> {
  return {
    reexport: `import type { Evidence as ${evidenceName} } from ${JSON.stringify(specifier)};`,
    schemaAssociation: `${schemaTypeName}<${evidenceName}["value"], ${evidenceName}["mode"], ${evidenceName}["identity"]>`,
  };
}

export function unwrap_tagged_schema(node: ts.Expression): ts.TaggedTemplateExpression | undefined {
  if (ts.isTaggedTemplateExpression(node)) return node;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return unwrap_tagged_schema(node.expression);
  return undefined;
}

/** Edits use UTF-16 offsets in the original TypeScript SourceFile text. */
export function schema_association_edits(associations: readonly SchemaSourceAssociation[]): readonly SchemaSourceEdit[] {
  const edits: SchemaSourceEdit[] = [];
  for (const association of associations) {
    const { declaration, text } = association;
    const initializer = declaration.initializer;
    const tagged = initializer === undefined ? undefined : unwrap_tagged_schema(initializer);
    if (initializer !== undefined && tagged !== undefined) {
      // Keep the authored tag as a copied segment so editor positions map exactly.
      edits.push({ start: initializer.getStart(), end: tagged.getStart(), text: "(" });
      edits.push({ start: tagged.getEnd(), end: initializer.getEnd(), text: ` as unknown as ${text})` });
    }
    const annotation = declaration.type;
    edits.push(annotation === undefined
      ? { start: declaration.name.getEnd(), end: declaration.name.getEnd(), text: `: ${text}` }
      : { start: annotation.getStart(), end: annotation.getEnd(), text });
  }
  return edits;
}

/** Shared alias allocation and association/import planning for compiler and editor views. */
export function schema_source_plan(source: ts.SourceFile, schemas: readonly Readonly<{
  declaration: ts.VariableDeclaration; name: string; specifier: string;
}>[]): Readonly<{ edits: readonly SchemaSourceEdit[]; generatedNames: readonly string[] }> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, visit); };
  visit(source);
  const generatedNames: string[] = [];
  const allocate = (preferred: string): string => {
    let name = preferred;
    for (let index = 1; names.has(name); index += 1) name = `${preferred}_${index}`;
    names.add(name);
    generatedNames.push(name);
    return name;
  };
  const schemaTypeName = allocate("__HsonSchema");
  const imports: string[] = [];
  const associations = schemas.map(schema => {
    const association = schema_type_association(schema.name, schema.specifier, schemaTypeName, allocate(`__${schema.name}Evidence`));
    imports.push(association.reexport);
    return { declaration: schema.declaration, text: association.schemaAssociation };
  });
  const edits = [...schema_association_edits(associations)];
  const legacy = legacy_import_block_edit(source);
  if (legacy !== undefined) edits.push(legacy);
  if (imports.length > 0) edits.push({ start: source.text.length, end: source.text.length, text: `\n${generated_exports_block(imports, schemaTypeName)}` });
  return { edits, generatedNames };
}

/**
 * Plan flow-local proof calls for the conservative direct post-hoc attachment
 * form. The same plan is consumed by generated compiler inputs and tsserver.
 */
export function library_schema_attachment_plan(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  schemas: readonly PreciseSchemaFact[],
): Readonly<{ edits: readonly SchemaSourceEdit[]; generatedNames: readonly string[]; attachments: readonly LibrarySchemaAttachmentFact[] }> {
  const hsonLiveMapSymbols = read_supported_hson_import_symbols(source, checker, [], "hsonLiveMap");
  if (hsonLiveMapSymbols.size === 0 || schemas.length === 0) return { edits: [], generatedNames: [], attachments: [] };
  const facts = new Map<ts.Declaration, PreciseSchemaFact>(schemas.map(fact => [fact.declaration, fact]));
  const names = new Set<string>();
  const collect = (node: ts.Node): void => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, collect); };
  collect(source);
  let helper = "__hson_assert_library_schema";
  for (let index = 1; names.has(helper); index += 1) helper = `__hson_assert_library_schema_${index}`;
  const edits: SchemaSourceEdit[] = [];
  const attachments: LibrarySchemaAttachmentFact[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isExpressionStatement(node)) {
      const recognized = recognize_library_schema_attachment(node.expression, checker, facts, hsonLiveMapSymbols);
      if (recognized !== undefined) {
        attachments.push({ statement: node, ...recognized });
        edits.push({
          start: node.getEnd(), end: node.getEnd(),
          text: `\n${helper}(${recognized.map.getText(source)}, ${recognized.library.getText(source)}, ${recognized.schema.getText(source)});`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (edits.length === 0) return { edits: [], generatedNames: [], attachments: [] };
  edits.push({
    start: source.text.length,
    end: source.text.length,
    text: `\ndeclare function ${helper}<TMap extends object, TLibrary extends import("hson-live").LiveMapKnownNames<TMap>, TSchema extends import("hson-live").HsonSchema>(map: TMap, library: TLibrary, schema: TSchema): asserts map is import("hson-live").LiveMapWithLibrarySchema<TMap, TLibrary, TSchema>;\n`,
  });
  return { edits, generatedNames: [helper], attachments };
}

function recognize_library_schema_attachment(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  schemas: ReadonlyMap<ts.Declaration, PreciseSchemaFact>,
  hsonLiveMapSymbols: ReadonlySet<ts.Symbol>,
): Readonly<{ map: ts.Identifier; library: ts.StringLiteral; schema: ts.Identifier; mode: "data" | "document" }> | undefined {
  if (!ts.isCallExpression(expression) || expression.arguments.length !== 1
    || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== "use") return undefined;
  const schemaMember = expression.expression.expression;
  if (!ts.isPropertyAccessExpression(schemaMember) || schemaMember.name.text !== "schema") return undefined;
  const libraryCall = schemaMember.expression;
  if (!ts.isCallExpression(libraryCall) || libraryCall.arguments.length !== 1
    || !ts.isPropertyAccessExpression(libraryCall.expression) || libraryCall.expression.name.text !== "lib"
    || !ts.isIdentifier(libraryCall.expression.expression)) return undefined;
  const map = libraryCall.expression.expression;
  const library = libraryCall.arguments[0];
  const schema = expression.arguments[0];
  if (!ts.isStringLiteral(library) || !ts.isIdentifier(schema)
    || !ts.isIdentifier(expression.expression.name) || !official_schema_use(expression.expression.name, checker)) return undefined;
  const fact = schema_fact(schema, checker, schemas);
  if (fact === undefined) return undefined;
  const admitted = tightening_admission(map, library.text, checker, hsonLiveMapSymbols);
  if (admitted === undefined || admitted !== fact.mode) return undefined;
  return { map, library, schema, mode: admitted };
}

function schema_fact(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  schemas: ReadonlyMap<ts.Declaration, PreciseSchemaFact>,
): PreciseSchemaFact | undefined {
  let symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations?.map(declaration => schemas.get(declaration)).find((fact): fact is PreciseSchemaFact => fact !== undefined);
}

function tightening_admission(
  map: ts.Identifier,
  library: string,
  checker: ts.TypeChecker,
  hsonLiveMapSymbols: ReadonlySet<ts.Symbol>,
): "data" | "document" | undefined {
  const symbol = checker.getSymbolAtLocation(map);
  if (symbol === undefined || symbol.declarations?.length !== 1) return undefined;
  const declaration = symbol.declarations[0];
  if (declaration === undefined || !ts.isVariableDeclaration(declaration) || declaration.initializer === undefined
    || !ts.isIdentifier(declaration.name) || !ts.isCallExpression(declaration.initializer)) return undefined;
  const construction = declaration.initializer;
  if (!ts.isPropertyAccessExpression(construction.expression) || construction.expression.name.text !== "fromLibraries"
    || !ts.isIdentifier(construction.expression.expression)
    || !hsonLiveMapSymbols.has(checker.getSymbolAtLocation(construction.expression.expression) as ts.Symbol)
    || construction.arguments.length !== 1 || !ts.isObjectLiteralExpression(construction.arguments[0])) return undefined;
  const property = construction.arguments[0].properties.find(item => property_name(item.name) === library);
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) return undefined;
  const definition = property.initializer;
  const mode = definition.properties.some(item => property_name(item.name) === "document") ? "document" as const
    : definition.properties.some(item => property_name(item.name) === "data") ? "data" as const : undefined;
  if (mode === undefined) return undefined;
  const schemaProperty = definition.properties.find(item => property_name(item.name) === "schema");
  if (schemaProperty === undefined) return mode;
  if (!ts.isPropertyAssignment(schemaProperty) || !ts.isIdentifier(schemaProperty.initializer)) return undefined;
  return official_family_any(schemaProperty.initializer, mode, checker) ? mode : undefined;
}

function official_schema_use(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return symbol?.declarations?.some(declaration => /(?:\/src\/types\/livemap\.types\.ts|\/dist\/(?:index|api\/livemap\/index|types\/livemap\.types)\.d\.ts)$/.test(declaration.getSourceFile().fileName.replaceAll("\\", "/"))) === true;
}

function official_family_any(identifier: ts.Identifier, mode: "data" | "document", checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined || symbol.declarations?.length !== 1) return false;
  const declaration = symbol.declarations[0];
  if (declaration === undefined || !ts.isImportSpecifier(declaration)) return false;
  const imported = declaration.propertyName?.text ?? declaration.name.text;
  const importDeclaration = declaration.parent.parent.parent;
  return imported === (mode === "data" ? "ANY_DATA" : "ANY_DOCUMENT")
    && ts.isImportDeclaration(importDeclaration) && ts.isStringLiteral(importDeclaration.moduleSpecifier)
    && ["hson-live", "hson-live/livemap"].includes(importDeclaration.moduleSpecifier.text)
    && checker.getAliasedSymbol(symbol).declarations?.some(item => /(?:^|\/)hson-schema\.[^/]+$/.test(item.getSourceFile().fileName.replaceAll("\\", "/"))) === true;
}

function property_name(name: ts.PropertyName | undefined): string | undefined {
  return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : undefined;
}

export function legacy_import_block_edit(source: ts.SourceFile): SchemaSourceEdit | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "hson-live") continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)
      || !bindings.elements.some(binding => binding.name.text === "__HsonSchema" && binding.propertyName?.text === "HsonSchema")) continue;
    for (const comment of ts.getLeadingCommentRanges(source.text, statement.getFullStart()) ?? []) {
      if (source.text.slice(comment.pos, comment.end) !== GENERATED_EXPORTS_START) continue;
      const block = generated_exports_block_from_source(source.text.slice(comment.pos));
      if (comment.pos + block.length >= statement.getEnd()) return { start: comment.pos, end: comment.pos + block.length, text: "" };
    }
  }
  return undefined;
}

export function apply_source_edits(source: string, edits: readonly SchemaSourceEdit[]): string {
  let output = source;
  let boundary = source.length;
  for (const { edit } of edits.map((edit, index) => ({ edit, index })).sort((left, right) => right.edit.start - left.edit.start || right.edit.end - left.edit.end || right.index - left.index)) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > boundary) throw new Error("Overlapping or invalid Hson Schema source edits.");
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    boundary = edit.start;
  }
  return output;
}

export function generated_exports_block(exports: readonly string[], schemaTypeName = "__HsonSchema"): string {
  if (exports.length === 0) return "";
  return `${GENERATED_EXPORTS_START}\nimport type { HsonSchema as ${schemaTypeName} } from "hson-live";\n${[...exports].sort().join("\n")}\n${GENERATED_EXPORTS_END}\n`;
}

export function generated_exports_block_from_source(source: string): string {
  const start = source.indexOf(GENERATED_EXPORTS_START);
  if (start < 0) return "";
  const end = source.indexOf(GENERATED_EXPORTS_END, start);
  if (end >= 0) return source.slice(start, end + GENERATED_EXPORTS_END.length + (source[end + GENERATED_EXPORTS_END.length] === "\n" ? 1 : 0));
  const legacy = source.slice(start).match(/^\/\/ @hson-schema generated type exports\n(?:export type \{[^\n]+\} from [^\n]+;\n?)*/)?.[0];
  return legacy ?? "";
}

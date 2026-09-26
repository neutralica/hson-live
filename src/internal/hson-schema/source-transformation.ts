import ts from "typescript";

export type SchemaSourceEdit = Readonly<{ start: number; end: number; text: string }>;
export type SchemaSourceAssociation = Readonly<{ declaration: ts.VariableDeclaration; text: string }>;

// Keep marker literals split so the legacy project's textual block scan cannot
// mistake the helper's own source for a generated association block.
export const GENERATED_EXPORTS_START = "// @hson-schema" + " generated type exports";
export const GENERATED_EXPORTS_END = "// @hson-schema" + " end generated type exports";

/** One association model for the legacy writer and generated compiler inputs. */
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

export function apply_generated_schema_associations(source: string, associations: readonly SchemaSourceAssociation[]): string {
  return apply_source_edits(source, schema_association_edits(associations));
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

export function remove_generated_exports_block(source: string): string {
  const block = generated_exports_block_from_source(source);
  return block === "" ? source : source.replace(block, "");
}

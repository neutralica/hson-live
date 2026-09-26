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
      edits.push({ start: initializer.getStart(), end: initializer.getEnd(), text: `(${tagged.getText()} as unknown as ${text})` });
    }
    const annotation = declaration.type;
    edits.push(annotation === undefined
      ? { start: declaration.name.getEnd(), end: declaration.name.getEnd(), text: `: ${text}` }
      : { start: annotation.getStart(), end: annotation.getEnd(), text });
  }
  return edits;
}

export function apply_source_edits(source: string, edits: readonly SchemaSourceEdit[]): string {
  let output = source;
  let boundary = source.length;
  for (const edit of [...edits].sort((left, right) => right.start - left.start || right.end - left.end)) {
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

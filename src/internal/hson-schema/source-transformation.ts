import defaultTs from "typescript";
import type ts from "typescript";
import { library_source_selection } from "./library-source.js";

export type SchemaSourceEdit = Readonly<{ start: number; end: number; text: string }>;
export type SchemaSourceAssociation = Readonly<{ declaration: ts.VariableDeclaration; text: string }>;
export type PreciseSchemaFact = Readonly<{ declaration: ts.Declaration; mode: "data" | "document" }>;
// Delimit generated compiler-view imports. Authored sources are never rewritten.
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

/** Edits use UTF-16 offsets in the original TypeScript SourceFile text. */
export function schema_association_edits(associations: readonly SchemaSourceAssociation[], ts: typeof defaultTs = defaultTs): readonly SchemaSourceEdit[] {
  const edits: SchemaSourceEdit[] = [];
  for (const association of associations) {
    const { declaration, text } = association;
    const initializer = declaration.initializer;
    const tagged = initializer !== undefined && ts.isTaggedTemplateExpression(initializer) ? initializer : undefined;
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
}>[], ts: typeof defaultTs = defaultTs): Readonly<{ edits: readonly SchemaSourceEdit[]; generatedNames: readonly string[] }> {
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
  const edits = [...schema_association_edits(associations, ts)];
  if (imports.length > 0) edits.push({ start: source.text.length, end: source.text.length, text: `\n${generated_exports_block(imports, schemaTypeName)}` });
  return { edits, generatedNames };
}

/** Recognize required direct family selection without treating optional lookup as proof. */
export function direct_family_selection(expression: ts.Expression, checker: ts.TypeChecker, ts: typeof defaultTs = defaultTs): Readonly<{
  map: ts.Identifier; library: ts.StringLiteral; facade: ts.Expression; family: "doc" | "data";
}> | undefined {
  const selected = library_source_selection(expression, checker, ts);
  return selected === undefined || selected.library === undefined || !selected.required || selected.family === "parts" ? undefined
    : { ...selected, library: selected.library, family: selected.family };
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
  return `${GENERATED_EXPORTS_START}\nimport type { HsonSchema as ${schemaTypeName} } from "hson-live/hson";\n${[...exports].sort().join("\n")}\n${GENERATED_EXPORTS_END}\n`;
}

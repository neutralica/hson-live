import { compile_hson_schema, type HsonSchemaSymbolTable } from "../../../src/internal/hson-schema/compiler.js";
import { serialize_hson_tag_name } from "../../../src/api/transform/utils/hson-utils/hson-tag-helpers.js";
import { local_hson_schema_declarations, type LocalHsonSchemaDeclaration } from "./hson-schema-local.js";

export type SchemaDefinitionSymbol = Readonly<{
  id: string;
  schemaId: string;
  name: string;
  range: Readonly<{ start: number; end: number }>;
  capability: "data" | "document-item";
  references: readonly Readonly<{ start: number; end: number }>[];
}>;

export type SchemaReferenceSymbol = Readonly<{
  schemaId: string;
  name: string;
  range: Readonly<{ start: number; end: number }>;
  requiredCapability: "data" | "document-item";
  targetId?: string;
}>;

export type LocalHsonSchemaSymbols = Readonly<{
  declarations: readonly LocalHsonSchemaDeclaration[];
  definitions: readonly SchemaDefinitionSymbol[];
  references: readonly SchemaReferenceSymbol[];
}>;

/**
 * Editor-neutral adaptation of the compiler's local semantic facts. Nothing
 * here resolves names: it only gives compiler-owned ranges their host offsets.
 */
export function local_hson_schema_symbols(fileName: string, text: string): LocalHsonSchemaSymbols {
  const declarations = local_hson_schema_declarations(text);
  const definitions: SchemaDefinitionSymbol[] = [];
  const references: SchemaReferenceSymbol[] = [];
  for (const declaration of declarations) {
    const schemaId = `${fileName}:${declaration.start}:${declaration.end}`;
    const result = compile_hson_schema(declaration.template);
    const facts = result.ok ? result.value.symbols : result.symbols;
    if (facts === undefined) continue;
    append_symbols(facts, declaration, schemaId, definitions, references);
  }
  return Object.freeze({ declarations, definitions: Object.freeze(definitions), references: Object.freeze(references) });
}

export function local_hson_schema_completion(fileName: string, text: string, offset: number): readonly SchemaDefinitionSymbol[] {
  const symbols = local_hson_schema_symbols(fileName, text);
  const declaration = symbols.declarations.find(candidate => offset >= candidate.templateStart && offset <= candidate.templateEnd);
  if (declaration === undefined) return Object.freeze([]);
  const localOffset = offset - declaration.templateStart;
  if (!is_ref_string_position(declaration.template, localOffset)) return Object.freeze([]);
  if (symbols.definitions.some(definition => definition.schemaId === `${fileName}:${declaration.start}:${declaration.end}`)) {
    return Object.freeze(symbols.definitions.filter(definition => definition.schemaId === `${fileName}:${declaration.start}:${declaration.end}`));
  }
  // The normal parser intentionally rejects half-written strings. Recover only
  // their delimiters, then hand the complete synthetic source to the compiler.
  const recovered = recover_ref_prefix(declaration.template, localOffset);
  const result = compile_hson_schema(recovered);
  const facts = result.ok ? result.value.symbols : result.symbols;
  if (facts === undefined) return Object.freeze([]);
  const definitions: SchemaDefinitionSymbol[] = [];
  append_symbols(facts, declaration, `${fileName}:${declaration.start}:${declaration.end}`, definitions, []);
  return Object.freeze(definitions);
}

export function schema_ref_completion_range(text: string, offset: number): Readonly<{ start: number; end: number }> | undefined {
  const prefix = text.slice(0, offset);
  const match = /<\s*ref\s+"[^"\\]*(?:\\.[^"\\]*)*$/.exec(prefix);
  if (match === null) return undefined;
  const start = (match.index ?? 0) + match[0].lastIndexOf('"') + 1;
  let end = offset, escaped = false;
  while (end < text.length) {
    const char = text[end];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') break;
    end += 1;
  }
  return Object.freeze({ start, end });
}

export function schema_definition_at(symbols: LocalHsonSchemaSymbols, offset: number): SchemaDefinitionSymbol | undefined {
  return symbols.definitions.find(symbol => contains(symbol.range, offset));
}

export function schema_reference_at(symbols: LocalHsonSchemaSymbols, offset: number): SchemaReferenceSymbol | undefined {
  return symbols.references.find(symbol => contains(symbol.range, offset));
}

export function schema_target_at(symbols: LocalHsonSchemaSymbols, offset: number): SchemaDefinitionSymbol | undefined {
  const definition = schema_definition_at(symbols, offset);
  if (definition !== undefined) return definition;
  const reference = schema_reference_at(symbols, offset);
  return reference?.targetId === undefined ? undefined : symbols.definitions.find(candidate => candidate.id === reference.targetId);
}

export function rename_hson_schema_definition(symbols: LocalHsonSchemaSymbols, offset: number, nextName: string): Readonly<{ edits: readonly Readonly<{ start: number; end: number; text: string }>[] }> | undefined {
  const target = schema_target_at(symbols, offset);
  if (target === undefined || !valid_definition_name(nextName)) return undefined;
  const sameScope = symbols.definitions.filter(candidate => candidate.schemaId === target.schemaId);
  if (sameScope.some(candidate => candidate.id !== target.id && candidate.name === nextName)) return undefined;
  const edits = [
    { ...target.range, text: serialize_hson_tag_name(nextName) },
    ...target.references.map(range => ({ ...range, text: JSON.stringify(nextName) })),
  ].sort((left, right) => left.start - right.start);
  return Object.freeze({ edits: Object.freeze(edits.map(change => Object.freeze(change))) });
}

function append_symbols(facts: HsonSchemaSymbolTable, declaration: LocalHsonSchemaDeclaration, schemaId: string, definitions: SchemaDefinitionSymbol[], references: SchemaReferenceSymbol[]): void {
  const ids = new Map<string, string>();
  for (const definition of facts.definitions) {
    const id = `${schemaId}:${definition.id}`;
    ids.set(definition.id, id);
    definitions.push(Object.freeze({ id, schemaId, name: definition.name, capability: definition.capability,
      range: offset_range(declaration, definition.declarationRange),
      references: Object.freeze(definition.referenceRanges.map(range => offset_range(declaration, range))),
    }));
  }
  for (const reference of facts.references) references.push(Object.freeze({ schemaId, name: reference.name, requiredCapability: reference.requiredCapability,
    range: offset_range(declaration, reference.range), ...(reference.targetId === undefined ? {} : { targetId: ids.get(reference.targetId) }),
  }));
}

function offset_range(declaration: LocalHsonSchemaDeclaration, range: Readonly<{ start: number; end: number }>): Readonly<{ start: number; end: number }> {
  return Object.freeze({ start: declaration.templateStart + range.start, end: declaration.templateStart + range.end });
}

function contains(range: Readonly<{ start: number; end: number }>, offset: number): boolean {
  return offset >= range.start && offset <= range.end;
}

function is_ref_string_position(source: string, offset: number): boolean {
  const prefix = source.slice(0, offset);
  return /<\s*ref\s+"[^"\\]*(?:\\.[^"\\]*)*$/.test(prefix);
}

function recover_ref_prefix(source: string, offset: number): string {
  const prefix = source.slice(0, offset);
  const suffix = source.slice(offset);
  const repaired = `${prefix}"${suffix}`;
  return `${repaired}${">".repeat(unclosed_angles(repaired))}`;
}

function unclosed_angles(source: string): number {
  let depth = 0, quoted = false, escaped = false;
  for (const char of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "<") depth += 1;
    else if (char === ">") depth = Math.max(0, depth - 1);
  }
  return depth;
}

function valid_definition_name(name: string): boolean {
  if (name.length === 0) return false;
  const rendered = serialize_hson_tag_name(name);
  return compile_hson_schema(`<type "data" defs <${rendered} "string"> content <ref ${JSON.stringify(name)}>>`).ok;
}

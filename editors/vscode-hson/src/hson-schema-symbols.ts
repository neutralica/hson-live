import { hson_grammar_checkpoint } from "../../../src/api/transform/parsers/tokenize-hson.js";
import { compile_hson_schema, type HsonSchemaSymbolTable, type HsonSchemaDefinitionSymbol } from "../../../src/internal/hson-schema/compiler.js";
import { SchemaSourceMapping } from "../../../src/internal/hson-schema/source-mapping.js";
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
  const declarations = local_hson_schema_declarations(text, fileName);
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

/** Source-only query: the provider already owns host discovery and its program. */
export function schema_reference_completion(source: string, cursor: number): Readonly<{
  range: Readonly<{ start: number; end: number }>;
  definitions: readonly HsonSchemaDefinitionSymbol[];
}> | undefined {
  const checkpoint = hson_grammar_checkpoint(source, cursor, "schema");
  if (checkpoint?.quoted === undefined || checkpoint.path.at(-1) !== "ref") return undefined;
  const { range } = checkpoint;
  const compiled = compile_hson_schema(source);
  const original = compiled.ok ? compiled.value.symbols : compiled.symbols;
  let reference = original?.references.find(reference => reference.range.start === range.start - 1 && reference.range.end === range.end + 1);
  let definitions = original?.definitions;
  if (reference === undefined) {
    // Repair only this value in a private compiler view. Keeping the entire
    // suffix lets the compiler retain forward definitions, including the
    // definition containing an empty reference. No authored edit uses this view.
    const probe = "hsonCompletionProbe";
    const mapping = new SchemaSourceMapping(source, [{ start: range.start, end: range.end,
      text: probe + (checkpoint.quoted.complete ? "" : '"') }]);
    let result = compile_hson_schema(mapping.text);
    let facts = result.ok ? result.value.symbols : result.symbols;
    if (facts === undefined && range.end + (checkpoint.quoted.complete ? 1 : 0) === source.length) {
      // Only an EOF value may recover missing containers. Never discard a suffix.
      result = compile_hson_schema(mapping.text + checkpoint.quoted.closingDelimiters.join(""));
      facts = result.ok ? result.value.symbols : result.symbols;
    }
    reference = facts?.references.find(reference => reference.range.start === range.start - 1 && reference.range.end === range.start + probe.length + 1);
    const authored = (range: Readonly<{ start: number; end: number }>) => {
      const span = mapping.authored_edit({ start: range.start, length: range.end - range.start });
      return span === undefined ? [] : [{ start: span.start, end: span.start + span.length }];
    };
    definitions = facts?.definitions.flatMap(definition => authored(definition.declarationRange).map(declarationRange => ({
      ...definition, declarationRange, id: `definition:${declarationRange.start}:${declarationRange.end}`,
      // The synthetic reference has no authored target; only copied uses survive.
      referenceRanges: definition.referenceRanges.flatMap(authored),
    })));
  }
  if (definitions === undefined || reference === undefined) return undefined;
  return Object.freeze({ range,
    definitions: Object.freeze(definitions.filter(definition => definition.capability === reference.requiredCapability)) });
}

export function local_hson_schema_reference_completion(fileName: string, text: string, offset: number): Readonly<{
  range: Readonly<{ start: number; end: number }>;
  definitions: readonly SchemaDefinitionSymbol[];
}> | undefined {
  const declaration = local_hson_schema_declarations(text, fileName)
    .find(candidate => offset >= candidate.templateStart && offset <= candidate.templateEnd);
  if (declaration === undefined) return undefined;
  const result = schema_reference_completion(declaration.template, offset - declaration.templateStart);
  if (result === undefined) return undefined;
  const definitions: SchemaDefinitionSymbol[] = [];
  append_symbols({ definitions: result.definitions, references: [] }, declaration,
    `${fileName}:${declaration.start}:${declaration.end}`, definitions, []);
  return Object.freeze({ range: offset_range(declaration, result.range), definitions: Object.freeze(definitions) });
}

export function local_hson_schema_completion(fileName: string, text: string, offset: number): readonly SchemaDefinitionSymbol[] {
  return local_hson_schema_reference_completion(fileName, text, offset)?.definitions ?? Object.freeze([]);
}

export function schema_ref_completion_range(text: string, offset: number, fileName = "schema.ts"): Readonly<{ start: number; end: number }> | undefined {
  return local_hson_schema_reference_completion(fileName, text, offset)?.range;
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

function valid_definition_name(name: string): boolean {
  if (name.length === 0) return false;
  const rendered = serialize_hson_tag_name(name);
  return compile_hson_schema(`<type "data" defs <${rendered} "string"> content <ref ${JSON.stringify(name)}>>`).ok;
}

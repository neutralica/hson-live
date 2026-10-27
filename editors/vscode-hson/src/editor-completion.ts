import ts from "typescript";
import { create_hson_source_program, discover_hson_tagged_templates, hson_source_syntactic_eligibility, type HsonTaggedTemplateDiscoveryResult } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { compile_hson_schema, type CompiledHsonSchema } from "../../../src/internal/hson-schema/compiler.js";
import { query_hson_editor_context, type HsonEditorCandidate } from "../../../src/internal/editor-introspection/query.js";
import { interpolation_site } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { annotated_data_schema_source, resolve_hson_schema_annotation } from "../../../src/internal/hson-schema/schema-annotation.js";
import type { DiscoveredHsonSchemaDeclaration } from "../../../src/internal/hson-schema/schema-discovery.js";
import { schema_reference_completion } from "./hson-schema-symbols.js";
import type { HsonTemplateSlot } from "../../../src/api/transform/parsers/tokenize-hson.js";
import { collect_part_source_facts, part_write_context, type PartSourceFacts } from "../../../src/internal/hson-schema/part-source.js";

export type HostCompletion = Readonly<{ candidate: HsonEditorCandidate; range: Readonly<{ start: number; end: number }>; isSnippet?: true }>;
type CachedDocument = Readonly<{
  version: number; text: string; program: ts.Program; file: ts.SourceFile; checker: ts.TypeChecker; discovery: HsonTaggedTemplateDiscoveryResult;
  schemaDeclarations: Map<ts.SourceFile, readonly DiscoveredHsonSchemaDeclaration[]>;
  eligible: (node: ts.Node) => boolean;
}>;

/** Version-scoped discovery and bounded Schema compilation, with no workspace execution. */
export class HsonEditorCompletionCache {
  constructor(private readonly typescript: typeof ts = ts) {}
  private readonly documents = new Map<string, CachedDocument>();
  private readonly schemas = new Map<string, CompiledHsonSchema | null>();
  private sourceProgram: ts.Program | undefined;
  private partFacts: Readonly<{ program: ts.Program; facts: PartSourceFacts }> | undefined;
  clear(): void { this.documents.clear(); this.schemas.clear(); this.sourceProgram = undefined; this.partFacts = undefined; }
  forget(fileName: string): void { this.documents.delete(fileName); this.partFacts = undefined; }
  complete(fileName: string, text: string, version: number, offset: number, sourceProgram?: ts.Program): readonly HostCompletion[] {
    if (!/\.(?:[cm]?ts|tsx)$/.test(fileName) || offset < 0 || offset > text.length) return [];
    // A producer edit can change every consumer without changing its text.
    // Retain discovery/checkers only for the current authored program.
    if (this.sourceProgram !== sourceProgram) {
      this.documents.clear();
      this.partFacts = undefined;
      this.sourceProgram = sourceProgram;
    }
    let cached = this.documents.get(fileName);
    if (cached === undefined || cached.version !== version || cached.text !== text || sourceProgram !== undefined && cached.program !== sourceProgram) {
      const program = sourceProgram ?? create_hson_source_program(fileName, text, {}, this.typescript);
      const file = program.getSourceFile(fileName);
      if (file === undefined || file.text !== text) return [];
      cached = { version, text, program, file, checker: program.getTypeChecker(), discovery: discover_hson_tagged_templates(fileName, text, program, undefined, this.typescript),
        schemaDeclarations: new Map(), eligible: hson_source_syntactic_eligibility(this.typescript, program) };
      this.documents.set(fileName, cached);
      if (this.documents.size > 8) {
        const oldest = this.documents.keys().next().value;
        if (oldest !== undefined) this.documents.delete(oldest);
      }
    }
    const site = [...cached.discovery.interpolated, ...cached.discovery.sources]
      .filter(source => offset >= source.bodyRange.start && offset <= source.bodyRange.end)
      .sort((a, b) => a.bodyRange.end - a.bodyRange.start - (b.bodyRange.end - b.bodyRange.start))[0];
    if (site === undefined) {
      if (this.partFacts?.program !== cached.program) this.partFacts = { program: cached.program, facts: collect_part_source_facts(this.typescript, cached.program) };
      const context = part_write_context(this.typescript, cached.program, this.partFacts.facts, fileName, offset);
      return context === undefined ? [] : context.names.map((name, index): HostCompletion => {
        const scanner = this.typescript.createScanner(this.typescript.ScriptTarget.Latest, false, cached.file.languageVariant, name);
        const identifier = scanner.scan() === this.typescript.SyntaxKind.Identifier && scanner.getTokenEnd() === name.length && scanner.getTokenValue() === name;
        const quoted = this.typescript.createPrinter().printNode(this.typescript.EmitHint.Unspecified,
          this.typescript.factory.createStringLiteral(name, context.quote === "'"), cached.file);
        // A quoted key cannot be shorthand. Offer a native value slot rather than an invalid bare string property.
        const isSnippet = context.quote === undefined && !context.assignment && !identifier;
        const insertText = context.quote !== undefined ? quoted.slice(1, -1) : identifier ? name : quoted;
        return { range: { start: context.start, end: context.end }, ...(isSnippet ? { isSnippet: true } : {}),
          candidate: { label: name, kind: "member", insertText: insertText + (isSnippet ? ': "$0"' : ''),
            detail: "Part argument from the authored definition (current governed definition may differ)",
            certainty: "possible", sortText: String(index).padStart(4, "0") } };
      });
    }
    const interpolated = cached.discovery.interpolated.find(source => source === site);
    if (site.authoringKind === "schema" && interpolated === undefined) {
      const reference = schema_reference_completion(text.slice(site.bodyRange.start, site.bodyRange.end), offset - site.bodyRange.start);
      if (reference !== undefined) return reference.definitions.map((definition, index) => ({
        range: { start: site.bodyRange.start + reference.range.start, end: site.bodyRange.start + reference.range.end },
        candidate: { label: definition.name, kind: "reference", insertText: template_reference_text(definition.name),
          detail: definition.capability === "data" ? "Hson Schema definition" : "Hson Schema document definition",
          sortText: String(index).padStart(4, "0") },
      }));
    }
    let source: string, cursor: number, slots: readonly HsonTemplateSlot[] = [];
    let map: (range: Readonly<{ start: number; end: number }>) => Readonly<{ start: number; end: number }> | undefined;
    {
      const interpolation = interpolation_site(interpolated ?? { ...site, substitutionRanges: [], expressionRanges: [] }, fileName);
      const literalIndex = interpolation.literals.findIndex(literal => offset >= literal.range.start && offset <= literal.range.end);
      if (literalIndex < 0) return [];
      const segments: { start: number; end: number; index: number }[] = [];
      let built = "";
      const mutableSlots: HsonTemplateSlot[] = [];
      interpolation.literals.forEach((literal, index) => {
        const start = built.length;
        built += literal.raw;
        segments.push({ start, end: built.length, index });
        if (index < interpolation.expressions.length) mutableSlots.push({ offset: built.length, substitution: index });
      });
      const segment = segments[literalIndex];
      const local = interpolation.literals[literalIndex]?.boundaries.indexOf(offset) ?? -1;
      if (segment === undefined || local < 0) return [];
      // Role observation needs every boundary; the checkpoint filters at its cursor.
      source = built; cursor = segment.start + local; slots = mutableSlots;
      map = range => {
        const owner = segments.find(segment => range.start >= segment.start && range.end <= segment.end);
        if (owner === undefined || owner.index !== literalIndex) return undefined;
        const literal = interpolation.literals[owner.index];
        const start = literal?.boundaries[range.start - owner.start], end = literal?.boundaries[range.end - owner.start];
        return start === undefined || end === undefined ? undefined : { start, end };
      };
    }
    const schema = site.authoringKind === "data" ? this.resolveSchema(cached, site.tagRange.start) : undefined;
    if (schema === null) return [];
    if (site.authoringKind === "document" && this.partFacts?.program !== cached.program) {
      this.partFacts = { program: cached.program, facts: collect_part_source_facts(this.typescript, cached.program) };
    }
    const result = query_hson_editor_context({ mode: site.authoringKind, source, cursor, slots, schema,
      ...(site.authoringKind !== "document" || this.partFacts === undefined ? {} : { parts: { facts: this.partFacts.facts, file: fileName, offset } }) });
    const range = result.checkpoint?.range === undefined ? undefined : map(result.checkpoint.range);
    return range === undefined ? [] : result.candidates.map(candidate => ({ candidate, range }));
  }

  private resolveSchema(document: CachedDocument, tagStart: number): CompiledHsonSchema | null | undefined {
    const ts = this.typescript;
    let tagged: ts.TaggedTemplateExpression | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && node.tag.getStart(document.file) === tagStart) tagged = node;
      if (tagged === undefined) ts.forEachChild(node, visit);
    };
    visit(document.file);
    const declaration = tagged?.parent;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration) || declaration.initializer !== tagged || declaration.type === undefined
      || !ts.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & ts.NodeFlags.Const) === 0
      || declaration.parent.declarations.length !== 1) return undefined;
    const annotation = resolve_hson_schema_annotation(ts, document.checker, declaration.type, document.eligible);
    if (annotation === undefined) return undefined;
    if (annotation.schema === undefined || annotation.kind !== "data" && annotation.kind !== "hson") return null;
    const source = annotated_data_schema_source(ts, document.program, document.checker, declaration.type, document.eligible, document.schemaDeclarations);
    if (source === undefined) return null;
    const raw = source;
    if (!this.schemas.has(raw)) {
      const compiled = compile_hson_schema(raw);
      this.schemas.set(raw, compiled.ok ? compiled.value : null);
      if (this.schemas.size > 16) {
        const oldest = this.schemas.keys().next().value;
        if (oldest !== undefined) this.schemas.delete(oldest);
      }
    }
    const compiled = this.schemas.get(raw);
    return compiled ?? null;
  }
}

/** Hson reads raw template text: use Hson escapes that are also safe TS lexemes.
 * Escaping a backtick as \` or a dollar as \$ would introduce invalid Hson escapes.
 */
function template_reference_text(name: string): string {
  return JSON.stringify(name).slice(1, -1).replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
}

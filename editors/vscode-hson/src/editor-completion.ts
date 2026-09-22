import ts from "typescript";
import { create_hson_source_program, discover_hson_tagged_templates, is_official_hson_package_binding, type HsonTaggedTemplateDiscoveryResult } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { compile_hson_schema, type CompiledHsonSchema } from "../../../src/internal/hson-schema/compiler.js";
import { query_hson_editor_context, type HsonEditorCandidate } from "../../../src/internal/editor-introspection/query.js";
import { interpolation_site } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import type { HsonTemplateSlot } from "../../../src/api/transform/parsers/tokenize-hson.js";

export type HostCompletion = Readonly<{ candidate: HsonEditorCandidate; range: Readonly<{ start: number; end: number }> }>;
type CachedDocument = Readonly<{ version: number; text: string; file: ts.SourceFile; checker: ts.TypeChecker; discovery: HsonTaggedTemplateDiscoveryResult }>;

/** Version-scoped discovery and bounded Schema compilation, with no workspace execution. */
export class HsonEditorCompletionCache {
  private readonly documents = new Map<string, CachedDocument>();
  private readonly schemas = new Map<string, CompiledHsonSchema | null>();
  clear(): void { this.documents.clear(); this.schemas.clear(); }
  forget(fileName: string): void { this.documents.delete(fileName); }
  complete(fileName: string, text: string, version: number, offset: number): readonly HostCompletion[] {
    if (!/\.tsx?$/.test(fileName) || offset < 0 || offset > text.length) return [];
    let cached = this.documents.get(fileName);
    if (cached === undefined || cached.version !== version || cached.text !== text) {
      const program = create_hson_source_program(fileName, text);
      const file = program.getSourceFile(fileName);
      if (file === undefined) return [];
      cached = { version, text, file, checker: program.getTypeChecker(), discovery: discover_hson_tagged_templates(fileName, text) };
      this.documents.set(fileName, cached);
      if (this.documents.size > 8) {
        const oldest = this.documents.keys().next().value;
        if (oldest !== undefined) this.documents.delete(oldest);
      }
    }
    const interpolated = cached.discovery.interpolated.find(source => offset >= source.bodyRange.start && offset <= source.bodyRange.end);
    const site = interpolated ?? cached.discovery.sources.find(source => offset >= source.bodyRange.start && offset <= source.bodyRange.end);
    if (site === undefined) return [];
    let source: string, cursor: number, slots: readonly HsonTemplateSlot[] = [];
    let map: (range: Readonly<{ start: number; end: number }>) => Readonly<{ start: number; end: number }> | undefined;
    if (interpolated !== undefined) {
      const interpolation = interpolation_site(interpolated, fileName);
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
      source = built; cursor = segment.start + local; slots = mutableSlots.filter(slot => slot.substitution < literalIndex);
      map = range => {
        const owner = segments.find(segment => range.start >= segment.start && range.end <= segment.end);
        if (owner === undefined || owner.index !== literalIndex) return undefined;
        const literal = interpolation.literals[owner.index];
        const start = literal?.boundaries[range.start - owner.start], end = literal?.boundaries[range.end - owner.start];
        return start === undefined || end === undefined ? undefined : { start, end };
      };
    } else {
      source = text.slice(site.bodyRange.start, site.bodyRange.end);
      cursor = offset - site.bodyRange.start;
      map = range => ({ start: site.bodyRange.start + range.start, end: site.bodyRange.start + range.end });
    }
    const schema = site.authoringKind === "data" ? this.resolveSchema(cached, site.tagRange.start) : undefined;
    const result = query_hson_editor_context({ mode: site.authoringKind, source, cursor, slots, schema });
    const range = result.checkpoint?.range === undefined ? undefined : map(result.checkpoint.range);
    return range === undefined ? [] : result.candidates.map(candidate => ({ candidate, range }));
  }

  private resolveSchema(document: CachedDocument, tagStart: number): CompiledHsonSchema | undefined {
    let tagged: ts.TaggedTemplateExpression | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && node.tag.getStart(document.file) === tagStart) tagged = node;
      if (tagged === undefined) ts.forEachChild(node, visit);
    };
    visit(document.file);
    const declaration = tagged?.parent;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration) || declaration.initializer !== tagged || declaration.type === undefined
      || !ts.isTypeReferenceNode(declaration.type) || !ts.isIdentifier(declaration.type.typeName)
      || !is_official_hson_package_binding(declaration.type.typeName, "HsonData", document.checker)
      || declaration.type.typeArguments?.length !== 1) return undefined;
    const query = declaration.type.typeArguments[0];
    if (query === undefined || !ts.isTypeQueryNode(query) || !ts.isIdentifier(query.exprName)) return undefined;
    const symbol = document.checker.getSymbolAtLocation(query.exprName);
    const producer = symbol?.declarations?.length === 1 ? symbol.declarations[0] : undefined;
    if (producer === undefined || !ts.isVariableDeclaration(producer) || producer.getSourceFile() !== document.file
      || !ts.isIdentifier(producer.name) || producer.initializer === undefined || !ts.isTaggedTemplateExpression(producer.initializer)
      || !ts.isNoSubstitutionTemplateLiteral(producer.initializer.template)
      || !official_schema_tag(producer.initializer, document.checker)) return undefined;
    const raw = producer.initializer.template.getText(document.file).slice(1, -1);
    if (!this.schemas.has(raw)) {
      const compiled = compile_hson_schema(raw);
      this.schemas.set(raw, compiled.ok ? compiled.value : null);
      if (this.schemas.size > 16) {
        const oldest = this.schemas.keys().next().value;
        if (oldest !== undefined) this.schemas.delete(oldest);
      }
    }
    const compiled = this.schemas.get(raw);
    return compiled ?? undefined;
  }
}

function official_schema_tag(tagged: ts.TaggedTemplateExpression, checker: ts.TypeChecker): boolean {
  return ts.isPropertyAccessExpression(tagged.tag) && tagged.tag.name.text === "schema"
    && ts.isIdentifier(tagged.tag.expression) && is_official_hson_package_binding(tagged.tag.expression, "Hson", checker);
}

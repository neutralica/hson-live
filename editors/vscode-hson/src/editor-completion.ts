import ts from "typescript";
import { create_hson_source_program, discover_hson_tagged_templates, type HsonTaggedTemplateDiscoveryResult } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { compile_hson_schema, type CompiledHsonSchema } from "../../../src/internal/hson-schema/compiler.js";
import { query_hson_editor_context, type HsonEditorCandidate } from "../../../src/internal/editor-introspection/query.js";
import { interpolation_site } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { resolve_hson_schema_annotation } from "../../../src/internal/hson-schema/schema-annotation.js";
import { resolve_immutable_schema } from "../../../src/internal/hson-schema/schema-identity.js";
import { discover_hson_schema_declarations } from "../../../src/internal/hson-schema/schema-discovery.js";
import { schema_reference_completion } from "./hson-schema-symbols.js";
import type { HsonTemplateSlot } from "../../../src/api/transform/parsers/tokenize-hson.js";

export type HostCompletion = Readonly<{ candidate: HsonEditorCandidate; range: Readonly<{ start: number; end: number }> }>;
type CachedDocument = Readonly<{
  version: number; text: string; program: ts.Program; file: ts.SourceFile; checker: ts.TypeChecker; discovery: HsonTaggedTemplateDiscoveryResult;
  schemaDeclarations: Map<ts.SourceFile, ReturnType<typeof discover_hson_schema_declarations>>;
}>;

/** Version-scoped discovery and bounded Schema compilation, with no workspace execution. */
export class HsonEditorCompletionCache {
  private readonly documents = new Map<string, CachedDocument>();
  private readonly schemas = new Map<string, CompiledHsonSchema | null>();
  private sourceProgram: ts.Program | undefined;
  clear(): void { this.documents.clear(); this.schemas.clear(); this.sourceProgram = undefined; }
  forget(fileName: string): void { this.documents.delete(fileName); }
  complete(fileName: string, text: string, version: number, offset: number, sourceProgram?: ts.Program): readonly HostCompletion[] {
    if (!/\.(?:[cm]?ts|tsx)$/.test(fileName) || offset < 0 || offset > text.length) return [];
    // A producer edit can change every consumer without changing its text.
    // Retain discovery/checkers only for the current authored program.
    if (this.sourceProgram !== sourceProgram) {
      this.documents.clear();
      this.sourceProgram = sourceProgram;
    }
    let cached = this.documents.get(fileName);
    if (cached === undefined || cached.version !== version || cached.text !== text || sourceProgram !== undefined && cached.program !== sourceProgram) {
      const program = sourceProgram ?? create_hson_source_program(fileName, text);
      const file = program.getSourceFile(fileName);
      if (file === undefined || file.text !== text) return [];
      cached = { version, text, program, file, checker: program.getTypeChecker(), discovery: discover_hson_tagged_templates(fileName, text, program), schemaDeclarations: new Map() };
      this.documents.set(fileName, cached);
      if (this.documents.size > 8) {
        const oldest = this.documents.keys().next().value;
        if (oldest !== undefined) this.documents.delete(oldest);
      }
    }
    const interpolated = cached.discovery.interpolated.find(source => offset >= source.bodyRange.start && offset <= source.bodyRange.end);
    const site = interpolated ?? cached.discovery.sources.find(source => offset >= source.bodyRange.start && offset <= source.bodyRange.end);
    if (site === undefined) return [];
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
      // Role observation needs every boundary; the checkpoint filters at its cursor.
      source = built; cursor = segment.start + local; slots = mutableSlots;
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
      map = range => range.start < 0 || range.end < range.start || range.end > source.length ? undefined
        : { start: site.bodyRange.start + range.start, end: site.bodyRange.start + range.end };
    }
    const schema = site.authoringKind === "data" ? this.resolveSchema(cached, site.tagRange.start) : undefined;
    if (schema === null) return [];
    const result = query_hson_editor_context({ mode: site.authoringKind, source, cursor, slots, schema });
    const range = result.checkpoint?.range === undefined ? undefined : map(result.checkpoint.range);
    return range === undefined ? [] : result.candidates.map(candidate => ({ candidate, range }));
  }

  private resolveSchema(document: CachedDocument, tagStart: number): CompiledHsonSchema | null | undefined {
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
    const annotation = resolve_hson_schema_annotation(ts, document.checker, declaration.type);
    if (annotation === undefined) return undefined;
    if (annotation.schema === undefined || annotation.kind !== "data" && annotation.kind !== "hson") return null;
    const source = resolve_immutable_schema(ts, document.checker, annotation.schema, producer => {
      const file = producer.getSourceFile();
      if (file.isDeclarationFile || document.program.isSourceFileFromExternalLibrary(file)
        || file.fileName.replaceAll("\\", "/").split("/").includes(".hson")) return undefined;
      let declarations = document.schemaDeclarations.get(file);
      if (declarations === undefined) {
        declarations = discover_hson_schema_declarations(ts, file, document.checker);
        document.schemaDeclarations.set(file, declarations);
      }
      return declarations.find(found => found.declaration === producer && found.eligible)?.source;
    });
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

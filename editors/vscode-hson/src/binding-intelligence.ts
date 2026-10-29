import { create_hson_source_program, discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { discover_static_from_hson_sources } from "../../../src/internal/embedded-hson/discover-static-from-hson-sources.js";
import { map_static_hson_range } from "../../../src/internal/embedded-hson/static-hson-source.js";
import { hson_interpolation_roles, type HsonTemplateSlot } from "../../../src/api/transform/parsers/tokenize-hson.js";
import { analyze_part_definition } from "../../../src/internal/part-definition.js";
import { project_part_bindings, parse_part_binding_source, type PartBindingSources, type PartBindingDeclaration } from "../../../src/internal/editor-introspection/part-bindings.js";
import type { PartSourceLocation } from "../../../src/internal/hson-schema/part-source.js";
import { interpolation_site, map_interpolation_range, type GeneratedSegment } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { markdown_hson_fence_regions } from "./markdown-fence-marker.js";
import type { HsonHighlight } from "./highlighting.js";

export type BindingDocument = Readonly<{ uri: string; fileName: string; languageId: string; version: number; text: string }>;
export type BindingSnapshot = Readonly<{
  document: BindingDocument;
  sources: readonly PartBindingSources[];
  tags?: ReturnType<typeof discover_hson_tagged_templates>;
  calls?: ReturnType<typeof discover_static_from_hson_sources>;
}>;
const empty: PartBindingSources = { declarations: [], references: [] };
function standalone(source: string, map: (range: { start: number; end: number }) => PartSourceLocation | undefined,
  slots: readonly HsonTemplateSlot[] = []): PartBindingSources {
  try {
    if (slots.length && !hson_interpolation_roles(source, "document", slots).every(role => role === "quoted-string")) return empty;
    const { root, provenance } = parse_part_binding_source(source, slots);
    const analysis = analyze_part_definition(root, () => {});
    return project_part_bindings(root, analysis, provenance, source, map);
  } catch { return empty; } // Incomplete/unavailable authoring retains TextMate's lexical fallback.
}

/** One bounded document-version snapshot shared by highlighting and navigation.
 * Compiler facts are also memoized by immutable Program for diagnostics/completion. */
export class HsonBindingCache {
  private readonly documents = new Map<string, BindingSnapshot>();
  clear(): void { this.documents.clear(); }
  forget(uri: string): void { this.documents.delete(uri); }
  get(document: BindingDocument): BindingSnapshot {
    const previous = this.documents.get(document.uri);
    if (previous?.document.version === document.version && previous.document.text === document.text
      && previous.document.languageId === document.languageId && previous.document.fileName === document.fileName) return previous;
    const { text, fileName, languageId } = document;
    const sources: PartBindingSources[] = [];
    let snapshot: BindingSnapshot = { document, sources };
    if (languageId === "hson" || languageId === "markdown") {
      const regions = languageId === "hson" ? [{ bodyRange: { start: 0, end: text.length } }] : markdown_hson_fence_regions(text);
      for (const { bodyRange } of regions) sources.push(standalone(text.slice(bodyRange.start, bodyRange.end), range =>
        ({ file: fileName, start: range.start + bodyRange.start, end: range.end + bodyRange.start, precision: "exact" })));
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
      const program = create_hson_source_program(fileName, text);
      const tags = discover_hson_tagged_templates(fileName, text, program);
      const calls = discover_static_from_hson_sources(fileName, text, program);
      for (const tag of [...tags.sources.map(source => ({ ...source, substitutionRanges: [], expressionRanges: [] })), ...tags.interpolated]) {
        if (tag.authoringKind !== "document" && tag.authoringKind !== "canonical") continue;
        const site = interpolation_site(tag, fileName);
        let source = "";
        const segments: GeneratedSegment[] = [], slots: HsonTemplateSlot[] = [];
        site.literals.forEach((literal, index) => {
          const start = source.length;
          source += literal.raw;
          segments.push({ kind: "literal", index, start, end: source.length });
          if (index < site.expressions.length) slots.push({ offset: source.length, substitution: index });
        });
        sources.push(standalone(source, range => {
          const mapped = map_interpolation_range(site, segments, { ...range, precision: "exact" });
          return mapped.kind !== "literal-exact" ? undefined : { file: fileName, ...mapped.range, precision: "exact" };
        }, slots));
      }
      for (const call of calls.sources) {
        if (call.literalRange.start < call.callRange.start || call.literalRange.end > call.callRange.end) continue;
        sources.push(standalone(call.runtimeText, range => {
          const mapped = map_static_hson_range(call, range);
          return mapped === undefined ? undefined : { file: fileName, ...mapped, precision: "exact" };
        }));
      }
      snapshot = { document, sources, tags, calls };
    }
    this.documents.set(document.uri, snapshot);
    if (this.documents.size > 8) this.documents.delete(this.documents.keys().next().value!);
    return snapshot;
  }
}

export function binding_definition_at(snapshot: BindingSnapshot, offset: number) {
  for (const source of snapshot.sources) for (const reference of source.references) {
    if (reference.resolution === "resolved" && reference.root.start <= offset && offset < reference.root.end && reference.declaration !== undefined) {
      return { uri: snapshot.document.uri, origin: reference.root, target: reference.declaration.location };
    }
  }
  return undefined;
}

function binding_token(binding: PartBindingDeclaration, range: PartSourceLocation): HsonHighlight {
  // Match each declaration's existing modifier too, so explicit user rules and
  // active-theme fallbacks apply identically to its local reference roots.
  const receiving = binding.origin === "receiving";
  return { range, type: receiving ? "hsonReceiving" : "hsonIteration", scopes: [],
    modifiers: [receiving ? "hsonQualifier" : "hsonLocalName"] };
}
export function binding_highlights(snapshot: BindingSnapshot): readonly HsonHighlight[] {
  const result: HsonHighlight[] = [];
  for (const source of snapshot.sources) {
    for (const declaration of source.declarations) result.push(binding_token(declaration, declaration.location));
    for (const reference of source.references) if (reference.resolution === "resolved" && reference.declaration !== undefined) {
      result.push(binding_token(reference.declaration, reference.root));
    }
  }
  return result.sort((a, b) => a.range.start - b.range.start);
}

/** Replace only declaration/root intervals, retaining sigils, members and punctuation. */
export function overlay_binding_highlights(lexical: readonly HsonHighlight[], bindings: readonly HsonHighlight[]): readonly HsonHighlight[] {
  const result: HsonHighlight[] = [];
  let index = 0;
  for (const token of lexical) {
    while (index < bindings.length && bindings[index]!.range.end <= token.range.start) index++;
    let start = token.range.start;
    for (let at = index; at < bindings.length && bindings[at]!.range.start < token.range.end; at++) {
      const binding = bindings[at]!;
      if (binding.range.start > start) result.push({ ...token, range: { start, end: binding.range.start } });
      start = Math.max(start, binding.range.end);
    }
    if (start < token.range.end) result.push({ ...token, range: { start, end: token.range.end } });
  }
  return [...result, ...bindings].sort((a, b) => a.range.start - b.range.start);
}

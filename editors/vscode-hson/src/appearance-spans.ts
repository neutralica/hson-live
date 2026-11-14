import type { IGrammar } from "vscode-textmate";
import { hson_highlights, hson_literal_highlights, type HsonHighlight } from "./highlighting.js";
import { HsonBindingCache, binding_highlights, overlay_binding_highlights, type BindingDocument } from "./binding-intelligence.js";
import { markdown_hson_fence_regions } from "./markdown-fence-marker.js";

export const appearanceRoles = ["attributeString", "contentString", "attributeQuotes", "contentQuotes"] as const;
export type AppearanceRole = typeof appearanceRoles[number];
export type AppearanceColors = Record<AppearanceRole, string>;
export type AppearanceSpan = Readonly<{ role: AppearanceRole; range: { start: number; end: number } }>;

export function isAppearanceRole(value: unknown): value is AppearanceRole {
  return appearanceRoles.some(role => role === value);
}

/** Validate color syntax only. Identical, transparent and low-contrast colors are valid. */
export function appearanceColor(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return undefined;
  return value.length < 6 ? "#" + [...value.slice(1)].map(char => char + char).join("") : value;
}

function roleFor(token: HsonHighlight): AppearanceRole | undefined {
  // Bound names, references, selector coordinates, escapes and native holes
  // keep their existing owners. Even strings nested in a reference are excluded.
  if (token.scopes.some(scope => ["meta.part.local.hson", "meta.part.incoming.hson", "meta.interpolation.hson"].includes(scope))) return;
  const attribute = token.scopes.includes("meta.attribute.value.hson") || token.scopes.includes("string.unquoted.attribute-value.hson");
  const content = token.scopes.includes("meta.content.value.hson");
  if (!attribute && !content) return;
  if (token.type === "hsonString") return attribute ? "attributeString" : "contentString";
  if (token.type === "hsonQuote") return attribute ? "attributeQuotes" : "contentQuotes";
  return;
}

/** Reusable, versioned classification. Appearance changes never enter this cache key. */
export class AppearanceSpanCache {
  private readonly entries = new Map<string, { document: BindingDocument; spans: readonly AppearanceSpan[] }>();
  constructor(private readonly bindings = new HsonBindingCache()) {}
  clear(): void { this.entries.clear(); }
  forget(uri: string): void { this.entries.delete(uri); }
  get(grammar: IGrammar, document: BindingDocument): readonly AppearanceSpan[] {
    const previous = this.entries.get(document.uri);
    if (previous && previous.document.version === document.version && previous.document.text === document.text
      && previous.document.languageId === document.languageId && previous.document.fileName === document.fileName) return previous.spans;
    const snapshot = this.bindings.get(document);
    const { text, languageId } = document;
    let lexical: readonly HsonHighlight[] = [];
    if (languageId === "hson") lexical = hson_literal_highlights(grammar, text);
    else if (languageId === "markdown") lexical = markdown_hson_fence_regions(text).flatMap(({ bodyRange }) =>
      hson_literal_highlights(grammar, text.slice(bodyRange.start, bodyRange.end)).map(token => ({ ...token,
        range: { start: token.range.start + bodyRange.start, end: token.range.end + bodyRange.start } })));
    else if (languageId === "typescript" || languageId === "typescriptreact") lexical = hson_highlights(grammar, document.fileName, text, snapshot);
    const spans = overlay_binding_highlights(lexical, binding_highlights(snapshot)).flatMap(token => {
      const role = roleFor(token);
      return role ? [{ role, range: token.range }] : [];
    });
    this.entries.set(document.uri, { document, spans });
    if (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!);
    return spans;
  }
}

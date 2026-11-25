import type { IGrammar } from "vscode-textmate";
import { embedded_binding_highlights, hson_literal_highlights, type HsonHighlight } from "./highlighting.js";
import { HsonBindingCache, binding_highlights, overlay_binding_highlights, type BindingDocument, type BindingSnapshot } from "./binding-intelligence.js";
import { markdown_hson_fence_regions } from "./markdown-fence-marker.js";

import { roleCatalog, type Family } from "./appearance-model.js";
import { syntaxExamplePath, tokenAppearancePaths, segmentBindings } from "./appearance-bindings.js";
export { appearanceColor } from "./appearance-model.js";
export const appearanceRoles = Object.keys(roleCatalog);
export type AppearanceRole = string;
export type AppearanceColors = Record<string,string>;
export type AppearanceSpan = Readonly<{role: string; family: Family; range: {start:number;end:number}}>;
export function isAppearanceRole(value: unknown): value is string {return typeof value === 'string' && Object.hasOwn(roleCatalog,value);}
function roleFor(token: HsonHighlight): string | undefined {
  if (token.type === 'hsonString' && token.scopes.includes('string.unquoted.attribute-value.hson')) return 'value.attributeString';
  const selector = [token.type,...token.modifiers].join('.');
  return segmentBindings.find(s=>s.selector===selector)?.id ?? syntaxExamplePath(token.scopes) ?? tokenAppearancePaths[token.type];
}

/** The shared binding snapshot is scoped to the current document text. */
export class AppearanceSpanCache {
  private readonly entries = new Map<string, { snapshot: BindingSnapshot; family: Family; spans: readonly AppearanceSpan[] }>();
  constructor(private readonly bindings = new HsonBindingCache()) {}
  clear(): void { this.entries.clear(); }
  forget(uri: string): void { this.entries.delete(uri); }
  get(grammar: IGrammar, document: BindingDocument, family: Family = 'all'): readonly AppearanceSpan[] {
    const snapshot = this.bindings.get(document);
    const previous = this.entries.get(document.uri);
    if (previous?.snapshot === snapshot && previous.family === family) return previous.spans;
    const { text, languageId } = document;
    let lexical: readonly HsonHighlight[] = [];
    if (languageId === "hson") lexical = hson_literal_highlights(grammar, text);
    else if (languageId === "markdown") lexical = markdown_hson_fence_regions(text).flatMap(({ bodyRange }) =>
      hson_literal_highlights(grammar, text.slice(bodyRange.start, bodyRange.end)).map(token => ({ ...token,
        range: { start: token.range.start + bodyRange.start, end: token.range.end + bodyRange.start } })));
    const typescript = languageId === "typescript" || languageId === "typescriptreact";
    const tokens = typescript ? embedded_binding_highlights(grammar, snapshot)
      : overlay_binding_highlights(lexical, binding_highlights(snapshot));
    const regions = [...snapshot.tags?.sources ?? [], ...snapshot.tags?.interpolated ?? []];
    const spans = tokens.flatMap(token => {
      const role = roleFor(token);
      const region = regions.filter(source => source.bodyRange.start <= token.range.start && source.bodyRange.end >= token.range.end)
        .sort((a,b)=>(a.bodyRange.end-a.bodyRange.start)-(b.bodyRange.end-b.bodyRange.start))[0];
      const selected: Family = region?.authoringKind === 'document' ? 'document' : region?.authoringKind === 'data' || region?.authoringKind === 'schema' ? 'data' : family;
      return role ? [{ role, range: token.range, family: selected }] : [];
    });
    this.entries.set(document.uri, { snapshot, family, spans });
    if (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!);
    return spans;
  }
}

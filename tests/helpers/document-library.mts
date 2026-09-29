import type { BrowserRealizationHtml } from "../../src/api/ssr/ssr.types.ts";

export function document_html(library: Readonly<{ mode: string; render?: () => BrowserRealizationHtml }>) {
  if (library.mode !== "document" || library.render === undefined) throw new Error("Expected document Library.");
  return library.render();
}

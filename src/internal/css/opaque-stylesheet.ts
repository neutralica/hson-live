import type { DocumentCssRecord } from "../../types/document-css.types.js";

/** Text is data. CSS interpretation belongs exclusively to the browser. */
export function opaque_document_stylesheet(text: string): DocumentCssRecord {
  if (typeof text !== "string") throw new TypeError("Stylesheet requires text.");
  return { rules: [], properties: [], keyframes: [], order: [{ kind: "text", text }] };
}

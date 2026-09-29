import type { HsonNode } from "../core/types.js";
import type { AuthorityProjectionSnapshot } from "../types/locus.projection.types.js";
import type { BrowserRealizationHtml } from "../api/ssr/ssr.types.js";
import { plan_browser_realization } from "./browser-realization/browser-realization-plan.js";
import { plan_managed_document_css } from "./browser-realization/managed-document-css.js";
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "./css/portable-document-stylesheet.js";
import { serialize_browser_realization } from "./browser-realization/browser-realization-serialize.js";
import { DocumentSsrError } from "./document-cut.error.js";
import { decode_hosted_root } from "../api/livemap/livemap.hosted.js";

export function realize_document(root: HsonNode, css = ""): BrowserRealizationHtml {
  try {
    const plan = plan_managed_document_css(plan_browser_realization(root), css);
    if (plan.roots.length !== 1 || plan.roots[0]?.kind !== "element") {
      throw new Error("Document SSR requires exactly one ordinary canonical document root.");
    }
    return serialize_browser_realization(plan) as BrowserRealizationHtml;
  } catch (cause) {
    throw new DocumentSsrError(
      "realize",
      "The captured canonical document is not compatible with browser-parser realization.",
      cause,
    );
  }
}

/** Hosted client egress: both siblings are derived from the admitted session snapshot. */
export function cut_hosted_projection(
  snapshot: AuthorityProjectionSnapshot,
  requested?: string,
): Readonly<{ html: BrowserRealizationHtml; data: AuthorityProjectionSnapshot; document: string; revision: number; projectionDigest: string }> {
  const selected = requested ?? snapshot.htmlDocument;
  if (typeof selected !== "string") {
    throw new DocumentSsrError("select", "A session HTML document selection is required.");
  }
  const library = snapshot.libraries.find((entry) => entry.name === selected && entry.mode === "document");
  if (library === undefined) {
    throw new DocumentSsrError("select", "The requested session HTML document is unavailable.");
  }
  let root: HsonNode;
  try {
    root = decode_hosted_root(library.root);
  } catch (cause) {
    throw new DocumentSsrError("bootstrap", "The session document could not be decoded.", cause);
  }
  const css = render_portable_document_stylesheet(decode_portable_document_stylesheet(library.css));
  return Object.freeze({ html: realize_document(root, css), data: snapshot, document: selected,
    revision: snapshot.revision, projectionDigest: snapshot.projectionDigest });
}

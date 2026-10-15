import type { HsonNode } from "../core/types.js";
import type { AuthorityProjectionSnapshot } from "../types/locus.projection.types.js";
import type { BrowserRealizationHtml } from "../api/ssr/ssr.types.js";
import { plan_browser_realization } from "./browser-realization/browser-realization-plan.js";
import { plan_managed_document_css } from "./browser-realization/managed-document-css.js";
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "./css/portable-document-stylesheet.js";
import { serialize_browser_realization } from "./browser-realization/browser-realization-serialize.js";
import { DocumentSsrError } from "./document-cut.error.js";
import type { PortableDocumentQuads } from "../types/livemap.types.js";
import { plan_portable_document_subjects } from "./browser-realization/portable-document-subjects.js";
import { decode_hosted_root, HOSTED_MAX_SNAPSHOT_BYTES } from "../api/livemap/livemap.hosted.js";
import { document_css_subject_identities } from "./css/css-identity-translation.js";

export function realize_document(root: HsonNode, css = "", subjects?: Readonly<{ quads?: PortableDocumentQuads }>): BrowserRealizationHtml {
  try {
    const browser = plan_browser_realization(root);
    const addressed = subjects === undefined ? browser : plan_portable_document_subjects(browser, root, subjects.quads);
    const plan = plan_managed_document_css(addressed, css);
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
  selected: string,
): Readonly<{ html: BrowserRealizationHtml; libs: AuthorityProjectionSnapshot; document: string }> {
  if (typeof selected !== "string") {
    throw new DocumentSsrError("select", "A session HTML document selection is required.");
  }
  const library = snapshot.libraries.find((entry) => entry.name === selected && entry.mode === "document");
  if (library === undefined) {
    throw new DocumentSsrError("select", "The requested session HTML document is unavailable.");
  }
  let root: HsonNode;
  try {
    root = decode_hosted_root(library.root, HOSTED_MAX_SNAPSHOT_BYTES);
  } catch (cause) {
    throw new DocumentSsrError("bootstrap", "The session document could not be decoded.", cause);
  }
  const css = render_portable_document_stylesheet(decode_portable_document_stylesheet(library.css));
  return Object.freeze({ html: realize_document(root, css,
    document_css_subject_identities(library.css!, "inbound").length ? { quads: library.quads } : undefined),
    libs: snapshot, document: selected });
}

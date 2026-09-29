import type {
  LiveMap,
} from "../../types/livemap.types.js";
import type { Locus } from "../../types/locus.types.js";
import { is_locus_libraries_snapshot_authority_internal } from "../locus/locus.libraries-snapshot.js";
import type {
  HostedLibrariesDocumentSsr,
} from "./ssr.types.js";

/** Compose browser HTML and projected authority state from one authorized session cut. */
export function render_hosted_document<TMap extends LiveMap>(
  options: Readonly<{ authority: Locus<TMap>; sessionId: string; document?: string }>,
): HostedLibrariesDocumentSsr;
export function render_hosted_document(
  options: Readonly<{
    authority: Locus<LiveMap>;
    sessionId: string;
    document?: string;
  }>,
): HostedLibrariesDocumentSsr {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("render_hosted_document options must be an object.");
  }
  const authority = options.authority;
  if (!is_locus_libraries_snapshot_authority_internal(authority) || typeof authority.cut !== "function"
    || typeof options.sessionId !== "string" || options.sessionId.length === 0) {
    throw new TypeError("render_hosted_document requires an authorized Locus session.");
  }
  const cut = authority.cut(options.sessionId, options.document);
  return Object.freeze({ html: cut.html, bootstrap: cut.data, document: cut.document,
    revision: cut.revision, projectionDigest: cut.projectionDigest });
}

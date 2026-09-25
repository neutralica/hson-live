import type {
  DocumentLiveMap,
  LiveMapLibraries,
} from "../../types/livemap.types.js";
import type { Locus } from "../../types/locus.types.js";
import { is_locus_libraries_snapshot_authority_internal } from "../locus/locus.libraries-snapshot.js";
import { install_libraries_snapshot, is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { decode_hosted_root } from "../livemap/livemap.hosted.js";
import { DocumentSsrError } from "./ssr.error.js";
import { render_local_document, render_local_libraries } from "../../internal/document-cut.js";
import type {
  DocumentSsr,
  LibrariesDocumentSsr,
  HostedLibrariesDocumentSsr,
} from "./ssr.types.js";

type SsrTestPoint =
  | "local-after-capture"
  | "hosted-after-snapshot"
  | "local-libraries-after-capture"
  | "hosted-libraries-after-snapshot";

let testHook: ((point: SsrTestPoint) => void) | undefined;

/** @internal Deterministic same-cut race seam; not reachable from public entrypoints. */
export function set_document_ssr_hook_for_tests(
  hook: ((point: SsrTestPoint) => void) | undefined,
): void {
  testHook = hook;
}

function require_options(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} options must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Compose browser-realization HTML and exact bootstrap state from one local capture. */
export function render_document(options: Readonly<{ map: DocumentLiveMap }>): DocumentSsr;
export function render_document(options: Readonly<{
  map: LiveMapLibraries;
  document?: string;
}>): LibrariesDocumentSsr;
export function render_document(options: Readonly<{
  map: DocumentLiveMap | LiveMapLibraries;
  document?: string;
}>): DocumentSsr | LibrariesDocumentSsr {
  require_options(options, "render_document");
  const map = options.map;
  if (is_public_multi_library_livemap(map)) {
    return render_local_libraries(map as LiveMapLibraries, options.document,
      install_libraries_snapshot, decode_hosted_root,
      () => testHook?.("local-libraries-after-capture"));
  }
  const documentMap = map as DocumentLiveMap;
  if (typeof documentMap !== "object" || documentMap === null
    || documentMap.mode !== "document" || typeof documentMap.capture !== "function") {
    throw new TypeError("render_document requires one DocumentLiveMap.");
  }

  return render_local_document(documentMap, () => testHook?.("local-after-capture"));
}

/** Compose browser HTML and projected authority state from one authorized session cut. */
export function render_hosted_document<TMap extends LiveMapLibraries>(
  options: Readonly<{ authority: Locus<TMap>; sessionId: string; document?: string }>,
): HostedLibrariesDocumentSsr;
export function render_hosted_document(
  options: Readonly<{
    authority: Locus<LiveMapLibraries>;
    sessionId: string;
    document?: string;
  }>,
): HostedLibrariesDocumentSsr {
  require_options(options, "render_hosted_document");
  const authority = options.authority;
  if (!is_locus_libraries_snapshot_authority_internal(authority) || typeof authority.cut !== "function"
    || typeof options.sessionId !== "string" || options.sessionId.length === 0) {
    throw new TypeError("render_hosted_document requires an authorized Locus session.");
  }
  const cut = authority.cut(options.sessionId, options.document);
  testHook?.("hosted-libraries-after-snapshot");
  return Object.freeze({ html: cut.html, bootstrap: cut.data, document: cut.document,
    revision: cut.revision, projectionDigest: cut.projectionDigest });
}

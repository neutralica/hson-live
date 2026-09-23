import type {
  DocumentLiveMap,
  LiveMapLibraries,
} from "../../types/livemap.types.js";
import type { LocusMultiLibrary } from "../../types/locus.types.js";
import {
  install_locus_authority_snapshot_internal,
  with_locus_bootstrap_snapshot,
  type LocusBootstrapAuthority,
} from "../locus/locus.bootstrap.js";
import {
  capture_locus_libraries_snapshot_internal,
  is_locus_libraries_snapshot_authority_internal,
} from "../locus/locus.libraries-snapshot.js";
import { install_libraries_snapshot, is_public_multi_library_livemap, make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import { decode_hosted_root } from "../livemap/livemap.hosted.js";
import { DocumentSsrError } from "./ssr.error.js";
import { cut_local_document, cut_local_libraries, cut_hosted_libraries, cut_hosted_snapshot, cut_hosted_authority } from "../../internal/document-cut.js";
import type {
  DocumentSsr,
  HostedDocumentSsr,
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
    const cut = cut_local_libraries(map as LiveMapLibraries, options.document,
      install_libraries_snapshot, decode_hosted_root,
      () => testHook?.("local-libraries-after-capture"));
    return Object.freeze({ html: cut.html, bootstrap: cut.data, document: cut.document });
  }
  const documentMap = map as DocumentLiveMap;
  if (typeof documentMap !== "object" || documentMap === null
    || documentMap.mode !== "document" || typeof documentMap.capture !== "function") {
    throw new TypeError("render_document requires one DocumentLiveMap.");
  }

  const cut = cut_local_document(documentMap, () => testHook?.("local-after-capture"));
  return Object.freeze({ html: cut.html, bootstrap: cut.data });
}

/** Compose browser-realization HTML and semantic recovery state from one hosted cut. */
export function render_hosted_document(
  options: Readonly<{ authority: LocusBootstrapAuthority }>,
): HostedDocumentSsr;
export function render_hosted_document<TMap extends LiveMapLibraries>(
  options: Readonly<{ authority: LocusMultiLibrary<TMap>; document?: string }>,
): HostedLibrariesDocumentSsr;
export function render_hosted_document(
  options: Readonly<{
    authority: LocusBootstrapAuthority | object;
    document?: string;
  }>,
): HostedDocumentSsr | HostedLibrariesDocumentSsr {
  require_options(options, "render_hosted_document");
  const authority = options.authority;
  if (is_locus_libraries_snapshot_authority_internal(authority)) {
    const cut = cut_hosted_libraries(() => capture_locus_libraries_snapshot_internal(authority),
      options.document, make_livemap_hosted_mirror_from_snapshot_internal, decode_hosted_root,
      () => testHook?.("hosted-libraries-after-snapshot"));
    return Object.freeze({ html: cut.html, bootstrap: cut.data, document: cut.document });
  }
  const soloAuthority = authority as LocusBootstrapAuthority;
  if (
    typeof soloAuthority !== "object"
    || soloAuthority === null
    || typeof soloAuthority.stream !== "object"
    || soloAuthority.stream === null
    || typeof soloAuthority.stream.logicalMapId !== "string"
    || typeof soloAuthority.recovery !== "object"
    || soloAuthority.recovery === null
    || typeof soloAuthority.recovery.plan !== "function"
  ) {
    throw new TypeError("render_hosted_document requires one Locus bootstrap authority.");
  }

  const cut = cut_hosted_authority(() => with_locus_bootstrap_snapshot(soloAuthority, (snapshot) =>
    cut_hosted_snapshot(snapshot, install_locus_authority_snapshot_internal,
      () => testHook?.("hosted-after-snapshot"))));
  return Object.freeze({ html: cut.html, bootstrap: cut.data });
}

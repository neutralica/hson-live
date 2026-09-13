import type {
  DocumentLiveMap,
  DocumentLiveMapCapture,
  HostedLiveMapLibrariesSnapshot,
  LiveMapLibraries,
  LiveMapLibrariesSnapshot,
} from "../../types/livemap.types.js";
import type { LocusMultiLibrary } from "../../types/locus.types.js";
import type { LocusSnapshotEnvelope } from "../../types/locus.representation.types.js";
import {
  install_locus_snapshot,
  with_locus_bootstrap_snapshot,
  type LocusBootstrapAuthority,
} from "../locus/locus.bootstrap.js";
import {
  capture_locus_libraries_snapshot_internal,
  install_locus_libraries_snapshot,
  is_locus_libraries_snapshot_authority_internal,
} from "../locus/locus.libraries-snapshot.js";
import { install_libraries_snapshot, is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { decode_hosted_root } from "../livemap/livemap.hosted.js";
import { plan_browser_realization } from "../../internal/browser-realization/browser-realization-plan.js";
import { serialize_browser_realization } from "../../internal/browser-realization/browser-realization-serialize.js";
import { DocumentSsrError } from "./ssr.error.js";
import type {
  BrowserRealizationHtml,
  DocumentSsr,
  HostedDocumentSsr,
  LibrariesDocumentSsr,
  HostedLibrariesDocumentSsr,
} from "./ssr.types.js";

type DocumentSnapshot = Extract<LocusSnapshotEnvelope, { hson: string }>
  & Readonly<{ mode: "document" }>;
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

function branded_html(value: string): BrowserRealizationHtml {
  return value as BrowserRealizationHtml;
}

function require_options(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} options must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function validate_capture(capture: DocumentLiveMapCapture): DocumentLiveMapCapture<"document"> {
  if (
    typeof capture !== "object"
    || capture === null
    || capture.kind !== "hson-document"
    || capture.mode !== "document"
    || !Number.isSafeInteger(capture.rev)
    || capture.rev < 0
    || typeof capture.root !== "object"
    || capture.root === null
  ) {
    throw new TypeError("Document SSR capture is not a valid document capture.");
  }
  return capture;
}

function realize(capture: DocumentLiveMapCapture<"document">): BrowserRealizationHtml {
  try {
    const plan = plan_browser_realization(capture.root);
    if (plan.roots.length !== 1 || plan.roots[0]?.kind !== "element") {
      throw new Error("Document SSR requires exactly one ordinary canonical document root.");
    }
    return branded_html(serialize_browser_realization(plan));
  } catch (cause) {
    throw new DocumentSsrError(
      "realize",
      "The captured canonical document is not compatible with browser-parser realization.",
      cause,
    );
  }
}

function selected_document(snapshot: LiveMapLibrariesSnapshot, requested: unknown): string {
  if (requested !== undefined && typeof requested !== "string") {
    throw new TypeError("Aggregate document selection must be a public Library name string.");
  }
  const documents = snapshot.registry.libraries.filter(
    (entry) => entry.scope !== "hson-internal" && entry.mode === "document",
  );
  if (requested === undefined) {
    if (documents.length === 0) {
      throw new DocumentSsrError("select", "The Libraries cut contains no selectable public document Library.");
    }
    if (documents.length !== 1) {
      throw new DocumentSsrError("select", "The Libraries cut contains multiple public document Libraries; document is required.");
    }
    return documents[0]!.name;
  }
  const selected = snapshot.registry.libraries.find((entry) => entry.name === requested);
  if (selected === undefined || selected.scope === "hson-internal" || selected.mode !== "document") {
    throw new DocumentSsrError("select", `Library ${JSON.stringify(requested)} is not a selectable public document.`);
  }
  return requested;
}

function capture_from_libraries_snapshot(
  snapshot: LiveMapLibrariesSnapshot,
  document: string,
  hosted?: HostedLiveMapLibrariesSnapshot,
): DocumentLiveMapCapture<"document"> {
  try {
    if (hosted === undefined) install_libraries_snapshot(snapshot);
    else install_locus_libraries_snapshot(hosted);
    const selected = snapshot.libraries.find((entry) => entry.name === document);
    if (selected === undefined || selected.mode !== "document") {
      throw new Error("Selected snapshot Library did not decode as a document.");
    }
    return validate_capture(Object.freeze({
      kind: "hson-document",
      mode: "document",
      rev: snapshot.revision,
      root: decode_hosted_root(selected.root),
    }));
  } catch (cause) {
    if (cause instanceof DocumentSsrError) throw cause;
    throw new DocumentSsrError(
      "bootstrap",
      "The captured semantic Libraries snapshot could not be decoded.",
      cause,
    );
  }
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
    let snapshot: LiveMapLibrariesSnapshot;
    try {
      snapshot = (map as LiveMapLibraries).capture();
    } catch (cause) {
      throw new DocumentSsrError("capture", "The complete Libraries cut could not be captured.", cause);
    }
    testHook?.("local-libraries-after-capture");
    const document = selected_document(snapshot, options.document);
    const capture = capture_from_libraries_snapshot(snapshot, document);
    return Object.freeze({ html: realize(capture), bootstrap: snapshot, document });
  }
  const documentMap = map as DocumentLiveMap;
  if (typeof documentMap !== "object" || documentMap === null
    || documentMap.mode !== "document" || typeof documentMap.capture !== "function") {
    throw new TypeError("render_document requires one DocumentLiveMap.");
  }

  let capture: DocumentLiveMapCapture<"document">;
  try {
    capture = validate_capture(documentMap.capture());
  } catch (cause) {
    if (cause instanceof DocumentSsrError) throw cause;
    throw new DocumentSsrError("capture", "The document cut could not be captured.", cause);
  }

  testHook?.("local-after-capture");
  return Object.freeze({ html: realize(capture), bootstrap: capture });
}

function is_document_snapshot(
  snapshot: Extract<LocusSnapshotEnvelope, { hson: string }>,
): snapshot is DocumentSnapshot {
  return snapshot.mode === "document";
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
    let snapshot: HostedLiveMapLibrariesSnapshot;
    try {
      snapshot = capture_locus_libraries_snapshot_internal(authority);
    } catch (cause) {
      throw new DocumentSsrError("capture", "The hosted Libraries cut could not be captured.", cause);
    }
    testHook?.("hosted-libraries-after-snapshot");
    const document = selected_document(snapshot, options.document);
    const capture = capture_from_libraries_snapshot(snapshot, document, snapshot);
    return Object.freeze({ html: realize(capture), bootstrap: snapshot, document });
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

  try {
    return with_locus_bootstrap_snapshot(soloAuthority, (snapshot) => {
      if (!is_document_snapshot(snapshot)) {
        throw new DocumentSsrError("select", "The selected Locus authority is not a document map.");
      }
      testHook?.("hosted-after-snapshot");
      let capture: DocumentLiveMapCapture<"document">;
      try {
        capture = validate_capture(install_locus_snapshot(snapshot).map.capture());
      } catch (cause) {
        throw new DocumentSsrError(
          "bootstrap",
          "The captured semantic document snapshot could not be decoded.",
          cause,
        );
      }
      return Object.freeze({ html: realize(capture), bootstrap: snapshot });
    });
  } catch (cause) {
    if (cause instanceof DocumentSsrError) throw cause;
    throw new DocumentSsrError("capture", "The hosted document cut could not be captured.", cause);
  }
}

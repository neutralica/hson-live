import type {
  DocumentLiveMap,
  DocumentLiveMapCapture,
  HostedLiveMapLibrariesSnapshot,
  LiveMapLibraries,
  LiveMapLibrariesSnapshot,
  LocalLibrariesContinuationSnapshot,
} from "../types/livemap.types.js";
import type { LocusSnapshotEnvelope } from "../types/locus.representation.types.js";
import type { HsonNode } from "../core/types.js";
import { plan_browser_realization } from "./browser-realization/browser-realization-plan.js";
import { serialize_browser_realization } from "./browser-realization/browser-realization-serialize.js";
import { DocumentSsrError } from "./document-cut.error.js";
import { clone_hson_graph_without_quids } from "../api/livemap/livemap.document.capture.js";
import { encode_hosted_root, make_hosted_client_snapshot } from "../api/livemap/livemap.hosted.js";
import { project_locus_client_snapshot } from "../api/locus/locus.client-replication.js";
import type {
  BrowserRealizationHtml,
  DocumentCut,
  HostedDocumentCut,
  LibrariesDocumentCut,
  HostedLibrariesDocumentCut,
} from "../api/ssr/ssr.types.js";

type DocumentSnapshot = Extract<LocusSnapshotEnvelope, { hson: string }>
  & Readonly<{ mode: "document" }>;

function is_document_snapshot(
  snapshot: Extract<LocusSnapshotEnvelope, { hson: string }>,
): snapshot is DocumentSnapshot {
  return snapshot.mode === "document";
}

function validate_capture(capture: DocumentLiveMapCapture): DocumentLiveMapCapture<"document"> {
  if (
    typeof capture !== "object" || capture === null
    || capture.kind !== "hson-document" || capture.mode !== "document"
    || !Number.isSafeInteger(capture.rev) || capture.rev < 0
    || typeof capture.root !== "object" || capture.root === null
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
    return serialize_browser_realization(plan) as BrowserRealizationHtml;
  } catch (cause) {
    throw new DocumentSsrError(
      "realize",
      "The captured canonical document is not compatible with browser-parser realization.",
      cause,
    );
  }
}

export function cut_document_capture(capture: DocumentLiveMapCapture): DocumentCut {
  const validated = validate_capture(capture);
  const data: DocumentLiveMapCapture<"document"> = Object.freeze({
    ...validated,
    root: clone_hson_graph_without_quids(validated.root),
  });
  return Object.freeze({ html: realize(data), data });
}

export function cut_local_document(
  map: DocumentLiveMap,
  afterCapture?: () => void,
): DocumentCut {
  let capture: DocumentLiveMapCapture;
  try {
    capture = validate_capture(map.capture({ identity: "strip" }));
  } catch (cause) {
    if (cause instanceof DocumentSsrError) throw cause;
    throw new DocumentSsrError("capture", "The document cut could not be captured.", cause);
  }
  afterCapture?.();
  return cut_document_capture(capture);
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

function cut_libraries_snapshot<TSnapshot extends LiveMapLibrariesSnapshot>(
  snapshot: TSnapshot,
  document: unknown,
  install: (snapshot: TSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
): Readonly<{ html: BrowserRealizationHtml; data: TSnapshot; document: string }> {
  const selected = selected_document(snapshot, document);
  let capture: DocumentLiveMapCapture<"document">;
  try {
    install(snapshot);
    const library = snapshot.libraries.find((entry) => entry.name === selected);
    if (library === undefined || library.mode !== "document") {
      throw new Error("Selected snapshot Library did not decode as a document.");
    }
    capture = validate_capture(Object.freeze({
      kind: "hson-document",
      mode: "document",
      rev: snapshot.revision,
      root: decodeRoot(library.root),
    }));
  } catch (cause) {
    if (cause instanceof DocumentSsrError) throw cause;
    throw new DocumentSsrError("bootstrap", "The captured semantic Libraries snapshot could not be decoded.", cause);
  }
  return Object.freeze({ html: realize(capture), data: snapshot, document: selected });
}

export function cut_local_libraries(
  map: LiveMapLibraries,
  document: unknown,
  install: (snapshot: LiveMapLibrariesSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
  afterCapture?: () => void,
): LibrariesDocumentCut {
  let snapshot: LiveMapLibrariesSnapshot;
  try {
    snapshot = map.capture();
  } catch (cause) {
    throw new DocumentSsrError("capture", "The complete Libraries cut could not be captured.", cause);
  }
  afterCapture?.();
  const cut = cut_libraries_snapshot(snapshot, document, install, decodeRoot);
  const data: LocalLibrariesContinuationSnapshot = Object.freeze({
    format: snapshot.format,
    revision: snapshot.revision,
    registry: snapshot.registry,
    registryDigest: snapshot.registryDigest,
    libraries: Object.freeze(snapshot.libraries.map((library) => Object.freeze({
      ...library,
      root: encode_hosted_root(clone_hson_graph_without_quids(decodeRoot(library.root))),
    }))),
  });
  return Object.freeze({ html: cut.html, data, document: cut.document });
}

export function cut_hosted_libraries(
  capture: () => HostedLiveMapLibrariesSnapshot,
  document: unknown,
  install: (snapshot: HostedLiveMapLibrariesSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
  afterCapture?: () => void,
): HostedLibrariesDocumentCut {
  let snapshot: HostedLiveMapLibrariesSnapshot;
  try {
    snapshot = capture();
  } catch (cause) {
    throw new DocumentSsrError("capture", "The hosted Libraries cut could not be captured.", cause);
  }
  afterCapture?.();
  const cut = cut_libraries_snapshot(snapshot, document, install, decodeRoot);
  return Object.freeze({ html: cut.html, data: make_hosted_client_snapshot(snapshot), document: cut.document });
}

export function cut_hosted_snapshot(
  snapshot: Extract<LocusSnapshotEnvelope, { hson: string }>,
  install: (snapshot: DocumentSnapshot) => Readonly<{ map: DocumentLiveMap }>,
  afterSnapshot?: () => void,
): HostedDocumentCut {
  if (!is_document_snapshot(snapshot)) {
    throw new DocumentSsrError("select", "The selected Locus authority is not a document map.");
  }
  afterSnapshot?.();
  let capture: DocumentLiveMapCapture;
  try {
    capture = validate_capture(install(snapshot).map.capture());
  } catch (cause) {
    throw new DocumentSsrError("bootstrap", "The captured semantic document snapshot could not be decoded.", cause);
  }
  return Object.freeze({ html: realize(capture), data: project_locus_client_snapshot(snapshot) });
}

export function cut_hosted_authority(capture: () => HostedDocumentCut): HostedDocumentCut {
  try {
    return capture();
  } catch (cause) {
    if (cause instanceof DocumentSsrError) throw cause;
    throw new DocumentSsrError("capture", "The hosted document cut could not be captured.", cause);
  }
}

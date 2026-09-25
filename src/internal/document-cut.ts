import type {
  DocumentLiveMap,
  DocumentLiveMapCapture,
  LiveMapLibraries,
  LiveMapLibrariesSnapshot,
  LocalLibrariesContinuationSnapshot,
} from "../types/livemap.types.js";
import type { HsonNode } from "../core/types.js";
import type { AuthorityProjectionSnapshot } from "../types/locus.projection.types.js";
import { plan_browser_realization } from "./browser-realization/browser-realization-plan.js";
import { serialize_browser_realization } from "./browser-realization/browser-realization-serialize.js";
import { DocumentSsrError } from "./document-cut.error.js";
import { clone_hson_graph_without_quids } from "../api/livemap/livemap.document.capture.js";
import { decode_hosted_root, encode_hosted_root } from "../api/livemap/livemap.hosted.js";
import type {
  BrowserRealizationHtml,
  DocumentSsr,
  LibrariesDocumentSsr,
} from "../api/ssr/ssr.types.js";

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

function render_document_capture(capture: DocumentLiveMapCapture): DocumentSsr {
  const validated = validate_capture(capture);
  const bootstrap: DocumentLiveMapCapture<"document"> = Object.freeze({
    ...validated,
    root: clone_hson_graph_without_quids(validated.root),
  });
  return Object.freeze({ html: realize(bootstrap), bootstrap });
}

export function render_local_document(
  map: DocumentLiveMap,
  afterCapture?: () => void,
): DocumentSsr {
  let capture: DocumentLiveMapCapture;
  try {
    capture = validate_capture(map.capture({ identity: "strip" }));
  } catch (cause) {
    if (cause instanceof DocumentSsrError) throw cause;
    throw new DocumentSsrError("capture", "The document could not be captured for rendering.", cause);
  }
  afterCapture?.();
  return render_document_capture(capture);
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
      throw new DocumentSsrError("select", "The Libraries snapshot contains no selectable public document Library.");
    }
    if (documents.length !== 1) {
      throw new DocumentSsrError("select", "The Libraries snapshot contains multiple public document Libraries; document is required.");
    }
    return documents[0]!.name;
  }
  const selected = snapshot.registry.libraries.find((entry) => entry.name === requested);
  if (selected === undefined || selected.scope === "hson-internal" || selected.mode !== "document") {
    throw new DocumentSsrError("select", `Library ${JSON.stringify(requested)} is not a selectable public document.`);
  }
  return requested;
}

function render_libraries_snapshot<TSnapshot extends LiveMapLibrariesSnapshot>(
  snapshot: TSnapshot,
  document: unknown,
  install: (snapshot: TSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
): Readonly<{ html: BrowserRealizationHtml; document: string }> {
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
  return Object.freeze({ html: realize(capture), document: selected });
}

export function render_local_libraries(
  map: LiveMapLibraries,
  document: unknown,
  install: (snapshot: LiveMapLibrariesSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
  afterCapture?: () => void,
): LibrariesDocumentSsr {
  let snapshot: LiveMapLibrariesSnapshot;
  try {
    snapshot = map.capture();
  } catch (cause) {
    throw new DocumentSsrError("capture", "The complete Libraries snapshot could not be captured for rendering.", cause);
  }
  afterCapture?.();
  const rendered = render_libraries_snapshot(snapshot, document, install, decodeRoot);
  const bootstrap: LocalLibrariesContinuationSnapshot = Object.freeze({
    format: snapshot.format,
    revision: snapshot.revision,
    registry: snapshot.registry,
    registryDigest: snapshot.registryDigest,
    libraries: Object.freeze(snapshot.libraries.map((library) => Object.freeze({
      ...library,
      root: encode_hosted_root(clone_hson_graph_without_quids(decodeRoot(library.root))),
    }))),
  });
  return Object.freeze({ html: rendered.html, bootstrap, document: rendered.document });
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
  let capture: DocumentLiveMapCapture<"document">;
  try {
    capture = validate_capture(Object.freeze({
      kind: "hson-document", mode: "document", rev: snapshot.revision,
      root: decode_hosted_root(library.root),
    }));
  } catch (cause) {
    throw new DocumentSsrError("bootstrap", "The session document could not be decoded.", cause);
  }
  return Object.freeze({ html: realize(capture), data: snapshot, document: selected,
    revision: snapshot.revision, projectionDigest: snapshot.projectionDigest });
}

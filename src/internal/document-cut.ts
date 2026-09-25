import type {
  LiveMapDocumentCapture,
  LiveMap,
  LiveMapSnapshot,
  LocalLibrariesContinuationSnapshot,
} from "../types/livemap.types.js";
import type { HsonNode } from "../core/types.js";
import type { AuthorityProjectionSnapshot } from "../types/locus.projection.types.js";
import { plan_browser_realization } from "./browser-realization/browser-realization-plan.js";
import { plan_managed_document_css } from "./browser-realization/managed-document-css.js";
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "./css/portable-document-stylesheet.js";
import { serialize_browser_realization } from "./browser-realization/browser-realization-serialize.js";
import { DocumentSsrError } from "./document-cut.error.js";
import { clone_hson_graph_without_quids } from "../api/livemap/livemap.document.capture.js";
import { decode_hosted_root, encode_hosted_root } from "../api/livemap/livemap.hosted.js";
import type {
  BrowserRealizationHtml,
  LibrariesDocumentSsr,
} from "../api/ssr/ssr.types.js";

function validate_capture(capture: LiveMapDocumentCapture): LiveMapDocumentCapture<"document"> {
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

function realize(capture: LiveMapDocumentCapture<"document">, css = ""): BrowserRealizationHtml {
  try {
    const plan = plan_managed_document_css(plan_browser_realization(capture.root), css);
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

function selected_document(snapshot: LiveMapSnapshot, requested: unknown): string {
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

function render_libraries_snapshot<TSnapshot extends LiveMapSnapshot>(
  snapshot: TSnapshot,
  document: unknown,
  install: (snapshot: TSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
): Readonly<{ html: BrowserRealizationHtml; document: string }> {
  const selected = selected_document(snapshot, document);
  let capture: LiveMapDocumentCapture<"document">;
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
  const encoded = snapshot.libraries.find((entry) => entry.name === selected);
  if (encoded?.css === undefined) throw new DocumentSsrError("bootstrap", "Document Library stylesheet is missing.");
  const css = render_portable_document_stylesheet(decode_portable_document_stylesheet(encoded.css));
  return Object.freeze({ html: realize(capture, css), document: selected });
}

export function render_local_libraries(
  map: LiveMap,
  document: unknown,
  install: (snapshot: LiveMapSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
  afterCapture?: () => void,
): LibrariesDocumentSsr {
  let snapshot: LiveMapSnapshot;
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

/** Render one local registry document without producing a continuation bootstrap. */
export function render_local_libraries_html(
  map: LiveMap,
  document: unknown,
  install: (snapshot: LiveMapSnapshot) => unknown,
  decodeRoot: (root: unknown) => HsonNode,
): BrowserRealizationHtml {
  let snapshot: LiveMapSnapshot;
  try {
    snapshot = map.capture();
  } catch (cause) {
    throw new DocumentSsrError("capture", "The complete LiveMap snapshot could not be captured for rendering.", cause);
  }
  return render_libraries_snapshot(snapshot, document, install, decodeRoot).html;
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
  let capture: LiveMapDocumentCapture<"document">;
  try {
    capture = validate_capture(Object.freeze({
      kind: "hson-document", mode: "document", rev: snapshot.revision,
      root: decode_hosted_root(library.root),
    }));
  } catch (cause) {
    throw new DocumentSsrError("bootstrap", "The session document could not be decoded.", cause);
  }
  const css = render_portable_document_stylesheet(decode_portable_document_stylesheet(library.css));
  return Object.freeze({ html: realize(capture, css), data: snapshot, document: selected,
    revision: snapshot.revision, projectionDigest: snapshot.projectionDigest });
}

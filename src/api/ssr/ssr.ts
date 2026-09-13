import type {
  DocumentLiveMap,
  DocumentLiveMapCapture,
} from "../../types/livemap.types.js";
import type { LocusSnapshotEnvelope } from "../../types/locus.representation.types.js";
import {
  install_locus_snapshot,
  with_locus_bootstrap_snapshot,
  type LocusBootstrapAuthority,
} from "../locus/locus.bootstrap.js";
import { plan_browser_realization } from "../../internal/browser-realization/browser-realization-plan.js";
import { serialize_browser_realization } from "../../internal/browser-realization/browser-realization-serialize.js";
import { DocumentSsrError } from "./ssr.error.js";
import type {
  BrowserRealizationHtml,
  DocumentSsr,
  HostedDocumentSsr,
} from "./ssr.types.js";

type DocumentSnapshot = Extract<LocusSnapshotEnvelope, { hson: string }>
  & Readonly<{ mode: "document" }>;
type SsrTestPoint = "local-after-capture" | "hosted-after-snapshot";

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

/** Compose browser-realization HTML and exact bootstrap state from one local capture. */
export function render_document(options: Readonly<{ map: DocumentLiveMap }>): DocumentSsr {
  require_options(options, "render_document");
  const map = options.map;
  if (typeof map !== "object" || map === null || map.mode !== "document" || typeof map.capture !== "function") {
    throw new TypeError("render_document requires one DocumentLiveMap.");
  }

  let capture: DocumentLiveMapCapture<"document">;
  try {
    capture = validate_capture(map.capture());
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
): HostedDocumentSsr {
  require_options(options, "render_hosted_document");
  const authority = options.authority;
  if (
    typeof authority !== "object"
    || authority === null
    || typeof authority.stream !== "object"
    || authority.stream === null
    || typeof authority.stream.logicalMapId !== "string"
    || typeof authority.recovery !== "object"
    || authority.recovery === null
    || typeof authority.recovery.plan !== "function"
  ) {
    throw new TypeError("render_hosted_document requires one Locus bootstrap authority.");
  }

  try {
    return with_locus_bootstrap_snapshot(authority, (snapshot) => {
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

import type {
  DocumentLiveMapCapture,
  LocalLibrariesContinuationSnapshot,
} from "../../types/livemap.types.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";

declare const BROWSER_REALIZATION_HTML: unique symbol;

/**
 * HTML produced by the browser-realization composition path.
 *
 * The brand distinguishes this parser-compatible output from Hson transport
 * HTML. It makes no sanitization, trust, XSS, CSP, or authentication claim.
 */
export type BrowserRealizationHtml = string & Readonly<{
  [BROWSER_REALIZATION_HTML]: true;
}>;

/** One local canonical cut and the browser-realization HTML derived from it. */
export type DocumentSsr = Readonly<{
  html: BrowserRealizationHtml;
  bootstrap: DocumentLiveMapCapture<"document">;
}>;

/** One selected document realization paired with its complete local Libraries cut. */
export type LibrariesDocumentSsr = Readonly<{
  html: BrowserRealizationHtml;
  bootstrap: LocalLibrariesContinuationSnapshot;
  document: string;
}>;

/** One selected document realization paired with its complete hosted Libraries cut. */
export type HostedLibrariesDocumentSsr = Readonly<{
  html: BrowserRealizationHtml;
  bootstrap: AuthorityProjectionSnapshot;
  document: string;
  revision: number;
  projectionDigest: string;
}>;

/** Object-owned local cut; `data` is accepted by the bootstrap codec. */
export type DocumentCut = Readonly<{ html: BrowserRealizationHtml; data: DocumentLiveMapCapture<"document"> }>;
export type LibrariesDocumentCut = Readonly<{
  html: BrowserRealizationHtml;
  data: LocalLibrariesContinuationSnapshot;
  document: string;
}>;
export type HostedLibrariesDocumentCut = Readonly<{
  html: BrowserRealizationHtml;
  data: AuthorityProjectionSnapshot;
  document: string;
  revision: number;
  projectionDigest: string;
}>;

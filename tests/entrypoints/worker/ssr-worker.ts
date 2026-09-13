import {
  render_document,
  render_hosted_document,
  encode_ssr_bootstrap,
  decode_ssr_bootstrap,
  DocumentSsrError,
  type BrowserRealizationHtml,
  type DocumentSsr,
  type HostedDocumentSsr,
  type LibrariesDocumentSsr,
  type HostedLibrariesDocumentSsr,
} from "hson-live/ssr";
import type { DocumentLiveMap, LiveMapLibraries } from "hson-live/livemap";
import type { LocusBootstrapAuthority, LocusMultiLibrary } from "hson-live/locus";

declare const map: DocumentLiveMap;
declare const authority: LocusBootstrapAuthority;
const local: DocumentSsr = render_document({ map });
const hosted: HostedDocumentSsr = render_hosted_document({ authority });
const localEncoded = encode_ssr_bootstrap(local.bootstrap);
void decode_ssr_bootstrap(localEncoded).bootstrap;
const html: BrowserRealizationHtml = local.html;
void html;
void hosted.bootstrap;
void DocumentSsrError;
declare const libraries: LiveMapLibraries;
declare const librariesAuthority: LocusMultiLibrary;
const aggregateLocal: LibrariesDocumentSsr = render_document({ map: libraries });
const aggregateHosted: HostedLibrariesDocumentSsr = render_hosted_document({ authority: librariesAuthority });
void aggregateLocal.document;
void aggregateHosted.document;

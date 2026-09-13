import {
  render_document,
  render_hosted_document,
  DocumentSsrError,
  type BrowserRealizationHtml,
  type DocumentSsr,
  type HostedDocumentSsr,
} from "hson-live/ssr";
import type { DocumentLiveMap } from "hson-live/livemap";
import type { LocusBootstrapAuthority } from "hson-live/locus";

declare const map: DocumentLiveMap;
declare const authority: LocusBootstrapAuthority;
const local: DocumentSsr = render_document({ map });
const hosted: HostedDocumentSsr = render_hosted_document({ authority });
const html: BrowserRealizationHtml = local.html;
void html;
void hosted.bootstrap;
void DocumentSsrError;

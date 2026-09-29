import type { LiveMapHtmlCut } from "hson-live/livemap";
import {
  render_hosted_document,
  encode_ssr_bootstrap,
  decode_ssr_bootstrap,
  DocumentSsrError,
  type BrowserRealizationHtml,
  type HostedLibrariesDocumentSsr,
} from "hson-live/ssr";
import type { LiveMap } from "hson-live/livemap";
import type { Locus } from "hson-live/locus";

declare const map: LiveMap;
declare const authority: unknown;
const local: LiveMapHtmlCut = map.cut({ html: "page" });
void local.libs;
void map.cut().libs;
// @ts-expect-error Worker hosted rendering requires a session projection too.
render_hosted_document({ authority });
const localEncoded = encode_ssr_bootstrap(local.libs);
void decode_ssr_bootstrap(localEncoded).bootstrap;
const html: BrowserRealizationHtml = local.html;
void html;
void DocumentSsrError;
declare const libraries: LiveMap;
declare const librariesAuthority: Locus;
const aggregateLocal: LiveMapHtmlCut = libraries.cut({ html: "page" });
const aggregateHosted: HostedLibrariesDocumentSsr = render_hosted_document({ authority: librariesAuthority, sessionId: "authorized-session" });
void aggregateLocal.libs;
void libraries.cut().libs;
void librariesAuthority.cut("authorized-session").data;
void aggregateLocal.document;
void aggregateHosted.document;

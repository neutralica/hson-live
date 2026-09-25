import {
  render_document,
  render_hosted_document,
  encode_ssr_bootstrap,
  decode_ssr_bootstrap,
  DocumentSsrError,
  type BrowserRealizationHtml,
  type LibrariesDocumentSsr,
  type HostedLibrariesDocumentSsr,
} from "hson-live/ssr";
import type { LiveMap } from "hson-live/livemap";
import type { Locus } from "hson-live/locus";

declare const map: LiveMap;
declare const authority: unknown;
const local: LibrariesDocumentSsr = render_document({ map });
void local.bootstrap;
// @ts-expect-error Local document maps do not expose hosted cuts.
map.cut();
// @ts-expect-error Worker hosted rendering requires a session projection too.
render_hosted_document({ authority });
const localEncoded = encode_ssr_bootstrap(local.bootstrap);
void decode_ssr_bootstrap(localEncoded).bootstrap;
const html: BrowserRealizationHtml = local.html;
void html;
void DocumentSsrError;
declare const libraries: LiveMap;
declare const librariesAuthority: Locus;
const aggregateLocal: LibrariesDocumentSsr = render_document({ map: libraries });
const aggregateHosted: HostedLibrariesDocumentSsr = render_hosted_document({ authority: librariesAuthority, sessionId: "authorized-session" });
void aggregateLocal.bootstrap;
// @ts-expect-error Local Libraries registries do not expose hosted cuts.
libraries.cut();
void librariesAuthority.cut("authorized-session").data;
void aggregateLocal.document;
void aggregateHosted.document;

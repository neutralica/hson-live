import type { LiveMapHtmlCut } from "hson-live/livemap";
import {
  encode_ssr_bootstrap,
  decode_ssr_bootstrap,
  DocumentSsrError,
  type BrowserRealizationHtml,
} from "hson-live/ssr";
import type { LiveMap } from "hson-live/livemap";
import type { Locus, LocusSessionHtmlNow } from "hson-live/locus";

declare const map: LiveMap;
const local: LiveMapHtmlCut = map.cut({ html: "page" });
void local.libs;
void map.cut().libs;
const localEncoded = encode_ssr_bootstrap(local.libs);
void decode_ssr_bootstrap(localEncoded).bootstrap;
const html: BrowserRealizationHtml = local.html;
void html;
void DocumentSsrError;
declare const libraries: LiveMap;
declare const librariesAuthority: Locus;
const aggregateLocal: LiveMapHtmlCut = libraries.cut({ html: "page" });
const session = await librariesAuthority.session.create({ libraries: ["page"] });
const aggregateHosted: LocusSessionHtmlNow = session.now({ html: "page" });
void aggregateLocal.libs;
void libraries.cut().libs;
void session.now().libs;
void aggregateLocal.document;
void aggregateHosted.document;

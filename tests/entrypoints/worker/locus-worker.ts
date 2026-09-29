import { create_browser_locus_socket, create_locus, hsonLocus,
  type LocusSocketLike, type Locus, type LocusSessionId, type AuthorityProjectionSnapshot } from "hson-live/locus";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonEcho } from "hson-live/echo";
import { Hson } from "hson-live/hson";

declare const websocketUrl: string;
declare const BrowserSocket: Parameters<typeof create_browser_locus_socket>[1];
declare const socket: LocusSocketLike;
void create_browser_locus_socket(websocketUrl, BrowserSocket);
void socket;
const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "empty">>>` } });
const locus: Locus<typeof map> = create_locus({ map, exposure: [{ library: "page", exposure: "client-public" }] });
void [locus, hsonLocus];
const retained = await locus.session.create({ libraries: ["page"] });
const snapshot: AuthorityProjectionSnapshot = retained.cut().libs;
void hsonEcho.replicate({ cut: retained.cut(), credential: retained.credential!, socket });
// @ts-expect-error Retained cuts have no family narrowing.
retained.cut({ data: [] });
// @ts-expect-error The public plural namespace is retired.
void locus.sessions;
// @ts-expect-error A bare map cannot become a hosted Locus.
create_locus({ map: hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: Hson.schema`<type "data" content <value "number">>` } }) });

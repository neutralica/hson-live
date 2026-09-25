import { Hson, hson, hsonLiveMap, hsonLocus, create_locus, create_echo,
  continue_document, continue_hosted_document, render_document, render_hosted_document,
  encode_ssr_bootstrap, decode_ssr_bootstrap, create_livehost_locus_registry,
  type Locus, type LiveMap, type LiveMapDocumentLibrary } from "hson-live";
import { create_browser_locus_socket, type LocusSocketLike } from "hson-live/locus";
import { create_node_locus_socket } from "hson-live/locus/node";
import { start_node_application_host } from "hson-live/livehost/node";
import { create_live_inspector } from "hson-live/diagnostics";

declare const documentLibrary: LiveMapDocumentLibrary;
declare const element: Element;
declare const socket: LocusSocketLike;
const registry = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "empty">>>` } });
const locus = create_locus({ map: registry, exposure: [{ library: "page", exposure: "client-public" }] });
const checked: Locus<typeof registry> = locus;
void (0 as unknown as Locus | LiveMap);
void [hson, hsonLocus, checked, create_echo, continue_document({ map: registry, root: element }),
  continue_hosted_document, render_document({ map: registry }), render_hosted_document,
  encode_ssr_bootstrap, decode_ssr_bootstrap, create_livehost_locus_registry,
  create_browser_locus_socket, create_node_locus_socket, start_node_application_host, create_live_inspector, socket];
// @ts-expect-error The one-map Locus bootstrap is retired.
import { decode_locus_bootstrap } from "hson-live/locus";
// @ts-expect-error The sessionless Locus wire codec is retired.
import { encode_locus_message } from "hson-live/locus";
// @ts-expect-error A document library cannot become a hosted Locus.
create_locus({ map: documentLibrary });
void [decode_locus_bootstrap, encode_locus_message];

import { Hson, hson, hsonLiveMap, continue_document, continue_hosted_document, encode_ssr_bootstrap, decode_ssr_bootstrap, create_livehost_locus_registry, type Locus, type LiveMap, type LiveMapDocumentLibrary } from "hson-live";
import { bind_locus_websocket, type LocusWebSocketLike } from "hson-live/locus";
import { bind_node_locus_websocket } from "hson-live/locus/node";
import { start_node_application_host } from "hson-live/livehost/node";
import { create_live_inspector } from "hson-live/diagnostics";

declare const documentLibrary: LiveMapDocumentLibrary;
declare const element: Element;
declare const socket: LocusWebSocketLike;
const pageDefinition = { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "empty">>>` };
const registry = hsonLiveMap.fromLibraries({ page: pageDefinition });
const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition: pageDefinition }] });
const checked: Locus<typeof registry> = locus;
void (0 as unknown as Locus | LiveMap);
void [hson, hsonLiveMap.locus, checked, hsonLiveMap.echo.create, continue_document({ map: registry, root: element }),
  continue_hosted_document, registry.cut({ html: "page" }), encode_ssr_bootstrap, decode_ssr_bootstrap, create_livehost_locus_registry,
  bind_locus_websocket, bind_node_locus_websocket, start_node_application_host, create_live_inspector, socket];
// @ts-expect-error The one-map Locus bootstrap is retired.
import { decode_locus_bootstrap } from "hson-live/locus";
// @ts-expect-error The sessionless Locus wire codec is retired.
import { encode_locus_message } from "hson-live/locus";
// @ts-expect-error A document library cannot become a hosted Locus.
hsonLiveMap.locus.create({ map: documentLibrary });
void [decode_locus_bootstrap, encode_locus_message];

/**
 * Published-import companion for docs/public-api.md.
 * Browser, transport, and authority inputs are deliberately application-owned.
 */
import {
  activate_interactions,
  add_interaction,
  continue_document,
  continue_hosted_document,
  HsonData,
  HsonDocument,
} from "hson-live";
import { hsonEcho, type Echo } from "hson-live/echo";
import { Hson } from "hson-live/hson";
import { hsonLiveMap, type LiveMap, type LiveMapDocumentLibrary } from "hson-live/livemap";
import { create_locus } from "hson-live/locus";
import { reflect_document } from "hson-live/mirror";
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "hson-live/ssr";
import { hsonTransform, type TransformOutput } from "hson-live/transform";
import { hsonLiveTree, type ContentManager } from "hson-live/livetree";

declare const userHtml: string;
declare const documentMap: LiveMapDocumentLibrary;
declare const transport: import("hson-live/echo").EchoReplicaTransport;
declare const root: Element;
declare const libraries: LiveMap;
declare const tree: ReturnType<typeof hsonLiveTree.fromHson>;
declare const echo: Echo<LiveMap>;
declare const authority: unknown;
declare const descriptor: Parameters<typeof add_interaction>[1];

const transformOutput: TransformOutput = hsonTransform.fromUntrustedHtml(userHtml);
const canonical = transformOutput.toHson().serialize();
const html: string = hsonTransform.fromHson(canonical).toHtml().serialize();
const authored = Hson.canonical`<main/>`;
const exactDocument = Hson.document.fromHson(authored);
void [html, authored, Hson.document.toNode(exactDocument)];

const dataMap = hsonLiveMap.fromLibraries({ state: { data: { count: 0 }, schema: Hson.schema`<type "data" content <count "number">>` } });
dataMap.lib("state").at(["count"]).set(1);
const exactData: HsonData | undefined = dataMap.lib("state").at([]).data();
void (exactData === undefined ? undefined : Hson.data.entries(exactData));

const standalone = hsonLiveTree.fromNode(hsonTransform.fromTrustedHtml("<main/>").toNode());
standalone.attrs.set("data-ready", "yes");
standalone.css.set.color("rebeccapurple");
const content: ContentManager = standalone.content;
void content;

const binding = reflect_document(documentMap);
binding.dispose();

const hostedMap = hsonLiveMap.fromLibraries({ page: { document: "<main/>",
  schema: Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "empty">>>` } });
const hosted = create_locus({ map: hostedMap, libraries: [{ name: "page", ownership: "shared" }] });
void hosted;

const localSsr = libraries.cut({ html: "page" });
const decoded = decode_ssr_bootstrap(encode_ssr_bootstrap(localSsr.libs));
void decoded;
void continue_document({ map: hostedMap, document: hostedMap.lib("page"), root });

const retained = await hosted.session.create({ libraries: ["state", "page"] });
const replica = await hsonEcho.create({ now: retained.now(), credential: retained.credential!, transport });
void replica;
void retained.now({ html: "page" });
// @ts-expect-error One-map hosted continuation is no longer a public client-egress path.
void continue_hosted_document({ echo, root });

add_interaction(libraries, descriptor);
const disposeInteractions = activate_interactions({
  map: libraries,
  tree,
  local: {
    reveal(event, subject, args) {
      void [event, subject, Hson.data.materialize(args)];
    },
  },
  dispatch: async (key, payload) => {
    await echo.action(key, payload);
  },
});
disposeInteractions();

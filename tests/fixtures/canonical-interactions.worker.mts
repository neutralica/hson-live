import { parentPort } from "node:worker_threads";
import {
  Hson,
  HsonData,
  activate_interactions,
  add_interaction,
  enable_interactions,
  hsonEcho,
  hsonLiveMap,
  hsonLocus,
  hsonMirror,
  type HsonSchema,
  type InteractionDescriptor,
  type InteractionListener,
} from "../../src/index.ts";
import type { LocusSocketLike } from "../../src/types/locus.types.ts";
import { link_node_to_el } from "../../src/api/livetree/utils/node-map-helpers.ts";

const PageSchema: HsonSchema = Hson`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const StateSchema: HsonSchema = Hson`<type "data" content <count "number">>`;
const QUID = "000008399";
const listener: InteractionListener = Object.freeze({
  event: "click", target: "element", capture: false, once: false, passive: false,
  missingTarget: "throw", preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false,
});

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: `<main <button @${QUID}/>/>`, schema: PageSchema },
  });
}

function socket_pair(): Readonly<{ client: LocusSocketLike; server: LocusSocketLike }> {
  const toClient = new Set<(raw: string) => void>();
  const toServer = new Set<(raw: string) => void>();
  return Object.freeze({
    client: Object.freeze({
      send: (raw: string) => { for (const receive of [...toServer]) receive(raw); },
      close: () => undefined,
      onMessage: (receive: (raw: string) => void) => { toClient.add(receive); return () => toClient.delete(receive); },
      onClose: (_receive: () => void) => () => undefined,
    }),
    server: Object.freeze({
      send: (raw: string) => { for (const receive of [...toClient]) receive(raw); },
      close: () => undefined,
      onMessage: (receive: (raw: string) => void) => { toServer.add(receive); return () => toServer.delete(receive); },
      onClose: (_receive: () => void) => () => undefined,
    }),
  });
}

const exact = HsonData.fromHson(Hson`<'10' -0 '2' 2 __proto__ <polluted true>>`);
const authorityMap = make_map();
enable_interactions(authorityMap);
const descriptor: InteractionDescriptor = Object.freeze({
  id: "worker", subjectQuid: QUID, listener, kind: "locus-authoritative", key: "save", payload: exact,
});
add_interaction(authorityMap, descriptor);
let handled: HsonData | undefined;
const locus = hsonLocus.create({
  map: authorityMap,
  actions: { save: (_context, payload) => { handled = payload; } },
});
const replicaMap = make_map();
enable_interactions(replicaMap);
const pair = socket_pair();
locus.connect(pair.server);
const echo = hsonEcho.create({ socket: pair.client, map: replicaMap, recovery: { logicalMapId: locus.logicalMapId } });
echo.connect();
await echo.session.create();
await echo.recovery.recover();

const reflection = hsonMirror(replicaMap.lib("page"));
const subject = reflection.tree.find.must.byQuid(QUID);
const target = new EventTarget();
link_node_to_el(subject.node, target as unknown as Element);
const dispose = activate_interactions({
  map: replicaMap,
  tree: reflection.tree,
  local: {},
  dispatch: async (key, payload) => {
    const result = await echo.action(key, payload);
    if (result.type !== "ack") throw result.error;
  },
});
target.dispatchEvent(new Event("click"));
for (let attempt = 0; attempt < 30 && handled === undefined; attempt += 1) await Promise.resolve();

parentPort?.postMessage(Object.freeze({
  equal: handled?.equals(exact) ?? false,
  order: handled?.entries()?.map(([name]) => name) ?? [],
  negativeZero: Object.is(handled?.entries()?.[0]?.[1].scalar(), -0),
}));
dispose();
reflection.dispose();
echo.dispose();
locus.dispose();

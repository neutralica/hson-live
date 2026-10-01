import { authority_definition_from_fixture_options } from "../helpers/locus-definition-fixture.mts";
import type { LocusActionContext } from "../../src/types/locus.core.types.ts";
import { test_echo_transport } from "../helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../../src/api/locus/locus.websocket.ts";
import { create_recovery_test_driver } from "../helpers/replica-driver.mts";
import { client_projection_map } from "../helpers/client-projection.mts";
import { parentPort } from "node:worker_threads";
import { test_public_projection } from "../helpers/hosted-catalog.mts";
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
import type { LocusWebSocketLike } from "../../src/types/locus.types.ts";
import { link_node_to_el } from "../../src/api/livetree/utils/node-map-helpers.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { project_authority_snapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.document.registration.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";

const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;
const QUID = "000008399";
const listener: InteractionListener = Object.freeze({
  event: "click", target: "element", capture: false, once: false, passive: false,
  missingTarget: "throw", preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false,
});

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: "<main <button/>/>", schema: PageSchema },
  });
}

function socket_pair(): Readonly<{ client: LocusWebSocketLike; server: LocusWebSocketLike }> {
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

const exact = Hson.data.fromHson(Hson.canonical`<'10' -0 '2' 2 __proto__ <polluted true>>`);
const authorityMap = make_map();
enable_interactions(authorityMap);
set_livemap_document_quid_candidate_source_for_tests(authorityMap.lib("page").document, () => QUID);
acquire_document_identity(authorityMap.lib("page").document, { kind: "path", path: validate_document_path([0, 0, 0]) });
const descriptor: InteractionDescriptor = Object.freeze({
  id: "worker", subject: Object.freeze({ library: "page", path: [0, 0, 0] }), listener, kind: "locus", key: "save", payload: exact,
});
add_interaction(authorityMap, descriptor);
let handled: HsonData | undefined;
const configured = test_public_projection(authorityMap);
const locus = hsonLocus.create({ ...authority_definition_from_fixture_options({ map: authorityMap, ...configured }),
  interactions: [descriptor],
  actions: { save: (_context: LocusActionContext, payload: HsonData | undefined) => { handled = payload; } } });
const captured = internal_livemap_aggregate_authority(locus.map).captureHosted();
const policy = make_locus_hosted_projection_policy(captured.registry, captured.authority,
  configured.libraries, configured.defaultProjection, configured.authorizeProjection);
const effective = await normalize_locus_effective_projection(policy, configured.defaultProjection);
const replicaMap = client_projection_map({ authority: project_authority_snapshot(captured, effective),
  local: {} }) as typeof authorityMap;
const pair = socket_pair();
bind_locus_websocket(locus, pair.server);
const echo = create_recovery_test_driver({ transport: test_echo_transport(pair.client), map: replicaMap });
echo.connect();
await echo.session.create();
await echo.completeRecovery();

const reflection = hsonMirror(replicaMap.lib("page"));
const page = replicaMap.lib("page");
if (!("document" in page)) throw new Error("Expected document library.");
const localQ = "000008398";
set_livemap_document_quid_candidate_source_for_tests(page.document, () => localQ);
acquire_document_identity(page.document, { kind: "path", path: validate_document_path([0, 0, 0]) });
if (page.document.byQuid(QUID) !== undefined) throw new Error("Worker Echo inherited the Locus QUID.");
const subject = reflection.tree.find.must.byQuid(localQ);
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
  equal: handled === exact,
  order: handled === undefined ? [] : Hson.data.entries(handled)?.map(([name]) => name) ?? [],
  negativeZero: Object.is(handled === undefined ? undefined : Hson.data.materialize(Hson.data.entries(handled)?.[0]?.[1]!), -0),
}));
dispose();
reflection.dispose();
echo.dispose();
locus.dispose();

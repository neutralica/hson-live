import assert from "node:assert/strict";
import { create_locus_fixture } from "../helpers/locus-definition-fixture.mts";
import { retained_subject } from "../helpers/retained-livetree-subject.mts";
import { locus_map_internal } from "../../src/internal/governor-maps.js";
import { authority_definition_from_fixture_options } from "../helpers/locus-definition-fixture.mts";
import type { LocusActionContext } from "../../src/types/locus.core.types.ts";
import { test_echo_transport } from "../helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../../src/api/locus/locus.websocket.ts";
import { create_recovery_test_driver } from "../helpers/replica-driver.mts";
import { client_projection_map } from "../helpers/client-projection.mts";
import { parentPort } from "node:worker_threads";
import { test_public_projection } from "../helpers/hosted-catalog.mts";
import { Hson, HsonDataValue, activate_interactions, add_interaction, enable_interactions, hsonLiveMap, hsonLiveTree, hsonMirror, type HsonSchema, type InteractionDescriptor, type InteractionListener } from "../../src/index.ts";
import type { LocusWebSocketLike } from "../../src/types/locus.types.ts";
import { link_node_to_el } from "../../src/api/livetree/utils/node-map-helpers.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { project_authority_snapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.document.registration.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { authored_event_cases } from "./authored-event-cases.mts";
import { local_behavior_cases } from "./local-behavior-cases.mts";
import { document_listener_cases } from "./document-listener-cases.mts";
import { FakeElement } from "../helpers/fake-document.mts";

await local_behavior_cases();
await document_listener_cases();

const standalone = hsonLiveTree.fromHson("<main <button/>/>");
try {
  const subject = standalone.find.must.byTag("button");
  const exact = Hson.data.parse`<'10' -0 '2' null>`;
  standalone.actions.define("echo", async (context, input) => {
    assert.deepEqual(context, { tree: standalone });
    return input;
  }, { input: { required: true } });
  const result = await subject.actions.trigger("echo", exact);
  assert.ok(result.ok && result.result === exact);
  const sub = subject.listen.event("<hson:event on:click local:echo input:data={null} <> >");
  sub.off();
  assert.throws(() => subject.listen.event("<hson:event on:click local:echo <> >"), /requires input/);
  const workerButton = new FakeElement("button");
  link_node_to_el(retained_subject(subject), workerButton as unknown as Element);
  const seen: unknown[] = [];
  standalone.actions.define("optional", (_context, input) => { seen.push(input?.scalar()); });
  const omitted = subject.listen.event("<hson:event on:click local:optional <> >");
  const explicit = subject.listen.event("<hson:event on:click local:optional input:data={null} <> >");
  workerButton.dispatchEvent(new Event("click"));
  assert.deepEqual(seen, [undefined, null]);
  omitted.off(); explicit.off();
} finally { standalone.remove(); }

const PageSchema: HsonSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content <sequence [<tag "button" content "empty">]>>]>>]>>`;
const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;
const QUID = "000008399";
const listener: InteractionListener = Object.freeze({
  event: "click", target: "element", capture: false, once: false, passive: false,
  missingTarget: "throw", preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false,
});

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { json: { count: 0 }, schema: StateSchema },
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

const exact = Hson.data.fromSource(Hson.canonical`<'10' -0 '2' 2 __proto__ <polluted true>>`);
const authorityMap = make_map();
enable_interactions(authorityMap);
set_livemap_document_quid_candidate_source_for_tests(authorityMap.doc.must("page").document, () => QUID);
acquire_document_identity(authorityMap.doc.must("page").document, { kind: "path", path: validate_document_path([0, 0, 0]) });
const descriptor: InteractionDescriptor = Object.freeze({
  id: "worker", subject: Object.freeze({ library: "page", path: [0, 0, 0] }), listener, kind: "locus", key: "save", payload: exact,
});
add_interaction(authorityMap, descriptor);
let handled: HsonDataValue | undefined;
const configured = test_public_projection(authorityMap);
const locus = create_locus_fixture({ ...authority_definition_from_fixture_options({ map: authorityMap, ...configured }),
  interactions: [descriptor],
  authorizeAction: ({ action }) => action === "save",
  actions: { save: (_context: LocusActionContext, payload: HsonDataValue | undefined) => { handled = payload; } } });
const captured = internal_livemap_aggregate_authority(locus_map_internal(locus)).captureHosted();
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

const reflection = hsonMirror(replicaMap.doc.must("page"));
const page = replicaMap.doc.must("page");
if (!("document" in page)) throw new Error("Expected document library.");
const localQ = "000008398";
set_livemap_document_quid_candidate_source_for_tests(page.document, () => localQ);
acquire_document_identity(page.document, { kind: "path", path: validate_document_path([0, 0, 0]) });
if (page.document.byQuid(QUID) !== undefined) throw new Error("Worker Echo inherited the Locus QUID.");
const subject = reflection.tree.find.must.byQuid(localQ);
const target = new EventTarget();
link_node_to_el(retained_subject(subject), target as unknown as Element);
const dispose = activate_interactions({
  map: replicaMap,
  tree: reflection.tree,
  dispatch: async (key, payload) => {
    const result = await echo.action(key, payload);
    if (result.type !== "ack") throw result.error;
  },
});
target.dispatchEvent(new Event("click"));
for (let attempt = 0; attempt < 30 && handled === undefined; attempt += 1) await Promise.resolve();

await (await import("./interaction-mixed-stage-cases.mts")).mixed_stage_interaction_cases();
await authored_event_cases();

parentPort?.postMessage(Object.freeze({
  equal: handled?.equals(exact) === true,
  order: handled === undefined ? [] : (handled).entries()?.map(([name]) => name) ?? [],
  negativeZero: Object.is(handled === undefined ? undefined : ((handled).entries()?.[0]?.[1]!).materialize(), -0),
}));
dispose();
reflection.dispose();
echo.dispose();
locus.dispose();

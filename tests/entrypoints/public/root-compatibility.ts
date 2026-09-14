import {
  Hson,
  HsonData,
  HsonDocument,
  activate_interactions,
  add_interaction,
  continue_document,
  continue_hosted_document,
  create_echo,
  create_livehost_locus_registry,
  create_locus,
  create_locus_bootstrap_echo,
  decode_ssr_bootstrap,
  enable_interactions,
  encode_ssr_bootstrap,
  hson,
  hsonCalc,
  hsonEcho,
  hsonLiveMap,
  hsonLiveTree,
  hsonLocus,
  hsonReflect,
  hsonTransform,
  link_livemap,
  LiveMapDocumentInstallError,
  LiveTree,
  LiveTreeDisposedError,
  reflect_document,
  remove_interaction,
  render_document,
  render_hosted_document,
  replace_interaction,
  TransformError,
  TreeSelector,
  type DocumentContinuation,
  type DocumentLiveMap,
  type Echo,
  type HsonFacade,
  type HsonSchema,
  type LiveHost,
  type LiveMap,
  type LiveMapLibraries,
  type Locus,
  type LocusMultiLibrary,
} from "hson-live";

import { CssManager, make_tree_selector, LIVETREE_DISPOSED_ERROR_CODE } from "hson-live/livetree";
import {
  make_livemap_core,
  make_livemap_store_api,
  snap_live_path,
  type LiveMapCapture,
  type LiveMapCommitObserver,
  type LiveMapReplay,
} from "hson-live/livemap";
import { reflect_collection, type CollectionReflect } from "hson-live/reflect";
import {
  decode_locus_message,
  encode_locus_message,
  make_locus_recovery_planner,
  type LocusClientMessage,
  type LocusRecoveryPlan,
} from "hson-live/locus";
import { start_node_application_host } from "hson-live/livehost/node";
import { create_node_locus_socket } from "hson-live/locus/node";
import {
  create_live_inspector,
  create_live_trace_collector,
  hsonInspect,
  type LiveInspector,
} from "hson-live/diagnostics";
import { assertCanonicalClosure } from "hson-live/diagnostics/transform-test-oracle";
import type { HsonNode, JsonValue, Primitive } from "hson-live/hson";

declare const map: DocumentLiveMap;
declare const element: Element;
declare const echo: Echo<DocumentLiveMap>;
declare const schema: HsonSchema;
const canonical = Hson.certify(schema, Hson`<main/>`);
const data = HsonData.fromHson(Hson`<value 1>`);
const document = HsonDocument.fromHson(Hson`<main/>`);
const continuation: DocumentContinuation = continue_document({ map, root: element });
void continue_hosted_document({ echo, root: element });
void [canonical, data, document, continuation, render_document({ map }), render_hosted_document,
  encode_ssr_bootstrap, decode_ssr_bootstrap];

const facade: HsonFacade = hson;
const normalTypes = null as unknown as LiveMap | LiveMapLibraries | Locus | LocusMultiLibrary | LiveHost;
void [facade, normalTypes, hsonCalc, hsonEcho, hsonLiveMap, hsonLiveTree, hsonLocus,
  hsonReflect, hsonTransform, LiveTree, TreeSelector, TransformError,
  LiveTreeDisposedError, LiveMapDocumentInstallError, reflect_document, link_livemap,
  create_echo, create_locus, create_locus_bootstrap_echo, create_livehost_locus_registry,
  activate_interactions, add_interaction, enable_interactions, remove_interaction, replace_interaction];

declare const core: ReturnType<typeof make_livemap_core>;
declare const capture: LiveMapCapture;
declare const replay: LiveMapReplay;
declare const observer: LiveMapCommitObserver;
declare const collection: CollectionReflect;
declare const clientMessage: LocusClientMessage;
declare const recoveryPlan: LocusRecoveryPlan;
declare const inspector: LiveInspector;
declare const node: HsonNode;
declare const json: JsonValue;
declare const primitive: Primitive;
void [CssManager, make_tree_selector, LIVETREE_DISPOSED_ERROR_CODE, make_livemap_core,
  make_livemap_store_api, snap_live_path, core, capture, replay, observer, reflect_collection,
  collection, decode_locus_message, encode_locus_message, make_locus_recovery_planner,
  clientMessage, recoveryPlan, start_node_application_host, create_node_locus_socket,
  create_live_inspector, create_live_trace_collector, hsonInspect, inspector,
  assertCanonicalClosure, node, json, primitive];

// @ts-expect-error CssManager is owned by /livetree.
import { CssManager as RemovedRootCssManager } from "hson-live";
// @ts-expect-error Replay machinery is owned by /livemap.
import type { LiveMapReplay as RemovedRootReplay } from "hson-live";
// @ts-expect-error Protocol frames are owned by /locus.
import type { LocusClientMessage as RemovedRootProtocol } from "hson-live";
// @ts-expect-error Collection reflection is owned by /reflect.
import { reflect_collection as RemovedRootCollectionReflect } from "hson-live";
// @ts-expect-error Inspection is owned by /diagnostics.
import { hsonInspect as RemovedRootInspector } from "hson-live";
// @ts-expect-error Node hosting is owned by /livehost/node.
import { start_node_application_host as RemovedRootNodeHost } from "hson-live";
// @ts-expect-error Detailed error-code constants are owned by subsystem subpaths.
import { LIVETREE_DISPOSED_ERROR_CODE as RemovedRootErrorCode } from "hson-live";
// @ts-expect-error The broad /types barrel was hard-removed.
import type { BasicValue as RemovedTypesBarrel } from "hson-live/types";
// @ts-expect-error The CSS test-export barrel was hard-removed.
import { render_rule as RemovedTestExport } from "hson-live/diagnostics/test-exports";

void [RemovedRootCssManager, RemovedRootCollectionReflect, RemovedRootInspector,
  RemovedRootNodeHost, RemovedRootErrorCode, RemovedTestExport];
void (0 as unknown as RemovedRootReplay | RemovedRootProtocol | RemovedTypesBarrel);

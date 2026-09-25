import type { PortableAggregateSnapshot } from "./livemap.hosted.internal.types.js";
import type { HsonNode, JsonValue } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import type { HostedLiveMapSnapshot, LiveMapGraphCommit, LiveMapGraphOp, LiveMapSnapshot, LocalLibrariesContinuationSnapshot, LivePath } from "../../types/livemap.types.js";
import { resolveLiveMapNode } from "./livemap.node.js";
import type { LiveMapIdentityEpochController } from "./livemap.identity-epoch.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import type { LiveMapProjectedIdentityOverlay } from "./livemap.projected.identity.js";
import type {
  LiveMapAggregateCommit,
  LiveMapAggregateWrite,
  LiveMapLibraryIdentity,
  LiveMapLibraryState,
  LiveMapStructuralTarget,
} from "./livemap.library.js";
import type { LiveMapSystemIdentity } from "./livemap.system.js";
import type {
  PreparedLiveMapAuthorityTransition,
  LiveMapTransitionController,
} from "./livemap.authority.js";
import type { PreparedDocumentMutation } from "./livemap.document.mutation.js";
import type { LiveMapRuntimeIdentityParticipant } from "./livemap.runtime-identity.js";
import type { LiveMapDocumentPath } from "../../types/livemap.types.js";
import type {
  HostedAggregateCommit,
  HostedRegistry,
  HostedRegistryBinding,
  HostedAuthorityFence,
} from "./livemap.hosted.js";

/** Detached, complete, QUID-free semantic authority at one revision. @internal */
export type LiveMapSemanticCheckpoint = Readonly<{
  authority: HostedAuthorityFence;
  revision: number;
  registry: HostedRegistry;
  libraries: readonly Readonly<{ name: string; root: HsonNode }>[];
}>;

type InternalLiveMapOwner = Readonly<{
  root: () => HsonNode;
}>;

const INTERNAL_OWNERS = new WeakMap<object, InternalLiveMapOwner>();

const INTERNAL_AUTHORITY_POSITION_OBSERVERS = new WeakMap<object, (listener: (revision: number) => void) => () => void>();

/** Selected managed libraries can follow map-wide authority position without a mutation event. @internal */
export function register_internal_authority_position_observer(
  owner: object,
  observe: (listener: (revision: number) => void) => () => void,
): void {
  INTERNAL_AUTHORITY_POSITION_OBSERVERS.set(owner, observe);
}

/** Present on map-backed selected libraries when their owner reports position. @internal */
export function internal_authority_position_observer(
  owner: object,
): ((listener: (revision: number) => void) => () => void) | undefined {
  return INTERNAL_AUTHORITY_POSITION_OBSERVERS.get(owner);
}

/** Non-public aggregate capability used only by architecture acceptance tests. @internal */
export type InternalLiveMapAggregateAuthority = Readonly<{
  /** Insertion-ordered opaque identities; this is an in-package test seam, not a selector API. */
  libraries: () => readonly LiveMapLibraryIdentity[];
  /** Configure the authority's pre-existing Hson-owned interaction state slot. @internal */
  configureSystemState: (
    key: string,
    transportName: string,
    root: HsonNode,
    hsonSchema: HsonSchema,
  ) => LiveMapSystemIdentity;
  systemState: (key: string) => LiveMapSystemIdentity | undefined;
  systemRoot: (system: LiveMapSystemIdentity) => HsonNode;
  systemTarget: (system: LiveMapSystemIdentity, path: LivePath) => import("./livemap.library.js").LiveMapSystemTarget;
  /** Fix public names and exact Schema sources before hosted capture/replay. @internal */
  configureHostedRegistry: (bindings: readonly HostedRegistryBinding[]) => HostedRegistry;
  /** Accept one locally prepared, portable batch as one topology transition. @internal */
  addLibraries: (definitions: readonly Readonly<{
    name: string;
    root: HsonNode;
    hsonSchema: HsonSchema;
    family: "data" | "document";
  }>[], afterInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void) => LiveMapAggregateCommit;
  /** Stage one topology batch under Locus management without installing it. @internal */
  prepareAddLibrariesManaged: (owner: object, definitions: readonly Readonly<{
    name: string;
    root: HsonNode;
    hsonSchema: HsonSchema;
    family: "data" | "document";
  }>[]) => Readonly<{
    transition: PreparedLiveMapAuthorityTransition;
    identities: readonly LiveMapLibraryIdentity[];
  }>;
  hostedRegistry: () => HostedRegistry;
  /** Read the hosted identity and revision without capturing roots. @internal */
  hostedPosition: () => Readonly<{ authority: import("./livemap.hosted.js").HostedAuthorityFence; revision: number; registryDigest: string }>;
  /** Set a supplied hosted identity before the first transition without recapturing roots. @internal */
  setInitialHostedAuthority: (authority: import("./livemap.hosted.js").HostedAuthorityFence) => void;
  /** Capture only preselected application names and the requested system root. @internal */
  captureSelectedHosted: (names: readonly string[], includeSystem: boolean) => Readonly<{
    authority: import("./livemap.hosted.js").HostedAuthorityFence;
    revision: number;
    libraries: readonly Readonly<{ name: string; root: Readonly<{ format: "hson-exact-value"; payload: string }> }>[];
    system: Readonly<{ format: "hson-exact-value"; payload: string }> | null;
  }>;
  /** Bind a fixed authority-projected subset of this client map. @internal */
  configureClientComposition: (snapshot: import("./livemap.hosted.internal.types.js").PortableAggregateSnapshot) => void;
  clientProjection: () => Readonly<{
    authority: import("./livemap.hosted.js").HostedAuthorityFence;
    registry: HostedRegistry;
    revision: number;
    libraries: readonly string[];
  }> | undefined;
  /** Add installed names to the client authority-owned partition. @internal */
  extendClientProjectionManaged: (owner: object, names: readonly string[], expectedDigest: string) => void;
  /** Validate a projected system root now and install it with the next topology transition. @internal */
  prepareClientProjectionSystemManaged: (owner: object, root: HsonNode) => () => void;
  captureLibraries: () => LiveMapSnapshot;
  stylesheet: (library: LiveMapLibraryIdentity) => import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
  commitStylesheet: (library: LiveMapLibraryIdentity, operation: import("../../types/livemap.types.js").LiveMapCssOp) => LiveMapAggregateCommit;
  captureHosted: () => HostedLiveMapSnapshot;
  captureSemanticCheckpoint: () => LiveMapSemanticCheckpoint;
  installSemanticCheckpoint: (checkpoint: LiveMapSemanticCheckpoint) => void;
  restoreLibraries: (snapshot: LiveMapSnapshot, afterTopologyInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void) => void;
  restorePortableLibraries: (snapshot: LocalLibrariesContinuationSnapshot) => void;
  restoreHosted: (snapshot: HostedLiveMapSnapshot, authorityOverride?: import("./livemap.hosted.js").HostedAuthorityFence) => void;
  /** QUID-free network snapshot; installs a fresh local identity epoch. @internal */
  restoreClientHosted: (snapshot: import("./livemap.hosted.internal.types.js").PortableAggregateSnapshot) => void;
  restoreClientHostedManaged: (owner: object, snapshot: import("./livemap.hosted.internal.types.js").PortableAggregateSnapshot,
    afterTopologyInstall?: (projected: readonly Readonly<{ name: string; identity: LiveMapLibraryIdentity }>[],
      retired: readonly LiveMapLibraryIdentity[]) => void) => void;
  /** Apply a transport snapshot while this aggregate is client-managed. @internal */
  restoreHostedManaged: (owner: object, snapshot: HostedLiveMapSnapshot) => void;
  replayHosted: (commit: HostedAggregateCommit) => LiveMapAggregateCommit;
  replayClientHosted: (commit: import("./livemap.hosted.js").PortableAggregateCommit) => LiveMapAggregateCommit;
  /** Replay durable portable effects, including a revision whose effects collapse after identity reset. @internal */
  replayDurableHosted: (commit: import("./livemap.hosted.js").PortableAggregateCommit) => void;
  replayClientHostedManaged: (owner: object, commit: import("./livemap.hosted.js").PortableAggregateCommit, authorityRev?: number) => LiveMapAggregateCommit;
  /** Apply a transport commit while this aggregate is client-managed. @internal */
  replayHostedManaged: (owner: object, commit: HostedAggregateCommit) => LiveMapAggregateCommit;
  /** Advance a managed replica through one effect-free authority revision. @internal */
  advanceHostedProgressManaged: (owner: object, progress: Readonly<{
    logicalMapId: string;
    incarnationId: string;
    registryDigest: string;
    prevRev: number;
    rev: number;
  }>) => number;
  /** Authority position, including commits, progress, and snapshot installation. @internal */
  observeAuthorityPosition: (listener: (revision: number) => void) => () => void;
  target: (library: LiveMapLibraryIdentity, path: LivePath) => LiveMapStructuralTarget;
  root: (library: LiveMapLibraryIdentity) => HsonNode;
  documentOverlay: (library: LiveMapLibraryIdentity) => LiveMapDocumentIdentityOverlay;
  projectedOverlay: (library: LiveMapLibraryIdentity) => LiveMapProjectedIdentityOverlay;
  /** Exact-capture continuity proof for a projected document Library. @internal */
  documentCaptureContinuity: (library: LiveMapLibraryIdentity) => object | undefined;
  identityEpoch: () => LiveMapIdentityEpochController;
  acquireLocalDocumentIdentity: (
    library: LiveMapLibraryIdentity,
    path: LiveMapDocumentPath,
    quid: string,
    participant?: LiveMapRuntimeIdentityParticipant,
  ) => void;
  acquireLocalProjectedIdentity: (library: LiveMapLibraryIdentity, path: LivePath, quid: string) => void;
  snap: (library: LiveMapLibraryIdentity, path?: LivePath) => JsonValue | undefined;
  handle: (library: LiveMapLibraryIdentity, path: LivePath) => InternalLiveMapPathAuthority;
  resolveQuid: (quid: string) => LiveMapStructuralTarget | undefined;
  prepare: (writes: readonly LiveMapAggregateWrite[]) => PreparedLiveMapAuthorityTransition;
  /** Prepare through the Locus-owned management claim. @internal */
  prepareManaged: (
    owner: object,
    writes: readonly LiveMapAggregateWrite[],
  ) => PreparedLiveMapAuthorityTransition;
  /** Detached resulting system root of one prepared transition, before acceptance. @internal */
  preparedSystemRoot: (transition: PreparedLiveMapAuthorityTransition) => HsonNode | undefined;
  accept: LiveMapTransitionController["acceptAuthority"];
  reserve: LiveMapTransitionController["reserveAuthority"];
  discard: LiveMapTransitionController["discardAuthority"];
  /** Claim/release the exclusive aggregate mutation boundary. @internal */
  claimManagement: (owner: object) => void;
  releaseManagement: (owner: object) => void;
  commit: (writes: readonly LiveMapAggregateWrite[]) => LiveMapAggregateCommit;
  /** Commit one already-planned document candidate through the map-global transition. */
  commitDocumentMutation: <TOp extends LiveMapGraphOp>(
    library: LiveMapLibraryIdentity,
    candidate: PreparedDocumentMutation<TOp>,
  ) => LiveMapGraphCommit<TOp>;
  /** Exact selected-document evidence carried by one accepted aggregate commit. */
  documentCommitFor: (
    library: LiveMapLibraryIdentity,
    commit: LiveMapAggregateCommit,
  ) => LiveMapGraphCommit | undefined;
  /** The accepted document root at this commit, even if later revisions were accepted during publication. */
  documentRootFor: (library: LiveMapLibraryIdentity, commit: LiveMapAggregateCommit) => HsonNode | undefined;
  /** Recover the aggregate envelope that accepted one selected-document commit. */
  aggregateCommitForDocument: (commit: LiveMapGraphCommit) => LiveMapAggregateCommit | undefined;
  observe: (listener: (commit: LiveMapAggregateCommit) => void) => () => void;
  /**
   * Observe one atomic hosted aggregate replacement.  This is deliberately a
   * recovery boundary, not a synthetic commit: a snapshot may jump several
   * global revisions and has no operation sequence to replay.
   * @internal
   */
  observeRestore: (listener: (event: Readonly<{
    previousRevision: number;
    revision: number;
    libraries: readonly LiveMapLibraryIdentity[];
    /** Libraries whose canonical roots actually changed at this boundary. */
    changedLibraries: readonly LiveMapLibraryIdentity[];
    continuity: "same-epoch" | "new-epoch";
  }>) => void) => () => void;
  watch: (
    library: LiveMapLibraryIdentity,
    path: LivePath,
    listener: (next: JsonValue | undefined) => void,
  ) => () => void;
  feed: (
    library: LiveMapLibraryIdentity,
    path: LivePath,
    listener: (event: Readonly<{
      commit: LiveMapAggregateCommit;
      path: LivePath;
      operations: readonly import("./livemap.library.js").LiveMapAggregateOperation[];
      value: JsonValue | undefined;
    }>) => void,
  ) => () => void;
  /** Detached application-registry evidence. Local document/data captures remain separate facade concerns. */
  inspect: () => Readonly<{
    revision: number;
    libraries: readonly Readonly<{
      identity: LiveMapLibraryIdentity;
      mode: LiveMapLibraryState["mode"];
      root: HsonNode;
      hsonSchemaAttached: boolean;
    }>[];
  }>;
  telemetry: () => Readonly<{
    candidateRootsCloned: number;
    schemaValidations: number;
    aggregatePublications: number;
    acceptedTransitions: number;
  }>;
}>;

/** Opaque internal data handle whose cache identity includes its library. @internal */
export type InternalLiveMapPathAuthority = Readonly<{
  target: LiveMapStructuralTarget;
  at: (path: LivePath) => InternalLiveMapPathAuthority;
  snap: () => JsonValue | undefined;
}>;

const INTERNAL_AGGREGATE_OWNERS = new WeakMap<object, InternalLiveMapAggregateAuthority>();

/** Register one in-package canonical-state reader. Never exported publicly. */
export function register_internal_livemap_owner(owner: object, root: () => HsonNode): void {
  INTERNAL_OWNERS.set(owner, Object.freeze({ root }));
}

/** Register the hidden multi-library transition seam; it is intentionally not a package API. */
export function register_internal_livemap_aggregate_owner(
  owner: object,
  authority: InternalLiveMapAggregateAuthority,
): void {
  INTERNAL_AGGREGATE_OWNERS.set(owner, authority);
}

/** Read the bounded aggregate architecture seam for focused in-package tests. @internal */
export function internal_livemap_aggregate_authority(owner: object): InternalLiveMapAggregateAuthority {
  const authority = INTERNAL_AGGREGATE_OWNERS.get(owner);
  if (authority === undefined) throw new Error("LiveMap internal aggregate authority is unavailable.");
  return authority;
}

/** In-package inspection and low-level test seam. Never exported publicly. */
export function internal_livemap_root(owner: object): HsonNode {
  const registered = INTERNAL_OWNERS.get(owner);
  if (registered === undefined) throw new Error("LiveMap internal owner is unavailable.");
  return registered.root();
}

/** In-package canonical-node inspection. Never exported publicly. */
export function internal_livemap_node(owner: object, path: LivePath): HsonNode | undefined {
  return resolveLiveMapNode(internal_livemap_root(owner), path);
}

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import type { HostedLiveMapLibrariesSnapshot, LiveMapGraphCommit, LiveMapGraphOp, LiveMapLibrariesSnapshot, LocalLibrariesContinuationSnapshot, LivePath } from "../../types/livemap.types.js";
import { resolveLiveMapNode } from "./livemap.node.js";
import type { LiveMapIdentityEpochController } from "./livemap.identity-epoch.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
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
} from "./livemap.hosted.js";

type InternalLiveMapOwner = Readonly<{
  root: () => HsonNode;
}>;

const INTERNAL_OWNERS = new WeakMap<object, InternalLiveMapOwner>();

type InternalLiveMapLibraryOwner = Readonly<{
  library: () => LiveMapLibraryState;
  revision: () => number;
  identityEpoch: LiveMapIdentityEpochController;
}>;

const INTERNAL_LIBRARY_OWNERS = new WeakMap<object, InternalLiveMapLibraryOwner>();
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
  hostedRegistry: () => HostedRegistry;
  captureLibraries: () => LiveMapLibrariesSnapshot;
  captureHosted: () => HostedLiveMapLibrariesSnapshot;
  restoreLibraries: (snapshot: LiveMapLibrariesSnapshot) => void;
  restorePortableLibraries: (snapshot: LocalLibrariesContinuationSnapshot) => void;
  restoreHosted: (snapshot: HostedLiveMapLibrariesSnapshot) => void;
  /** Apply a transport snapshot while this aggregate is client-managed. @internal */
  restoreHostedManaged: (owner: object, snapshot: HostedLiveMapLibrariesSnapshot) => void;
  replayHosted: (commit: HostedAggregateCommit) => LiveMapAggregateCommit;
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
  accept: LiveMapTransitionController["acceptAuthority"];
  discard: LiveMapTransitionController["discardAuthority"];
  /** Claim/release the same exclusive mutation boundary used by solo Locus. @internal */
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
  /** Recover the aggregate envelope that accepted one selected-document commit. */
  aggregateCommitForDocument: (commit: LiveMapGraphCommit) => LiveMapAggregateCommit | undefined;
  lowerForLegacy: (commit: LiveMapAggregateCommit) => never;
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
  /** Detached application-registry evidence. Solo capture/root remain compatibility-facade concerns. */
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

/** Register non-public ownership evidence for architecture regression tests. */
export function register_internal_livemap_library_owner(
  owner: object,
  library: () => LiveMapLibraryState,
  revision: () => number,
  identityEpoch: LiveMapIdentityEpochController,
): void {
  INTERNAL_LIBRARY_OWNERS.set(owner, Object.freeze({ library, revision, identityEpoch }));
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

/** Inspect ownership without publishing a library-selection API. @internal */
export function internal_livemap_library_ownership(owner: object): Readonly<{
  library: object;
  mode: LiveMapLibraryState["mode"];
  root: HsonNode;
  hsonSchemaAttached: boolean;
  revision: number;
  quidEpoch: number;
  issuedQuids: number;
}> {
  const registered = INTERNAL_LIBRARY_OWNERS.get(owner);
  if (registered === undefined) throw new Error("LiveMap internal library owner is unavailable.");
  const library = registered.library();
  return Object.freeze({
    library: library.identity,
    mode: library.mode,
    root: library.root,
    hsonSchemaAttached: library.hsonSchema !== undefined,
    revision: registered.revision(),
    quidEpoch: registered.identityEpoch.current(),
    issuedQuids: registered.identityEpoch.issued().size,
  });
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

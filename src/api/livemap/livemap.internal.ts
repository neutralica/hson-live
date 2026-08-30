import type { HsonNode, JsonValue } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import type { LivePath } from "../../types/livemap.types.js";
import { resolveLiveMapNode } from "./livemap.node.js";
import type { LiveMapIdentityEpochController } from "./livemap.identity-epoch.js";
import type {
  LiveMapAggregateCommit,
  LiveMapAggregateWrite,
  LiveMapLibraryIdentity,
  LiveMapLibraryState,
  LiveMapStructuralTarget,
} from "./livemap.library.js";
import type {
  PreparedLiveMapAggregateTransition,
  LiveMapTransitionController,
} from "./livemap.authority.js";

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

/** Non-public aggregate capability used only by architecture acceptance tests. @internal */
export type InternalLiveMapAggregateAuthority = Readonly<{
  defaultLibrary: () => LiveMapLibraryIdentity;
  addLibrary: (root: HsonNode, options?: Readonly<{ hsonSchema?: HsonSchema }>) => LiveMapLibraryIdentity;
  target: (library: LiveMapLibraryIdentity, path: LivePath) => LiveMapStructuralTarget;
  root: (library: LiveMapLibraryIdentity) => HsonNode;
  snap: (library: LiveMapLibraryIdentity, path?: LivePath) => JsonValue | undefined;
  handle: (library: LiveMapLibraryIdentity, path: LivePath) => InternalLiveMapPathAuthority;
  resolveQuid: (quid: string) => LiveMapStructuralTarget | undefined;
  prepare: (writes: readonly LiveMapAggregateWrite[]) => PreparedLiveMapAggregateTransition;
  accept: LiveMapTransitionController["acceptAggregate"];
  discard: LiveMapTransitionController["discardAggregate"];
  commit: (writes: readonly LiveMapAggregateWrite[]) => LiveMapAggregateCommit;
  lowerForLegacy: (commit: LiveMapAggregateCommit) => never;
  observe: (listener: (commit: LiveMapAggregateCommit) => void) => () => void;
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
  telemetry: () => Readonly<{
    candidateRootsCloned: number;
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

import type { HsonNode } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import type { LiveMapAnyOp, LiveMapRootMode, LivePath } from "../../types/livemap.types.js";
import type { PreparedLiveMapRoot } from "./livemap.document.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import type { LiveMapProjectedIdentityOverlay } from "./livemap.projected.identity.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";

/**
 * Opaque, map-local library authority. It intentionally has no string form:
 * public paths stay local to their canonical graph and never encode a library.
 * @internal
 */
export type LiveMapLibraryIdentity = object;

/** A graph-local coordinate; QUID resolution may later lower to this shape. @internal */
export type LiveMapStructuralTarget = Readonly<{
  library: LiveMapLibraryIdentity;
  path: LivePath;
}>;

/** One library-qualified operation in the map-global internal order. @internal */
export type LiveMapAggregateOperation = Readonly<{
  target: LiveMapStructuralTarget;
  operation: LiveMapAnyOp;
}>;

/**
 * The authoritative internal commit shape for an aggregate transition.
 *
 * It deliberately has no legacy transport payload. The existing public/Locus
 * envelope remains a single-library lowering boundary and must reject this
 * shape rather than silently dropping library coordinates.
 * @internal
 */
export type LiveMapAggregateCommit = Readonly<{
  kind: "aggregate";
  changed: boolean;
  prevRev: number;
  rev: number;
  operations: readonly LiveMapAggregateOperation[];
}>;

/** Narrow internal write request used only by aggregate-library tests. @internal */
export type LiveMapAggregateWrite =
  | Readonly<{
    target: LiveMapStructuralTarget;
    kind: "set" | "replace" | "delete";
    value?: unknown;
  }>
  | Readonly<{
    target: LiveMapStructuralTarget;
    kind: "ensure-quid";
    quid: string;
  }>;

/** Reject accidental lowering of an aggregate commit into the path-only legacy envelope. @internal */
export function reject_livemap_aggregate_legacy_lowering(
  _commit: LiveMapAggregateCommit,
): never {
  throw new Error(
    "LiveMap aggregate commit cannot be serialized through the legacy single-root commit boundary.",
  );
}

/**
 * State owned by one canonical graph under a LiveMap.
 *
 * This deliberately excludes revision, transition, publication, lifecycle, and
 * QUID epoch/issued-ledger authority. Those remain singular and map-global so a
 * future subject move between libraries can retain its raw QUID.
 * @internal
 */
export type LiveMapLibraryState = {
  readonly identity: LiveMapLibraryIdentity;
  readonly mode: LiveMapRootMode;
  root: HsonNode;
  documentOverlay?: LiveMapDocumentIdentityOverlay;
  projectedOverlay?: LiveMapProjectedIdentityOverlay;
  projectedValue?: OrderedProjectedValue;
  hsonSchema?: HsonSchema;
};

/**
 * Deterministic, map-owned registry for graph-local repositories.
 *
 * The registry deliberately has no names, public ids, or construction policy.
 * It is only the authority layer that keeps an opaque library identity bound to
 * one canonical graph for the lifetime of its enclosing LiveMap.
 * @internal
 */
export type LiveMapLibraryRegistry = Readonly<{
  defaultLibrary: () => LiveMapLibraryState;
  get: (identity: LiveMapLibraryIdentity) => LiveMapLibraryState | undefined;
  require: (identity: LiveMapLibraryIdentity) => LiveMapLibraryState;
  all: () => readonly LiveMapLibraryState[];
  add: (library: LiveMapLibraryState) => void;
  size: () => number;
}>;

/** Create the sole, stable internal library for the lifetime of this LiveMap. @internal */
export function make_default_livemap_library(
  prepared: PreparedLiveMapRoot,
  hsonSchema?: HsonSchema,
): LiveMapLibraryState {
  return make_livemap_library(prepared, hsonSchema);
}

/** Create one opaque graph-local library record. @internal */
export function make_livemap_library(
  prepared: PreparedLiveMapRoot,
  hsonSchema?: HsonSchema,
): LiveMapLibraryState {
  return {
    identity: Object.freeze(Object.create(null)),
    mode: prepared.mode,
    root: prepared.root,
    ...(prepared.documentOverlay === undefined ? {} : { documentOverlay: prepared.documentOverlay }),
    ...(prepared.projectedOverlay === undefined ? {} : { projectedOverlay: prepared.projectedOverlay }),
    ...(hsonSchema === undefined ? {} : { hsonSchema }),
  };
}

/**
 * Make one internal registry with insertion-ordered iteration.
 *
 * The first registered record is the legacy default/solo library. This is an
 * internal topology fact only: it does not choose a future public default for
 * a multi-library LiveMap.
 * @internal
 */
export function make_livemap_library_registry(
  initialLibrary: LiveMapLibraryState,
): LiveMapLibraryRegistry {
  const entries = new Map<LiveMapLibraryIdentity, LiveMapLibraryState>();
  const ordered: LiveMapLibraryState[] = [];

  const add = (library: LiveMapLibraryState): void => {
    if (entries.has(library.identity)) {
      throw new Error("LiveMap library registry cannot register one identity twice.");
    }
    entries.set(library.identity, library);
    ordered.push(library);
  };

  add(initialLibrary);
  return Object.freeze({
    defaultLibrary: () => initialLibrary,
    get: (identity) => entries.get(identity),
    require: (identity) => {
      const library = entries.get(identity);
      if (library !== undefined) return library;
      throw new Error("LiveMap aggregate target belongs to another map authority.");
    },
    all: () => Object.freeze([...ordered]),
    add,
    size: () => ordered.length,
  });
}

/** Keep structural targeting separate from a path's public spelling. @internal */
export function livemap_library_target(
  library: LiveMapLibraryState,
  path: LivePath,
): LiveMapStructuralTarget {
  return Object.freeze({ library: library.identity, path });
}

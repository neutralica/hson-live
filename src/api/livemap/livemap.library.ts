import type { HsonNode } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import type { LiveMapAnyOp, LiveMapRootMode, LivePath } from "../../types/livemap.types.js";
import type { PreparedLiveMapRoot } from "./livemap.document.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import type { LiveMapProjectedIdentityOverlay } from "./livemap.projected.identity.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { HostedAggregateCommit } from "./livemap.hosted.js";
import type { LiveMapProjectedDataOp } from "./livemap.transport.js";
import type { LiveMapSystemIdentity } from "./livemap.system.js";
import { empty_portable_document_stylesheet, type PortableDocumentStylesheet } from "../../internal/css/portable-document-stylesheet.js";
import type { LiveMapCssOp } from "../../types/livemap.types.js";

/**
 * Opaque, map-local library authority. It intentionally has no string form:
 * public paths stay local to their canonical graph and never encode a library.
 * @internal
 */
export type LiveMapLibraryIdentity = object;

/** A graph-local coordinate; QUID resolution may later lower to this shape. @internal */
export type LiveMapStructuralTarget = Readonly<{
  domain: "application";
  library: LiveMapLibraryIdentity;
  system?: never;
  path: LivePath;
}>;

/** A coordinate in canonical Hson-owned state, outside application topology. @internal */
export type LiveMapSystemTarget = Readonly<{
  domain: "system";
  system: LiveMapSystemIdentity;
  library?: never;
  path: LivePath;
}>;

export type LiveMapAuthorityTarget = LiveMapStructuralTarget | LiveMapSystemTarget;

/** One library-qualified operation in the map-global internal order. @internal */
export type LiveMapAggregateOperation = Readonly<{
  target: LiveMapAuthorityTarget;
  operation: LiveMapAnyOp;
  /** Carrier-native evidence for exact data transport. @internal */
  projected?: LiveMapProjectedDataOp;
}>;

/**
 * The authoritative internal commit shape for one map-global transition.
 *
 * Its operations carry library coordinates. Portable projections and durable
 * records encode those coordinates explicitly.
 * @internal
 */
export type LiveMapAggregateCommit = Readonly<{
  kind: "aggregate";
  changed: boolean;
  prevRev: number;
  rev: number;
  operations: readonly LiveMapAggregateOperation[];
  /** One local portable stylesheet operation, owned by a document Library. */
  css?: Readonly<{ library: LiveMapLibraryIdentity; operation: LiveMapCssOp }>;
  /** The shared portable topology effect for local and hosted admission. */
  topology?: import("../../types/livemap.types.js").LiveMapLibraryAddOperation;
  /** Exact named replay envelope when this aggregate has a configured hosted registry. @internal */
  hosted?: HostedAggregateCommit;
}>;

/** Narrow internal write request used only by aggregate-library tests. @internal */
export type LiveMapAggregateWrite =
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "set-key";
    key: string;
    value: OrderedProjectedValue;
  }>
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "set" | "replace" | "delete";
    value?: unknown;
  }>
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "splice";
    start: number;
    deleteCount: number;
    items: readonly OrderedProjectedValue[];
  }>
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "rename";
    from: string;
    to: string;
  }>
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "move";
    from: number;
    to: number;
  }>
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "ensure-quid";
    quid: string;
  }>
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "graph";
    operation: import("../../types/livemap.types.js").LiveMapGraphOp;
  }>
  | Readonly<{
    target: LiveMapAuthorityTarget;
    kind: "replay-data";
    operation: import("./livemap.transport.js").LiveMapProjectedDataOp;
  }>;

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
  stylesheet?: PortableDocumentStylesheet;
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
  add: (libraries: readonly LiveMapLibraryState[]) => void;
  replace: (libraries: readonly LiveMapLibraryState[]) => void;
  get: (identity: LiveMapLibraryIdentity) => LiveMapLibraryState | undefined;
  require: (identity: LiveMapLibraryIdentity) => LiveMapLibraryState;
  all: () => readonly LiveMapLibraryState[];
  size: () => number;
}>;

/** Create one opaque graph-local library record. @internal */
export function make_livemap_library(
  prepared: PreparedLiveMapRoot,
  hsonSchema?: HsonSchema,
): LiveMapLibraryState {
  return {
    identity: Object.freeze(Object.create(null)),
    mode: prepared.mode,
    root: prepared.root,
    ...(prepared.mode === "document" ? { stylesheet: empty_portable_document_stylesheet() } : {}),
    ...(prepared.documentOverlay === undefined ? {} : { documentOverlay: prepared.documentOverlay }),
    ...(prepared.projectedOverlay === undefined ? {} : { projectedOverlay: prepared.projectedOverlay }),
    ...(hsonSchema === undefined ? {} : { hsonSchema }),
  };
}

/**
 * Make one internal registry with insertion-ordered iteration.
 *
 * Initial records are admitted together, before the map accepts transitions.
 * @internal
 */
export function make_livemap_library_registry(
  initialLibraries: readonly LiveMapLibraryState[],
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

  for (const library of initialLibraries) add(library);
  return Object.freeze({
    add: (libraries) => {
      const staged = new Set<LiveMapLibraryIdentity>();
      for (const library of libraries) {
        if (entries.has(library.identity) || staged.has(library.identity)) {
          throw new Error("LiveMap library registry cannot register one identity twice.");
        }
        staged.add(library.identity);
      }
      for (const library of libraries) add(library);
    },
    replace: (libraries) => {
      const identities = new Set(libraries.map((library) => library.identity));
      if (identities.size !== libraries.length) {
        throw new Error("LiveMap replacement registry contains duplicate identities.");
      }
      entries.clear();
      ordered.length = 0;
      for (const library of libraries) add(library);
    },
    get: (identity) => entries.get(identity),
    require: (identity) => {
      const library = entries.get(identity);
      if (library !== undefined) return library;
      throw new Error("LiveMap aggregate target belongs to another map authority.");
    },
    all: () => Object.freeze([...ordered]),
    size: () => ordered.length,
  });
}

/** Keep structural targeting separate from a path's public spelling. @internal */
export function livemap_library_target(
  library: LiveMapLibraryState,
  path: LivePath,
): LiveMapStructuralTarget {
  return Object.freeze({ domain: "application", library: library.identity, path });
}

/** Keep system coordinates out of the application Library registry. @internal */
export function livemap_system_target(
  system: LiveMapSystemIdentity,
  path: LivePath,
): LiveMapSystemTarget {
  return Object.freeze({ domain: "system", system, path });
}

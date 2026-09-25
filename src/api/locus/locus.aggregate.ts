import type { JsonValue } from "../../core/types.js";
import { ExactDataCarrier } from "../data/hson-data.js";
import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentContent,
  LiveMapGraphOp,
  LiveMap,
  LiveMapDefinitions,
  LivePath,
} from "../../types/livemap.types.js";
import type { LocusActionOrigin, LocusClientActionMessage } from "../../types/locus.types.js";
import {
  internal_livemap_aggregate_authority,
  type InternalLiveMapAggregateAuthority,
} from "../livemap/livemap.internal.js";
import type {
  LiveMapAggregateWrite,
  LiveMapLibraryIdentity,
} from "../livemap/livemap.library.js";
import {
  type HostedAggregateCommit,
} from "../livemap/livemap.hosted.js";
import { admit_public_document_graph_operation } from "../livemap/livemap.document.mutation.js";
import type { PreparedLiveMapAuthorityTransition } from "../livemap/livemap.authority.js";
import { prepare_hosted_livemap_library_add_internal } from "../livemap/livemap.libraries.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import {
  is_ordered_projected_object,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import {
  INTERACTION_RESERVED_LIBRARY_KEY,
  register_interaction_draft_internal,
} from "../../internal/interaction-storage.js";

/** Maximum current hosted socket frame size. */
export const DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES = 4 * 1_024 * 1_024;

/** Complete exact living-authority history envelope, never a client message. */
export type LocusHostedAggregateAuthorityEnvelope = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  registryDigest: string;
  commit: HostedAggregateCommit;
}>;

export type LocusHostedAggregateDataDraft = Readonly<{
  at: (path: LivePath) => Readonly<{
    set: (value: JsonValue) => void;
    replace: (value: JsonValue) => void;
    delete: () => void;
  }>;
}>;

type LocusHostedAggregateDocumentGraphMutation = Exclude<LiveMapGraphOp, Readonly<{ op: "ensure-quid" }>>;

export type LocusHostedAggregateDocumentDraft = Readonly<{
  /** Stage an existing portable document stylesheet operation at this Library's authority gate. */
  css: (operation: import("../../types/livemap.types.js").LiveMapCssOp) => void;
  /** The selected library is separate from the document-local graph target. */
  graph: (operation: LocusHostedAggregateDocumentGraphMutation) => void;
  attrs: Readonly<{
    set: (target: LiveMapDocumentCommitTarget, name: string, value: LiveMapDocumentAttributeValue) => void;
    drop: (target: LiveMapDocumentCommitTarget, name: string) => void;
    replace: (target: LiveMapDocumentCommitTarget, attrs: LiveMapDocumentAttrs) => void;
  }>;
  content: Readonly<{
    replace: (target: LiveMapDocumentCommitTarget, index: number, replacement: LiveMapDocumentContent) => void;
    insert: (target: LiveMapDocumentCommitTarget, index: number, content: LiveMapDocumentContent) => void;
    remove: (target: LiveMapDocumentCommitTarget, index: number) => void;
    move: (target: LiveMapDocumentCommitTarget, from: number, to: number) => void;
  }>;
}>;

export type LocusHostedAggregateDraft = Readonly<{
  lib: (name: string) => LocusHostedAggregateDataDraft | LocusHostedAggregateDocumentDraft;
}>;

export type LocusHostedAggregateActionContext = Readonly<{
  map: LiveMap;
  origin: LocusActionOrigin;
  /**
   * Add work to this action's one aggregate candidate. Nothing becomes visible
   * until the action returns and the single prepared transition is accepted.
   */
  mutate: (mutation: (draft: LocusHostedAggregateDraft) => void) => Promise<void>;
}>;

export type LocusHostedAggregateAction = (
  context: LocusHostedAggregateActionContext,
  payload: ExactDataCarrier | undefined,
  message?: LocusClientActionMessage,
) => unknown | void | Promise<unknown | void>;

export type LocusHostedAggregateGateInput = Readonly<{
  transition: PreparedLiveMapAuthorityTransition;
  commit: HostedAggregateCommit;
  baseRevision: number;
  nextRevision: number;
}>;

export type LocusHostedAggregatePreaccept = Readonly<{
  /** Install an already prepared retained-history decision after runtime installation. */
  install?: () => void;
  /** Release the session admission fence on either outcome. */
  release?: () => void;
}>;

export type LocusHostedAggregateOptions = Readonly<{
  map: LiveMap;
  actions?: Readonly<Record<string, LocusHostedAggregateAction>>;
  /** The existing Locus pre-accept/durability boundary, at aggregate granularity. */
  gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
  /** Validate and retain the portable record before the session roster cut. @internal */
  prepareGate?: (input: LocusHostedAggregateGateInput) => void;
  /** Synchronous semantic/session/history preflight before the durable gate. @internal */
  beforeAccept?: (input: LocusHostedAggregateGateInput) => LocusHostedAggregatePreaccept | void;
  /** Whether a gate failure may mean the durable record was written. @internal */
  uncertainGateFailure?: (cause: unknown) => boolean;
  /** Notification that this authority can no longer serve safely. @internal */
  onFault?: (cause: unknown) => void;
}>;

export type LocusHostedAggregate = Readonly<{
  map: LiveMap;
  readonly logicalMapId: string;
  readonly incarnationId: string;
  readonly registryDigest: string;
  readonly rev: number;
  mutate: (mutation: (draft: LocusHostedAggregateDraft) => void | Promise<void>) => Promise<HostedAggregateCommit | undefined>;
  /** @internal Stage one ordinary LiveMap library-add batch through this authority's gate. */
  add_libraries_internal: (definitions: LiveMapDefinitions, afterInstall?: () => void) => Promise<HostedAggregateCommit>;
  dispatch_action: (name: string, payload?: ExactDataCarrier | JsonValue, message?: LocusClientActionMessage, origin?: LocusActionOrigin) => Promise<unknown | void>;
  /** @internal Ordered non-mutation barrier shared with aggregate mutations. */
  run_exclusive: <TResult>(operation: () => TResult | Promise<TResult>) => Promise<TResult>;
  /** Internal exact transition feed for retained authority history. */
  on_commit: (listener: (commit: HostedAggregateCommit) => void) => () => void;
  dispose: () => void;
}>;

/**
 * Internal aggregate server authority. It owns one existing aggregate LiveMap
 * and lowers every action into exactly one exact map-authority transition.
 */
export function create_locus_hosted_aggregate_internal(
  options: LocusHostedAggregateOptions,
): LocusHostedAggregate {
  const aggregate = internal_livemap_aggregate_authority(options.map);
  const snapshot = aggregate.hostedPosition();
  const owner = Object.freeze({});
  const commitListeners = new Set<(commit: HostedAggregateCommit) => void>();
  let disposed = false;
  let faulted = false;
  let reservedDecision = false;
  let tail = Promise.resolve();
  const directOrigin: LocusActionOrigin = Object.freeze({ kind: "direct" });

  aggregate.claimManagement(owner);

  const accept_prepared = async (
    transition: PreparedLiveMapAuthorityTransition,
    afterInstall?: () => void,
  ): Promise<HostedAggregateCommit> => {
    const hosted = transition.commit.hosted;
    if (hosted === undefined) {
      aggregate.discard(transition);
      throw new Error("Hosted map-authority transition did not produce exact replay evidence.");
    }
    const gateInput = Object.freeze({ transition, commit: hosted,
      baseRevision: transition.baseRevision, nextRevision: transition.nextRevision });
    let releaseReservation: (() => void) | undefined;
    let preaccept: LocusHostedAggregatePreaccept | void;
    try {
      options.prepareGate?.(gateInput);
      releaseReservation = aggregate.reserve(transition);
      reservedDecision = true;
      preaccept = options.beforeAccept?.(gateInput);
    } catch (cause) {
      aggregate.discard(transition);
      releaseReservation?.();
      reservedDecision = false;
      if (disposed && !faulted) aggregate.releaseManagement(owner);
      throw cause;
    }
    let durableDecision = false;
    try {
      try {
        await options.gate?.(gateInput);
        durableDecision = true;
      } catch (cause) {
        if (options.uncertainGateFailure?.(cause)) {
          faulted = true;
          try { options.onFault?.(cause); } catch { /* The authority remains fenced. */ }
        }
        throw cause;
      }
      // The reserved transition is installed only after its durable decision.
      const accepted = aggregate.accept(transition, "isolate", () => {
        afterInstall?.();
        preaccept?.install?.();
      }).commit;
      const acceptedHosted = accepted.hosted;
      if (acceptedHosted === undefined) throw new Error("Accepted hosted commit is unavailable.");
      for (const listener of [...commitListeners]) {
        try { listener(acceptedHosted); } catch { /* External observers are isolated. */ }
      }
      return acceptedHosted;
    } catch (cause) {
      if (durableDecision) {
        faulted = true;
        try { options.onFault?.(cause); } catch { /* The authority remains fenced. */ }
      } else {
        aggregate.discard(transition);
      }
      throw cause;
    } finally {
      preaccept?.release?.();
      releaseReservation?.();
      reservedDecision = false;
      if (disposed && !faulted) aggregate.releaseManagement(owner);
    }
  };

  const enqueue = <T>(
    operation: (draft: LocusHostedAggregateDraft) => T | Promise<T>,
  ): Promise<Readonly<{ result: T; commit: HostedAggregateCommit | undefined }>> => {
    const run = async (): Promise<Readonly<{ result: T; commit: HostedAggregateCommit | undefined }>> => {
      if (disposed || faulted) throw new Error("Hosted aggregate Locus authority is closed or faulted.");
      const accumulator = make_managed_aggregate_draft(aggregate);
      let result: T;
      try {
        result = await operation(accumulator.draft);
      } finally {
        accumulator.close();
      }
      const writes = accumulator.writes();
      if (writes.length === 0) return Object.freeze({ result, commit: undefined });

      const transition = aggregate.prepareManaged(owner, writes);
      return Object.freeze({ result, commit: await accept_prepared(transition) });
    };
    const next = tail.then(run, run);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };

  return Object.freeze({
    map: options.map,
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    get registryDigest() { return aggregate.hostedPosition().registryDigest; },
    get rev() { return options.map.rev; },
    async mutate(mutation) {
      return (await enqueue(mutation)).commit;
    },
    add_libraries_internal(definitions, afterInstall) {
      const run = async (): Promise<HostedAggregateCommit> => {
        if (disposed || faulted) throw new Error("Hosted aggregate Locus authority is closed or faulted.");
        const prepared = prepare_hosted_livemap_library_add_internal(options.map, owner, definitions);
        return accept_prepared(prepared.transition, () => {
          prepared.afterInstall();
          afterInstall?.();
        });
      };
      const next = tail.then(run, run);
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
    async dispatch_action(name, payload, message, origin = directOrigin) {
      const action = options.actions?.[name];
      if (action === undefined) throw new Error(`Unknown hosted aggregate Locus action: ${name}`);
      const admittedPayload = payload === undefined ? undefined : ExactDataCarrier.from(payload);
      return (await enqueue(async (draft) => {
        const context: LocusHostedAggregateActionContext = Object.freeze({
          map: options.map,
          origin,
          mutate: async (mutation) => { mutation(draft); },
        });
        return action(context, admittedPayload, message);
      })).result;
    },
    run_exclusive<TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> {
      const run = async (): Promise<TResult> => {
        if (disposed || faulted) throw new Error("Hosted aggregate Locus authority is closed or faulted.");
        return operation();
      };
      const next = tail.then(run, run);
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
    on_commit(listener) {
      commitListeners.add(listener);
      return () => { commitListeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!faulted && !reservedDecision) aggregate.releaseManagement(owner);
    },
  });
}

function make_managed_aggregate_draft(
  aggregate: InternalLiveMapAggregateAuthority,
): Readonly<{
  draft: LocusHostedAggregateDraft;
  writes: () => readonly LiveMapAggregateWrite[];
  close: () => void;
}> {
  const registry = aggregate.hostedRegistry();
  const identities = aggregate.libraries();
  const byName = new Map<string, Readonly<{ identity: LiveMapLibraryIdentity; mode: string }>>();
  let applicationIndex = 0;
  for (let index = 0; index < registry.libraries.length; index += 1) {
    const library = registry.libraries[index];
    if (library === undefined) {
      throw new Error("Hosted aggregate registry identity binding is unavailable.");
    }
    if (library.scope !== "hson-internal") {
      const identity = identities[applicationIndex];
      applicationIndex += 1;
      if (identity === undefined) throw new Error("Hosted application registry identity binding is unavailable.");
      byName.set(library.name, Object.freeze({ identity, mode: library.mode }));
    }
  }
  const writes: LiveMapAggregateWrite[] = [];
  let open = true;
  const assert_open = (): void => {
    if (!open) throw new Error("Hosted aggregate Locus draft is expired.");
  };
  const selected = (name: string): LocusHostedAggregateDataDraft | LocusHostedAggregateDocumentDraft => {
    assert_open();
    const binding = byName.get(name);
    if (binding === undefined) throw new Error(`Unknown hosted aggregate Library ${JSON.stringify(name)}.`);
    if (binding.mode === "document") {
      const graph = (operation: LiveMapGraphOp): void => {
        assert_open();
        admit_public_document_graph_operation(operation);
        const path = operation.op === "replace-root" ? [] : operation.target.path;
        writes.push(Object.freeze({
          target: aggregate.target(binding.identity, path),
          kind: "graph",
          operation,
        }));
      };
      const attrs: LocusHostedAggregateDocumentDraft["attrs"] = Object.freeze({
        set: (target, name, value) => graph(Object.freeze({ domain: "graph", op: "set-attr", target, name, value })),
        drop: (target, name) => graph(Object.freeze({ domain: "graph", op: "remove-attr", target, name })),
        replace: (target, attrs) => graph(Object.freeze({ domain: "graph", op: "replace-attrs", target, attrs })),
      });
      const content: LocusHostedAggregateDocumentDraft["content"] = Object.freeze({
        replace: (target, index, replacement) => graph(Object.freeze({ domain: "graph", op: "replace-content", target, index, replacement })),
        insert: (target, index, content) => graph(Object.freeze({ domain: "graph", op: "insert-content", target, index, content })),
        remove: (target, index) => graph(Object.freeze({ domain: "graph", op: "remove-content", target, index })),
        move: (target, from, to) => graph(Object.freeze({ domain: "graph", op: "move-content", target, from, to })),
      });
      return Object.freeze({
        css: (operation: import("../../types/livemap.types.js").LiveMapCssOp) => {
          assert_open();
          writes.push(Object.freeze({ target: aggregate.target(binding.identity, []), kind: "css", operation }));
        },
        graph,
        attrs,
        content,
      });
    }
    return Object.freeze({
      at(path) {
        const target = aggregate.target(binding.identity, path);
        return Object.freeze({
          set(value) {
            assert_open();
            writes.push(Object.freeze({ target, kind: "set", value }));
          },
          replace(value) {
            assert_open();
            writes.push(Object.freeze({ target, kind: "replace", value }));
          },
          delete() {
            assert_open();
            writes.push(Object.freeze({ target, kind: "delete" }));
          },
        });
      },
    });
  };
  const draft = Object.freeze({ lib: selected });
  const interactionSystem = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  if (interactionSystem !== undefined) {
    const interactionRoot = projected_value_from_hson_node(aggregate.systemRoot(interactionSystem));
    if (!is_ordered_projected_object(interactionRoot)) {
      throw new Error("Canonical interaction Library root is malformed.");
    }
    const initialInteractionValue = interactionRoot.entries.find(([name]) => name === "descriptors")?.[1];
    if (initialInteractionValue === undefined) {
      throw new Error("Canonical interaction descriptor collection is missing.");
    }
    let interactionValue: OrderedProjectedValue = initialInteractionValue;
    register_interaction_draft_internal(
      draft,
      interactionSystem,
      () => interactionValue,
      (value) => {
        assert_open();
        interactionValue = value;
        writes.push(Object.freeze({
          target: aggregate.systemTarget(interactionSystem, ["descriptors"]),
          kind: "replace",
          value,
        }));
      },
    );
  }
  return Object.freeze({
    draft,
    writes: () => Object.freeze([...writes]),
    close: () => { open = false; },
  });
}

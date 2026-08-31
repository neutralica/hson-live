import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentContent,
  LiveMapGraphOp,
  LiveMapLibraries,
  LivePath,
} from "../../types/livemap.types.js";
import {
  internal_livemap_aggregate_authority,
  type InternalLiveMapAggregateAuthority,
} from "../livemap/livemap.internal.js";
import type {
  LiveMapAggregateCommit,
  LiveMapAggregateWrite,
  LiveMapLibraryIdentity,
} from "../livemap/livemap.library.js";
import {
  HOSTED_MAX_COMMIT_BYTES,
  type HostedAggregateCommit,
  type HostedAggregateSnapshot,
} from "../livemap/livemap.hosted.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import type { PreparedLiveMapAggregateTransition } from "../livemap/livemap.authority.js";

/** Internal H2 wire marker. The enclosed commit is the exact H1 commit. */
export const LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT = "hson-locus-hosted-aggregate-h2" as const;
/** Keep the H2 live path inside the existing Locus four-megabyte history budget. */
export const DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES = 4 * 1_024 * 1_024;

export type LocusHostedAggregateWireEnvelope = Readonly<{
  format: typeof LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT;
  logicalMapId: string;
  incarnationId: string;
  registryDigest: string;
  commit: HostedAggregateCommit;
}>;

export type LocusHostedAggregateWireMessage = Readonly<{
  type: "commit";
  id: "hosted-aggregate";
  commit: LocusHostedAggregateWireEnvelope;
}>;

export type LocusHostedAggregateDataDraft = Readonly<{
  at: (path: LivePath) => Readonly<{
    set: (value: JsonValue) => void;
    replace: (value: JsonValue) => void;
    delete: () => void;
    ensureQuid: (quid: string) => void;
  }>;
}>;

export type LocusHostedAggregateDocumentDraft = Readonly<{
  /** The selected library is separate from the document-local graph target. */
  graph: (operation: LiveMapGraphOp) => void;
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
  map: LiveMapLibraries;
  /**
   * Add work to this action's one aggregate candidate. Nothing becomes visible
   * until the action returns and the single prepared transition is accepted.
   */
  mutate: (mutation: (draft: LocusHostedAggregateDraft) => void) => Promise<void>;
}>;

export type LocusHostedAggregateAction = (
  context: LocusHostedAggregateActionContext,
  payload: JsonValue | undefined,
) => JsonValue | void | Promise<JsonValue | void>;

export type LocusHostedAggregateGateInput = Readonly<{
  transition: PreparedLiveMapAggregateTransition;
  commit: HostedAggregateCommit;
  baseRevision: number;
  nextRevision: number;
}>;

export type LocusHostedAggregateOptions = Readonly<{
  map: LiveMapLibraries;
  actions?: Readonly<Record<string, LocusHostedAggregateAction>>;
  /** The existing Locus pre-accept/durability boundary, at aggregate granularity. */
  gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
  /** Optional internal live transport sink. One accepted transition emits once. */
  send?: (wire: string) => void;
  maxWireBytes?: number;
}>;

export type LocusHostedAggregate = Readonly<{
  map: LiveMapLibraries;
  readonly logicalMapId: string;
  readonly incarnationId: string;
  readonly registryDigest: string;
  readonly rev: number;
  mutate: (mutation: (draft: LocusHostedAggregateDraft) => void | Promise<void>) => Promise<HostedAggregateCommit | undefined>;
  dispatch_action: (name: string, payload?: JsonValue) => Promise<JsonValue | void>;
  on_wire: (listener: (wire: string) => void) => () => void;
  dispose: () => void;
}>;

export type LocusHostedAggregateClient = Readonly<{
  map: LiveMapLibraries;
  readonly logicalMapId: string;
  readonly incarnationId: string;
  readonly registryDigest: string;
  readonly rev: number;
  apply_wire: (wire: string) => LiveMapAggregateCommit;
}>;

/**
 * Internal H2 server authority. It owns one existing aggregate LiveMap and
 * lowers every action into exactly one H1 aggregate transition.
 */
export function create_locus_hosted_aggregate_internal(
  options: LocusHostedAggregateOptions,
): LocusHostedAggregate {
  const aggregate = internal_livemap_aggregate_authority(options.map);
  const snapshot = aggregate.captureHosted();
  const owner = Object.freeze({});
  const maxWireBytes = valid_wire_bound(options.maxWireBytes);
  const listeners = new Set<(wire: string) => void>();
  let disposed = false;
  let tail = Promise.resolve();

  aggregate.claimManagement(owner);

  const enqueue = <T>(
    operation: (draft: LocusHostedAggregateDraft) => T | Promise<T>,
  ): Promise<Readonly<{ result: T; commit: HostedAggregateCommit | undefined }>> => {
    const run = async (): Promise<Readonly<{ result: T; commit: HostedAggregateCommit | undefined }>> => {
      if (disposed) throw new Error("Hosted aggregate Locus authority is closed.");
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
      const hosted = transition.commit.hosted;
      if (hosted === undefined) {
        aggregate.discard(transition);
        throw new Error("Hosted aggregate transition did not produce H1 replay evidence.");
      }
      let wire: string;
      try {
        wire = encode_locus_hosted_aggregate_wire(hosted, maxWireBytes);
      } catch (cause) {
        aggregate.discard(transition);
        throw cause;
      }
      try {
        await options.gate?.(Object.freeze({
          transition,
          commit: hosted,
          baseRevision: transition.baseRevision,
          nextRevision: transition.nextRevision,
        }));
      } catch (cause) {
        aggregate.discard(transition);
        throw cause;
      }
      const accepted = aggregate.accept(transition, "isolate").commit;
      const acceptedHosted = accepted.hosted;
      if (acceptedHosted === undefined || JSON.stringify(acceptedHosted) !== JSON.stringify(hosted)) {
        throw new Error("Hosted aggregate acceptance disagreed with its prepared commit.");
      }
      // State is accepted before external publication, matching the established
      // Locus authority sequence. Listener failures do not split the transition.
      options.send?.(wire);
      for (const listener of [...listeners]) {
        try { listener(wire); } catch { /* Transport observers are isolated. */ }
      }
      return Object.freeze({ result, commit: acceptedHosted });
    };
    const next = tail.then(run, run);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };

  return Object.freeze({
    map: options.map,
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    registryDigest: snapshot.registryDigest,
    get rev() { return options.map.rev; },
    async mutate(mutation) {
      return (await enqueue(mutation)).commit;
    },
    async dispatch_action(name, payload) {
      const action = options.actions?.[name];
      if (action === undefined) throw new Error(`Unknown hosted aggregate Locus action: ${name}`);
      return (await enqueue(async (draft) => {
        const context: LocusHostedAggregateActionContext = Object.freeze({
          map: options.map,
          mutate: async (mutation) => { mutation(draft); },
        });
        return action(context, payload);
      })).result;
    },
    on_wire(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      aggregate.releaseManagement(owner);
    },
  });
}

/**
 * Internal H2 client bootstrap seam. H3 will connect this representation to
 * recovery/snapshot replacement; H2 only accepts a seeded mirror plus live
 * aggregate commit replay.
 */
export function create_locus_hosted_aggregate_client_internal(
  snapshot: HostedAggregateSnapshot,
  options: Readonly<{ maxWireBytes?: number }> = {},
): LocusHostedAggregateClient {
  const map = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
  const aggregate = internal_livemap_aggregate_authority(map);
  const maxWireBytes = valid_wire_bound(options.maxWireBytes);
  const authority = snapshot.authority;
  const registryDigest = snapshot.registryDigest;

  return Object.freeze({
    map,
    logicalMapId: authority.logicalMapId,
    incarnationId: authority.incarnationId,
    registryDigest,
    get rev() { return map.rev; },
    apply_wire(wire) {
      const commit = decode_locus_hosted_aggregate_wire(
        wire,
        Object.freeze({
          logicalMapId: authority.logicalMapId,
          incarnationId: authority.incarnationId,
          registryDigest,
          maxWireBytes,
        }),
      );
      // H1 performs exact semantic/replay reconciliation, library-mode,
      // schema, QUID-ledger, and revision validation before its one install.
      return aggregate.replayHosted(commit);
    },
  });
}

/** Encode the normal Locus `commit` message with an H1 aggregate payload. */
export function encode_locus_hosted_aggregate_wire(
  commit: HostedAggregateCommit,
  maxWireBytes = DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
): string {
  const message: LocusHostedAggregateWireMessage = Object.freeze({
    type: "commit",
    id: "hosted-aggregate",
    commit: Object.freeze({
      format: LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT,
      logicalMapId: commit.authority.logicalMapId,
      incarnationId: commit.authority.incarnationId,
      registryDigest: commit.registryDigest,
      commit,
    }),
  });
  const encoded = JSON.stringify(message);
  if (new TextEncoder().encode(encoded).byteLength > valid_wire_bound(maxWireBytes)) {
    throw new Error("Hosted aggregate Locus commit exceeds the live wire byte limit.");
  }
  return encoded;
}

/** Strict envelope decoder; H1 then validates the enclosed exact payload. */
export function decode_locus_hosted_aggregate_wire(
  wire: string,
  expected: Readonly<{
    logicalMapId: string;
    incarnationId: string;
    registryDigest: string;
    maxWireBytes?: number;
  }>,
): HostedAggregateCommit {
  if (typeof wire !== "string" || new TextEncoder().encode(wire).byteLength > valid_wire_bound(expected.maxWireBytes)) {
    throw new Error("Hosted aggregate Locus wire message is malformed or exceeds its byte limit.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(wire); } catch (cause) {
    throw new Error("Hosted aggregate Locus wire message is not JSON.", { cause });
  }
  const message = exact_record(parsed, "Hosted aggregate Locus wire message");
  exact_keys(message, ["type", "id", "commit"], "Hosted aggregate Locus wire message");
  if (message.type !== "commit" || message.id !== "hosted-aggregate") {
    throw new Error("Hosted aggregate Locus wire message has an invalid routing envelope.");
  }
  const envelope = exact_record(message.commit, "Hosted aggregate Locus commit envelope");
  exact_keys(envelope, ["format", "logicalMapId", "incarnationId", "registryDigest", "commit"], "Hosted aggregate Locus commit envelope");
  if (envelope.format !== LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT
    || envelope.logicalMapId !== expected.logicalMapId
    || envelope.incarnationId !== expected.incarnationId
    || envelope.registryDigest !== expected.registryDigest) {
    throw new Error("Hosted aggregate Locus wire fence is incompatible with this mirror.");
  }
  const commit = exact_record(envelope.commit, "Hosted aggregate H1 commit") as HostedAggregateCommit;
  if (commit.authority?.logicalMapId !== envelope.logicalMapId
    || commit.authority?.incarnationId !== envelope.incarnationId
    || commit.registryDigest !== envelope.registryDigest) {
    throw new Error("Hosted aggregate Locus routing envelope disagrees with its H1 commit.");
  }
  return commit;
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
  for (let index = 0; index < registry.libraries.length; index += 1) {
    const library = registry.libraries[index];
    const identity = identities[index];
    if (library === undefined || identity === undefined) {
      throw new Error("Hosted aggregate registry identity binding is unavailable.");
    }
    byName.set(library.name, Object.freeze({ identity, mode: library.mode }));
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
          ensureQuid(quid) {
            assert_open();
            writes.push(Object.freeze({ target, kind: "ensure-quid", quid }));
          },
        });
      },
    });
  };
  return Object.freeze({
    draft: Object.freeze({ lib: selected }),
    writes: () => Object.freeze([...writes]),
    close: () => { open = false; },
  });
}

function valid_wire_bound(value: number | undefined): number {
  const bound = value ?? DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES;
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > HOSTED_MAX_COMMIT_BYTES) {
    throw new Error("Hosted aggregate Locus wire byte limit is invalid.");
  }
  return bound;
}

function exact_record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function exact_keys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) {
    throw new Error(`${label} contains missing or unexpected fields.`);
  }
}

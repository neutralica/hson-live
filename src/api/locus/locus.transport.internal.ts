import type {
  LocusHostedAggregateCanonicalPublication,
  LocusHostedAggregateSynchronizationOutput,
  LocusHostedAggregateSynchronizationRequest,
} from "./locus.aggregate.transport.internal.js";
import type { JsonValue } from "../../core/types.js";
import type {
  LocusActionPayloads,
  LocusClientActionMessage,
  LocusClientMessage,
  LocusConnectionContext,
  LocusDisposer,
  LocusIncarnationId,
  LocusLogicalMapId,
  LocusServerMessage,
  LocusSessionId,
} from "../../types/locus.types.js";

/** @internal Finite commands, queries, and session-control requests. */
export type LocusFiniteOperationRequest<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusClientActionMessage<TActions> | Extract<LocusClientMessage<TActions>, {
  type: "action-status" | "session-create" | "session-attach" | "session-goodbye";
}>;

/** @internal Typed finite authority outcomes and session-control outcomes. */
export type LocusFiniteOperationOutcome = Extract<LocusServerMessage, {
  type: "ack" | "error" | "action-status" | "session-created" | "session-attached" | "session-rejected" | "session-fenced" | "session-ended";
}>;

/** @internal Recovery establishment and recovery-transfer output. */
export type LocusSynchronizationOutput = LocusHostedAggregateSynchronizationOutput;

/** @internal Ordered canonical publication after a caught-up boundary. */
export type LocusCanonicalPublication = LocusHostedAggregateCanonicalPublication;

/** @internal Non-canonical application event output. */
export type LocusTransientEventOutput = Extract<LocusServerMessage, { type: "event" }>;

/**
 * Internal typed downstream sink. Transport adapters frame these semantic
 * outputs; Locus authority never needs to know how their bytes are carried.
 */
export type LocusDownstreamSink<
  TSynchronization = LocusSynchronizationOutput,
  TPublication = LocusCanonicalPublication,
> = Readonly<{
  finite: (outcome: LocusFiniteOperationOutcome) => void;
  synchronization: (output: TSynchronization) => void;
  publication: (publication: TPublication) => void;
  event: (event: LocusTransientEventOutput) => void;
}>;

/** @internal Authority/session evidence shared by operations and synchronization. */
export type LocusAuthoritySessionBinding = Readonly<{
  principalId: string | undefined;
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  readonly sessionId: LocusSessionId | undefined;
  readonly attachmentEpoch: number | undefined;
  readonly attached: boolean;
}>;

/**
 * Internal semantic attachment. A WebSocket is one adapter for this shape;
 * future finite-operation and synchronization transports may be composed
 * around the same authority/session binding.
 */
export type LocusSemanticAttachment<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TSynchronizationRequest = LocusHostedAggregateSynchronizationRequest,
> = Readonly<{
  binding: LocusAuthoritySessionBinding;
  operations: Readonly<{
    submit: (request: LocusFiniteOperationRequest<TActions>) => void | Promise<void>;
  }>;
  synchronization: Readonly<{
    begin: (request: TSynchronizationRequest) => void;
    cancel: () => void;
  }>;
  emit_event: (event: string, payload: JsonValue) => void;
  close: (hostShutdown?: boolean) => void;
}>;

export type LocusSemanticAttachmentOptions = Readonly<{
  downstream: LocusDownstreamSink;
  connection?: LocusConnectionContext;
  /** Adapter-owned physical listener cleanup, invoked when the attachment ends. */
  onClose?: LocusDisposer;
}>;

type BoundSemanticAttachmentFactory = (
  options: LocusSemanticAttachmentOptions,
) => LocusSemanticAttachment;

const semanticAttachmentFactories = new WeakMap<object, BoundSemanticAttachmentFactory>();

export function register_locus_semantic_attachment_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  locus: object,
  factory: (options: LocusSemanticAttachmentOptions) => LocusSemanticAttachment<TActions>,
): void {
  semanticAttachmentFactories.set(locus, factory as unknown as BoundSemanticAttachmentFactory);
}

/** Attach typed operation and synchronization capabilities to one Locus authority. */
export function attach_locus_semantic_transport_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  locus: object,
  options: LocusSemanticAttachmentOptions,
): LocusSemanticAttachment<TActions> {
  const factory = semanticAttachmentFactories.get(locus);
  if (factory === undefined) throw new Error("Locus semantic attachment authority is unavailable.");
  return factory(options) as LocusSemanticAttachment<TActions>;
}

/** @internal No-op attachment returned by unavailable authority runtimes. */
export function inert_locus_semantic_attachment_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  logicalMapId: LocusLogicalMapId,
  incarnationId: LocusIncarnationId,
  principalId?: string,
): LocusSemanticAttachment<TActions> {
  const binding = Object.freeze({
    principalId,
    logicalMapId,
    incarnationId,
    get sessionId() { return undefined; },
    get attachmentEpoch() { return undefined; },
    get attached() { return false; },
  });
  return Object.freeze({
    binding,
    operations: Object.freeze({ submit: () => {} }),
    synchronization: Object.freeze({ begin: () => {}, cancel: () => {} }),
    emit_event: () => {},
    close: () => {},
  });
}

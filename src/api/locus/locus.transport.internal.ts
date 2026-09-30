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

export type LocusFiniteOperationRequest<TActions extends LocusActionPayloads = LocusActionPayloads> =
  LocusClientActionMessage<TActions> | Extract<LocusClientMessage<TActions>, {
    type: "action-status" | "session-create" | "session-attach" | "session-detach" | "session-goodbye";
  }>;

export type LocusFiniteOperationOutcome = Extract<LocusServerMessage, {
  type: "ack" | "error" | "action-status" | "session-created" | "session-attached"
    | "session-detached" | "session-rejected" | "session-ended";
}>;
export type LocusSynchronizationOutput = LocusHostedAggregateSynchronizationOutput;
export type LocusCanonicalPublication = LocusHostedAggregateCanonicalPublication;
export type LocusTransientEventOutput = Extract<LocusServerMessage, { type: "event" }>;
export type LocusAttachmentNotice = Extract<LocusServerMessage, { type: "session-fenced" | "session-ended" }>;
export type LocusOrderedSynchronizationOutput = LocusSynchronizationOutput | LocusCanonicalPublication;
export type LocusOrderedSynchronizationSink = (output: LocusOrderedSynchronizationOutput) => void | Promise<void>;

export type LocusAuthoritySessionBinding = Readonly<{
  principalId: string | undefined;
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  readonly sessionId: LocusSessionId | undefined;
  readonly attachmentEpoch: number | undefined;
  readonly attached: boolean;
}>;

/** One logical authorized attachment; no physical connection or stream is required. */
export type LocusSemanticAttachment<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  binding: LocusAuthoritySessionBinding;
  operations: Readonly<{
    submit: (request: LocusFiniteOperationRequest<TActions>) => Promise<LocusFiniteOperationOutcome>;
  }>;
  synchronization: Readonly<{
    open: (request: LocusHostedAggregateSynchronizationRequest, sink: LocusOrderedSynchronizationSink,
      onEnd?: (cause?: unknown) => void) => LocusDisposer;
  }>;
  emit_event: (event: string, payload: JsonValue) => void;
  close: (hostShutdown?: boolean) => void;
}>;

export type LocusSemanticAttachmentOptions = Readonly<{
  notice: (event: LocusAttachmentNotice) => void;
  connection?: LocusConnectionContext;
  onClose?: LocusDisposer;
}>;

type BoundSemanticAttachmentFactory = (options: LocusSemanticAttachmentOptions) => LocusSemanticAttachment;
const semanticAttachmentFactories = new WeakMap<object, BoundSemanticAttachmentFactory>();
const publicationByteLimits = new WeakMap<object, number>();

export function register_locus_semantic_attachment_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  locus: object,
  factory: (options: LocusSemanticAttachmentOptions) => LocusSemanticAttachment<TActions>,
  maxWireBytes: number,
): void {
  semanticAttachmentFactories.set(locus, factory as unknown as BoundSemanticAttachmentFactory);
  publicationByteLimits.set(locus, maxWireBytes);
}

export function alias_locus_semantic_attachment_internal(target: object, source: object): void {
  const factory = semanticAttachmentFactories.get(source);
  const limit = publicationByteLimits.get(source);
  if (factory === undefined || limit === undefined) throw new Error("Locus semantic attachment authority is unavailable.");
  semanticAttachmentFactories.set(target, factory);
  publicationByteLimits.set(target, limit);
}

export function locus_publication_byte_limit_internal(locus: object): number {
  const limit = publicationByteLimits.get(locus);
  if (limit === undefined) throw new Error("Locus publication limit is unavailable.");
  return limit;
}

export function attach_locus_semantic_transport_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  locus: object,
  options: LocusSemanticAttachmentOptions,
): LocusSemanticAttachment<TActions> {
  const factory = semanticAttachmentFactories.get(locus);
  if (factory === undefined) throw new Error("Locus semantic attachment authority is unavailable.");
  return factory(options) as LocusSemanticAttachment<TActions>;
}

export function inert_locus_semantic_attachment_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
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
    operations: Object.freeze({ submit: async () => { throw new Error("Locus attachment is unavailable."); } }),
    synchronization: Object.freeze({ open: () => () => {} }),
    emit_event: () => {},
    close: () => {},
  });
}

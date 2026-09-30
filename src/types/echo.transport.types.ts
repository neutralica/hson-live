import type {
  LocusActionPayloads,
  LocusClientActionMessage,
  LocusClientMessage,
  LocusServerMessage,
} from "./locus.protocol.types.js";
import type {
  LocusHostedAggregateCanonicalPublication,
  LocusHostedAggregateSynchronizationOutput,
  LocusHostedAggregateSynchronizationRequest,
} from "../api/locus/locus.aggregate.transport.internal.js";

/** One finite Echo request, independent of its physical carrier. */
export type EchoFiniteOperationRequest<TActions extends LocusActionPayloads = LocusActionPayloads> =
  LocusClientActionMessage<TActions> | Extract<LocusClientMessage<TActions>, {
    type: "action-status" | "session-create" | "session-attach" | "session-detach" | "session-goodbye";
  }>;

/** A correlated authority response, including semantic rejection. */
export type EchoFiniteOperationOutcome = Extract<LocusServerMessage, {
  type: "ack" | "error" | "action-status" | "session-created" | "session-attached" | "session-rejected" | "session-detached" | "session-ended";
}>;

export type EchoSubmission<T> =
  | Readonly<{ kind: "response"; outcome: T }>
  | Readonly<{ kind: "not-submitted"; cause?: unknown }>
  | Readonly<{ kind: "uncertain"; cause?: unknown }>;

/** The AbortSignal operations Echo needs, available across Web Platform runtimes. */
export type EchoCancellationSignal = Readonly<{
  aborted: boolean;
  reason?: unknown;
  addEventListener(type: "abort", listener: () => void, options?: Readonly<{ once?: boolean }>): void;
  removeEventListener(type: "abort", listener: () => void): void;
}>;

/** Attachment notices are separate from finite outcomes and replica state. */
export type EchoAttachmentEvent =
  | Readonly<{ kind: "available" }>
  | Readonly<{ kind: "fenced"; sessionId: string; epoch: number }>
  | Readonly<{ kind: "ended"; sessionId: string; epoch: number }>
  | Readonly<{ kind: "observation-interrupted"; cause?: unknown }>;

export type EchoSynchronizationRequest = LocusHostedAggregateSynchronizationRequest;
export type EchoSynchronizationOutput =
  LocusHostedAggregateSynchronizationOutput | LocusHostedAggregateCanonicalPublication;

export type EchoSynchronizationEnd = Readonly<{
  kind: "cancelled" | "interrupted" | "invalid";
  cause?: unknown;
}>;

export type EchoSynchronizationObserver = Readonly<{
  onOutput: (output: EchoSynchronizationOutput) => void | Promise<void>;
  onEnd: (end: EchoSynchronizationEnd) => void;
}>;

export type EchoSynchronizationSubscription = Readonly<{ cancel: () => void }>;

export type EchoEndpointTransport<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  operations: Readonly<{
    submit: (
      request: EchoFiniteOperationRequest<TActions>,
      options?: Readonly<{ signal?: EchoCancellationSignal }>,
    ) => Promise<EchoSubmission<EchoFiniteOperationOutcome>>;
  }>;
  attachment: Readonly<{
    observe: (listener: (event: EchoAttachmentEvent) => void) => () => void;
  }>;
}>;

export type EchoReplicaTransport<TActions extends LocusActionPayloads = LocusActionPayloads> =
  EchoEndpointTransport<TActions> & Readonly<{
    synchronization: Readonly<{
      open: (
        request: EchoSynchronizationRequest,
        observer: EchoSynchronizationObserver,
        options?: Readonly<{ signal?: EchoCancellationSignal }>,
      ) => Promise<EchoSynchronizationSubscription>;
    }>;
  }>;

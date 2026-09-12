import type {
  LocusActionPayloads,
  LocusClientActionMessage,
  LocusClientMessage,
  LocusDisposer,
  LocusServerMessage,
} from "../../types/locus.types.js";

/** @internal Finite commands, queries, and session-control requests. */
export type EchoFiniteOperationRequest<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusClientActionMessage<TActions> | Extract<LocusClientMessage<TActions>, {
  type: "action-status" | "session-create" | "session-attach" | "session-goodbye";
}>;

/** @internal Typed authority and session-control outcomes. */
export type EchoFiniteOperationOutcome = Extract<LocusServerMessage, {
  type: "ack" | "error" | "action-status" | "session-created" | "session-attached" | "session-rejected" | "session-fenced" | "session-ended";
}>;

/**
 * Internal finite-operation capability. Submission and outcome delivery are
 * intentionally independent: a transport need not return an outcome through
 * the same physical callback source that accepted the request.
 */
export type EchoFiniteOperationCapability<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  /** @internal Semantic attachment identity shared with synchronization. */
  binding?: object;
  submit: (request: EchoFiniteOperationRequest<TActions>) => void;
  onOutcome: (listener: (outcome: EchoFiniteOperationOutcome) => void) => LocusDisposer;
}>;

/** @internal Mutable adapter side of one finite-operation capability. */
export type EchoFiniteOperationAdapter<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  capability: EchoFiniteOperationCapability<TActions>;
  deliver: (outcome: EchoFiniteOperationOutcome) => void;
  clear: () => void;
}>;

export function create_echo_finite_operation_adapter_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(submit: (request: EchoFiniteOperationRequest<TActions>) => void, binding?: object): EchoFiniteOperationAdapter<TActions> {
  const listeners = new Set<(outcome: EchoFiniteOperationOutcome) => void>();
  return Object.freeze({
    capability: Object.freeze({
      ...(binding === undefined ? {} : { binding }),
      submit,
      onOutcome(listener: (outcome: EchoFiniteOperationOutcome) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    deliver(outcome: EchoFiniteOperationOutcome) {
      for (const listener of [...listeners]) listener(outcome);
    },
    clear() { listeners.clear(); },
  });
}

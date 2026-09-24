import type { LocusHostedAggregateSynchronizationRequest, LocusHostedAggregateSynchronizationOutput, LocusHostedAggregateCanonicalPublication } from "../locus/locus.aggregate.transport.internal.js";
import type {
  LocusDisposer,
} from "../../types/locus.types.js";
import type { LocusServerMessage } from "../../types/locus.types.js";

/** @internal Typed recovery transfer and ordered canonical publication. */
export type EchoSynchronizationOutput = LocusHostedAggregateSynchronizationOutput | LocusHostedAggregateCanonicalPublication;
export type EchoSynchronizationRequest = LocusHostedAggregateSynchronizationRequest;

/** @internal Ordered downstream synchronization capability. */
export type EchoSynchronizationCapability<
  TRequest = EchoSynchronizationRequest,
  TOutput = EchoSynchronizationOutput,
> = Readonly<{
  /** @internal Semantic attachment identity shared with finite operations. */
  binding?: object;
  begin: (request: TRequest) => void;
  onOutput: (listener: (output: TOutput) => void) => LocusDisposer;
}>;

/** @internal Mutable transport-adapter side of synchronization delivery. */
export type EchoSynchronizationAdapter<
  TRequest = EchoSynchronizationRequest,
  TOutput = EchoSynchronizationOutput,
> = Readonly<{
  capability: EchoSynchronizationCapability<TRequest, TOutput>;
  deliver: (output: TOutput) => void;
  clear: () => void;
}>;

export function create_echo_synchronization_adapter_internal<
  TRequest = EchoSynchronizationRequest,
  TOutput = EchoSynchronizationOutput,
>(
  begin: (request: TRequest) => void,
  binding?: object,
): EchoSynchronizationAdapter<TRequest, TOutput> {
  const listeners = new Set<(output: TOutput) => void>();
  return Object.freeze({
    capability: Object.freeze({
      ...(binding === undefined ? {} : { binding }),
      begin,
      onOutput(listener: (output: TOutput) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    deliver(output: TOutput) {
      for (const listener of [...listeners]) listener(output);
    },
    clear() { listeners.clear(); },
  });
}

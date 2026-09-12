import type {
  LocusClientRecoverMessage,
  LocusDisposer,
} from "../../types/locus.types.js";
import type { LocusDecodedServerMessage } from "../locus/locus.document-snapshot.js";

/** @internal Typed recovery transfer and ordered canonical publication. */
export type EchoSynchronizationOutput = Extract<LocusDecodedServerMessage, {
  type: "recovery-plan" | "recovery-commit" | "recovery-snapshot" | "recovery-caught-up" | "recovery-error" | "commit";
}> | Readonly<{
  type: "synchronization-failure";
  error: Readonly<{ code?: string; message: string; cause?: unknown }>;
}>;

/** @internal Ordered downstream synchronization capability. */
export type EchoSynchronizationCapability<
  TRequest = LocusClientRecoverMessage,
  TOutput = EchoSynchronizationOutput,
> = Readonly<{
  /** @internal Semantic attachment identity shared with finite operations. */
  binding?: object;
  begin: (request: TRequest) => void;
  onOutput: (listener: (output: TOutput) => void) => LocusDisposer;
}>;

/** @internal Mutable transport-adapter side of synchronization delivery. */
export type EchoSynchronizationAdapter<
  TRequest = LocusClientRecoverMessage,
  TOutput = EchoSynchronizationOutput,
> = Readonly<{
  capability: EchoSynchronizationCapability<TRequest, TOutput>;
  deliver: (output: TOutput) => void;
  clear: () => void;
}>;

export function create_echo_synchronization_adapter_internal<
  TRequest = LocusClientRecoverMessage,
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

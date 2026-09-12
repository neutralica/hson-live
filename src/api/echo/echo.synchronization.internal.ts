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
export type EchoSynchronizationCapability = Readonly<{
  begin: (request: LocusClientRecoverMessage) => void;
  onOutput: (listener: (output: EchoSynchronizationOutput) => void) => LocusDisposer;
}>;

/** @internal Mutable transport-adapter side of synchronization delivery. */
export type EchoSynchronizationAdapter = Readonly<{
  capability: EchoSynchronizationCapability;
  deliver: (output: EchoSynchronizationOutput) => void;
  clear: () => void;
}>;

export function create_echo_synchronization_adapter_internal(
  begin: (request: LocusClientRecoverMessage) => void,
): EchoSynchronizationAdapter {
  const listeners = new Set<(output: EchoSynchronizationOutput) => void>();
  return Object.freeze({
    capability: Object.freeze({
      begin,
      onOutput(listener: (output: EchoSynchronizationOutput) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    deliver(output: EchoSynchronizationOutput) {
      for (const listener of [...listeners]) listener(output);
    },
    clear() { listeners.clear(); },
  });
}

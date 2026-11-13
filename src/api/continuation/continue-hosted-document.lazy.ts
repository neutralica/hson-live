import type { InteractionFailure } from "../../types/interaction.types.js";
import type { InteractionLocalBehaviors } from "../../types/local-behavior.types.js";
import type { EchoReplicaOptions } from "../../types/locus.types.js";
import type { HostedDocumentContinuation } from "./continuation.types.js";

type HostedInteractions = Readonly<{
  /** Synchronously register on the composed client LiveMap before its listeners activate. */
  registerActions?: (actions: InteractionLocalBehaviors) => void | undefined;
  onFailure?: (failure: InteractionFailure) => void;
}>;

export type HostedContinuationOptions = EchoReplicaOptions & Readonly<{
  root: Element;
  document?: string;
  interactions?: HostedInteractions;
}>;

export async function continue_hosted_document(options: HostedContinuationOptions): Promise<HostedDocumentContinuation> {
  const implementation = await import("./continue-hosted-document.js");
  return implementation.continue_hosted_document_internal(options);
}

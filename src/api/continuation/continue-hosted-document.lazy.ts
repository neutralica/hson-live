import type { InteractionFailure, InteractionLocalBehaviors } from "../../types/interaction.types.js";
import type { EchoReplicaOptions } from "../../types/locus.types.js";
import type { HostedDocumentContinuation } from "./continuation.types.js";

type HostedInteractions = Readonly<{
  local: InteractionLocalBehaviors;
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

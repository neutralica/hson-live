import type { InteractionFailure, InteractionLocalBehaviors } from "../../types/interaction.types.js";
import type { Echo, LocusActionPayloads } from "../../types/locus.types.js";
import type { LiveMapDocumentLibrary, LiveMap } from "../../types/livemap.types.js";
import type { HostedDocumentContinuation } from "./continuation.types.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";

type HostedInteractions = Readonly<{
  local: InteractionLocalBehaviors;
  onFailure?: (failure: InteractionFailure) => void;
}>;

type ReplicaEcho<TMap extends LiveMap> = Echo<TMap, LocusActionPayloads>;

export function continue_hosted_document<TDocument extends LiveMapDocumentLibrary, TEcho extends ReplicaEcho<LiveMap>>(options: Readonly<{
  echo: TEcho;
  root: Element;
  authority: AuthorityProjectionSnapshot;
  document: TDocument;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation<TDocument> & Readonly<{ echo: TEcho }>>;
export function continue_hosted_document<TEcho extends ReplicaEcho<LiveMap>>(options: Readonly<{
  echo: TEcho;
  root: Element;
  authority: AuthorityProjectionSnapshot;
  document?: undefined;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation<LiveMapDocumentLibrary> & Readonly<{ echo: TEcho }>>;
export async function continue_hosted_document(options: Readonly<{
  echo: ReplicaEcho<LiveMap>;
  root: Element;
  authority: AuthorityProjectionSnapshot;
  document?: LiveMapDocumentLibrary;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation> {
  if (options.authority === undefined) {
    throw new TypeError("Hosted continuation requires a projected authority snapshot.");
  }
  const implementation = await import("./continue-hosted-document.js");
  return implementation.continue_hosted_document_internal(options);
}

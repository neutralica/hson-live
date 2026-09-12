import type { InteractionFailure, InteractionLocalBehaviors } from "../../types/interaction.types.js";
import type { Echo, LocusActionPayloads } from "../../types/locus.types.js";
import type {
  DocumentLiveMap,
  LiveMapAuthority,
  LiveMapDocumentLibrary,
  LiveMapLibraries,
} from "../../types/livemap.types.js";
import type { HostedDocumentContinuation } from "./continuation.types.js";

type HostedInteractions = Readonly<{
  local: InteractionLocalBehaviors;
  onFailure?: (failure: InteractionFailure) => void;
}>;

type ReplicaEcho<TMap extends LiveMapAuthority | LiveMapLibraries> = Echo<TMap, LocusActionPayloads>;

export function continue_hosted_document<TMap extends DocumentLiveMap, TEcho extends ReplicaEcho<TMap>>(options: Readonly<{
  echo: TEcho;
  root: Element;
  document?: never;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation<TMap> & Readonly<{ echo: TEcho }>>;
export function continue_hosted_document<TDocument extends LiveMapDocumentLibrary, TEcho extends ReplicaEcho<LiveMapLibraries>>(options: Readonly<{
  echo: TEcho;
  root: Element;
  document: TDocument;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation<TDocument> & Readonly<{ echo: TEcho }>>;
export function continue_hosted_document<TEcho extends ReplicaEcho<LiveMapLibraries>>(options: Readonly<{
  echo: TEcho;
  root: Element;
  document?: undefined;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation<LiveMapDocumentLibrary> & Readonly<{ echo: TEcho }>>;
export async function continue_hosted_document(options: Readonly<{
  echo: ReplicaEcho<LiveMapAuthority | LiveMapLibraries>;
  root: Element;
  document?: LiveMapDocumentLibrary;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation> {
  const implementation = await import("./continue-hosted-document.js");
  return implementation.continue_hosted_document_internal(options);
}

import type { InteractionFailure, InteractionLocalBehaviors } from "../../types/interaction.types.js";
import type { Echo, LocusActionPayloads } from "../../types/locus.types.js";
import type {
  LiveMapDocumentLibrary,
  LiveMapLibraries,
} from "../../types/livemap.types.js";
import type { HsonData } from "../transform/transform.types.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import { echo_document_authority_for } from "../echo/echo.document-authority.js";
import { admit_authority_projection_snapshot, client_projection_identity_internal } from "../locus/locus.authority-projection-snapshot.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { activate_interactions } from "../interactions/interactions.js";
import { runtime_for_tree } from "../livetree/runtime/livetree-runtime.js";
import { reflect_existing_document_in_runtime } from "../reflect/reflect.document.js";
import { adopt_exact_existing_document, type ExactDocumentAdoption } from "./continuation.adopt.js";
import {
  reserve_continuation_root,
  resolve_continuation_document,
  validate_continuation_root,
  validate_interaction_shape,
  schedule_continuation_runtime_activation,
  continuation_document_library_name,
} from "./continuation.common.js";
import { DocumentContinuationError } from "./continuation.error.js";
import type { HostedDocumentContinuation } from "./continuation.types.js";

type HostedInteractions = Readonly<{
  local: InteractionLocalBehaviors;
  onFailure?: (failure: InteractionFailure) => void;
}>;

type ReplicaEcho<TMap extends LiveMapLibraries> = Echo<TMap, LocusActionPayloads>;

export function continue_hosted_document<TDocument extends LiveMapDocumentLibrary, TEcho extends ReplicaEcho<LiveMapLibraries>>(options: Readonly<{
  echo: TEcho;
  root: Element;
  authority: AuthorityProjectionSnapshot;
  document: TDocument;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation<TDocument> & Readonly<{ echo: TEcho }>>;
export function continue_hosted_document<TEcho extends ReplicaEcho<LiveMapLibraries>>(options: Readonly<{
  echo: TEcho;
  root: Element;
  authority: AuthorityProjectionSnapshot;
  document?: undefined;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation<LiveMapDocumentLibrary> & Readonly<{ echo: TEcho }>>;
export async function continue_hosted_document(options: Readonly<{
  echo: ReplicaEcho<LiveMapLibraries>;
  root: Element;
  authority: AuthorityProjectionSnapshot;
  document?: LiveMapDocumentLibrary;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation> {
  return continue_hosted_document_internal(options);
}

/** @internal Lazy package-root composition point. */
export async function continue_hosted_document_internal(options: Readonly<{
  echo: ReplicaEcho<LiveMapLibraries>;
  root: Element;
  authority: AuthorityProjectionSnapshot;
  document?: LiveMapDocumentLibrary;
  interactions?: HostedInteractions;
}>): Promise<HostedDocumentContinuation> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Hosted document continuation options must be an object.");
  }
  validate_continuation_root(options.root);
  validate_interaction_shape(options.interactions);
  const echo = options.echo;
  if (typeof echo !== "object" || echo === null
    || typeof echo.recovery !== "object" || echo.recovery === null
    || echo.recovery.map !== echo.map) {
    throw new TypeError("Hosted document continuation requires one replica-bearing Echo over its exact map.");
  }
  const releaseRoot = reserve_continuation_root(options.root);
  let adoption: ExactDocumentAdoption | undefined;
  let reflect: ReturnType<typeof reflect_existing_document_in_runtime> | undefined;
  let disposeInteractions: (() => void) | undefined;
  try {
    const resolved = resolve_continuation_document(echo.map, options.document);
    if (resolved.aggregate === undefined) {
      throw new TypeError("Hosted continuation requires a projected library registry.");
    }
    const snapshot = admit_authority_projection_snapshot(options.authority);
    const aggregate = internal_livemap_aggregate_authority(resolved.aggregate);
    const projection = aggregate.clientProjection();
    const current = aggregate.captureSelectedHosted(snapshot.libraries.map((entry) => entry.name), false);
    const currentLibraries = new Map(current.libraries.map((entry) => [entry.name, entry]));
    const selectedName = continuation_document_library_name(resolved.aggregate, resolved.selected);
    if (projection === undefined
      || client_projection_identity_internal(resolved.aggregate) !== snapshot.projectionDigest
      || projection.authority.logicalMapId !== snapshot.authority.logicalMapId
      || projection.authority.incarnationId !== snapshot.authority.incarnationId
      || echo.recovery.logicalMapId !== snapshot.authority.logicalMapId
      || projection.revision !== snapshot.revision
      || echo.recovery.lastAppliedRev !== snapshot.revision
      || snapshot.libraries.some((entry) => currentLibraries.get(entry.name)?.root.payload !== entry.root.payload)
      || !snapshot.libraries.some((entry) => entry.name === selectedName && entry.mode === "document")
      || (options.document === undefined && snapshot.htmlDocument !== selectedName)) {
      throw new Error("Hosted continuation authority projection does not match its selected document.");
    }
    if (echo_document_authority_for(resolved.selected) === undefined) {
      throw new Error("Selected document is not governed by the supplied Echo replica.");
    }
    if (echo.recovery.logicalMapId === undefined || echo.recovery.logicalMapId.length === 0) {
      throw new Error("Supplied Echo has no coherent logical map identity.");
    }
    if (resolved.aggregate === undefined && echo.recovery.lastAppliedRev !== undefined
      && echo.recovery.lastAppliedRev !== echo.map.rev) {
      throw new Error("Supplied Echo recovery cursor does not match its canonical map revision.");
    }
    const revision = resolved.selected.rev;
    const canonicalRoot = resolved.selected.root();
    try {
      adoption = adopt_exact_existing_document(canonicalRoot, options.root);
      if (resolved.selected.rev !== revision) {
        throw new Error("Canonical document revision changed during exact DOM adoption.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("adopt", cause);
    }
    try {
      reflect = reflect_existing_document_in_runtime(
        resolved.selected,
        adoption.tree,
        runtime_for_tree(adoption.tree),
      );
      if (reflect.status !== "active" || reflect.sourceRevision !== revision) {
        throw new Error("Mirror did not establish exact correspondence at the captured revision.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("reflect", cause);
    }
    try {
      if (echo.recovery.status !== "caught_up") await echo.recovery.recover();
      if (echo.recovery.status !== "caught_up") throw new Error("Echo recovery did not reach caught-up state.");
      if ((resolved.aggregate === undefined && echo.recovery.lastAppliedRev !== echo.map.rev)
        || resolved.selected.rev !== echo.map.rev) {
        throw new Error("Echo, aggregate, and selected document revisions are not current together.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("recover", cause);
    }
    try {
      if (reflect.status !== "active" || reflect.sourceRevision !== resolved.selected.rev) {
        throw reflect.failure ?? new Error("Mirror is not current after Echo recovery.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("reflect", cause);
    }
    if (options.interactions !== undefined) {
      try {
        if (resolved.aggregate === undefined) {
          throw new Error("Canonical interactions require a multi-library Echo map with enabled interaction storage.");
        }
        const dispatch = async (actionKey: string, payload: HsonData): Promise<void> => {
          const outcome = await echo.action(actionKey, payload);
          if (outcome.type === "ack" && outcome.ok === true) return;
          const error = new Error(outcome.error.message, { cause: outcome.error });
          if (outcome.error.code !== undefined) {
            Object.defineProperty(error, "code", { value: outcome.error.code, enumerable: true });
          }
          throw error;
        };
        disposeInteractions = activate_interactions({
          map: resolved.aggregate,
          tree: adoption.tree,
          document: continuation_document_library_name(resolved.aggregate, resolved.selected),
          local: options.interactions.local,
          dispatch,
          ...(options.interactions.onFailure === undefined ? {} : { onFailure: options.interactions.onFailure }),
        });
      } catch (cause) {
        throw new DocumentContinuationError("interactions", cause);
      }
    }
    adoption.commit();
    let disposed = false;
    const result: HostedDocumentContinuation = Object.freeze({
      echo,
      map: resolved.selected,
      tree: adoption.tree,
      reflect,
      dispose(): void {
        if (disposed) return;
        disposed = true;
        let failure: unknown;
        try { disposeInteractions?.(); } catch (cause) { failure ??= cause; }
        try { reflect?.dispose(); } catch (cause) { failure ??= cause; }
        releaseRoot();
        if (failure !== undefined) throw failure;
      },
    });
    schedule_continuation_runtime_activation(adoption.activateRuntimeManagers, "promise-resolution");
    return result;
  } catch (cause) {
    try { disposeInteractions?.(); } catch { /* Preserve construction failure. */ }
    try { reflect?.dispose(); } catch { /* Preserve construction failure. */ }
    try { adoption?.abort(); } catch { /* Preserve construction failure. */ }
    releaseRoot();
    throw cause;
  }
}

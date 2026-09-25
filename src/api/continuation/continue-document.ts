import type {
  InteractionActionDispatcher,
  InteractionFailure,
  InteractionLocalBehaviors,
} from "../../types/interaction.types.js";
import type {
  LiveMapDocumentLibrary,
  LiveMap,
} from "../../types/livemap.types.js";
import { activate_interactions } from "../interactions/interactions.js";
import { reflect_existing_document_in_runtime } from "../mirror/mirror.document.js";
import { runtime_for_tree } from "../livetree/runtime/livetree-runtime.js";
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
import type { DocumentContinuation } from "./continuation.types.js";

type LocalInteractions = Readonly<{
  local: InteractionLocalBehaviors;
  dispatch?: InteractionActionDispatcher;
  onFailure?: (failure: InteractionFailure) => void;
}>;

export function continue_document<TDocument extends LiveMapDocumentLibrary>(options: Readonly<{
  map: LiveMap;
  root: Element;
  document: TDocument;
  interactions?: LocalInteractions;
}>): DocumentContinuation<TDocument>;
export function continue_document(options: Readonly<{
  map: LiveMap;
  root: Element;
  document?: undefined;
  interactions?: LocalInteractions;
}>): DocumentContinuation<LiveMapDocumentLibrary>;
export function continue_document(options: Readonly<{
  map: LiveMap;
  root: Element;
  document?: LiveMapDocumentLibrary;
  interactions?: LocalInteractions;
}>): DocumentContinuation {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Document continuation options must be an object.");
  }
  validate_continuation_root(options.root);
  validate_interaction_shape(options.interactions);
  const releaseRoot = reserve_continuation_root(options.root);
  let adoption: ExactDocumentAdoption | undefined;
  let reflect: ReturnType<typeof reflect_existing_document_in_runtime> | undefined;
  let disposeInteractions: (() => void) | undefined;
  try {
    const resolved = resolve_continuation_document(options.map, options.document);
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
      if (reflect.status !== "active"
        || reflect.sourceRevision !== revision
        || resolved.selected.rev !== revision) {
        throw new Error("Mirror did not establish exact correspondence at the captured revision.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("mirror", cause);
    }
    if (options.interactions !== undefined) {
      try {
        disposeInteractions = activate_interactions({
          map: resolved.aggregate,
          tree: adoption.tree,
          document: continuation_document_library_name(resolved.aggregate, resolved.selected),
          local: options.interactions.local,
          ...(options.interactions.dispatch === undefined ? {} : { dispatch: options.interactions.dispatch }),
          ...(options.interactions.onFailure === undefined ? {} : { onFailure: options.interactions.onFailure }),
        });
      } catch (cause) {
        throw new DocumentContinuationError("interactions", cause);
      }
    }
    adoption.commit();
    let disposed = false;
    const result: DocumentContinuation = Object.freeze({
      map: resolved.selected,
      tree: adoption.tree,
      mirror: reflect,
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
    schedule_continuation_runtime_activation(adoption.activateRuntimeManagers, "synchronous-return");
    return result;
  } catch (cause) {
    try { disposeInteractions?.(); } catch { /* Preserve construction failure. */ }
    try { reflect?.dispose(); } catch { /* Preserve construction failure. */ }
    try { adoption?.abort(); } catch { /* Preserve construction failure. */ }
    releaseRoot();
    throw cause;
  }
}

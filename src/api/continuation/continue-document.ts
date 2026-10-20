import type { PortableDocumentHandoff } from "../livemap/livemap.internal.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { prepare_portable_native_handoff } from "./continuation.portable.js";
import type {
  InteractionActionDispatcher,
  InteractionFailure,
  InteractionLocalBehaviors,
} from "../../types/interaction.types.js";
import type {
  LiveMapDocumentLibrary,
  LiveMap,
} from "../../types/livemap.types.js";
import { activate_document_interactions_internal } from "../interactions/interactions.js";
import { reflect_existing_document_in_runtime } from "../mirror/mirror.document.js";
import { runtime_for_tree } from "../livetree/runtime/livetree-runtime.js";
import { bind_document_css_tree } from "../livetree/managers/bound-document-css.js";
import { echo_document_authority_for } from "../echo/echo.document-authority.js";
import { adopt_exact_existing_document, type ExactDocumentAdoption } from "./continuation.adopt.js";
import {
  reserve_continuation_root,
  activate_continuation_root,
  resolve_continuation_document,
  validate_continuation_root,
  validate_interaction_shape,
  schedule_continuation_runtime_activation,
  continuation_document_library_name,
  capture_continuation_document_root,
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
  return continue_document_impl(options);
}

/** Bounded local portable SSR handoff. No package export or public option. @internal */
export function continue_portable_document_internal(options: Readonly<{
  map: LiveMap; root: Element; document: LiveMapDocumentLibrary; interactions?: LocalInteractions;
}>, handoff: PortableDocumentHandoff): DocumentContinuation {
  const owner = internal_livemap_aggregate_authority(options.map);
  owner.assertPortableDocumentHandoff(handoff);
  if (options.map.doc.must(handoff.libraryName) !== options.document) throw new Error("Portable handoff selects a different Library.");
  return continue_document_impl(options, handoff);
}

function continue_document_impl(options: Readonly<{
  map: LiveMap; root: Element; document?: LiveMapDocumentLibrary; interactions?: LocalInteractions;
}>, handoff?: PortableDocumentHandoff): DocumentContinuation {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Document continuation options must be an object.");
  }
  validate_continuation_root(options.root);
  validate_interaction_shape(options.interactions);
  const releaseRoot = reserve_continuation_root(options.root);
  let adoption: ExactDocumentAdoption | undefined;
  let reflect: ReturnType<typeof reflect_existing_document_in_runtime> | undefined;
  let disposeInteractions: (() => void) | undefined;
  let disposeCssBinding: (() => void) | undefined;
  let nativeHandoff: ReturnType<typeof prepare_portable_native_handoff> | undefined;
  try {
    const resolved = resolve_continuation_document(options.map, options.document);
    let revision = resolved.selected.rev;
    handoff?.assertCurrent();
    const canonicalRoot = capture_continuation_document_root(resolved.selected);
    try {
      adoption = adopt_exact_existing_document(canonicalRoot, options.root,
        handoff?.portableCss ?? resolved.selected.css.snapshot(),
        handoff === undefined ? undefined : { quads: handoff.quads });
      handoff?.assertCurrent();
      if (resolved.selected.rev !== revision) {
        throw new Error("Canonical document revision changed during exact DOM adoption.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("adopt", cause);
    }
    if (handoff !== undefined) {
      nativeHandoff = prepare_portable_native_handoff(adoption, handoff);
      nativeHandoff.apply();
      revision = resolved.selected.rev;
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
        disposeInteractions = activate_document_interactions_internal({
          map: resolved.aggregate,
          tree: reflect.tree,
          document: continuation_document_library_name(resolved.aggregate, resolved.selected),
          local: options.interactions.local,
          ...(options.interactions.dispatch === undefined ? {} : { dispatch: options.interactions.dispatch }),
          ...(options.interactions.onFailure === undefined ? {} : { onFailure: options.interactions.onFailure }),
        }, () => {
          // A retained rollback tree does not authorize live interaction work.
          if (reflect!.status !== "active") throw new Error("Document interaction binding is not active.");
          return reflect!.tree;
        });
      } catch (cause) {
        throw new DocumentContinuationError("interactions", cause);
      }
    }
    try {
      disposeCssBinding = bind_document_css_tree(reflect.tree, resolved.selected,
        adoption.managedStyle, echo_document_authority_for(resolved.selected) !== undefined, () => reflect!.tree);
    } catch (cause) {
      throw new DocumentContinuationError("adopt", cause);
    }
    adoption.commit(() => reflect!.tree);
    nativeHandoff?.finish();
    let disposed = false;
    const result: DocumentContinuation = Object.freeze({
      map: resolved.selected,
      get tree() { return reflect!.tree; },
      mirror: reflect,
      dispose(): void {
        if (disposed) return;
        disposed = true;
        let failure: unknown;
        try { disposeInteractions?.(); } catch (cause) { failure ??= cause; }
        try { disposeCssBinding?.(); } catch (cause) { failure ??= cause; }
        try { reflect?.dispose(); } catch (cause) { failure ??= cause; }
        releaseRoot();
        if (failure !== undefined) throw failure;
      },
    });
    schedule_continuation_runtime_activation(adoption.activateRuntimeManagers, "synchronous-return");
    activate_continuation_root(options.root);
    return result;
  } catch (cause) {
    try { disposeInteractions?.(); } catch { /* Preserve construction failure. */ }
    try { disposeCssBinding?.(); } catch { /* Preserve construction failure. */ }
    try { reflect?.dispose(); } catch { /* Preserve construction failure. */ }
    let rollbackFailure: unknown;
    try { nativeHandoff?.rollback(); } catch (failure) { rollbackFailure = failure; }
    try { adoption?.abort(reflect?.tree); } catch (failure) { rollbackFailure ??= failure; }
    nativeHandoff?.finish();
    releaseRoot();
    if (rollbackFailure !== undefined) throw new AggregateError([cause, rollbackFailure], "Document continuation rollback failed.");
    throw cause;
  }
}

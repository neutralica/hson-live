import { prepare_portable_native_handoff } from "./continuation.portable.js";
import { capture_startup_dom } from "./continuation.startup-dom.js";
import type { ReceivingDocumentHandoff, ReceivingDocumentHandoffOwner } from "../livemap/livemap.internal.js";
import type { HsonData } from "../transform/transform.types.js";
import type { HsonNode } from "../../core/types.js";
import { echo_receiving_document_handoff_internal, prepare_echo_replica_internal } from "../echo/echo.replica-preparation.js";
import { echo_document_authority_for } from "../echo/echo.document-authority.js";
import { admit_authority_projection_snapshot, client_projection_identity_internal } from "../locus/locus.authority-projection-snapshot.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { activate_document_interactions_internal } from "../interactions/interactions.js";
import { runtime_for_tree } from "../livetree/runtime/livetree-runtime.js";
import { bind_document_css_tree } from "../livetree/managers/bound-document-css.js";
import { reflect_existing_document_in_runtime } from "../mirror/mirror.document.js";
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
import type { HostedDocumentContinuation } from "./continuation.types.js";
import type { HostedContinuationOptions } from "./continue-hosted-document.lazy.js";

type HostedStartupPoint = "adopted" | "native" | "mirror" | "recovered" | "publish";
let startupFaultHook: ((point: HostedStartupPoint, echo: ReturnType<typeof prepare_echo_replica_internal>["echo"]) => void) | undefined;

/** @internal Deterministic startup fault seam; not a package export. */
export function set_hosted_startup_fault_hook_for_tests(hook: typeof startupFaultHook): void {
  startupFaultHook = hook;
}

export async function continue_hosted_document(options: HostedContinuationOptions): Promise<HostedDocumentContinuation> {
  return continue_hosted_document_internal(options);
}

/** @internal Lazy package-root composition point. */
export async function continue_hosted_document_internal(options: HostedContinuationOptions): Promise<HostedDocumentContinuation> {
  return prepare_hosted_document_internal(options).start();
}

type PreparedHostedDocument = Readonly<{
  start: () => Promise<HostedDocumentContinuation>;
  dispose: () => void;
}>;

/** Prepare a hosted replica and reserve its exact root without inspecting the DOM. @internal */
export function prepare_hosted_document_internal(options: HostedContinuationOptions): PreparedHostedDocument {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Hosted document continuation options must be an object.");
  }
  validate_continuation_root(options.root);
  validate_interaction_shape(options.interactions);
  const releaseRoot = reserve_continuation_root(options.root);
  let prepared: ReturnType<typeof prepare_echo_replica_internal> | undefined;
  try {
    prepared = prepare_echo_replica_internal(options);
    const replica = prepared;
    const echo = replica.echo;
    const documentName = options.document ?? ("document" in options.now ? options.now.document : undefined);
    const explicitDocument = documentName === undefined ? undefined : replica.map.lib(documentName);
    if (explicitDocument !== undefined && explicitDocument.mode !== "document") {
      throw new Error("Explicit continuation selection is not a document library.");
    }
    const resolved = resolve_continuation_document(replica.map, explicitDocument);
    if (resolved.aggregate === undefined) {
      throw new TypeError("Hosted continuation requires a projected library registry.");
    }
    const snapshot = admit_authority_projection_snapshot(options.now.libs, true);
    const aggregate = internal_livemap_aggregate_authority(resolved.aggregate);
    const projection = aggregate.clientProjection();
    const current = aggregate.captureSelectedHosted(snapshot.libraries.map((entry) => entry.name), false, true);
    const currentLibraries = new Map(current.libraries.map((entry) => [entry.name, entry]));
    const selectedName = continuation_document_library_name(resolved.aggregate, resolved.selected);
    if (projection === undefined
      || client_projection_identity_internal(resolved.aggregate) !== snapshot.projectionDigest
      || projection.authority.logicalMapId !== snapshot.authority.logicalMapId
      || projection.authority.incarnationId !== snapshot.authority.incarnationId
      || projection.revision !== snapshot.revision
      || snapshot.libraries.some((entry) => currentLibraries.get(entry.name)?.root.payload !== entry.root.payload)
      || !snapshot.libraries.some((entry) => entry.name === selectedName && entry.mode === "document")) {
      throw new Error("Hosted continuation authority projection does not match its selected document.");
    }
    if (echo_document_authority_for(resolved.selected) === undefined) {
      throw new Error("Selected document is not governed by the supplied Echo replica.");
    }
    const handoffOwner = echo_receiving_document_handoff_internal(echo);
    const handoff = handoffOwner.prepare(selectedName);
    handoffOwner.assert(handoff, selectedName);
    const revision = resolved.selected.rev;
    const canonicalRoot = capture_continuation_document_root(resolved.selected);
    const root = options.root;
    const interactions = options.interactions;
    let state: "prepared" | "starting" | "started" | "failed" | "disposed" = "prepared";
    return Object.freeze({
      async start(): Promise<HostedDocumentContinuation> {
        if (state !== "prepared") throw new Error(`Hosted continuation cannot start from ${state} state.`);
        state = "starting";
        try {
          const continuation = await start_hosted_document({
            prepared: replica, resolved, revision, canonicalRoot, root, interactions, releaseRoot, handoffOwner, handoff,
          });
          state = "started";
          return continuation;
        } catch (cause) {
          state = "failed";
          throw cause;
        }
      },
      dispose(): void {
        if (state === "disposed" || state === "failed") return;
        if (state !== "prepared") throw new Error(`Hosted continuation preparation cannot dispose from ${state} state.`);
        state = "disposed";
        releaseRoot();
        echo.dispose();
      },
    });
  } catch (cause) {
    releaseRoot();
    try { prepared?.echo.dispose(); } catch { /* Preserve preparation failure. */ }
    throw cause;
  }
}

type HostedStart = Readonly<{
  prepared: ReturnType<typeof prepare_echo_replica_internal>;
  resolved: ReturnType<typeof resolve_continuation_document>;
  revision: number;
  canonicalRoot: HsonNode;
  root: Element;
  interactions: HostedContinuationOptions["interactions"];
  releaseRoot: () => void;
  handoffOwner: ReceivingDocumentHandoffOwner;
  handoff: ReceivingDocumentHandoff;
}>;

async function start_hosted_document(context: HostedStart): Promise<HostedDocumentContinuation> {
  const { prepared, resolved, revision, canonicalRoot, root, interactions, releaseRoot, handoffOwner, handoff } = context;
  const echo = prepared.echo;
  let adoption: ExactDocumentAdoption | undefined;
  let reflect: ReturnType<typeof reflect_existing_document_in_runtime> | undefined;
  let disposeInteractions: (() => void) | undefined;
  let disposeCssBinding: (() => void) | undefined;
  let nativeHandoff: ReturnType<typeof prepare_portable_native_handoff> | undefined;
  let restoreDom: (() => void) | undefined;
  try {
    restoreDom = capture_startup_dom(root);
    const assertHandoff = (): void => handoffOwner.assert(handoff, handoff.libraryName);
    try {
      assertHandoff();
      adoption = adopt_exact_existing_document(canonicalRoot, root, handoff.portableCss, { quads: handoff.quads });
      startupFaultHook?.("adopted", echo);
      assertHandoff();
      if (resolved.selected.rev !== revision) {
        throw new Error("Canonical document revision changed during exact DOM adoption.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("adopt", cause);
    }
    try {
      nativeHandoff = prepare_portable_native_handoff(adoption, {
        portableCss: handoff.portableCss, receivingCss: handoff.receivingCss, assertCurrent: assertHandoff,
      });
      nativeHandoff.apply();
      startupFaultHook?.("native", echo);
      assertHandoff();
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
      throw new DocumentContinuationError("mirror", cause);
    }
    // Consume authenticated admission synchronously, before attachment can replay
    // newer authority. The existing Mirror and CSS binding own later revisions.
    assertHandoff();
    try {
      disposeCssBinding = bind_document_css_tree(reflect.tree, resolved.selected,
        adoption.managedStyle, true, () => reflect!.tree);
    } catch (cause) {
      throw new DocumentContinuationError("adopt", cause);
    }
    assertHandoff();
    startupFaultHook?.("mirror", echo);
    assertHandoff();
    nativeHandoff.finish();
    handoffOwner.release();
    try {
      await prepared.attach();
      await prepared.complete();
      if (echo.sync.status !== "caught_up") throw new Error("Echo sync did not reach caught-up state.");
      if (resolved.selected.rev !== prepared.map.rev) {
        throw new Error("Echo, aggregate, and selected document revisions are not current together.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("recover", cause);
    }
    try {
      if (reflect.status !== "active" || reflect.sourceRevision !== resolved.selected.rev) {
        throw reflect.failure ?? new Error("Mirror is not current after Echo synchronization.");
      }
    } catch (cause) {
      throw new DocumentContinuationError("mirror", cause);
    }
    startupFaultHook?.("recovered", echo);
    if (interactions !== undefined) {
      try {
        const dispatch = async (actionKey: string, payload: HsonData): Promise<void> => {
          const outcome = await echo.action(actionKey, payload);
          if (outcome.type === "ack" && outcome.ok === true) return;
          const error = new Error(outcome.error.message, { cause: outcome.error });
          if (outcome.error.code !== undefined) {
            Object.defineProperty(error, "code", { value: outcome.error.code, enumerable: true });
          }
          throw error;
        };
        disposeInteractions = activate_document_interactions_internal({
          map: resolved.aggregate,
          tree: reflect.tree,
          document: continuation_document_library_name(resolved.aggregate, resolved.selected),
          local: interactions.local,
          dispatch,
          ...(interactions.onFailure === undefined ? {} : { onFailure: interactions.onFailure }),
        }, () => {
          // A retained rollback tree does not authorize live interaction work.
          if (reflect!.status !== "active") throw new Error("Document interaction binding is not active.");
          return reflect!.tree;
        });
      } catch (cause) {
        throw new DocumentContinuationError("interactions", cause);
      }
    }
    let disposed = false;
    const selected = echo.lib(continuation_document_library_name(resolved.aggregate, resolved.selected));
    if (selected.mode !== "document" || selected.source !== "authority-projected") {
      throw new Error("Hosted continuation selected document is not authority-projected.");
    }
    const result: HostedDocumentContinuation = Object.freeze({
      echo,
      map: selected,
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
    startupFaultHook?.("publish", echo);
    let published = false;
    schedule_continuation_runtime_activation(() => { if (published) adoption!.activateRuntimeManagers(); }, "promise-resolution");
    activate_continuation_root(root);
    adoption.commit(() => reflect!.tree);
    published = true;
    restoreDom = undefined;
    nativeHandoff = undefined;
    return result;
  } catch (cause) {
    const failures: unknown[] = [];
    try { disposeInteractions?.(); } catch (failure) { failures.push(failure); }
    try { disposeCssBinding?.(); } catch (failure) { failures.push(failure); }
    try { reflect?.dispose(); } catch (failure) { failures.push(failure); }
    try { adoption?.abort(reflect?.tree); } catch (failure) { failures.push(failure); }
    try { await prepared.detach(); } catch (failure) { failures.push(failure); }
    try { echo.dispose(); } catch (failure) { failures.push(failure); }
    handoffOwner.release();
    try { nativeHandoff?.rollback(); } catch (failure) { failures.push(failure); }
    try { restoreDom?.(); } catch (failure) { failures.push(failure); }
    try { nativeHandoff?.finish(); } catch (failure) { failures.push(failure); }
    releaseRoot();
    if (failures.length) throw new AggregateError([cause, ...failures], "Hosted continuation rollback failed.");
    throw cause;
  }
}

import { is_ordinary_element_node } from "../../core/node-guards.js";
import type { LiveMapDocumentPath, LiveMapDocumentPathInput } from "../../types/livemap.types.js";
import type { LiveMapDocumentIdentityHandle } from "./livemap.identity.types.js";
import type { LiveMapDocumentIdentityEpochController } from "./livemap.document.capture.js";
import { resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import { ensure_livemap_document_canonical_identity } from "./livemap.document.registration.js";
import { clone_livemap_document_exact_view } from "./livemap.document.identity.js";
import type { LiveMapDocumentMutationController } from "./livemap.document.mutation.js";
import { normalize_document_request_target } from "./livemap.document.target.js";
import { LiveMapDocumentMutationError } from "./livemap.error.js";
import { lower_internal_document_element_target, resolve_internal_document_location } from "./livemap.document.logical.js";

type IdentityHandleController = LiveMapDocumentMutationController & Readonly<{
  identityEpoch: LiveMapDocumentIdentityEpochController;
}>;

export type LiveMapDocumentIdentityTargetInternal = Readonly<{
  kind: "path";
  path: LiveMapDocumentPathInput;
}>;

type LiveMapDocumentIdentityApi = Readonly<{
  acquire: (target: LiveMapDocumentIdentityTargetInternal) => LiveMapDocumentIdentityHandle;
  captureElement: (select: () => readonly number[], assertLifetime?: () => void) => () => LiveMapDocumentPath;
}>;

const documentIdentityApiForOwner = new WeakMap<object, LiveMapDocumentIdentityApi>();

/** Build the internal path-only sparse identity acquisition capability. */
export function make_livemap_document_identity_api(
  owner: () => object,
  controller: IdentityHandleController,
): LiveMapDocumentIdentityApi {
  return Object.freeze({
    captureElement: (select, assertLifetime) => {
      const assertCapture = controller.captureFence();
      const logical = select();
      assertCapture();
      const root = controller.root();
      const resolution = resolve_internal_document_location(root, controller.mode,
        logical.map(index => ({ kind: "content", index })));
      const path = validate_document_path(lower_internal_document_element_target(resolution).path);
      const epoch = controller.identityEpoch.current();
      const quid = controller.overlay().quidAtPath(path);
      const identity = quid === undefined ? undefined : make_identity_handle(controller, quid, epoch);
      return () => {
        // A QUAD must still own its lifetime. A coordinate only selects once,
        // since a continuing keyed element can vacate that coordinate.
        controller.captureFence()();
        assertLifetime?.();
        if (identity === undefined) {
          // An unkeyed subject has proof of continuity only in the captured graph.
          if (controller.root() === root && controller.identityEpoch.current() === epoch) return path;
        } else {
          const current = identity.path();
          if (current !== undefined) return current;
        }
        throw new Error("Document listener subject changed before acceptance.");
      };
    },
    acquire: (targetInput) => {
      const request = normalize_document_request_target(targetInput, "ensure-quid");
      if (request.kind !== "path") {
        throw new LiveMapDocumentMutationError(
          "INVALID_DOCUMENT_TARGET",
          "ensure-quid",
          "internal identity acquisition requires a canonical path target; raw QUIDs cannot reconstruct handles",
        );
      }
      const target = Object.freeze({
        kind: "path" as const,
        path: validate_document_path(request.path),
      });
      const quid = ensure_livemap_document_canonical_identity(owner(), target);
      return make_identity_handle(controller, quid, controller.identityEpoch.current());
    },
  });
}

/** Capture a selected element for one authoring submission. Any existing identity stays runtime-local. @internal */
export function capture_livemap_document_element(owner: object, select: () => readonly number[], assertLifetime?: () => void): () => LiveMapDocumentPath {
  const api = documentIdentityApiForOwner.get(owner);
  if (api === undefined) throw new Error("LiveMap document has no internal identity authority.");
  return api.captureElement(select, assertLifetime);
}

/** Register internal document identity acquisition without extending the public document façade. */
export function register_livemap_document_identity_api(
  owner: object,
  api: LiveMapDocumentIdentityApi,
): void {
  documentIdentityApiForOwner.set(owner, api);
}

/** Internal acquisition seam for continuity facilities and authoritative tests. */
export function acquire_livemap_document_identity(
  owner: object,
  target: LiveMapDocumentIdentityTargetInternal,
): LiveMapDocumentIdentityHandle {
  const api = documentIdentityApiForOwner.get(owner);
  if (api === undefined) throw new Error("LiveMap document has no internal identity authority.");
  return api.acquire(target);
}

/** Observe an already issued identity without acquisition or publication. @internal */
export function make_livemap_document_identity_handle(
  controller: IdentityHandleController,
  quid: string,
): LiveMapDocumentIdentityHandle {
  return make_identity_handle(controller, quid, controller.identityEpoch.current());
}

function make_identity_handle(
  controller: IdentityHandleController,
  quid: string,
  epoch: number,
): LiveMapDocumentIdentityHandle {
  let disposed = false;

  const current_path = (): LiveMapDocumentPath | undefined => {
    if (disposed || controller.identityEpoch.current() !== epoch) return undefined;
    try {
      const overlay = controller.overlay();
      const path = overlay.pathForQuid(quid);
      if (path === undefined || overlay.quidAtPath(path) !== quid) return undefined;
      const endpoint = resolve_document_path(controller.root(), controller.mode, path);
      if (!is_ordinary_element_node(endpoint)) return undefined;
      return validate_document_path(path);
    } catch {
      return undefined;
    }
  };

  return Object.freeze({
    get active() {
      return current_path() !== undefined;
    },
    path: current_path,
    snap: () => {
      const path = current_path();
      if (path === undefined) return undefined;
      const view = clone_livemap_document_exact_view(controller.root(), controller.mode, controller.overlay());
      const endpoint = resolve_document_path(view, controller.mode, path);
      return is_ordinary_element_node(endpoint) ? endpoint : undefined;
    },
    dispose: () => {
      disposed = true;
    },
  });
}

import { is_ordinary_element_node } from "../../core/node-guards.js";
import { read_hson_node_quid } from "../../core/hson-node-quid.js";
import type {
  LiveMapDocumentIdentityHandle,
  LiveMapDocumentIdentityTarget,
  LiveMapDocumentPath,
} from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import type { LiveMapDocumentIdentityEpochController } from "./livemap.document.capture.js";
import { resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import { ensure_livemap_document_canonical_identity } from "./livemap.document.registration.js";
import type { LiveMapDocumentMutationController } from "./livemap.document.mutation.js";
import { normalize_document_request_target } from "./livemap.document.target.js";
import { LiveMapDocumentMutationError } from "./livemap.error.js";

type IdentityHandleController = LiveMapDocumentMutationController & Readonly<{
  identityEpoch: LiveMapDocumentIdentityEpochController;
}>;

/** Build the public path-only sparse identity acquisition capability. */
export function make_livemap_document_identity_api(
  owner: () => object,
  controller: IdentityHandleController,
): Readonly<{
  ensureIdentity: (target: LiveMapDocumentIdentityTarget) => LiveMapDocumentIdentityHandle;
}> {
  return Object.freeze({
    ensureIdentity: (targetInput) => {
      const request = normalize_document_request_target(targetInput, "ensure-quid");
      if (request.kind !== "path") {
        throw new LiveMapDocumentMutationError(
          "INVALID_DOCUMENT_TARGET",
          "ensure-quid",
          "explicit identity acquisition requires a canonical path target; raw QUIDs cannot reconstruct handles",
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

function make_identity_handle(
  controller: IdentityHandleController,
  quid: string,
  epoch: number,
): LiveMapDocumentIdentityHandle {
  let disposed = false;

  const current_path = (): LiveMapDocumentPath | undefined => {
    if (disposed || controller.identityEpoch.current() !== epoch) return undefined;
    const path = controller.overlay().pathForQuid(quid);
    if (path === undefined || controller.overlay().quidAtPath(path) !== quid) return undefined;
    try {
      const endpoint = resolve_document_path(controller.root(), controller.mode, path);
      if (!is_ordinary_element_node(endpoint) || read_hson_node_quid(endpoint) !== quid) return undefined;
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
      const endpoint = resolve_document_path(controller.root(), controller.mode, path);
      return is_ordinary_element_node(endpoint) ? clone_live_root(endpoint) : undefined;
    },
    dispose: () => {
      disposed = true;
    },
  });
}

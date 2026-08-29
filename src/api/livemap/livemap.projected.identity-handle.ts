import {
  assign_hson_node_quid,
  is_projected_container_quid_eligible,
  read_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type { HsonNode } from "../../core/types.js";
import type {
  LiveMapGraphCommit,
  LiveMapProjectedGraphEnsureQuidOp,
  LiveMapProjectedIdentityHandle,
  LivePath,
} from "../../types/livemap.types.js";
import type { LiveMapDocumentIdentityEpochController } from "./livemap.document.capture.js";
import { clone_live_root, resolve_value_node, snap_live_path } from "./livemap.editor.js";
import { LiveMapProjectedIdentityError } from "./livemap.error.js";
import { clone_live_path, live_path_key } from "./livemap.path.js";
import {
  register_livemap_projected_identity_at_path,
  type LiveMapProjectedIdentityOverlay,
} from "./livemap.projected.identity.js";
import {
  allocate_livemap_quid,
  LIVEMAP_QUID_MINT_RETRY_LIMIT,
  set_livemap_quid_candidate_source_for_tests,
} from "./livemap.quid-allocation.js";

export const LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT = LIVEMAP_QUID_MINT_RETRY_LIMIT;

export type LiveMapProjectedIdentityController = Readonly<{
  root: () => HsonNode;
  overlay: () => LiveMapProjectedIdentityOverlay;
  identityEpoch: LiveMapDocumentIdentityEpochController;
  applyIdentity: (
    root: HsonNode,
    overlay: LiveMapProjectedIdentityOverlay,
    operation: LiveMapProjectedGraphEnsureQuidOp,
  ) => LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp>;
}>;

type LiveMapProjectedIdentityApi = Readonly<{
  acquire: (path: LivePath) => LiveMapProjectedIdentityHandle;
}>;

const projectedIdentityApiForOwner = new WeakMap<object, LiveMapProjectedIdentityApi>();

/** Narrow deterministic allocator seam for data identity tests. @internal */
export function set_livemap_projected_quid_candidate_source_for_tests(
  owner: object,
  source: (() => string) | undefined,
): void {
  set_livemap_quid_candidate_source_for_tests(owner, source);
}

/** Build the sole projected-container acquisition method. */
export function make_livemap_projected_identity_api(
  owner: () => object,
  controller: LiveMapProjectedIdentityController,
): LiveMapProjectedIdentityApi {
  return Object.freeze({
    acquire: (pathInput) => {
      const path = clone_live_path(pathInput);
      const current = current_claim(controller, path);
      const quid = current ?? allocate_and_commit(owner(), controller, path);
      return make_handle(controller, quid, controller.identityEpoch.current());
    },
  });
}

/** Register internal data identity acquisition without extending the public map façade. */
export function register_livemap_projected_identity_api(
  owner: object,
  api: LiveMapProjectedIdentityApi,
): void {
  projectedIdentityApiForOwner.set(owner, api);
}

/** Internal acquisition seam for continuity facilities and authoritative tests. */
export function acquire_livemap_projected_identity(
  owner: object,
  path: LivePath,
): LiveMapProjectedIdentityHandle {
  const api = projectedIdentityApiForOwner.get(owner);
  if (api === undefined) throw new Error("LiveMap has no internal data identity authority.");
  return api.acquire(path);
}

function current_claim(
  controller: LiveMapProjectedIdentityController,
  path: LivePath,
): string | undefined {
  const endpoint = resolve_value_node(controller.root(), path);
  if (endpoint === undefined) {
    throw new LiveMapProjectedIdentityError(
      "PROJECTED_IDENTITY_TARGET_NOT_FOUND",
      path,
      "path does not resolve",
    );
  }
  if (!is_projected_container_quid_eligible(endpoint)) {
    throw new LiveMapProjectedIdentityError(
      "PROJECTED_IDENTITY_INELIGIBLE",
      path,
      "target must be a semantic data object or array container",
    );
  }
  const existing = read_hson_node_quid(endpoint);
  const indexed = controller.overlay().quidAtPath(path);
  const indexedPath = existing === undefined ? undefined : controller.overlay().pathForQuid(existing);
  if (existing !== indexed
    || (existing !== undefined
      && (indexedPath === undefined || live_path_key(indexedPath) !== live_path_key(path)))) {
    throw new LiveMapProjectedIdentityError(
      "PROJECTED_IDENTITY_INVARIANT",
      path,
      "canonical graph and sparse identity overlay disagree",
    );
  }
  return existing;
}

function allocate_and_commit(
  owner: object,
  controller: LiveMapProjectedIdentityController,
  path: LivePath,
): string {
  const allocated = allocate_livemap_quid(
    owner,
    (quid) => controller.identityEpoch.issued().has(quid)
      || controller.overlay().pathForQuid(quid) !== undefined,
    (quid) => {
      const root = clone_live_root(controller.root());
      const endpoint = resolve_value_node(root, path);
      if (endpoint === undefined || !is_projected_container_quid_eligible(endpoint)) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_INELIGIBLE",
          path,
          "staged target is not an eligible projected container",
        );
      }
      try {
        assign_hson_node_quid(endpoint, quid);
        const overlay = register_livemap_projected_identity_at_path(controller.overlay(), quid, path);
        const operation: LiveMapProjectedGraphEnsureQuidOp = Object.freeze({
          domain: "graph",
          op: "ensure-quid",
          target: Object.freeze({ kind: "path", path, projected: true as const }),
          quid,
        });
        const commit = controller.applyIdentity(root, overlay, operation);
        if (!commit.changed) {
          throw new LiveMapProjectedIdentityError(
            "PROJECTED_IDENTITY_INVARIANT",
            path,
            "new registration did not change canonical graph state",
          );
        }
        return Object.freeze({ claimed: true, value: quid });
      } catch (cause) {
        if (cause instanceof LiveMapProjectedIdentityError) throw cause;
        if (controller.overlay().pathForQuid(quid) !== undefined) return Object.freeze({ claimed: false });
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_COLLISION",
          path,
          "candidate could not be claimed atomically",
          { cause },
        );
      }
    },
  );
  if (allocated !== undefined) return allocated;
  throw new LiveMapProjectedIdentityError(
    "PROJECTED_IDENTITY_ALLOCATOR_EXHAUSTED",
    path,
    `allocator exhausted ${LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT} attempts`,
  );
}

function make_handle(
  controller: LiveMapProjectedIdentityController,
  quid: string,
  epoch: number,
): LiveMapProjectedIdentityHandle {
  let disposed = false;
  const current_path = (): LivePath | undefined => {
    if (disposed || controller.identityEpoch.current() !== epoch) return undefined;
    const path = controller.overlay().pathForQuid(quid);
    if (path === undefined || controller.overlay().quidAtPath(path) !== quid) return undefined;
    const endpoint = resolve_value_node(controller.root(), path);
    if (endpoint === undefined
      || !is_projected_container_quid_eligible(endpoint)
      || read_hson_node_quid(endpoint) !== quid) return undefined;
    return clone_live_path(path);
  };
  return Object.freeze({
    get active() { return current_path() !== undefined; },
    path: current_path,
    snap: () => {
      const path = current_path();
      if (path === undefined) return undefined;
      const value = snap_live_path(controller.root(), path);
      return value !== null && typeof value === "object" ? value : undefined;
    },
    dispose: () => { disposed = true; },
  });
}

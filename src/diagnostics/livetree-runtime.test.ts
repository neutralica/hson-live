import type { HsonNode } from "../core/types.js";
import type { DocumentLiveMap } from "../types/livemap.types.js";
import type { LiveTree } from "../api/livetree/livetree.js";
import {
  create_livetree_in_runtime,
} from "../api/livetree/creation/create-livetree.js";
import { project_livetree } from "../api/livetree/creation/project-live-tree.js";
import {
  reflect_document_in_runtime,
  type DocumentReflect,
} from "../api/reflect/reflect.document.js";
import { CssManager } from "../api/livetree/managers/css-manager.js";
import {
  lifecycle_resource_counts_for_owner,
  own_disposable_for_owner,
  type LifecycleResourceKind,
  type LifecycleResourceCounts,
} from "../api/livetree/managers/lifecycle-registry.js";
import {
  get_node_by_quid,
  set_livetree_quid_candidate_source_for_tests,
} from "../api/livetree/quid/data-quid.js";
import {
  create_livetree_runtime,
  dispose_livetree_runtime,
  register_runtime_document,
  runtime_owns_document,
  runtime_for_tree,
  type LiveTreeRuntime,
} from "../api/livetree/runtime/livetree-runtime.js";

export type LiveTreeRuntimeTestHandle = Readonly<{ kind: "LiveTreeRuntimeTestHandle" }>;

const RUNTIME_FOR_TEST_HANDLE = new WeakMap<object, LiveTreeRuntime>();

function runtime_for_handle(handle: LiveTreeRuntimeTestHandle): LiveTreeRuntime {
  const runtime = RUNTIME_FOR_TEST_HANDLE.get(handle);
  if (runtime === undefined) throw new Error("Unknown LiveTree runtime test handle.");
  return runtime;
}

export function create_livetree_runtime_test_handle(): LiveTreeRuntimeTestHandle {
  const handle: LiveTreeRuntimeTestHandle = Object.freeze({
    kind: "LiveTreeRuntimeTestHandle",
  });
  RUNTIME_FOR_TEST_HANDLE.set(handle, create_livetree_runtime());
  return handle;
}

export function create_livetree_for_runtime_test(
  handle: LiveTreeRuntimeTestHandle,
  node: HsonNode,
): LiveTree {
  return create_livetree_in_runtime(node, runtime_for_handle(handle));
}

export function lookup_livetree_runtime_test_node(
  handle: LiveTreeRuntimeTestHandle,
  quid: string,
): HsonNode | undefined {
  return get_node_by_quid(quid, runtime_for_handle(handle));
}

export function livetree_runtime_test_claim_count(
  handle: LiveTreeRuntimeTestHandle,
): number {
  return runtime_for_handle(handle).quidToNode.size;
}

export function livetree_runtime_test_issued_count(
  handle: LiveTreeRuntimeTestHandle,
): number {
  return runtime_for_handle(handle).issuedQuids.size;
}

export function livetree_runtime_test_pending_count(
  handle: LiveTreeRuntimeTestHandle,
): number {
  return runtime_for_handle(handle).pendingQuidClaims.size;
}

export function set_livetree_runtime_test_quid_candidate_source(
  handle: LiveTreeRuntimeTestHandle,
  source: (() => string) | undefined,
): void {
  set_livetree_quid_candidate_source_for_tests(runtime_for_handle(handle), source);
}

export function livetree_runtime_test_resource_counts(
  handle: LiveTreeRuntimeTestHandle,
  quid: string,
): LifecycleResourceCounts {
  const runtime = runtime_for_handle(handle);
  return lifecycle_resource_counts_for_owner(quid, runtime);
}

export function own_livetree_runtime_test_disposable(
  handle: LiveTreeRuntimeTestHandle,
  quid: string,
  dispose: () => void,
  kind: LifecycleResourceKind,
): () => void {
  return own_disposable_for_owner(
    quid,
    dispose,
    kind,
    runtime_for_handle(handle),
  );
}

export function livetree_runtime_test_css_manager(
  handle: LiveTreeRuntimeTestHandle,
): CssManager {
  return CssManager.forRuntime(runtime_for_handle(handle));
}

export function register_livetree_runtime_test_document(
  handle: LiveTreeRuntimeTestHandle,
  document: Document,
): void {
  register_runtime_document(runtime_for_handle(handle), document);
}

export function project_livetree_for_runtime_test(
  handle: LiveTreeRuntimeTestHandle,
  tree: LiveTree,
  document: Document,
): Node {
  const runtime = runtime_for_handle(handle);
  if (runtime_for_tree(tree) !== runtime) {
    throw new Error("LiveTree runtime test handle does not own the supplied tree.");
  }
  return project_livetree(tree.node, "html", runtime, document);
}

export function dispose_livetree_runtime_test_handle(
  handle: LiveTreeRuntimeTestHandle,
): void {
  dispose_livetree_runtime(runtime_for_handle(handle));
}

export function livetree_runtime_test_owns_document(
  handle: LiveTreeRuntimeTestHandle,
  document: Document,
): boolean {
  return runtime_owns_document(runtime_for_handle(handle), document);
}

export function reflect_document_for_runtime_test(
  handle: LiveTreeRuntimeTestHandle,
  map: DocumentLiveMap,
): DocumentReflect {
  return reflect_document_in_runtime(map, runtime_for_handle(handle));
}

export function livetree_runtime_test_same_runtime(
  handle: LiveTreeRuntimeTestHandle,
  tree: LiveTree,
): boolean {
  return runtime_for_handle(handle) === runtime_for_tree(tree);
}

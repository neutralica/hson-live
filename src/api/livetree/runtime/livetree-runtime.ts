import type { HsonNode } from "../../../core/types.js";
import { is_Node } from "../../../core/node-guards.js";
import type { LifecycleResourceKind } from "../managers/lifecycle-registry.js";

/**
 * Internal ownership environment for active LiveTree claims and resources.
 *
 * This object is not node identity. It is never serialized and never forms part
 * of a public QUID value.
 *
 */
export type LiveTreeRuntime = {
  readonly quidToNode: Map<string, HsonNode>;
  readonly nodeToQuid: WeakMap<HsonNode, string>;
  readonly ownerDisposables: Map<string, Set<() => void>>;
  readonly ownerDisposableKinds: Map<string, Map<() => void, LifecycleResourceKind>>;
  readonly styleDocuments: Set<Document>;
  readonly styleDocumentListeners: Set<(document: Document) => void>;
  cssManager: unknown;
  disposeCss: (() => void) | undefined;
  disposed: boolean;
};

function make_runtime(): LiveTreeRuntime {
  return {
    quidToNode: new Map(),
    nodeToQuid: new WeakMap(),
    ownerDisposables: new Map(),
    ownerDisposableKinds: new Map(),
    styleDocuments: new Set(),
    styleDocumentListeners: new Set(),
    cssManager: undefined,
    disposeCss: undefined,
    disposed: false,
  };
}

const DEFAULT_LIVETREE_RUNTIME = make_runtime();
const RUNTIME_FOR_NODE = new WeakMap<HsonNode, LiveTreeRuntime>();
const RUNTIME_FOR_TREE = new WeakMap<object, LiveTreeRuntime>();
const REQUESTED_CONSTRUCTION_RUNTIME = new WeakMap<HsonNode, LiveTreeRuntime>();
const RUNTIME_FOR_DOCUMENT = new WeakMap<Document, LiveTreeRuntime>();

function collect_runtime_graph(root: HsonNode): readonly HsonNode[] {
  const nodes: HsonNode[] = [];
  const visited = new WeakSet<HsonNode>();
  const visit = (node: HsonNode): void => {
    if (visited.has(node)) return;
    visited.add(node);
    nodes.push(node);
    for (const child of node.$_content) {
      if (is_Node(child)) visit(child);
    }
  };
  visit(root);
  return nodes;
}

/** @internal */
export function default_livetree_runtime(): LiveTreeRuntime {
  return DEFAULT_LIVETREE_RUNTIME;
}

/** @internal */
export function create_livetree_runtime(): LiveTreeRuntime {
  return make_runtime();
}

/** @internal */
export function runtime_for_node(node: HsonNode): LiveTreeRuntime | undefined {
  return RUNTIME_FOR_NODE.get(node);
}

/** @internal */
export function runtime_for_tree(tree: object): LiveTreeRuntime {
  return RUNTIME_FOR_TREE.get(tree) ?? DEFAULT_LIVETREE_RUNTIME;
}

/** @internal */
export function bind_tree_runtime(tree: object, runtime: LiveTreeRuntime): void {
  const current = RUNTIME_FOR_TREE.get(tree);
  if (current !== undefined && current !== runtime) {
    throw new Error("LiveTree handle cannot change runtime scope.");
  }
  RUNTIME_FOR_TREE.set(tree, runtime);
}

/** Validate one complete graph before publishing any runtime correspondence. @internal */
export function assert_graph_runtime_available(root: HsonNode, runtime: LiveTreeRuntime): void {
  if (runtime.disposed) {
    throw new Error("LiveTree runtime scope has been disposed.");
  }
  for (const node of collect_runtime_graph(root)) {
    const current = RUNTIME_FOR_NODE.get(node);
    if (current !== undefined && current !== runtime) {
      throw new Error("LiveTree graph is already active in another runtime scope.");
    }
  }
}

/** Publish exact-object runtime routing for a completely validated graph. @internal */
export function bind_graph_runtime(root: HsonNode, runtime: LiveTreeRuntime): void {
  assert_graph_runtime_available(root, runtime);
  for (const node of collect_runtime_graph(root)) {
    RUNTIME_FOR_NODE.set(node, runtime);
  }
}

/** Release exact-object runtime routing during terminal destruction. @internal */
export function release_nodes_runtime(
  nodes: readonly HsonNode[],
  runtime: LiveTreeRuntime,
): void {
  for (const node of nodes) {
    if (RUNTIME_FOR_NODE.get(node) === runtime) RUNTIME_FOR_NODE.delete(node);
  }
}

/**
 * Claim one physical DOM Document for one LiveTree runtime.
 *
 * The weak owner index is operational state only. It is never serialized or
 * reflected into DOM markup. Re-registering the same runtime is idempotent;
 * another runtime is rejected before listeners or style hosts can mutate.
 * @internal
 */
export function register_runtime_document(runtime: LiveTreeRuntime, document: Document): void {
  if (runtime.disposed) {
    throw new Error("LiveTree runtime scope has been disposed.");
  }
  const current = RUNTIME_FOR_DOCUMENT.get(document);
  if (current === runtime) return;
  if (current !== undefined) {
    throw new Error("DOM Document is already owned by another LiveTree runtime scope.");
  }
  RUNTIME_FOR_DOCUMENT.set(document, runtime);
  runtime.styleDocuments.add(document);
  try {
    for (const listener of runtime.styleDocumentListeners) listener(document);
  } catch (cause) {
    runtime.styleDocuments.delete(document);
    if (RUNTIME_FOR_DOCUMENT.get(document) === runtime) {
      RUNTIME_FOR_DOCUMENT.delete(document);
    }
    throw cause;
  }
}

/** Release an inactive internal runtime and its physical Document claims. @internal */
export function dispose_livetree_runtime(runtime: LiveTreeRuntime): void {
  if (runtime === DEFAULT_LIVETREE_RUNTIME) {
    throw new Error("The compatibility-default LiveTree runtime cannot be disposed.");
  }
  if (runtime.disposed) return;
  if (
    runtime.quidToNode.size !== 0
    || runtime.ownerDisposables.size !== 0
    || runtime.ownerDisposableKinds.size !== 0
  ) {
    throw new Error("Cannot dispose a LiveTree runtime while active claims or resources remain.");
  }

  runtime.disposeCss?.();
  runtime.disposeCss = undefined;
  runtime.cssManager = undefined;
  runtime.styleDocumentListeners.clear();
  for (const document of runtime.styleDocuments) {
    if (RUNTIME_FOR_DOCUMENT.get(document) === runtime) {
      RUNTIME_FOR_DOCUMENT.delete(document);
    }
  }
  runtime.styleDocuments.clear();
  runtime.disposed = true;
}

/** Exact-object ownership diagnostic for internal tests. @internal */
export function runtime_owns_document(runtime: LiveTreeRuntime, document: Document): boolean {
  return RUNTIME_FOR_DOCUMENT.get(document) === runtime;
}

/** @internal */
export function requested_runtime_for_construction(node: HsonNode): LiveTreeRuntime | undefined {
  return REQUESTED_CONSTRUCTION_RUNTIME.get(node);
}

/** Synchronous construction seam used by internal factories and diagnostics. @internal */
export function with_livetree_construction_runtime<T>(
  node: HsonNode,
  runtime: LiveTreeRuntime,
  construct: () => T,
): T {
  const prior = REQUESTED_CONSTRUCTION_RUNTIME.get(node);
  REQUESTED_CONSTRUCTION_RUNTIME.set(node, runtime);
  try {
    return construct();
  } finally {
    if (prior === undefined) REQUESTED_CONSTRUCTION_RUNTIME.delete(node);
    else REQUESTED_CONSTRUCTION_RUNTIME.set(node, prior);
  }
}

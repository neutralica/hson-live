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
  readonly pendingQuidClaims: Map<string, HsonNode>;
  /** Every QUID lineage admitted or minted during this runtime lifetime. */
  readonly issuedQuids: Set<string>;
  /** Runtime resources follow exact realized subjects, never canonical QUID equality. */
  readonly ownerDisposables: Map<HsonNode, Set<() => void>>;
  readonly ownerDisposableKinds: Map<HsonNode, Map<() => void, LifecycleResourceKind>>;
  readonly styleDocuments: Set<Document>;
  /** Claimed documents not yet visible to runtime managers. */
  readonly silentStyleDocuments: Set<Document>;
  readonly styleDocumentListeners: Set<(document: Document) => void>;
  readonly realizationListeners: Set<() => void>;
  cssManager: unknown;
  disposeCss: (() => void) | undefined;
  disposed: boolean;
};

function make_runtime(): LiveTreeRuntime {
  return {
    quidToNode: new Map(),
    nodeToQuid: new WeakMap(),
    pendingQuidClaims: new Map(),
    issuedQuids: new Set(),
    ownerDisposables: new Map(),
    ownerDisposableKinds: new Map(),
    styleDocuments: new Set(),
    silentStyleDocuments: new Set(),
    styleDocumentListeners: new Set(),
    realizationListeners: new Set(),
    cssManager: undefined,
    disposeCss: undefined,
    disposed: false,
  };
}

const DEFAULT_LIVETREE_RUNTIME = make_runtime();
const RUNTIME_FOR_NODE = new WeakMap<HsonNode, LiveTreeRuntime>();
const RUNTIME_FOR_TREE = new WeakMap<object, LiveTreeRuntime>();
const SUBJECT_FOR_TREE = new WeakMap<object, HsonNode>();
const REQUESTED_CONSTRUCTION_RUNTIME = new WeakMap<HsonNode, LiveTreeRuntime>();
const REQUESTED_LINKED_CONSTRUCTION = new WeakSet<HsonNode>();
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
export function bind_tree_runtime(tree: object, runtime: LiveTreeRuntime, subject: HsonNode): void {
  const current = RUNTIME_FOR_TREE.get(tree);
  if (current !== undefined && current !== runtime) {
    throw new Error("LiveTree handle cannot change runtime scope.");
  }
  RUNTIME_FOR_TREE.set(tree, runtime);
  SUBJECT_FOR_TREE.set(tree, subject);
}

/** Resolve the exact runtime realization subject pinned by a LiveTree alias. @internal */
export function subject_for_tree(tree: object): HsonNode {
  const subject = SUBJECT_FOR_TREE.get(tree);
  if (subject === undefined) throw new Error("LiveTree handle has no runtime subject.");
  return subject;
}

/** Observe exact realization creation/release inside one active tree runtime. @internal */
export function observe_livetree_realizations_internal(
  tree: object,
  listener: () => void,
): () => void {
  const runtime = runtime_for_tree(tree);
  runtime.realizationListeners.add(listener);
  return () => { runtime.realizationListeners.delete(listener); };
}

/** Publish one completed realization boundary. @internal */
export function notify_livetree_realizations_internal(runtime: LiveTreeRuntime): void {
  for (const listener of [...runtime.realizationListeners]) listener();
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
  if (current === runtime) {
    if (runtime.silentStyleDocuments.has(document)) {
      activate_runtime_document(runtime, document);
    }
    return;
  }
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

export type SilentRuntimeDocumentClaim = Readonly<{
  ownedByAttempt: boolean;
  activate: () => void;
  rollback: () => void;
}>;

/** Claim a document without exposing it to managers until continuation publication. @internal */
export function claim_runtime_document_silently(
  runtime: LiveTreeRuntime,
  document: Document,
): SilentRuntimeDocumentClaim {
  assert_runtime_document_available(runtime, document);
  const current = RUNTIME_FOR_DOCUMENT.get(document);
  if (current === runtime) {
    return Object.freeze({ ownedByAttempt: false, activate: () => {}, rollback: () => {} });
  }
  RUNTIME_FOR_DOCUMENT.set(document, runtime);
  runtime.silentStyleDocuments.add(document);
  let finished = false;
  return Object.freeze({
    ownedByAttempt: true,
    activate(): void {
      if (finished) return;
      finished = true;
      activate_runtime_document(runtime, document);
    },
    rollback(): void {
      if (finished) return;
      finished = true;
      runtime.silentStyleDocuments.delete(document);
      if (RUNTIME_FOR_DOCUMENT.get(document) === runtime) RUNTIME_FOR_DOCUMENT.delete(document);
    },
  });
}

/** Publish a successful silent claim and isolate manager failures from continuation. @internal */
function activate_runtime_document(runtime: LiveTreeRuntime, document: Document): void {
  runtime.silentStyleDocuments.delete(document);
  runtime.styleDocuments.add(document);
  for (const listener of [...runtime.styleDocumentListeners]) {
    try {
      listener(document);
    } catch (cause) {
      report_runtime_activation_failure(cause);
    }
  }
}

function report_runtime_activation_failure(cause: unknown): void {
  const reporter = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (typeof reporter === "function") reporter(cause);
  else console.error("LiveTree runtime manager activation failed after continuation success.", cause);
}

/** Validate a document claim without publishing it. @internal */
export function assert_runtime_document_available(
  runtime: LiveTreeRuntime,
  document: Document,
): void {
  if (runtime.disposed) {
    throw new Error("LiveTree runtime scope has been disposed.");
  }
  const current = RUNTIME_FOR_DOCUMENT.get(document);
  if (current !== undefined && current !== runtime) {
    throw new Error("DOM Document is already owned by another LiveTree runtime scope.");
  }
}

/** Release a document claim installed by an aborted internal operation. @internal */
export function release_runtime_document_claim(
  runtime: LiveTreeRuntime,
  document: Document,
): void {
  if (RUNTIME_FOR_DOCUMENT.get(document) !== runtime) return;
  RUNTIME_FOR_DOCUMENT.delete(document);
  runtime.styleDocuments.delete(document);
  runtime.silentStyleDocuments.delete(document);
}

/** Release an inactive internal runtime and its physical Document claims. @internal */
export function dispose_livetree_runtime(runtime: LiveTreeRuntime): void {
  if (runtime === DEFAULT_LIVETREE_RUNTIME) {
    throw new Error("The compatibility-default LiveTree runtime cannot be disposed.");
  }
  if (runtime.disposed) return;
  if (
    runtime.quidToNode.size !== 0
    || runtime.pendingQuidClaims.size !== 0
    || runtime.ownerDisposables.size !== 0
    || runtime.ownerDisposableKinds.size !== 0
  ) {
    throw new Error("Cannot dispose a LiveTree runtime while active claims or resources remain.");
  }

  runtime.disposeCss?.();
  runtime.disposeCss = undefined;
  runtime.cssManager = undefined;
  runtime.styleDocumentListeners.clear();
  runtime.realizationListeners.clear();
  for (const document of runtime.styleDocuments) {
    if (RUNTIME_FOR_DOCUMENT.get(document) === runtime) {
      RUNTIME_FOR_DOCUMENT.delete(document);
    }
  }
  runtime.styleDocuments.clear();
  runtime.silentStyleDocuments.clear();
  runtime.issuedQuids.clear();
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

/** Whether an internal document projection requested authority-preserving construction. @internal */
export function linked_livetree_construction_requested(node: HsonNode): boolean {
  return REQUESTED_LINKED_CONSTRUCTION.has(node);
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

/** Construct one LiveMap-linked handle without granting standalone mint authority. @internal */
export function with_linked_livetree_construction_runtime<T>(
  node: HsonNode,
  runtime: LiveTreeRuntime,
  construct: () => T,
): T {
  const wasLinked = REQUESTED_LINKED_CONSTRUCTION.has(node);
  REQUESTED_LINKED_CONSTRUCTION.add(node);
  try {
    return with_livetree_construction_runtime(node, runtime, construct);
  } finally {
    if (!wasLinked) REQUESTED_LINKED_CONSTRUCTION.delete(node);
  }
}

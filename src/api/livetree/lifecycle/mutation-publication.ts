import type { HsonNode } from "../../../core/types.js";
import { is_Node } from "../../../core/node-guards.js";
import { parent_for_node } from "./graph-ownership.js";
import { get_dom_for_node, get_node_for_dom } from "../utils/node-map-helpers.js";
import { browser_realization_content_target } from "../../../internal/browser-realization/browser-realization-dom.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";

// Exact subjects, rather than handles or runtimes: aliases conflict, while
// independent ownership regions in the same runtime remain usable.
const PUBLISHING_SUBJECTS = new WeakSet<HsonNode>();
// Exact child-list snapshots may include containers with no graph owner. Keep
// strong references only until the owning operation finishes or rolls back.
const PUBLISHING_CONTAINERS = new Map<Node, ReadonlySet<Node>>();
let activePublications = 0;

/** Native admission must precede parsing, normalization and identity planning.
 * Ancestor writes also own this footprint. Placement writers reserve the
 * original parent separately; sibling child-list writes remain independent. @internal */
export function assert_native_mutation_publication_available(node: Node): void {
  if (activePublications === 0) return;
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    // Restoring original child references also restores their placement if raw
    // code moved them elsewhere. A new wrapping owner would lose that child.
    for (const children of PUBLISHING_CONTAINERS.values()) {
      if (current !== node && children.has(current)) throw new Error("LiveTree mutation overlaps an unfinished native placement.");
    }
    const subject = get_node_for_dom(current);
    if (subject && PUBLISHING_SUBJECTS.has(subject)) throw new Error("LiveTree mutation overlaps an unfinished publication.");
    pending.push(...Array.from(current.childNodes ?? []));
    if (current.nodeType === 1) {
      const content = browser_realization_content_target(current as Element);
      if (content !== current) pending.push(content);
    }
  }
  for (const container of PUBLISHING_CONTAINERS.keys()) {
    for (let current: Node | null = container; current; current = current.parentNode) {
      if (current === node) throw new Error("LiveTree mutation overlaps an unfinished native publication.");
    }
  }
}

/** Reject a public write overlapping a rollback-owned region. @internal */
export function assert_mutation_publication_available(node: HsonNode): void {
  const seen = new Set<HsonNode>();
  for (let owner: HsonNode | undefined = node; owner && !seen.has(owner); owner = parent_for_node(owner)) {
    if (PUBLISHING_SUBJECTS.has(owner)) throw new Error("LiveTree mutation overlaps an unfinished publication.");
    seen.add(owner);
  }
  // Ancestor lifecycle/structural writes also own their descendants.
  for (const subject of collect_subtree_nodes(node, "pre")) {
    if (PUBLISHING_SUBJECTS.has(subject)) throw new Error("LiveTree mutation overlaps an unfinished publication.");
    const dom = get_dom_for_node(subject);
    if (dom) {
      assert_native_mutation_publication_available(dom);
      if (dom.nodeType === 1) assert_native_mutation_publication_available(browser_realization_content_target(dom as Element));
    }
  }
}

/** Protect only these operations' subjects until publication or rollback ends.
 * This guard neither mutates, queues nor rolls back application work. @internal */
export function begin_mutation_publication(roots: readonly HsonNode[], nativeContainers: readonly Node[] = []): () => void {
  for (const root of roots) assert_mutation_publication_available(root);
  const containers = new Map<Node, ReadonlySet<Node>>();
  for (const container of nativeContainers) {
    assert_native_mutation_publication_available(container);
    // Complete all native reads before installing any guard state.
    containers.set(container, new Set(Array.from(container.childNodes ?? [])));
  }
  const subjects = new Set<HsonNode>(), ancestors = new Set<HsonNode>(), pending = [...roots];
  for (const root of roots) for (let owner: HsonNode | undefined = root; owner && !ancestors.has(owner); owner = parent_for_node(owner)) {
    if (PUBLISHING_SUBJECTS.has(owner)) throw new Error("LiveTree mutation overlaps an unfinished publication.");
    ancestors.add(owner);
  }
  while (pending.length) {
    const subject = pending.pop()!;
    if (subjects.has(subject)) continue;
    if (PUBLISHING_SUBJECTS.has(subject)) throw new Error("LiveTree mutation overlaps an unfinished publication.");
    subjects.add(subject);
    for (const child of subject.$_content) if (is_Node(child)) pending.push(child);
  }
  for (const subject of subjects) PUBLISHING_SUBJECTS.add(subject);
  for (const [container, children] of containers) PUBLISHING_CONTAINERS.set(container, children);
  activePublications++;
  return () => {
    for (const subject of subjects) PUBLISHING_SUBJECTS.delete(subject);
    for (const container of containers.keys()) PUBLISHING_CONTAINERS.delete(container);
    activePublications--;
  };
}

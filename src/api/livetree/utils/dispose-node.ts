import type { HsonNode } from "../../../core/types.js";
import {
  disposables_drain_for_owners,
} from "../managers/lifecycle-registry.js";
import {
  destroy_subtree_quids,
  get_quid,
  HSON_QUID_MARKUP_NAME,
} from "../quid/data-quid.js";
import { mark_livetree_nodes_disposed } from "../livetree-state.js";
import { detach_node_deep } from "./detach-node.js";
import { get_el_for_node } from "./node-map-helpers.js";
import { collect_subtree_nodes } from "./subtree-traversal.js";
import {
  default_livetree_runtime,
  release_nodes_runtime,
  runtime_for_node,
  type LiveTreeRuntime,
} from "../runtime/livetree-runtime.js";

export type DisposeNodeDeepResult = Readonly<{
  nodesDisposed: number;
  identitiesDestroyed: number;
  disposableDrainPasses: number;
  disposableCallbacks: number;
  disposableDrainBounded: boolean;
}>;

/**
 * Terminally dispose a complete Hson subtree.
 *
 * Parent-graph unlinking remains the caller's responsibility. Unlike
 * `detach_node_deep`, this operation destroys QUID identity and marks all node
 * aliases disposed after runtime teardown completes.
 */
export function dispose_node_deep(
  root: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_node(root) ?? default_livetree_runtime(),
): DisposeNodeDeepResult {
  const nodes = collect_subtree_nodes(root, "post");
  const formerQuids = new Map<HsonNode, string>();
  const mappedElements: Element[] = [];

  for (const node of nodes) {
    const quid = get_quid(node, runtime);
    if (quid) formerQuids.set(node, quid);

    const element = get_el_for_node(node);
    if (element) mappedElements.push(element);
  }

  // Runtime teardown preserves identity so every owner QUID remains available
  // while listeners, CSS, observers, and mappings are released.
  detach_node_deep(root, runtime);

  // Runtime callbacks may register more work, including against an owner that
  // was processed earlier in post-order. Drain the complete owner set to a
  // fixed point before destroying identity.
  const drain = disposables_drain_for_owners([...formerQuids.values()], undefined, runtime);

  const identitiesDestroyed = destroy_subtree_quids(root, runtime);

  // `detach_node_deep` has already removed node-element mappings, so retain the
  // pre-teardown elements long enough to scrub identity attributes as well.
  for (const element of mappedElements) {
    element.removeAttribute(HSON_QUID_MARKUP_NAME);
  }

  mark_livetree_nodes_disposed(nodes, formerQuids);
  release_nodes_runtime(nodes, runtime);

  return {
    nodesDisposed: nodes.length,
    identitiesDestroyed,
    disposableDrainPasses: drain.passes,
    disposableCallbacks: drain.callbacks,
    disposableDrainBounded: drain.bounded,
  };
}

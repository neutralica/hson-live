// clone.ts

import { HsonNode } from "../../../core/types.js";
import { HSON_META_QUID, ensure_quid, get_quid } from "../quid/data-quid.js";
import { LiveTree } from "../livetree.js";
import { make_branch_from_node } from "../creation/create-branch.js";
import { has_own_entries, prune_empty_node_meta } from "../../../core/node-storage.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { is_ordinary_element_node } from "../../../core/node-guards.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import { scan_hson_node_quids } from "../../../core/hson-node-quid.js";
import { runtime_for_tree, type LiveTreeRuntime } from "../runtime/livetree-runtime.js";


// clone + remint in one traversal so mapping is correct by construction
type QuidMap = Map<string, string>;

type CloneOpts = {
  persistQuidMeta?: boolean; // default true
};

function clone_branch_inner(
  src: HsonNode,
  quidMap: QuidMap,
  opts: CloneOpts,
  runtime: LiveTreeRuntime,
): HsonNode {
  const dst = CREATE_NODE({ $_tag: src.$_tag });

  // deep clone containers
  if (has_own_entries(src.$_attrs)) dst.$_attrs = { ...src.$_attrs };
  if (has_own_entries(src.$_meta)) {
    dst.$_meta = { ...src.$_meta };

    // Identity is not structural clone data. Remove the source QUID before
    // ensure_quid() runs so every eligible clone node receives fresh identity.
    delete dst.$_meta[HSON_META_QUID];
    prune_empty_node_meta(dst);
  }

  // deep clone content
  dst.$_content = src.$_content.map((c) => {
    if (typeof c === "object" && c !== null) {
      return clone_branch_inner(c as HsonNode, quidMap, opts, runtime);
    }
    return c;
  });

  // Mint a new quid only for canonical identity-bearing ordinary nodes.
  const oldQ = get_quid(src, runtime);
  if (is_ordinary_element_node(dst)) {
    const newQ = ensure_quid(dst, { persist: opts.persistQuidMeta ?? true }, runtime);
    if (oldQ) quidMap.set(oldQ, newQ);
  }

  return dst;
}

function clone_branch_with_quids(
  srcRoot: HsonNode,
  runtime: LiveTreeRuntime,
  opts?: CloneOpts,
): { root: HsonNode; quidMap: QuidMap } {
  // Reject invalid or duplicate supplied QUID metadata before cloning or
  // registering any node.
  scan_hson_node_quids(srcRoot);

  // Also preflight LiveTree's runtime-only reverse cache.
  for (const node of collect_subtree_nodes(srcRoot, "pre")) get_quid(node, runtime);

  const quidMap: QuidMap = new Map();
  const root = clone_branch_inner(
    srcRoot,
    quidMap,
    { persistQuidMeta: opts?.persistQuidMeta ?? true },
    runtime,
  );
  return { root, quidMap };
}


// clone steps:
// - deep clones nodes sans QUIDs
// - mints new QUIDs
// - builds old->new QUID map
// Runtime resources are deliberately not copied. The clone is structural-only:
// fresh QUIDs, no CSS/listener/event/observer/binding ownership transfer.
export function clone_branch_method<TSelf extends LiveTree>(this: TSelf): TSelf {
  const srcNode: HsonNode = this.node;
  const runtime = runtime_for_tree(this);
  const clonedRootNode: HsonNode = clone_branch_with_quids(srcNode, runtime).root;

  return make_branch_from_node(
    clonedRootNode,
    { quidGraphValidated: true, runtime },
  ) as TSelf;
}

// clone.ts

import { HsonNode } from "../../../core/types.js";
import { _DATA_QUID, ensure_quid, get_quid } from "../quid/data-quid.js";
import { LiveTree } from "../livetree.js";
import { make_branch_from_node } from "../creation/create-branch.js";
import { has_own_entries, prune_empty_node_meta } from "../../../core/node-storage.js";
import { CREATE_NODE } from "../../../core/factories.js";


// clone + remint in one traversal so mapping is correct by construction
type QuidMap = Map<string, string>;

type CloneOpts = {
  persistQuidMeta?: boolean; // default true
};

function clone_branch_inner(
  src: HsonNode,
  quidMap: QuidMap,
  opts: CloneOpts,
): HsonNode {
  const dst = CREATE_NODE({ $_tag: src.$_tag });

  // deep clone containers
  if (has_own_entries(src.$_attrs)) dst.$_attrs = { ...src.$_attrs };
  if (has_own_entries(src.$_meta)) {
    dst.$_meta = { ...src.$_meta };

    // CHANGED: identity is not structural clone data. Remove the source quid
    // before ensure_quid() runs so the clone is always reminted.
    delete dst.$_meta[_DATA_QUID];
    prune_empty_node_meta(dst);
  }

  // deep clone content
  dst.$_content = src.$_content.map((c) => {
    if (typeof c === "object" && c !== null) {
      return clone_branch_inner(c as HsonNode, quidMap, opts);
    }
    return c;
  });

  // Mint a new quid for dst after the copied source identity has been removed.
  const oldQ = get_quid(src);
  const newQ = ensure_quid(dst, { persist: opts.persistQuidMeta ?? true });

  if (oldQ) quidMap.set(oldQ, newQ);

  return dst;
}

function clone_branch_with_quids(
  srcRoot: HsonNode,
  opts?: CloneOpts,
): { root: HsonNode; quidMap: QuidMap } {
  const quidMap: QuidMap = new Map();
  const root = clone_branch_inner(srcRoot, quidMap, { persistQuidMeta: opts?.persistQuidMeta ?? true });
  return { root, quidMap };
}


// clone steps:
// - deep clones nodes sans QUIDs
// - mints new QUIDs
// - builds old->new QUID map
// - copies per-QUID CSS rules internally via CssManager @internal hook
// - animations, event listeners, and events are *not* copied: 
//    this function returns flat HTML that looks the same but doesn't adopt any old behaviors
export function clone_branch_method<TSelf extends LiveTree>(this: TSelf): TSelf {
  const srcNode: HsonNode = this.node;
  const clonedRootNode: HsonNode = clone_branch_with_quids(srcNode).root;

  return make_branch_from_node(clonedRootNode) as TSelf;
}

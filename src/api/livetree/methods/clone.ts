import { HsonNode } from "../../../types-consts/node.types";
import { _DATA_QUID, ensure_quid, get_quid } from "../../../quid/data-quid.quid";
import { LiveTree } from "../livetree";
import { hson } from "../../../hson";


// CHANGED: clone + remint in one traversal so mapping is correct by construction
type QuidMap = Map<string, string>;

type CloneOpts = {
  persistQuidMeta?: boolean; // default true
};

function clone_branch_inner(
  src: HsonNode,
  quidMap: QuidMap,
  opts: CloneOpts,
): HsonNode {
  // shallow copy of the node object
  const dst: HsonNode = { ...src };

  // CHANGED: deep clone containers you mutate later
  if (src._attrs) dst._attrs = { ...src._attrs };
  if (src._meta)  dst._meta  = { ...src._meta };

  // CHANGED: deep clone content
  if (src._content) {
    dst._content = src._content.map((c) => {
      if (typeof c === "object" && c !== null) {
        return clone_branch_inner(c as HsonNode, quidMap, opts);
      }
      return c;
    });
  }

  // CHANGED: mint a new quid for dst, and record mapping from src's quid (if any)
  const oldQ = get_quid(src);
  const newQ = ensure_quid(dst, { persist: opts.persistQuidMeta ?? true });

  // If you’re cloning, you never want the old quid hanging around in meta by accident.
  // ensure_quid() should have overwritten it when persist=true, but when persist=false, scrub it.
  if ((opts.persistQuidMeta ?? true) === false && dst._meta && _DATA_QUID in dst._meta) {
    delete dst._meta[_DATA_QUID];
  }

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
export function clone_branch_method(this: LiveTree): LiveTree {
  // ensure cloning an actual bound node
  const srcNode: HsonNode = this.node; 
  const clonedRootNode: HsonNode = clone_branch_with_quids(srcNode).root;

  return hson.fromNode(clonedRootNode).liveTree().asBranch();
}
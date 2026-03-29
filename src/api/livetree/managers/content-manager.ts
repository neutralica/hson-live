//content-manager.ts


import { ELEM_OBJ, EVERY_VSN, LEAF_NODES } from "../../../consts/constants.js";
import { Primitive } from "../../../types/core.types.js";
import { HsonNode } from "../../../types/node.types.js";
import { is_Node } from "../../../utils/node-utils/node-guards.js";
import { create_livetree } from "../create-livetree.js";
import { LiveTree } from "../livetree.js";
type ContentItem = HsonNode | Primitive;

const VSN_SET: ReadonlySet<string> = new Set(EVERY_VSN);
const LEAF_SET: ReadonlySet<string> = new Set(LEAF_NODES);

// helper
const is_vsn_tag = (tag: string): boolean => VSN_SET.has(tag);
const is_leaf_vsn = (tag: string): boolean => LEAF_SET.has(tag);

export class ContentManager {
  private readonly owner: LiveTree;

  public constructor(owner: LiveTree) {
    this.owner = owner;
  }

  /** Raw `_content` array (no unwrapping, no minting, no filtering). */
  private pure_nodes(): readonly ContentItem[] {
    const n = this.owner.node as HsonNode;
    return (n._content ?? []) as readonly ContentItem[];
  }

  /**
   * CHANGED: “content” means element-children, with VSN wrappers invisible:
   * - flatten VSN containers: _root, _elem, _obj, _arr, _ii
   * - skip VSN leaves: _str, _val
   * - include non-VSN nodes
   * - ignore primitives
   */
  private effective_node_children(): readonly HsonNode[] {
    const out: HsonNode[] = [];

    const walk_items = (items: readonly ContentItem[]): void => {
      for (const it of items) {
        if (!is_Node(it)) continue;

        const tag = it._tag;

        // leaf wrappers are invisible at the “element-children” level
        if (is_leaf_vsn(tag)) {
          continue;
        }

        // container wrappers are invisible; descend into their content
        if (is_vsn_tag(tag)) {
          const kids = (it._content ?? []) as readonly ContentItem[];
          walk_items(kids);
          continue;
        }

        // normal element node
        out.push(it);
      }
    };

    walk_items(this.pure_nodes());
    return out;
  }

  /** Count of effective node-children (VSNs invisible; primitives ignored). */
  public count(): number {
    return this.effective_node_children().length;
  }

  /** Node-child at index (effective view). */
  private at_node(ix: number): HsonNode | undefined {
    const a = this.effective_node_children();
    if (ix < 0 || ix >= a.length) return undefined;
    return a[ix];
  }

  /** LiveTree handle for the node-child at index (effective view). */
  public at(ix: number): LiveTree | undefined {
    const n = this.at_node(ix);
    if (!n) return undefined;
    const t = create_livetree(n);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }

  public first(): LiveTree | undefined {
    const n = this.at_node(0);
    if (!n) return undefined;
    const t = create_livetree(n);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }

  public all(): readonly LiveTree[] {
    const out: LiveTree[] = [];
    for (const n of this.effective_node_children()) {
      const t = create_livetree(n);
      t.adoptRoots(this.owner.hostRootNode());
      out.push(t);
    }
    return out;
  }

  public mustOnly(opts?: { warn?: boolean }): LiveTree {
    const warn = opts?.warn ?? true;
    const kids = this.effective_node_children();

    if (kids.length !== 1) {
      const msg =
        `ContentManager.mustOnly(): expected 1 node-content, got ${kids.length}.\n` +
        `(on: ${this.owner.node._tag})`;
      if (warn) console.warn(msg);
      throw new Error(msg);
    }

    const t = create_livetree(kids[0]!);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }
}
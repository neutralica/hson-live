//content-manager.ts


import { Primitive } from "../../../types/core.types";
import { HsonNode } from "../../../types/node.types";
import { is_Node } from "../../../utils/node-utils/node-guards";
import { create_livetree } from "../create-livetree";
import { LiveTree } from "../livetree";


type ContentItem = HsonNode | Primitive;

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

  /** Count of raw content items. */
  public count(): number {
    return this.pure_nodes().length;
  }

  /** Raw item at index (can be node or primitive). */
  private at_node(ix: number): ContentItem | undefined {
    const a = this.pure_nodes();
    if (ix < 0 || ix >= a.length) return undefined;
    return a[ix];
  }

  /**
   * LiveTree handle for the node at index.
   * - returns undefined if the content item is missing or primitive
   * - QUID minting happens because create_livetree is the handle factory
   */
  public at(ix: number): LiveTree | undefined {
    const v = this.at_node(ix);
    if (!is_Node(v)) return undefined;
    const t = create_livetree(v);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }

  /** First node-content as a LiveTree handle (skips primitives). */
  public first(): LiveTree | undefined {
    const a = this.pure_nodes();
    for (const v of a) {
      if (!is_Node(v)) continue;
      const t = create_livetree(v);
      t.adoptRoots(this.owner.hostRootNode());
      return t;
    }
    return undefined;
  }

  /** All node-contents as LiveTree handles (skips primitives). */
  public all(): readonly LiveTree[] {
    const out: LiveTree[] = [];
    for (const v of this.pure_nodes()) {
      if (!is_Node(v)) continue;
      const t = create_livetree(v);
      t.adoptRoots(this.owner.hostRootNode());
      out.push(t);
    }
    return out;
  }

  /**
   * Expect exactly one node child.
   * - ignores primitives
   * - warns and returns undefined on 0 or >1 nodes
   */
  public mustOnly(opts?: { warn?: boolean }): LiveTree  {
    const warn = opts?.warn ?? true;

    let found: HsonNode | undefined;
    let count = 0;

    for (const v of this.pure_nodes()) {
      if (!is_Node(v)) continue;
      count += 1;
      if (count === 1) found = v;
    }

    if (count !== 1) {
      if (warn) {
        console.warn(
            `ContentManager.mustOnly(): expected 1 node-content, got ${count}.\n 
          (on: ${this.owner.node._tag})`
        );
      }
      throw new Error ( `ContentManager.mustOnly(): expected 1 node-content, got ${count}.\n 
          (on: ${this.owner.node._tag})`)
      // return undefined;
    }

    const t = create_livetree(found!);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }
}
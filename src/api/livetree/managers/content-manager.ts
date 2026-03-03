//content-manager.ts


import { Primitive } from "../../../types/core.types.js";
import { HsonNode } from "../../../types/node.types.js";
import { is_Node } from "../../../utils/node-utils/node-guards.js";
import { create_livetree } from "../create-livetree.js";
import { LiveTree } from "../livetree.js";


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

  // ADDED: effective content list with transparent `_elem` unwrapping
  // Rule: if the parent has exactly ONE node child and it's `_elem`,
  // treat that `_elem` as invisible and use ITS raw _content instead.
  private effective_nodes(): readonly ContentItem[] {
    const raw = this.pure_nodes();

    // node children only (primitives ignored for semantic content APIs)
    const nodeKids: HsonNode[] = [];
    for (const v of raw) if (is_Node(v)) nodeKids.push(v);

    if (nodeKids.length === 1 && nodeKids[0]!._tag === "_elem") {
      // unwrap one level; still raw content items under the wrapper
      return ((nodeKids[0]!._content ?? []) as readonly ContentItem[]);
    }

    // otherwise: semantic content is just this node’s raw content
    return raw;
  }

  /** Count of raw content items. */
  public count(): number {
    // NOTE: keep as raw count (your original intent). If you want semantic count,
    // add a separate method later (e.g., countNodes()).
    return this.pure_nodes().length;
  }

  /** Raw item at index (can be node or primitive). */
  private at_node(ix: number): ContentItem | undefined {
    // CHANGED: operate on effective content (unwrap `_elem` if applicable)
    const a = this.effective_nodes();
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
    // CHANGED: operate on effective content
    const a = this.effective_nodes();
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
    // CHANGED: operate on effective content
    const out: LiveTree[] = [];
    for (const v of this.effective_nodes()) {
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
   * - throws on 0 or >1 nodes
   */
  public mustOnly(opts?: { warn?: boolean }): LiveTree {
    const warn = opts?.warn ?? true;

    // CHANGED: operate on effective content
    let found: HsonNode | undefined;
    let count = 0;

    for (const v of this.effective_nodes()) {
      if (!is_Node(v)) continue;
      count += 1;
      if (count === 1) found = v;
    }

    if (count !== 1) {
      const msg =
        `ContentManager.mustOnly(): expected 1 node-content, got ${count}.\n` +
        `(on: ${this.owner.node._tag})`;

      if (warn) console.warn(msg);
      throw new Error(msg);
    }

    const t = create_livetree(found!);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }
}
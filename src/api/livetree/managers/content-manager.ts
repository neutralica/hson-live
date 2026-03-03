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

  // CHANGED: content APIs treat `_elem` as invisible and operate on its contents.
  private effective_nodes(): readonly ContentItem[] {
    const raw = this.pure_nodes();

    // Find node children (ignore primitives for wrapper detection)
    const nodeKids: HsonNode[] = [];
    for (const v of raw) if (is_Node(v)) nodeKids.push(v);

    // If there is exactly one node child and it's `_elem`, content = its content.
    if (nodeKids.length === 1 && nodeKids[0]!._tag === "_elem") {
      return ((nodeKids[0]!._content ?? []) as readonly ContentItem[]);
    }

    // If you truly guarantee `_elem` always exists, this is “unexpected but survivable”.
    return raw;
  }

  /** Count of content items (within `_elem` when present). */
  public count(): number {
    // CHANGED: semantic count
    return this.effective_nodes().length;
  }

  private at_node(ix: number): ContentItem | undefined {
    // CHANGED: semantic indexing
    const a = this.effective_nodes();
    if (ix < 0 || ix >= a.length) return undefined;
    return a[ix];
  }

  public first(): LiveTree | undefined {
    // CHANGED: semantic first()
    for (const v of this.effective_nodes()) {
      if (!is_Node(v)) continue;
      const t = create_livetree(v);
      t.adoptRoots(this.owner.hostRootNode());
      return t;
    }
    return undefined;
  }

  public all(): readonly LiveTree[] {
    // CHANGED: semantic all()
    const out: LiveTree[] = [];
    for (const v of this.effective_nodes()) {
      if (!is_Node(v)) continue;
      const t = create_livetree(v);
      t.adoptRoots(this.owner.hostRootNode());
      out.push(t);
    }
    return out;
  }

  public mustOnly(opts?: { warn?: boolean }): LiveTree {
    // CHANGED: semantic mustOnly()
    const warn = opts?.warn ?? true;

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
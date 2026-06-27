import { ELEM_OBJ, EVERY_VSN, LEAF_NODES } from "../../../consts/constants.js";
import { Primitive } from "../../../types/core.types.js";
import { HsonNode } from "../../../types/node.types.js";
import { is_Node } from "../../../utils/node-utils/node-guards.js";
import { serialize_xml } from "../../serializers/serialize-html.js";
import { create_livetree } from "../creation/create-livetree.js";
import { LiveTree } from "../livetree.js";

type ContentItem = HsonNode | Primitive;

/**
 * Graph-backed markup snapshot for a `ContentManager` owner node.
 *
 * These strings are serialized from the HSON node graph, not read from a
 * mounted DOM element. They are therefore available for detached branches.
 */
type ContentMarkupApi = Readonly<{
  /** Serialized child markup for the owner node. */
  readonly innerHTML: string;
  /** Serialized owner-node markup, including the owner tag itself. */
  readonly outerHTML: string;
}>;

const VSN_SET: ReadonlySet<string> = new Set(EVERY_VSN);
const LEAF_SET: ReadonlySet<string> = new Set(LEAF_NODES);

// helper
const is_vsn_tag = (tag: string): boolean => VSN_SET.has(tag);
const is_leaf_vsn = (tag: string): boolean => LEAF_SET.has(tag);
/** Serialize one content item through the canonical XML/HSON serializer. */
const serialize_content_item = (item: ContentItem): string => {
  return serialize_xml(item);
};

/** Serialize only a node's child content, excluding the node wrapper itself. */
const serialize_node_inner_markup = (node: HsonNode): string => {
  return ((node._content ?? []) as readonly ContentItem[])
    .map(serialize_content_item)
    .join("");
};

/**
 * Structured content access for a `LiveTree` node.
 *
 * The child-selection methods expose an effective element-child view where VSN
 * container wrappers are transparent, VSN leaves are skipped, and primitive
 * leaves are ignored. The `markup` accessor is graph-backed and serializes the
 * owner node without requiring a mounted DOM element.
 */
export class ContentManager {
  private readonly owner: LiveTree;

  public constructor(owner: LiveTree) {
    this.owner = owner;
  }

  /** Return the raw `_content` array with no VSN unwrapping or filtering. */
  private pure_nodes(): readonly ContentItem[] {
    const n = this.owner.node as HsonNode;
    return (n._content ?? []) as readonly ContentItem[];
  }

  /**
   * Return effective element children with structural VSN wrappers hidden.
   *
   * Rules:
   * - flatten VSN containers: _-root, _-elem, _-obj, _-arr, _-ii
   * - skip VSN leaves: _-str, _-val
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

  /** Return the effective node-child at `ix`, or `undefined` when out of range. */
  private at_node(ix: number): HsonNode | undefined {
    const a = this.effective_node_children();
    if (ix < 0 || ix >= a.length) return undefined;
    return a[ix];
  }

  /**
   * Graph-backed markup strings for this tree's owner node.
   *
   * Unlike `tree.dom.innerHTML` / `tree.dom.outerHTML`, this accessor does not
   * require a mounted DOM element. It serializes the HSON graph through the
   * canonical XML serializer and therefore preserves standard wire attrs such
   * as QUID metadata.
   */
  public get markup(): ContentMarkupApi {
    const node = this.owner.node as HsonNode;

    return Object.freeze({
      get innerHTML(): string {
        return serialize_node_inner_markup(node);
      },
      get outerHTML(): string {
        return serialize_xml(node);
      },
    });
  }

  /** Return the number of effective node-children. */
  public count(): number {
    return this.effective_node_children().length;
  }

  /** Return a `LiveTree` handle for the effective node-child at `ix`. */
  public at(ix: number): LiveTree | undefined {
    const n = this.at_node(ix);
    if (!n) return undefined;
    const t = create_livetree(n);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }

  /** Return a `LiveTree` handle for the first effective node-child. */
  public first(): LiveTree | undefined {
    const n = this.at_node(0);
    if (!n) return undefined;
    const t = create_livetree(n);
    t.adoptRoots(this.owner.hostRootNode());
    return t;
  }

  /** Return `LiveTree` handles for all effective node-children. */
  public all(): readonly LiveTree[] {
    const out: LiveTree[] = [];
    for (const n of this.effective_node_children()) {
      const t = create_livetree(n);
      t.adoptRoots(this.owner.hostRootNode());
      out.push(t);
    }
    return out;
  }

  /**
   * Return the only effective node-child, or throw when the count is not one.
   *
   * @param opts.warn - Whether to `console.warn` before throwing. Defaults to `true`.
   */
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
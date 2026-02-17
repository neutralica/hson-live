// livetree2.ts

import { ensure_quid, get_node_by_quid } from "../../quid/data-quid.quid";
import { HsonNode } from "../../types/node.types";
import { ListenerBuilder } from "../../types/listen.types";
import { element_for_node } from "../../utils/tree-utils/node-map-helpers";
import { CssHandle, StyleHandle } from "../../types/css.types";
import { remove_livetree } from "./methods/remove-self";
import { get_form_value, get_node_text_content, set_node_text_content, set_form_value, set_node_text_leaves, overwrite_node_text_content, insert_node_text_leaf, LiveTextApi, add_node_text_leaf } from "./managers/text-form-values";
import { DataManager } from "./managers/data-manager";
import { empty_contents } from "./methods/empty";
import { build_listener } from "./managers/listener-builder";
import { FindMany, make_find_all_for, make_find_for } from "./methods/find"; // CHANGED
import { clearFlagsImpl, getAttrImpl, removeAttrImpl, setAttrsImpl, setFlagsImpl } from "./managers/attrs-manager";
import { remove_child } from "./methods/remove-child";
import { StyleManager } from "./managers/style-manager";
import { LiveTreeCreateHelper } from "../../types/livetree.types"; // CHANGED
import { append_branch } from "./methods/append-other";
import { make_tree_create } from "./methods/create-node";
import { FindWithById, NodeRef } from "../../types/livetree.types";
import { Primitive } from "../../types/core.types";
import { make_class_api, make_id_api, StyleSetter } from "./managers/style-setter";
import { ClassApi, IdApi, LiveTreeDom } from "../../types/dom.types";
import { make_dom_api } from "./managers/dom-manager";
import { is_Node } from "../../utils/node-utils/node-guards";
import { TreeEvents } from "../../types/events.types";
import { make_tree_events } from "./managers/events-handler";
import { clone_branch_method } from "./methods/clone";
import { create_livetree } from "./create-livetree";
import { ContentManager } from "./managers/content-manager";
import { css_for_quids } from "./methods/css-for-quids";
// NEW: motion.ts (or livetree-methods/motion.ts)
/**
 * Named CSS variables used by `set_motion_transform`.
 *
 * Each field corresponds to a `--*` custom property:
 * - `x` / `y`   → base position
 * - `tx` / `ty` → animated offsets
 * - `dx` / `dy` → interactive offsets (e.g. drag)
 */
export type MotionVars = Readonly<{
  x?: string;   // "--x"
  y?: string;   // "--y"
  tx?: string;  // "--tx" (animated)
  ty?: string;  // "--ty" (animated)
  dx?: string;  // "--dx" (interactive)
  dy?: string;  // "--dy" (interactive)
}>;

/**
 * Apply the canonical motion transform to a `LiveTree`.
 *
 * This composes `--x/--y` + `--dx/--dy` + `--tx/--ty` into a single
 * `translate3d(...)` and sets `will-change: transform` for smoother
 * animation.
 *
 * @param t - LiveTree whose inline style should receive the transform.
 */
export function set_motion_transform(t: LiveTree): void {
  // CHANGED: one canonical transform composition.
  t.style.setMany({
    transform:
      "translate3d(" +
      "calc(var(--x, 0px) + var(--dx, 0px) + var(--tx, 0px))," +
      "calc(var(--y, 0px) + var(--dy, 0px) + var(--ty, 0px))," +
      "0)",
    "will-change": "transform",
  });
}

/**
 * Create a stable `NodeRef` for a given `HsonNode`.
 *
 * Behavior:
 * - Ensures the node has a QUID via `ensure_quid(node)` and stores it
 *   as `q` on the reference.
 * - Provides `resolveNode()` which currently returns the original
 *   `HsonNode` directly.
 * - Provides `resolveElement()` which returns the associated DOM
 *   `Element`, if any, via `element_for_node(node)`.
 *
 * This is the primary bridge between HSON nodes, their QUID identity,
 * and any DOM elements registered in `NODE_ELEMENT_MAP`.
 *
 * @param node - The HSON node to wrap in a reference.
 * @returns A `NodeRef` that exposes QUID, node, and DOM element lookup.
 * @see ensure_quid
 * @see element_for_node
 */
function makeRef(node: HsonNode): NodeRef {
  /*  Ensure the node has a stable QUID and keeps NODE_ELEMENT_MAP happy. */
  const q = ensure_quid(node);

  const ref: NodeRef = {
    q,
    resolveNode(): HsonNode { /* exposes the node itself */
      // if we later introduce a global QUID→node map,
      // this is where to switch to a lookup.
      return node;
    },

    resolveElement(): Element | undefined { /* exposes the DOM Element . */
      return element_for_node(node) ?? undefined;
    },
  };

  return ref;
}

/**
 * Instrumented wrapper around a single `HsonNode`, providing a high-level API.
 *
 * Core surfaces:
 * - Traversal and selection (`find`, `findAll`).
 * - Structural editing (`append`, `empty`, `removeChildren`, `removeSelf`).
 * - Attribute/flag, content/form, style/data/css, and event helpers.
 * - Typed element creation via `.create`.
 *
 * Instances maintain:
 * - nodeRef: A `NodeRef` that pins the current node and QUID.
 * - hostRoot: HSON node representing the historic root of the subtree.
 * - Lazily constructed managers for style (`StyleManager`) and dataset (`DataManager`).
 */
export class LiveTree {
  /* the HsonNode being referenced */
  private nodeRef!: NodeRef;
  /* the root node or historic root node */
  private hostRoot!: HsonNode;
  /* inline style editor */

  private styleApiInternal: StyleHandle | undefined = undefined;

  // private styleManagerInternal: StyleManager | undefined = undefined;
  /* .dataset editor */
  private datasetManagerInternal: DataManager | undefined = undefined;
  private contentManager: ContentManager | undefined = undefined;
  private cssApiInternal: CssHandle | undefined = undefined;
  private eventsInternal?: TreeEvents;
  private idApi?: IdApi;
  private classApi?: ClassApi;

  /**
   * Internal helper to assign `nodeRef` from either a raw `HsonNode`
   * or another `LiveTree`.
   *
   * Behavior:
   * - When given a `LiveTree`, re-wraps its `.node` in a fresh `NodeRef`
   *   to ensure a stable QUID and consistent `resolve*` behavior.
   * - When given a `HsonNode`, wraps it directly via `makeRef`.
   *
   * This method centralizes creation of the `NodeRef` used by the
   * `node` getter and QUID-based DOM resolution.
   *
   * @param input - Either a `HsonNode` or another `LiveTree`.
   * @see makeRef
   */
  private setRef(input: HsonNode | LiveTree): void {
    this.invalidate_dom_api();
    if (input instanceof LiveTree) {
      this.nodeRef = makeRef(input.node);
      return;
    }
    this.nodeRef = makeRef(input);
  }
  /**
   * Internal helper to assign the `hostRoot` for this `LiveTree`.
   *
   * Behavior:
   * - When given a `LiveTree`, inherits its `hostRoot` so that branches
   *   grafted from an existing tree carry forward the same historic root.
   * - When given a `HsonNode`, treats that node as the root for this
   *   instance.
   *
   * Throws if the resulting `hostRoot` is falsy, as a missing root would
   * break features that depend on a stable root context.
   *
   * @param input - Either a `HsonNode` or another `LiveTree`.
   */
  private setRoot(input: HsonNode | LiveTree): void {
    this.invalidate_dom_api();
    if (input instanceof LiveTree) {
      this.hostRoot = input.hostRoot;
      if (!this.hostRoot) { throw new Error('could not set host root'); }
      return;
    }
    this.hostRoot = input; /* HsonNode fallback */
    if (!this.hostRoot) { throw new Error('could not set host root'); }
  }
  /**
   * Construct a new `LiveTree` from either a raw `HsonNode` or another
   * `LiveTree`.
   *
   * Initialization steps:
   * - Derive and store the `hostRoot` via `setRoot(input)`.
   * - Create a `NodeRef` and QUID association via `setRef(input)`.
   *
   * When constructed from another `LiveTree`, both the root and the
   * referenced node are inherited so the new instance views the same
   * subtree within the same root context.
   *
   * @param input - A `HsonNode` to wrap, or another `LiveTree` to clone
   *                references from.
   */
  constructor(input: HsonNode | LiveTree) {
    this.setRoot(input);
    this.setRef(input);
  }

  private domApiInternal: LiveTreeDom | undefined = undefined;

  // ADDED: public accessor
  /**
   * DOM adapter bound to this tree.
   *
   * Provides element-oriented helpers (`el`, `closest`, `parent`, etc.)
   * while remaining safe to call when the node is not mounted.
   */
  public get dom(): LiveTreeDom {
    if (!this.domApiInternal) {
      this.domApiInternal = make_dom_api(this);
    }
    return this.domApiInternal;
  }

  // OPTIONAL: if the underlying bound element can change during lifetime
  // ADDED
  private invalidate_dom_api(): void {
    // existing
    this.domApiInternal = undefined;
    // ADDED: css handle depends on the current nodeRef/quid context
    this.cssApiInternal = undefined;
  }

  /**
   * Append a branch as children of this tree.
   *
   * @param branch - The branch to append under this tree.
   * @param index - Optional insertion index relative to existing children.
   * @returns This `LiveTree` instance, for chaining.
   * @see append_branch
   */
  public append = append_branch;

  /**
   * Remove all child content under this tree's node.
   *
   * @returns This `LiveTree` instance, for chaining.
   * @see empty_contents
   */
  public empty = empty_contents;

  /**
   * Remove all direct node children and return how many were removed.
   *
   * @returns The number of removed child nodes.
   */
  public removeChildren(): number {
    const parent = this.nodeRef.resolveNode();
    const kids = parent!._content;

    if (!Array.isArray(kids) || kids.length === 0) return 0;

    // CHANGED: only node children (not text leaves)
    const nodeKids = kids.filter(is_Node);
    if (nodeKids.length === 0) return 0;

    let removed = 0;

    // ADDED: snapshot direct children; remove each via the canonical funnel
    for (const child of nodeKids) {
      // CHANGED: wrap the child as a LiveTree bound to the same hostRoot context
      const childTree = create_livetree(child);
      childTree.setRoot(this); // or whatever your “inherit hostRoot” API is
      removed += remove_livetree.call(childTree);
    }

    return removed;
  }


  /**
   * Remove this node from its parent (HSON + DOM).
   *
   * @returns `1` when removed, or `0` if already detached.
   * @see remove_livetree
   */
  public removeSelf(): number {
    // CHANGED: funnel through the one implementation
    return remove_livetree.call(this);
  }


  /**
   * Find the first matching descendant in this subtree.
   *
   * @param q - Selector string or `HsonQuery`.
   * @returns Matching `LiveTree`, or `undefined` if none.
   * @see make_find_for
   */
  public find: FindWithById = make_find_for(this);

  /**
   * Find all matching descendants in this subtree.
   *
   * @param q - Selector string or `HsonQuery` (or list of queries).
   * @returns A `TreeSelector` over all matching subtrees.
   * @see make_find_all_for
   */
  public findAll: FindMany = make_find_all_for(this);

  /**
   * Typed element creation helper bound to this tree.
   *
   * @returns A `LiveTreeCreateHelper` scoped to this tree.
   * @see make_tree_create
   */
  public get create(): LiveTreeCreateHelper {
    return make_tree_create(this);
  }

  /**
   * Return this tree's QUID, a stable identity string associated with the
   * underlying `HsonNode`.
   *
   * QUIDs are used to:
   * - Track node identity across transforms.
   * - Key CSS and other managers (`css`, `css_for_quids`, etc.).
   *
   * @returns The QUID string for this tree's node.
   * @see makeRef
   */
  public get quid(): string {
    return this.nodeRef.q;
  }

  /**
   * Return the historic root node associated with this `LiveTree`.
   *
   * The host root represents the top-level HSON node for the tree this
   * instance belongs to, even if the current node is a nested descendant.
   *
   * @returns The root `HsonNode` for this tree's context.
   */
  public hostRootNode(): HsonNode {
    return this.hostRoot;
  }
  /**
   * Content manager for structured child access and mutation.
   *
   * This is a lazy accessor; the manager is constructed on first use.
   */
  public get content(): ContentManager {
    return (this.contentManager ??= new ContentManager(this));
  }
  /* internal: allow a branch to inherit host roots when grafted/appended */
  adoptRoots(root: HsonNode): this {
    this.hostRoot = root;
    return this;
  }
  /**
   * Resolve and return the underlying `HsonNode` for this tree.
   *
   * Delegates to `nodeRef.resolveNode()` and throws if the reference
   * fails to resolve, as this indicates a broken or stale link between
   * the tree and its node.
   *
   * @returns The `HsonNode` currently referenced by this `LiveTree`.
   * @throws If `resolveNode()` returns a falsy value.
   * @see NodeRef.resolveNode
   */
  public get node(): HsonNode {
    const n = this.nodeRef.resolveNode();
    if (!n) {
      throw new Error("LiveTree2.node: ref did not resolve");
    }
    return n;
  }

  /*---------- managers & adapters ---------- */
  /**
  * Inline style setter for this node (lazy).
  *
  * @returns A `StyleSetter` bound to this tree’s node.
  * @see StyleManager
  */

  public get style(): StyleHandle {
    if (!this.styleApiInternal) {
      const mgr = new StyleManager(this);
      // CHANGED: expose both write + read
      this.styleApiInternal = {
        ...mgr.setter,
        get: mgr.getter,
      };
    }
    return this.styleApiInternal;
  }

  public get events(): TreeEvents {
    if (!this.eventsInternal) {
      this.eventsInternal = make_tree_events();
    }
    return this.eventsInternal;
  }
  /**
   * Dataset (`data-*`) manager for this node (lazy).
   *
   * @returns A `DataManager` instance bound to this tree.
   */
  public get data(): DataManager {
    if (!this.datasetManagerInternal) {
      this.datasetManagerInternal = new DataManager(this);
    }
    return this.datasetManagerInternal;
  }

  /**
   * Stylesheet rule handle scoped to this node’s QUID selector.
   *
   * @returns A `CssHandle` targeting this node’s QUID selector.
   * @see css_for_quids
   */
  public get css(): CssHandle {
    if (!this.cssApiInternal) {
      this.cssApiInternal = css_for_quids(this, [this.quid]);
    }
    return this.cssApiInternal;
  }

  /**
   * Event listener builder bound to this tree’s DOM element.
   *
   * @returns A `ListenerBuilder` for attaching events.
   * @see build_listener
   */
  public get listen(): ListenerBuilder {
    return build_listener(this);
  }

  /* ---------- attribute / flags API ---------- */
  /**
   * Read a single attribute from this tree's node.
   *
   * Delegates to `getAttrImpl(this, name)`, which treats the HSON node
   * as the source of truth and applies any special handling (e.g. for
   * `style` attributes).
   *
   * @param name - The attribute name to read.
   * @returns The attribute value as a primitive, or `undefined` if absent.
   * @see getAttrImpl
   */
  public getAttr(name: string): Primitive | undefined {
    return getAttrImpl(this, name);
  }
  /**
   * Remove a single attribute from this tree's node.
   *
   * Delegates to `removeAttrImpl(this, name)`, which updates the HSON
   * node and DOM element consistently.
   *
   * @param name - The attribute name to remove.
   * @returns This `LiveTree` instance, for chaining.
   * @see removeAttrImpl
   */
  public removeAttr(name: string): LiveTree {
    return removeAttrImpl(this, name);
  }
  /**
   * Set one or more boolean-present attributes ("flags") on this node.
   *
   * Delegates to `setFlagsImpl(this, ...names)`, which ensures each
   * named attribute is present and treated as a flag, typically by
   * storing `key="key"` or an equivalent representation.
   *
   * @param names - One or more attribute names to set as flags.
   * @returns This `LiveTree` instance, for chaining.
   * @see setFlagsImpl
   */
  public setFlags(...names: string[]): LiveTree {
    return setFlagsImpl(this, ...names);
  }
  /**
   * Clear one or more boolean-present attributes ("flags") on this node.
   *
   * Delegates to `clearFlagsImpl(this, ...names)`, removing each named
   * flag from both HSON and DOM.
   *
   * @param names - One or more attribute names to remove.
   * @returns This `LiveTree` instance, for chaining.
   * @see clearFlagsImpl
   */
  public removeFlags(...names: string[]): LiveTree {
    return clearFlagsImpl(this, ...names);
  }

  /**
   * Set one or more attributes on this node.
   *
   * Overloads:
   * - `setAttrs(name, value)`:
   *   - Set a single attribute by name, where `value` may be a string,
   *     boolean, or `null`.
   * - `setAttrs(map)`:
   *   - Set multiple attributes from a record of names to values.
   *
   * Both forms delegate to `setAttrsImpl(this, nameOrMap, value)`, which
   * normalizes semantics such as:
   * - Removing attributes when given `null`/`false`.
   * - Handling boolean-present attributes.
   * - Special-casing `style` to use structured style objects.
   *
   * @param nameOrMap - Attribute name or map of attribute names to values.
   * @param value - Optional value when setting a single attribute.
   * @returns This `LiveTree` instance, for chaining.
   * @see setAttrsImpl
   */
  public setAttrs(name: string, value: string | boolean | null): LiveTree;
  public setAttrs(map: Record<string, string | boolean | null>): LiveTree;
  public setAttrs(
    nameOrMap: string | Record<string, string | boolean | null>,
    value?: string | boolean | null,
  ): LiveTree {
    return setAttrsImpl(this, nameOrMap, value);
  }



public readonly text: LiveTextApi = {
  set: (value) => { set_node_text_leaves(this.node, value); return this; },
  add: (value) => { add_node_text_leaf(this.node, value); return this; },
  overwrite: (value) => { overwrite_node_text_content(this.node, value); return this; },
  insert: (ix, value) => { insert_node_text_leaf(this.node, ix, value); return this; },
};
  
  
  //// TODO - TEXT HANDLING MOVED TO .text NAMESPACE; delete these when safe
  /*  ---------- content API ---------- */
  /**
   * Replace this node’s content with a single text/leaf value.
   *
   * `null` is stored as a `_val` payload and rendered as an empty string
   * when mirrored to the DOM.
   *
   * @param value - The primitive value to render as text for this node.
   * @returns This `LiveTree` instance, for chaining.
   * @see set_node_text_content
   */
  // public setText(value: Primitive): LiveTree {
  //   set_node_text_content(this.node, value);
  //   return this;
  // }
  /**
   * Return all text content rendered under this node.
   *
   * @returns A string containing the concatenated text content.
   * @see get_node_text_content
   */
  // public getText(): string {
  //   return get_node_text_content(this.node);
  // }
  /**
   * Set the form value for this node and mirror to DOM when mounted.
   *
   * @param value - The string form value to apply.
   * @param opts - Optional flags (`silent`, `strict`).
   * @returns This `LiveTree` instance, for chaining.
   * @see set_form_value
   */
  public setFormValue(value: string, opts?: { silent?: boolean; strict?: boolean }): LiveTree {
    set_form_value(this.node, value, opts);
    return this;
  }
  /**
   * Read the form value for this node.
   *
   * @returns The current form value as a string (possibly empty).
   * @see get_form_value
   */
  public getFormValue(): string {
    return get_form_value(this.node);
  }

  /**
   * ID helper bound to this node’s `id` attribute.
   *
   * Provides `get/set/clear` in a chainable API.
   */
  public get id(): IdApi {
    // ADDED: cached id namespace
    if (!this.idApi) this.idApi = make_id_api(this);
    return this.idApi;
  }

  /**
   * Classlist helper bound to this node’s `class` attribute.
   *
   * Provides `get/has/set/add/remove/toggle/clear` in a stable, chainable
   * API. All mutations are reflected in the underlying HSON attrs (and
   * DOM when mounted).
   */
  public get classlist(): ClassApi {
    // ADDED: cached class namespace
    if (!this.classApi) this.classApi = make_class_api(this);
    return this.classApi;
  }

  public cloneBranch(): LiveTree {
    return clone_branch_method.call(this);
  }
  /*  ---------- DOM adapter ---------- */
  /**
   * Resolve this tree's node to its associated DOM `Element`, if any.
   *
   * Uses the stored `NodeRef` to call `resolveElement()` and returns
   * the result. If the node has no mapped element, `undefined` is
   * returned instead of throwing.
   *
   * @returns The DOM `Element` corresponding to this tree's node, or
   *          `undefined` if not mounted.
   * @see NodeRef.resolveElement
   */
  // TODO should this return an HtmlElement to prevent constant typeof checks?
  public asDomElement(): Element | undefined {
    const firstRef = this.nodeRef;
    if (!firstRef) return undefined;
    return firstRef.resolveElement();
  }
}

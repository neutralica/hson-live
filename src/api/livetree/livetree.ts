// livetree2.ts

import { ensure_quid, get_node_by_quid } from "../../quid/data-quid.quid.js";
import { HsonNode } from "../../types/node.types.js";
import { ListenerBuilder } from "../../types/listen.types.js";
import { element_for_node } from "../../utils/livetree-utils/node-map-helpers.js";
import { CssTreeHandle, StyleHandle } from "../../types/css.types.js";
import { remove_livetree } from "./methods/remove-self.js";
import { get_form_value, set_node_text_content, set_form_value, overwrite_node_text_content, insert_node_text_leaf, LiveTextApi, add_node_text_content, get_node_text_content } from "./managers/text-form-values.js";
import { DataApi,  make_data_api } from "./managers/data-manager.js";
import { empty_contents } from "./methods/empty.js";
import { build_listener } from "./managers/listener-builder.js";
import { FindMany, make_find_all_for, make_find_for } from "./methods/find.js"; // CHANGED
import { StyleManager } from "./managers/style-manager.js";
import { HtmlCreateHelper } from "../../types/livetree.types.js"; // CHANGED
import { append_branch } from "./methods/appends.js";
import { FindWithById, NodeRef } from "../../types/livetree.types.js";
import { StyleSetter } from "./managers/style-setter.js";
import { make_class_api, make_id_api } from "./managers/id-classlist.js";
import { ClassApi, IdApi, LiveTreeDom } from "../../types/dom.types.js";
import { make_dom_api } from "./managers/dom-api.js";
import { TreeEvents } from "../../types/events.types.js";
import { make_tree_events } from "./managers/events-handler.js";
import { clone_branch_method } from "./methods/clone.js";
import { ContentManager } from "./managers/content-manager.js";
import { css_for_quids } from "./methods/css-for-quids.js";
import { AttrHandle, FlagHandle } from "../../types/attrs.types.js";
import { attr_handle, flag_handle } from "./managers/attr-handle.js";
import { remove_node_children } from "./methods/remove-child.js";
import { is_svg_context_tag, SVG_TAGS } from "../../consts/html-tags.js";
import { make_tree_create2 } from "./methods/create/create-core.js";
import { make_svg_tree_create } from "./methods/create/create-svg.js";
import { make_html_tree_create } from "./methods/create/create-html.js";
import { SvgBox } from "../../types/svg.types.js";
import { make_svg_api, SvgApi } from "./managers/svg-builder.js";

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
  private styleApiInternal: StyleHandle<this> | undefined = undefined;
  /* dataset property manager */
  private dataApiInternal?: DataApi<this>;
  /* accessor api for a node's effective children (skips _VSNs) */
  private contentManager: ContentManager | undefined = undefined;
  /* provides api for quid-scoped stylesheet editing */
  private cssApiInternal: CssTreeHandle | undefined = undefined;
  /* tree-scoped event emitter (separate from DOM listeners) */
  private eventsInternal?: TreeEvents;
  /* convenience handle for the `id` _attr */
  private idApi?: IdApi<this>;
  /* convenience handle for the `class` _attr */
  private classApi?: ClassApi<this>;
  /* attribute (_attr) API handle */
  private _attr?: AttrHandle<this>;
  /* "flag" (HTML boolean attributes) API handle */
  private _flag?: FlagHandle<this>;
  /* namespace for SvgLiveTree-specific operations */
  private svgApi?: SvgApi<this>;
  /* LiveTree DOM api */
  private domApiInternal: LiveTreeDom | undefined = undefined;



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



  public get dom(): LiveTreeDom {
    if (!this.domApiInternal) {
      this.domApiInternal = make_dom_api(this, () => this.resolveDomElement());
    }
    return this.domApiInternal;
  }

  //  the underlying bound element can change during lifetime:
  private invalidate_dom_api(): void {
    // existing
    this.domApiInternal = undefined;
    // css handle depends on the current nodeRef/quid context
    this.cssApiInternal = undefined;
  }

  public append = append_branch;

  public empty = empty_contents;

  public removeChildren(): number {
    // minimal wrapper; semantics live in helper
    const parent = this.nodeRef.resolveNode();
    if (!parent) return 0;
    return remove_node_children(parent);
  }
  public removeSelf(): number {
    // funnel through the one implementation
    return remove_livetree.call(this);
  }

  public find: FindWithById = make_find_for(this);

  /**
   * Find all matching descendants in this subtree.
   *
   * @param q - Selector string or `HsonQuery` (or list of queries).
   * @returns A `TreeSelector` over all matching subtrees.
   * @see make_find_all_for
   */
  public findAll: FindMany = make_find_all_for(this);

  public get create(): HtmlCreateHelper {
    return (
      this.svg.inScope()
        ? make_svg_tree_create(this)
        : make_html_tree_create(this)
    ) as unknown as HtmlCreateHelper;
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

  public get style(): StyleHandle<this> {
    if (!this.styleApiInternal) {
      const mgr = new StyleManager<this>(this);
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

  public get data(): DataApi<this> {
    this.dataApiInternal ??= make_data_api(this);
    return this.dataApiInternal;

  }

  public get css(): CssTreeHandle {
    if (!this.cssApiInternal) {
      this.cssApiInternal = css_for_quids(this, [this.quid]);
    }
    return this.cssApiInternal;
  }

  public get listen(): ListenerBuilder {
    return build_listener(this);
  }

  /* ---------- attribute / flags API ---------- */

  public get attr(): AttrHandle<this> {
    return (this._attr ??= attr_handle(this));
  }

  
  public get flag(): FlagHandle<this> {
    return (this._flag ??= flag_handle(this));
  }

  public readonly text: LiveTextApi<this> = {
    set: (value) => { set_node_text_content(this.node, value); return this; },
    add: (value) => { add_node_text_content(this.node, value); return this; },
    overwrite: (value) => { overwrite_node_text_content(this.node, value); return this; },
    insert: (ix, value) => { insert_node_text_leaf(this.node, ix, value); return this; },
    get: (): string => {
      return get_node_text_content(this.node);
    },
  };


  /**
   * Set the form value for this node and mirror to DOM when mounted.
   *
   * @param value - The string form value to apply.
   * @param opts - Optional flags (`silent`, `strict`).
   * @returns This `LiveTree` instance, for chaining.
   * @see set_form_value
   */
  public setFormValue(value: string, opts?: { silent?: boolean; strict?: boolean }): this {
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

  public get id(): IdApi<this> {
    // cached id namespace
    if (!this.idApi) this.idApi = make_id_api(this);
    return this.idApi;
  }

  public get classlist(): ClassApi<this> {
    // cached class namespace
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
  private resolveDomElement(): Element | undefined {
    const firstRef = this.nodeRef;
    if (!firstRef) return undefined;
    return firstRef.resolveElement();
  }

  public get svg(): SvgApi<this> {
    if (!this.svgApi) {
      this.svgApi = Object.freeze(
        make_svg_api(this)
      );
    }

    return this.svgApi;
  }
}

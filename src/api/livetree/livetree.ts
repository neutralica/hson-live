// livetree.ts

import { ensure_quid, get_node_by_quid } from "./quid/data-quid.js";
import { HsonNode } from "../../core/types.js";
import { ListenerBuilder } from "../../types/listen.types.js";
import { get_el_for_node } from "./utils/node-map-helpers.js";
import { CssTreeHandle, StyleHandle } from "../../types/css.types.js";
import { get_form_value, set_node_text_content, set_form_value, overwrite_node_text_content, insert_node_text_leaf, LiveTextApi, add_node_text_content, get_node_text_content, make_text_api, make_form_api } from "./managers/text-form-values.js";
import { DataApi, make_data_api } from "./managers/data-manager.js";
import { empty_contents } from "./methods/empty.js";
import { build_listener } from "./managers/listener-builder.js";
import { FindMany, make_find_all_for, make_find_for } from "./methods/find.js"; // CHANGED
import { StyleManager } from "./managers/style-manager.js";
import { HtmlCreateHelper } from "../../types/livetree.types.js"; // CHANGED
import { append_branch } from "./methods/appends.js";
import { FindWithById, NodeRef } from "../../types/livetree.types.js";
import { make_class_api, make_id_api } from "./managers/id-classlist.js";
import { ClassApi, IdApi, LiveTreeDom } from "../../types/dom.types.js";
import { make_dom_api } from "./managers/dom-api.js";
import { TreeEvents } from "../../types/events.types.js";
import { make_tree_events } from "./managers/make-events.js";
import { clone_branch_method } from "./methods/clone.js";
import { ContentManager } from "./managers/content-manager.js";
import { css_for_quids } from "./methods/livetree.css-quids.js";
import { AttrHandle, FlagHandle } from "../../types/attrs.types.js";
import { attr_handle, flag_handle } from "./managers/attr-handle.js";
import { remove_node_children } from "./methods/remove-child.js";
import { make_svg_tree_create } from "./methods/create/create-svg.js";
import { make_html_tree_create } from "./methods/create/create-html.js";
import { make_svg_api, SvgApi } from "./managers/svg-api.js";
import { AppendableLiveBranch, LiveFormApi, LiveTreeApi } from "../../types/livetree-internals.types.js";
import { make_canvas_api } from "./managers/canvas/make-canvas-api.js";
import { CanvasApi } from "./managers/canvas/canvas.types.js";
import { LiveTreeBindApi, make_livetree_bind_api } from "./methods/livetree.bind.js";
import { assert_livetree_node_active, is_livetree_node_disposed } from "./livetree-state.js";
import { index_subtree_ownership } from "./lifecycle/graph-ownership.js";
import {
  detach_livetree,
  detach_livetree_contents,
  remove_livetree_terminal,
} from "./lifecycle/public-lifecycle.js";
import type { DetachedLiveContent, LiveTreeLifecycleResult } from "../../types/lifecycle.types.js";
import { guard_api_surface } from "./utils/guard-api-surface.js";

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
 * @see get_el_for_node
 */
class LiveTreeNodeRef implements NodeRef {
  public constructor(
    public readonly q: string,
    private readonly referencedNode: HsonNode,
  ) {}

  public resolveNode(): HsonNode {
    return this.referencedNode;
  }

  public resolveElement(): Element | undefined {
    return get_el_for_node(this.referencedNode) ?? undefined;
  }
}

function makeRef(node: HsonNode): NodeRef {
  assert_livetree_node_active(node, "create a LiveTree handle");
  /*  Ensure the node has a stable QUID and keeps NODE_ELEMENT_MAP happy. */
  const q = ensure_quid(node);
  return new LiveTreeNodeRef(q, node);
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
export class LiveTree implements LiveTreeApi<LiveTree> {
  /* the HsonNode being referenced */
  declare private nodeRef: NodeRef;
  /* the root node or historic root node */
  declare private hostRoot: HsonNode;
  /* inline style editor */
  declare private styleApiInternal?: StyleHandle<this>;
  /* dataset property manager */
  declare private dataApiInternal?: DataApi<this>;
  /* accessor api for a node's effective children (skips _VSNs) */
  declare private contentManager?: ContentManager;
  /* provides api for quid-scoped stylesheet editing */
  declare private cssApiInternal?: CssTreeHandle;
  /* tree-scoped event emitter (separate from DOM listeners) */
  declare private eventsInternal?: TreeEvents;
  /* convenience handle for the `id` _attr */
  declare private idApi?: IdApi<this>;
  /* convenience handle for the `class` _attr */
  declare private classApi?: ClassApi<this>;
  /* attribute (_attr) API handle */
  declare private _attr?: AttrHandle<this>;
  /* "flag" (HTML boolean attributes) API handle */
  declare private _flag?: FlagHandle<this>;
  /* namespace for SvgLiveTree-specific operations */
  declare private svgApi?: SvgApi<this>;
  /* LiveTree DOM api */
  declare private domApiInternal?: LiveTreeDom;
  /* text content API */
  declare private textApiInternal?: LiveTextApi<this>;
  /* form-specific API for inputs, form-value, etc */
  declare private formApiInternal?: LiveFormApi<this>;
  /* canvas-specific namespace */
  declare private canvasApi?: CanvasApi<this>;
  /* liveMap binding handle */
  declare private bindApiInternal?: LiveTreeBindApi<this>;
  declare private findApiInternal?: FindWithById;
  declare private findAllApiInternal?: FindMany;
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
    const node = this.nodeRef.resolveNode();
    if (!node) throw new Error("LiveTree constructor: ref did not resolve");
    index_subtree_ownership(node);
  }

  //  the underlying bound element can change during lifetime:
  private invalidate_dom_api(): void {
    delete this.domApiInternal;
    delete this.cssApiInternal;
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
    this.assertActive("access DOM");
    const firstRef = this.nodeRef;
    if (!firstRef) return undefined;
    return firstRef.resolveElement();
  }

  /***************************************
   * LiveTree API
   ***************************************/
  /***************************************
   * Core tree operations
   *
   * Public branch mutation and query surface.
   *
   * @see LiveTreeContent
   * @see LiveTreeQuery
   ***************************************/

  /** Append another branch into this branch's content. */
  public append(branch: AppendableLiveBranch<this>, index?: number): this {
    append_branch.call(this, branch, index);
    return this;
  }

  /** Remove all content from this branch. */
  public empty(): this {
    empty_contents.call(this);
    return this;
  }

  /** Find the first matching descendant or helper query. */
  public get find(): FindWithById {
    return this.findApiInternal ??= make_find_for(this);
  }

  /** Find all matching descendants or helper query results. */
  public get findAll(): FindMany {
    return this.findAllApiInternal ??= make_find_all_for(this);
  }


  /***************************************
   * DOM projection
   *
   * Access mounted DOM projection helpers.
   *
   * @see LiveTreeDomAccess
   ***************************************/

  /** DOM helper bound to this tree's mounted element. */
  public get dom(): LiveTreeDom {
    this.assertActive("access DOM");
    return this.domApiInternal ??= guard_api_surface(
      make_dom_api(this, () => this.resolveDomElement()),
      () => this.assertActive("access DOM"),
      this,
    );
  }


  /***************************************
   * Branch removal
   *
   * Structural removal operations against the backing HSON node graph.
   *
   * @see LiveTreeContent
   ***************************************/

  /** @deprecated Specialized semantic-element removal. Use empty() or detachContents(). */
  public removeChildren(): number {
    this.assertActive("remove children");
    const parent = this.nodeRef.resolveNode();
    if (!parent) return 0;
    return remove_node_children(parent);
  }

  /** @deprecated Terminal alias for remove(). Use remove() or detach() explicitly. */
  public removeSelf(): number {
    return this.remove();
  }

  /** Identity-preserving removal of all ordered content. */
  public detachContents(): DetachedLiveContent {
    return detach_livetree_contents(this);
  }

  /** Identity-preserving removal of this branch from its current owner. */
  public detach(): LiveTreeLifecycleResult {
    return detach_livetree(this);
  }

  /** Terminally remove and dispose this complete branch. */
  public remove(): LiveTreeLifecycleResult {
    const node = this.nodeRef.resolveNode();
    if (!node) return 0;
    return remove_livetree_terminal(node);
  }


  /***************************************
   * Child creation
   *
   * Namespace-aware child factory.
   *
   * @see LiveTreeDomAccess
   ***************************************/

  /** Create HTML or SVG children according to the current namespace scope. */
  public get create(): HtmlCreateHelper {
    this.assertActive("create content");
    return (
      this.svg.inScope() ? make_svg_tree_create(this) : make_html_tree_create(this)
    ) as unknown as HtmlCreateHelper;
  }


  /***************************************
   * Identity and host-root context
   *
   * Stable branch identity and root ownership.
   *
   * @see LiveTreeIdentity
   ***************************************/

  /** Stable QUID for this branch. */
  public get quid(): string {
    this.assertActive("access QUID");
    return this.nodeRef.q;
  }

  /** Whether terminal lifecycle disposal has reached this node. */
  public get isDisposed(): boolean {
    const node = this.nodeRef.resolveNode();
    return node ? is_livetree_node_disposed(node) : false;
  }

  /** Return the host root node for this branch. */
  public hostRootNode(): HsonNode {
    this.assertActive("access host root");
    return this.hostRoot;
  }

  /** Content manager bound to this branch. */
  public get content(): ContentManager {
    this.assertActive("access content");
    return (this.contentManager ??= guard_api_surface(
      new ContentManager(this),
      () => this.assertActive("access content"),
      this,
    ));
  }

  /** Adopt a new host-root context for this branch. */
  public adoptRoots(root: HsonNode): this {
    this.assertActive("adopt roots");
    assert_livetree_node_active(root, "adopt disposed root");
    this.hostRoot = root;
    return this;
  }

  /** Resolve and return the backing HSON node.   */
  public get node(): HsonNode {
    const n = this.nodeRef.resolveNode();
    if (!n) {
      throw new Error("LiveTree2.node: ref did not resolve");
    }
    assert_livetree_node_active(n, "access node");
    return n;
  }

  private assertActive(operation: string): void {
    const node = this.nodeRef.resolveNode();
    if (node) assert_livetree_node_active(node, operation);
  }

  /***************************************
   * Style and CSS managers
   *
   * Inline style, scoped CSS, data, and event helper namespaces.
   *
   * @see LiveTreeStyling
   * @see LiveTreeData
   * @see LiveTreeEvents
   ***************************************/

  /** Inline style helper bound to this branch.
   * 
   * @see StyleManager
   * @see StyleSetter
   * @see StyleHandle
   */
  public get style(): StyleHandle<this> {
    this.assertActive("access style");
    if (!this.styleApiInternal) {
      const mgr = new StyleManager<this>(this);
      this.styleApiInternal = {
        ...mgr.setter,
        get: mgr.getter,
        getMany: mgr.getMany,
        var: mgr.var,
      };
      this.styleApiInternal = guard_api_surface(
        this.styleApiInternal,
        () => this.assertActive("access style"),
        this,
      );
    }
    return this.styleApiInternal;
  }

  /** QUID-scoped stylesheet helper for this branch. 
   * 
   * @see CssTreeHandle
   */
  public get css(): CssTreeHandle {
    this.assertActive("access CSS");
    if (!this.cssApiInternal) {
      this.cssApiInternal = guard_api_surface(
        css_for_quids(this, [this.quid]),
        () => this.assertActive("access CSS"),
        this,
      );
    }
    return this.cssApiInternal;
  }

  /** Tree-local event registry/helper surface.
   * 
   * @see make_tree_events
   * @see TreeEvents
   */
  public get events(): TreeEvents {
    this.assertActive("access events");
    if (!this.eventsInternal) {
      this.eventsInternal = guard_api_surface(
        make_tree_events(this.quid),
        () => this.assertActive("access events"),
        this,
      );
    }
    return this.eventsInternal;
  }

  /** Fluent event-listener builder bound to this branch.
   * 
   * @see ListenerBuilder
   */
  public get listen(): ListenerBuilder {
    this.assertActive("listen");
    return guard_api_surface(
      build_listener(this),
      () => this.assertActive("listen"),
      this,
    );
  }


  public get bind(): LiveTreeBindApi<this> {
    this.assertActive("bind");
    return this.bindApiInternal ??= guard_api_surface(
      make_livetree_bind_api(this),
      () => this.assertActive("bind"),
      this,
    );
  }
  
  /***************************************
   * Attribute helpers
   * 
   * getters/setters for attributes and "flags" AKA boolean attributes, plus convenience wrapeprs for e.g. id, class, text
  *
   * all helpers are bound to the current LiveTree node
   *
   * @see LiveTreeAttrs
   ***************************************/

  /** Attributes - get/set/setMany/has/drop
   * 
   * @see AttrHandle
   */
  public get attr(): AttrHandle<this> {
    this.assertActive("access attributes");
    return (this._attr ??= guard_api_surface(attr_handle(this), () => this.assertActive("access attributes"), this));
  }

  /** "Flags" (HTML boolean attributes) - has/get/clear 
   * 
   * @see FlagHandle
  */
  public get flag(): FlagHandle<this> {
    this.assertActive("access flags");
    return (this._flag ??= guard_api_surface(flag_handle(this), () => this.assertActive("access flags"), this));
  }


  /***************************************
   * Dataset, id, classlist
   *
   * Get/set wrappers for common attribute calls 
   *
   * @see LiveTreeAttrs
   * @see LiveTreeData
   ***************************************/

  /** Dataset - (get/set/drop/setMany)
   * 
   * @see DataApi
   */
  public get data(): DataApi<this> {
    this.assertActive("access data");
    return this.dataApiInternal ??= guard_api_surface(make_data_api(this), () => this.assertActive("access data"), this);
  }

  /** ID - (get/set/clear)
   * 
   * @see IdApi
   */
  public get id(): IdApi<this> {
    this.assertActive("access id");
    return this.idApi ??= guard_api_surface(make_id_api(this), () => this.assertActive("access id"), this);
  }

  /** Classlist - (get/has/add/set/remove/toggle/clear)
   * 
   * @see ClassApi
  */
  public get classlist(): ClassApi<this> {
    this.assertActive("access class list");
    return this.classApi ??= guard_api_surface(make_class_api(this), () => this.assertActive("access class list"), this);
  }



  /***************************************
   * Textcontent, Form, Value, Inputs
   * 
   * get/set and handles for text nodes and common input methods
  *
   * all helpers are bound to the current LiveTree node
   *
   * @see LiveTreeText
   * @see LiveTreeForm
   ***************************************/

  /** 
   * Text-content
   * (set/get/add/overwrite/insert)
   * 
   * @see LiveTextApi
   */
  public get text(): LiveTextApi<this> {
    this.assertActive("access text");
    return this.textApiInternal ??= guard_api_surface(make_text_api(this), () => this.assertActive("access text"), this);
  }


  /** 
   * Form  
   * (set/get for value, checked, selected)
   * 
   * @see LiveFormApi
   */
  public get form(): LiveFormApi<this> {
    this.assertActive("access form");
    return this.formApiInternal ??= guard_api_surface(make_form_api(this), () => this.assertActive("access form"), this);
  }


  /***************************************
   * SVG
   * (inScope/preserveAspectRatio/viewBox/d/fill/stroke/strokeWidth/vectorEffect/bbox/must.bbox)
   * 
   * @see SvgApi
   ***************************************/
  public get svg(): SvgApi<this> {
    this.assertActive("access SVG");
    if (!this.svgApi) {
      this.svgApi = guard_api_surface(
        Object.freeze(make_svg_api(this)),
        () => this.assertActive("access SVG"),
        this,
      );
    }
    return this.svgApi;
  }


  /***************************************
   * Canvas methods
   * 
   * get/set convenience methods for common canvas properties and attributes
   * 
   * all helpers are bound to the current LiveTree node
   *
   * @see make_canvas_api
   * @see CanvasApi
   ***************************************/
  public get canvas(): CanvasApi<this> {
    this.assertActive("access canvas");
    return this.canvasApi ??= guard_api_surface(
      Object.freeze(make_canvas_api(this)),
      () => this.assertActive("access canvas"),
      this,
    );
  }

  /***************************************
 * Branch cloning
 *
 * Deep branch duplication with fresh identity.
 *
 * @see clone_branch_method
 ***************************************/

  /** Clone this branch as a new unattached LiveTree branch. */
  /** Clone this branch as a new unattached branch of the same LiveTree subtype. */
  public cloneBranch(): this {
    this.assertActive("clone branch");
    return clone_branch_method.call(this) as this;
  }


}

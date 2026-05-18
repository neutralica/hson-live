// livetree2.ts

import { ensure_quid, get_node_by_quid } from "../../quid/data-quid.quid.js";
import { HsonNode } from "../../types/node.types.js";
import { ListenerBuilder } from "../../types/listen.types.js";
import { element_for_node } from "../../utils/livetree-utils/node-map-helpers.js";
import { CssTreeHandle, StyleHandle } from "../../types/css.types.js";
import { remove_livetree } from "./methods/remove-self.js";
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
import { make_tree_events } from "./managers/events-handler.js";
import { clone_branch_method } from "./methods/clone.js";
import { ContentManager } from "./managers/content-manager.js";
import { css_for_quids } from "./methods/css-for-quids.js";
import { AttrHandle, FlagHandle } from "../../types/attrs.types.js";
import { attr_handle, flag_handle } from "./managers/attr-handle.js";
import { remove_node_children } from "./methods/remove-child.js";
import { make_svg_tree_create } from "./methods/create/create-svg.js";
import { make_html_tree_create } from "./methods/create/create-html.js";
import { make_svg_api, SvgApi } from "./managers/svg-builder.js";
import { LiveFormApi, LiveTreeApi } from "../../types/livetree-internals.types.js";
import { make_canvas_api } from "./managers/canvas/make-canvas-api.js";
import { CanvasApi } from "./managers/canvas/canvas.types.js";

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
export class LiveTree implements LiveTreeApi<LiveTree> {
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
  /* text content API */
  private textApiInternal?: LiveTextApi<this>;
  /* form-specific API for inputs, form-value, etc */
  private formApiInternal?: LiveFormApi<this>;
  /* canvas-specific namespace */
  private canvasApi?: CanvasApi<this>;

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

  //  the underlying bound element can change during lifetime:
  private invalidate_dom_api(): void {
    // existing
    this.domApiInternal = undefined;
    // css handle depends on the current nodeRef/quid context
    this.cssApiInternal = undefined;
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
  public append = append_branch;

  /** Remove all content from this branch. */
  public empty = empty_contents;

  /** Find the first matching descendant or helper query. */
  public find: FindWithById = make_find_for(this);

  /** Find all matching descendants or helper query results. */
  public findAll: FindMany = make_find_all_for(this);


  /***************************************
   * DOM projection
   *
   * Access mounted DOM projection helpers.
   *
   * @see LiveTreeDomAccess
   ***************************************/

  /** DOM helper bound to this tree's mounted element. */
  public get dom(): LiveTreeDom {
    return this.domApiInternal ??= make_dom_api(this, () => this.resolveDomElement());
  }


  /***************************************
   * Branch removal
   *
   * Structural removal operations against the backing HSON node graph.
   *
   * @see LiveTreeContent
   ***************************************/

  /** Remove all child content from this branch and return the removal count. */
  public removeChildren(): number {
    const parent = this.nodeRef.resolveNode();
    if (!parent) return 0;
    return remove_node_children(parent);
  }

  /** Remove this branch from its parent and return the removal count. */
  public removeSelf(): number {
    return remove_livetree.call(this);
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
    return this.nodeRef.q;
  }

  /** Return the host root node for this branch. */
  public hostRootNode(): HsonNode {
    return this.hostRoot;
  }

  /** Content manager bound to this branch. */
  public get content(): ContentManager {
    return (this.contentManager ??= new ContentManager(this));
  }

  /** Adopt a new host-root context for this branch. */
  public adoptRoots(root: HsonNode): this {
    this.hostRoot = root;
    return this;
  }

  /** Resolve and return the backing HSON node.   */
  public get node(): HsonNode {
    const n = this.nodeRef.resolveNode();
    if (!n) {
      throw new Error("LiveTree2.node: ref did not resolve");
    }
    return n;
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
    if (!this.styleApiInternal) {
      const mgr = new StyleManager<this>(this);
      this.styleApiInternal = {
        ...mgr.setter,
        get: mgr.getter,
      };
    }
    return this.styleApiInternal;
  }
  
    /** QUID-scoped stylesheet helper for this branch. 
     * 
     * @see CssTreeHandle
     */
    public get css(): CssTreeHandle {
      if (!this.cssApiInternal) {
        this.cssApiInternal = css_for_quids(this, [this.quid]);
      }
      return this.cssApiInternal;
    }

  /** Tree-local event registry/helper surface.
   * 
   * @see make_tree_events
   * @see TreeEvents
   */
  public get events(): TreeEvents {
    if (!this.eventsInternal) {
      this.eventsInternal = make_tree_events();
    }
    return this.eventsInternal;
  }

  /** Fluent event-listener builder bound to this branch.
   * 
   * @see ListenerBuilder
   */
  public get listen(): ListenerBuilder {
    return build_listener(this);
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
    return (this._attr ??= attr_handle(this));
  }

  /** "Flags" (HTML boolean attributes) - has/get/clear 
   * 
   * @see FlagHandle
  */
  public get flag(): FlagHandle<this> {
    return (this._flag ??= flag_handle(this));
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
    return this.dataApiInternal ??= make_data_api(this);
  }

  /** ID - (get/set/clear)
   * 
   * @see IdApi
   */
  public get id(): IdApi<this> {
    return this.idApi ??= make_id_api(this);
  }

  /** Classlist - (get/has/add/set/remove/toggle/clear)
   * 
   * @see ClassApi
  */
  public get classlist(): ClassApi<this> {
    return this.classApi ??= make_class_api(this);
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
    return this.textApiInternal ??= make_text_api(this);
  }


  /** 
   * Form  
   * (set/get for value, checked, selected)
   * 
   * @see LiveFormApi
   */
  public get form(): LiveFormApi<this> {
    return this.formApiInternal ??= make_form_api(this);
  }


  /***************************************
   * SVG
   * (inScope/preserveAspectRatio/viewBox/d/fill/stroke/strokeWidth/vectorEffect/bbox/must.bbox)
   * 
   * @see SvgApi
   ***************************************/
  public get svg(): SvgApi<this> {
    if (!this.svgApi) {
      this.svgApi = Object.freeze(
        make_svg_api(this)
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
    return this.canvasApi ??= Object.freeze(make_canvas_api(this));
  }

    /***************************************
   * Branch cloning
   *
   * Deep branch duplication with fresh identity.
   *
   * @see clone_branch_method
   ***************************************/

  /** Clone this branch as a new unattached LiveTree branch. */
  public cloneBranch(): LiveTree {
    return clone_branch_method.call(this);
  }


}

// livetree2.ts

import { ensure_quid, get_node_by_quid } from "../../quid/data-quid.quid.js";
import { HsonNode } from "../../types/node.types.js";
import { ListenerBuilder } from "../../types/listen.types.js";
import { element_for_node } from "../../utils/livetree-utils/node-map-helpers.js";
import { CssTreeHandle, StyleHandle } from "../../types/css.types.js";
import { remove_livetree } from "./methods/remove-self.js";
import { get_form_value, set_node_text_content, set_form_value, overwrite_node_text_content, insert_node_text_leaf, LiveTextApi, add_node_text_content, get_node_text_content } from "./managers/text-form-values.js";
import { DataManager } from "./managers/data-manager.js";
import { empty_contents } from "./methods/empty.js";
import { build_listener } from "./managers/listener-builder.js";
import { FindMany, make_find_all_for, make_find_for } from "./methods/find.js"; // CHANGED
import { StyleManager } from "./managers/style-manager.js";
import { HtmlCreateHelper, LiveTreeCreateHelper, SvgCreateHelper, SvgScopeApi, SvgTag } from "../../types/livetree.types.js"; // CHANGED
import { append_branch } from "./methods/appends.js";
import { FindWithById, NodeRef } from "../../types/livetree.types.js";
import { make_class_api, make_id_api, StyleSetter } from "./managers/style-setter.js";
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
  private datasetManagerInternal: DataManager<this> | undefined = undefined;
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
  private svgApi?: SvgScopeApi;
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


  /**
   * DOM adapter bound to this tree's current mounted element, if any.
   *
   * Soft methods return `undefined` or `false` when the tree has no mapped
   * DOM element; corresponding `must.*` helpers throw instead.
   *
   * The surface includes:
   * - element resolution: `el`, `html`, `rect`, `closest`, `parent`, `treeFromEl`
   * - state / layout reads: `isConnected`, `computed`, `computedProp`,
   *   `clientRects`, `scrollSize`, `clientSize`
   * - owner-document queries via `doc`: `elementAtPoint`, `elementsFromPoint`,
   *   `treeAtPoint`, and `treesFromPoint`
   */

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
   * Remove this node's direct child nodes and return the number removed.
   *
   * This is a structural child-node operation. Removal semantics are defined by
   * `remove_node_children`, and DOM state is kept in sync when mounted.
   *
   * @returns The number of direct node-children removed.
   */

  public removeChildren(): number {
    // minimal wrapper; semantics live in helper
    const parent = this.nodeRef.resolveNode();
    if (!parent) return 0;
    return remove_node_children(parent);
  }
  /**
   * Remove this node from its parent (HSON + DOM).
   *
   * @returns `1` when removed, or `0` if already detached.
   * @see remove_livetree
   */
  public removeSelf(): number {
    // funnel through the one implementation
    return remove_livetree.call(this);
  }

  /**
   * Find the first matching descendant in this subtree.
   *
   * Supports structural queries plus convenience helpers:
   * - `find(q)`
   * - `find.byId(id)`
   * - `find.byAttrs(attr, value)`
   * - `find.byFlags(flag)`
   * - `find.byTag(tag)`
   * - `find.byQuid(quid)`
   * - `find.must(...)` and matching `.must.*` variants
   * (TODO: find.byClass, find.bySel)
   *
   * @param q - Selector string or `HsonQuery`.
   * @returns The first matching `LiveTree`, or `undefined`.
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
   * Child-creation helper bound to this tree.
   *
   * In HTML scope, this exposes HTML tag helpers plus `svg(...)`.
   * In SVG scope, this exposes SVG tag helpers appropriate to the current
   * namespace context.
   *
   * Supported patterns include:
   * - creating empty children by tag helper, e.g. `tree.create.div()`
   * - creating from trusted markup source strings, e.g. `tree.create.div("<div>...</div>")`
   * - creating multiple children via `tree.create.tags([...])`
   * - controlling insertion position for the next creation call with
   *   `.prepend()` or `.at(index)`
   *
   * Returned child trees adopt this tree's host-root context.
   */

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

  /**
   * Internal event bus for non-DOM tree events.
   *
   * This is separate from `.listen`, which attaches browser event listeners.
   * Use `.events` for library-level or lifecycle-style signaling where no DOM
   * `EventTarget` is involved.
   */
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
  public get data(): DataManager<this> {
    if (!this.datasetManagerInternal) {
      this.datasetManagerInternal = new DataManager<this>(this);
    }
    return this.datasetManagerInternal;
  }

  /**
   * Stylesheet rule handle scoped to this node’s QUID selector.
   *
   * @returns A `CssHandle` targeting this node’s QUID selector.
   * @see css_for_quids
   */
  public get css(): CssTreeHandle {
    if (!this.cssApiInternal) {
      this.cssApiInternal = css_for_quids(this, [this.quid]);
    }
    return this.cssApiInternal;
  }

  /**
   * Event-listener builder for this tree.
   *
   * Registrations attach immediately when declared. By default listeners target
   * this tree's current DOM element, but `.document`, `.window`, and `.element`
   * can be used to choose the target for the next registration.
   *
   * Chainable modifiers such as `.once()`, `.capture()`, `.passive()`,
   * `.preventDefault()`, `.stopProp()`, and `.stopImmediateProp()` configure
   * the next listener registration.
   *
   * Ambient `document` / `window` listeners are tracked under this tree's QUID
   * and are removed automatically when the owning tree is removed.
   *
   * @returns A `ListenerBuilder` for attaching DOM listeners.
   * @see build_listener
   */
  public get listen(): ListenerBuilder {
    return build_listener(this);
  }

  /* ---------- attribute / flags API ---------- */

  /**
   * Attribute helper bound to this node.
   *
   * Use `attr.get`, `attr.has`, `attr.set`, `attr.setMany`, and `attr.drop`
   * to read and mutate HSON / DOM attributes through one consistent surface.
   */
  public get attr(): AttrHandle<this> {
    return (this._attr ??= attr_handle(this));
  }

  /**
   * Boolean-attribute helper bound to this node.
   *
   * Flags are represented as present-style attributes and provide a small
   * convenience surface for `has`, `set`, and `clear`.
   */
  public get flag(): FlagHandle<this> {
    return (this._flag ??= flag_handle(this));
  }

  /**
   * Text-content helper namespace for this node.
   *
   * These methods operate on HSON text/value leaves rather than replacing the
   * tree object itself:
   * - `set(value)` updates existing text/value leaves while preserving element children
   * - `add(value)` appends a new text leaf
   * - `insert(ix, value)` inserts a text leaf at the requested content index
   * - `overwrite(value)` replaces all content with a single text/value leaf
   * - `get()` returns concatenated text content under the node
   */

  public readonly text: LiveTextApi<this> = {
    set: (value) => { set_node_text_content(this.node, value); return this; },
    add: (value) => { add_node_text_content(this.node, value); return this; },
    overwrite: (value) => { overwrite_node_text_content(this.node, value); return this; },
    insert: (ix, value) => { insert_node_text_leaf(this.node, ix, value); return this; },
    get: (): string => {
      return get_node_text_content(this.node);
    },
  };


  //// TODO - TEXT HANDLING MOVED TO .text NAMESPACE; delete these when safe
  /*  ---------- content API ---------- */
  /**
   * Replace this node’s content with a single text/leaf value.
   *
   * `null` is stored as a `_-val` payload and rendered as an empty string
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

  /**
   * ID helper bound to this node’s `id` attribute.
   *
   * Provides `get/set/clear` in a chainable API.
   */
  public get id(): IdApi<this> {
    // cached id namespace
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
  public get classlist(): ClassApi<this> {
    // cached class namespace
    if (!this.classApi) this.classApi = make_class_api(this);
    return this.classApi;
  }

  /**
   * Deep-clone this subtree into a detached `LiveTree`.
   *
   * The cloned branch receives fresh QUID identity and is not mounted into the
   * DOM until it is appended or otherwise inserted elsewhere.
   */

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

  /**
   * SVG-scoped helpers for trees in SVG context.
   *
   * - `inScope()` reports whether the current node belongs to SVG scope
   * - `bbox()` returns the mounted element's `getBBox()` result when available
   * - `must.bbox()` throws when no SVG bounding box can be resolved
   */
  public get svg(): SvgScopeApi {
    if (!this.svgApi) {
      const bbox = (): SvgBox | undefined => {
        const el = this.dom.el();
        if (!(el instanceof SVGGraphicsElement)) return undefined;

        const b = el.getBBox();
        return {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        };
      };

      this.svgApi = Object.freeze({
        inScope: (): boolean => {
          return SVG_TAGS.includes(this.node._tag as SvgTag);
        },

        // ADD
        bbox,

        must: {
          bbox: (label?: string): SvgBox => {
            const b = bbox();
            if (!b) {
              throw new Error(label ?? `[LiveTree.svg.must.bbox] no bbox available`);
            }
            return b;
          },
        },
      });
    }

    return this.svgApi;
  }
}

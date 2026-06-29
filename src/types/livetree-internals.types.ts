import { LiveTree } from "../api/livetree/livetree.js";
import { CanvasApi, LiveTreeCanvas } from "../api/livetree/managers/canvas/canvas.types.js";
import { ContentManager } from "../api/livetree/managers/content-manager.js";
import { DataApi } from "../api/livetree/managers/data-manager.js";
import { SvgApi } from "../api/livetree/managers/svg-api.js";
import { LiveTextApi } from "../api/livetree/managers/text-form-values.js";
import { FindMany } from "../api/livetree/methods/find.js";
import { AttrHandle, FlagHandle } from "./attrs.types.js";
import { StyleHandle, CssTreeHandle } from "./css.types.js";
import { LiveTreeDom, IdApi, ClassApi } from "./dom.types.js";
import { TreeEvents } from "./events.types.js";
import { ListenerBuilder } from "./listen.types.js";
import { FindWithById, HtmlCreateHelper } from "./livetree.types.js";
import { HsonNode } from "./node.types.js";

export interface LiveTreeIdentity extends LiveTreeNodeHost { }

export interface AppendableLiveBranch<TSelf> extends LiveTreeNodeHost {
    /**
     * Adopts the provided host root as this branch's root context.
     */
    adoptRoots(root: HsonNode): TSelf;
}

export interface LiveTreeNodeHost {

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
    readonly quid: string;


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
    readonly node: HsonNode;


    /**
     * Return the historic root node associated with this `LiveTree`.
     *
     * The host root represents the top-level HSON node for the tree this
     * instance belongs to, even if the current node is a nested descendant.
     *
     * @returns The root `HsonNode` for this tree's context.
     */
    hostRootNode(): HsonNode;
}

export interface LiveTreeAttrAccess<TSelf> {
    /**
     * Attribute helper bound to this node.
     *
     * Use `attr.get`, `attr.has`, `attr.set`, `attr.setMany`, and `attr.drop`
     * to read and mutate HSON / DOM attributes through one consistent surface.
     */
    readonly attr: AttrHandle<TSelf>;
}


export interface LiveTreeStyleAccess<TSelf> {
    /**
     * Inline style helper bound to this node.
     */
    readonly style: StyleHandle<TSelf>;
}

export interface LiveTreeContent<TSelf> {

    /**
     * Append a branch as children of this tree.
     *
     * @param branch - The branch to append under this tree.
     * @param index - Optional insertion index relative to existing children.
     * @returns This `LiveTree` instance, for chaining.
     * @see append_branch
     */
    append(branch: AppendableLiveBranch<TSelf>, index?: number): TSelf;

    /**
     * Remove all child content under this tree's node.
     *
     * @returns This `LiveTree` instance, for chaining.
     * @see empty_contents
     */
    empty(): TSelf;

    /**
     * Remove this node's direct child nodes and return the number removed.
     *
     * This is a structural child-node operation. Removal semantics are defined by
     * `remove_node_children`, and DOM state is kept in sync when mounted.
     *
     * @returns The number of direct node-children removed.
     */
    removeChildren(): number;

    /**
       * Remove this node from its parent (HSON + DOM).
       *
       * @returns `1` when removed, or `0` if already detached.
       * @see remove_livetree
       */
    removeSelf(): number;
 /**
   * Content manager for structured child access and mutation.
   *
   * This is a lazy accessor; the manager is constructed on first use.
   */
    readonly content: ContentManager;
    
    adoptRoots(root: HsonNode): TSelf;
    /**
     * Deep-clone this subtree into a detached `LiveTree`.
     *
     * The cloned branch receives fresh QUID identity and is not mounted into the
     * DOM until it is appended or otherwise inserted elsewhere.
     */
    cloneBranch(): TSelf;
}

export interface LiveTreeQuery {

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
    find: FindWithById;
    /**
       * Find all matching descendants in this subtree.
       *
       * @param q - Selector string or `HsonQuery` (or list of queries).
       * @returns A `TreeSelector` over all matching subtrees.
       * @see make_find_all_for
       */
    findAll: FindMany;
}
export interface LiveTreeDomAccess {
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
    readonly dom: LiveTreeDom;

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
    readonly create: HtmlCreateHelper;
}


export interface LiveTreeAttrs<TSelf>
    extends LiveTreeAttrAccess<TSelf> {
    /**
     * Boolean-attribute helper bound to this node.
     *
     * Flags are represented as present-style attributes and provide a small
     * convenience surface for `has`, `set`, and `clear`.
     */
    readonly flag: FlagHandle<TSelf>;

    /**
     * ID helper bound to this node’s `id` attribute.
     *
     * Provides `get/set/clear` in a chainable API.
     */
    readonly id: IdApi<TSelf>;

    /**
     * Classlist helper bound to this node’s `class` attribute.
     *
     * Provides `get/has/set/add/remove/toggle/clear` in a stable, chainable
     * API. All mutations are reflected in the underlying HSON attrs and DOM
     * when mounted.
     */
    readonly classlist: ClassApi<TSelf>;
}


export interface LiveTreeStyling<TSelf>

    extends LiveTreeStyleAccess<TSelf> {

    /**

     * Scoped CSS rule helper bound to this tree.

     */

    readonly css: CssTreeHandle;

}

export interface LiveTreeEvents {
    /**
     * Internal event bus for non-DOM tree events.
     *
     * This is separate from `.listen`, which attaches browser event listeners.
     * Use `.events` for library-level or lifecycle-style signaling where no DOM
     * `EventTarget` is involved.
     */
    readonly events: TreeEvents;

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
    readonly listen: ListenerBuilder;
}

export interface LiveTreeText<TSelf> {

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
    readonly text: LiveTextApi<TSelf>;
}

export interface LiveTreeData<TSelf> {
    /**
     * Dataset (`data-*`) manager for this node (lazy).
     *
     * @returns A `DataManager` instance bound to this tree.
     */
    readonly data: DataApi<TSelf>;
}
export interface LiveTreeForm<TSelf> {
    /**
     * Form/input helper bound to this node.
     *
     * Provides value, checked, and selected operations for form-like nodes,
     * mirroring to DOM when mounted.
     */
    readonly form: LiveFormApi<TSelf>;

}
export interface LiveTreeSvg<TSelf> {
    /**
     * SVG-scoped helpers for trees in SVG context.
     *
     * - `inScope()` reports whether the current node belongs to SVG scope
     * - `bbox()` returns the mounted element's `getBBox()` result when available
     * - `must.bbox()` throws when no SVG bounding box can be resolved
     */
    readonly svg: SvgApi<TSelf>;
}

export interface LiveFormApi<TSelf> {
    /**
     * Set the form value for this node and mirror to DOM when mounted.
     */
    setValue(value: string, opts?: { silent?: boolean; strict?: boolean }): TSelf;

    /**
     * Read the form value for this node.
     */
    getValue(): string;

    /**
     * Read the checked state for checkbox/radio inputs.
     */
    getChecked(): boolean;

    /**
     * Set the checked state for checkbox/radio inputs.
     */
    setChecked(value: boolean, opts?: { silent?: boolean; strict?: boolean }): TSelf;

    /**
     * Read selected value(s) for select-like inputs.
     */
    getSelected(): string | readonly string[];

    /**
     * Set selected value(s) for select-like inputs.
     */
    setSelected(
        value: string | readonly string[],
        opts?: { silent?: boolean; strict?: boolean },
    ): TSelf;
};

export interface LiveTreeApi<TSelf>
    extends
    LiveTreeIdentity,
    LiveTreeContent<TSelf>,
    LiveTreeQuery,
    LiveTreeDomAccess,
    LiveTreeAttrs<TSelf>,
    LiveTreeStyling<TSelf>,
    LiveTreeEvents,
    LiveTreeText<TSelf>,
    LiveTreeData<TSelf>,
    LiveTreeForm<TSelf>,
    LiveTreeSvg<TSelf>,
    LiveTreeCanvas<TSelf> { };

export interface HtmlLiveTreeApi<TSelf>
    extends
    LiveTreeIdentity,
    LiveTreeContent<TSelf>,
    LiveTreeQuery,
    LiveTreeDomAccess,
    LiveTreeAttrs<TSelf>,
    LiveTreeStyling<TSelf>,
    LiveTreeEvents,
    LiveTreeText<TSelf>,
    LiveTreeData<TSelf>,
    LiveTreeForm<TSelf>,
    LiveTreeCanvas<TSelf> { };

export interface SvgLiveTreeApi<TSelf>
    extends
    LiveTreeIdentity,
    LiveTreeContent<TSelf>,
    LiveTreeQuery,
    LiveTreeAttrs<TSelf>,
    LiveTreeStyling<TSelf>,
    LiveTreeEvents,
    LiveTreeData<TSelf> { };


export interface LiveTreeSvgHost<TSelf>
    extends
    LiveTreeNodeHost,
    LiveTreeAttrAccess<TSelf>,
    LiveTreeStyleAccess<TSelf> { };

export interface LiveTreeCanvasHost<TSelf>
    extends
    LiveTreeNodeHost,
    LiveTreeAttrAccess<TSelf> { };

export type CanvasCreateHelper = HtmlCreateHelper;


export type CanvasLiveTree = LiveTree & {
    readonly create: CanvasCreateHelper;
    readonly canvas: CanvasApi<CanvasLiveTree>;
};

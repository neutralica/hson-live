// livetree2.types.ts

import { LiveTree } from "../api/livetree/livetree.js";
import { HsonAttrs, HsonMeta, HsonNode } from "./node.types.js";
import { FindQuery } from "../api/livetree/methods/find.js";
import { TreeSelector } from "../api/livetree/tree-selector.js";
import { HTML_TAGS, SVG_TAGS } from "../consts/html-tags.js";
import { SvgBox, SvgLiveTree } from "./svg.types.js";


export type SvgScopeApi = Readonly<{
  inScope: () => boolean;
   bbox(): SvgBox | undefined;

  must: Readonly<{
    bbox: (label?: string) => SvgBox;
  }>;
}>;

/**************************************************************
 * Structural query for selecting `HsonNode` instances.
 *
 * Each field is optional; all specified predicates must match:
 *
 *   - `tag`   → exact tag name match (`_obj`, `div`, etc.).
 *   - `attrs` → shallow partial match on `_attrs`, using plain
 *               `===` equality for values.
 *   - `meta`  → shallow partial match on `_meta` keys/values.
 *   - `text`  → matches string payload under `_str`/`_val` or
 *               element text:
 *                 • string → substring match,
 *                 • RegExp → `regex.test(...)`.
 *
 * Query objects are consumed by utilities such as `search_nodes`
 * and `LiveTree.find`, which treat missing fields as wildcards.
 **************************************************************/
export interface HsonQuery {
  tag?: string;
  attrs?: Partial<HsonAttrs>;
  meta?: Partial<HsonMeta>;
  text?: string | RegExp;
}

/**************************************************************
 * Stable reference to a logical node, keyed by its QUID.
 *
 * A `NodeRef` carries:
 *   - `q`              → the QUID string identifier,
 *   - `resolveNode()`  → return the referenced node (or lookup by QUID),
 *   - `resolveElement()` → lookup the mounted DOM element,
 *                          typically via `NODE_ELEMENT_MAP`.
 *
 * Both resolve methods may return `undefined` if the node has
 * not been materialized, has been detached, or the QUID map was
 * cleared. Callers must treat this as a soft reference.
 **************************************************************/
export interface NodeRef {
  q: string;
  resolveNode(): HsonNode | undefined;
  resolveElement(): Element | undefined;
}

/**************************************************************
 * Callable finder bound to a particular `LiveTree` root.
 *
 * Call forms:
 *   - `find(q)`:
 *       • `q: string`     → parsed as a selector-like query,
 *       • `q: HsonQuery`  → structural query object.
 *     Returns a child `LiveTree` for the first match, or
 *     `undefined` on no match.
 *
 *   - `find.byId(id)`:
 *       Shortcut for `{ attrs: { id } }`, limited to the bound
 *       root’s subtree.
 *
 *   - `find.must`:
 *       Same as above, but throws a descriptive `Error` when no
 *       match is found. Callable as `find.must(q, label?)`, and
 *       exposes the same helpers (`find.must.byId`, etc.).
 *       The optional `label` is used to improve error messages
 *       (e.g. test helpers).
 *
 * Implementations typically:
 *   - run `search_nodes` starting from `tree.node`,
 *   - wrap found `HsonNode` instances via a child `LiveTree`
 *     constructor (`wrap_in_tree`),
 *   - maintain the host root identity across branches.
 **************************************************************/
type FindOneHelpers<Return> = {
  byQuid: (quid: string) => Return;
  byId: (id: string) => Return;
  byAttrs: (attr: string, value: string) => Return;
  byFlags: (flag: string) => Return;
  byTag: (tag: string) => Return;
};

export type FindWithByIdMust = ((q: FindQuery, label?: string) => LiveTree) & FindOneHelpers<LiveTree>;

export type FindWithById = ((q: FindQuery) => LiveTree | undefined) &
  FindOneHelpers<LiveTree | undefined> & {
    must: FindWithByIdMust;
  };

/**************************************************************
 * Allowed HTML tag names for creation helpers.
 *
 * This is the DOM lib’s `keyof HTMLElementTagNameMap`, ensuring
 * that:
 *   - creation helpers (`create.div`, `create.span`, etc.) only
 *     expose real HTML tag names, and
 *   - type inference for tag-specific element types stays aligned
 *     with the browser’s built-in element map.
 **************************************************************/
export type TagName = string;

export type AnyCreateTag = HtmlTag | SvgTag;
export type HtmlTag = (typeof HTML_TAGS)[number];
export type SvgTag = (typeof SVG_TAGS)[number];
export type NonRootSvgTag = Exclude<SvgTag, "svg">;

export type LiveTreeCreateHelper =
  Record<Exclude<HtmlTag, "svg">, (index?: number) => LiveTree> &
  Record<NonRootSvgTag, (index?: number) => LiveTree> & {
    tags(tags: TagName[], index?: number): TreeSelector;

    // svg is special
    svg(source?: string): LiveTree;

    // recursive to itself, not CreateHelper
    prepend(): LiveTreeCreateHelper;
    at(index: number): LiveTreeCreateHelper;
  };

export type HtmlLiveTree = Omit<LiveTree, "create"> & {
  create: HtmlCreateHelper;
};
export type HtmlCreateHelper =
  Record<HtmlTag, (source?: string) => LiveTree> & {
    svg(source?: string): SvgLiveTree;
    tags(tags: TagName[]): TreeSelector;
    tag(tag: TagName, source?: string): LiveTree;
    prepend(): HtmlCreateHelper;
    at(index: number): HtmlCreateHelper;
  };

export type SvgCreateHelper =
  Record<NonRootSvgTag, (source?: string) => SvgLiveTree> & {
    svg(source?: string): SvgLiveTree;
    prepend(): SvgCreateHelper;
    at(index: number): SvgCreateHelper;
  };


// helper exposes methods for HtmlTag only (div(), span(), etc)
// and keeps tags([...]) for arbitrary tag names.
export type CreateHelper<Single, Many> =
  Record<HtmlTag, (source?: string) => Single> & {
    tags(tags: TagName[]): Many;
    prepend(): CreateHelper<Single, Many>;
    at(index: number): CreateHelper<Single, Many>;
  };

  export type DetachedCreateHelper =
  HtmlCreateHelper &
  SvgCreateHelper & {
    prepend(): DetachedCreateHelper;
    at(index: number): DetachedCreateHelper;
    };
  
/**************************************************************
 * Creation helper exposed as `selector.create` on a
 * `TreeSelector`.
 *
 * Behavior:
 *   - Per-tag calls (e.g. `selector.create.div(index?)`) create
 *     one new child per `LiveTree` in the selection and return a
 *     `TreeSelector` containing all newly created children.
 *
 *   - Batch calls (`selector.create.tags([...], index?)`)
 *     create multiple children under each selected tree, flatten
 *     all of them, and return a single `TreeSelector` over the
 *     entire set.
 *
 * This allows a multi-selection to construct mirrored subtree
 * structures across many parents in a single operation, while
 * keeping the return type consistently `TreeSelector` for
 * further broadcast-style operations.
 **************************************************************/
export type TreeSelectorCreateHelper = CreateHelper<TreeSelector, TreeSelector>;

export type DocApi = Readonly<{
  document: Document;
  window: Window | null;

  // Amenity: handle to <body> if it exists
  body: LiveTree | undefined;

  // Good to have (optional):
  rootEl: HTMLElement | null;  // doc.documentElement if needed later
}>;
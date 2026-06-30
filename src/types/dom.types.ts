// dom.types.ts
import { LiveTree } from "../api/livetree/livetree.js";
import { TreeSelector } from "../api/livetree/creation/tree-selector.js";

/**
 * Callable `closest` helper.
 *
 * Returns the nearest DOM ancestor-or-self matching `sel`, resolved back into a
 * `LiveTree`. Returns `undefined` when this tree is unmounted, no element
 * matches, or the matched element is not mapped to a LiveTree node.
 */
export type ClosestFn = ((sel: string) => LiveTree | undefined) & {
  /** Strict `closest` variant; throws when no resolvable match is found. */
  must: (sel: string, label?: string) => LiveTree;
};

/**
 * Callable `parent` helper.
 *
 * Returns this tree element's DOM `parentElement`, resolved back into a
 * `LiveTree`. Returns `undefined` when unmounted, parentless, or unmapped.
 */
export type ParentFn = (() => LiveTree | undefined) & {
  /** Strict `parent` variant; throws when no resolvable parent is found. */
  must: (label?: string) => LiveTree;
};


export interface LiveTreeDocument {
  /** Return the topmost `Element` at viewport coordinates, if any. */
  elementAtPoint(x: number, y: number): Element | undefined;

  /** Return all `Element` hits at viewport coordinates, topmost first. */
  elementsFromPoint(x: number, y: number): Element[];

  /** Return the topmost hit at viewport coordinates as a `LiveTree`, if mapped. */
  treeAtPoint(x: number, y: number): LiveTree | undefined;

  /** Return all mapped `LiveTree` hits at viewport coordinates, topmost first. */
  treesFromPoint(x: number, y: number): TreeSelector;
}



/**
 * DOM containment helper. The callable form is equivalent to
 * `contains.tree(other)`.
 */
export type DomContainsApi = ((other: LiveTree) => boolean) & Readonly<{
  /** Return whether this tree's element contains `node`, including itself. */
  node(node: Node): boolean;

  /** Return whether this tree's element contains `target` when it is a DOM `Node`. */
  target(target: EventTarget | null): boolean;

  /** Return whether this tree's element contains another tree's element. */
  tree(other: LiveTree): boolean;
}>;

export interface LiveTreeDom {
  /** Return this tree's mapped DOM element, or `undefined` when unmounted. */
  el(): Element | undefined;
  /** Return this tree's mapped element only when it is an `HTMLElement`. */
  htmlEl(): HTMLElement | undefined;
  /** Return the innerHTML of this tree's mapped DOM element as a string, or undefined. */
  innerHtml: string | undefined;
  /** Return the outerHTML of this tree's mapped DOM element as a string, or undefined. */
  outerHtml: string | undefined;
  /** Return whether this tree's element matches `sel`; false when unmounted. */
  matches(sel: string): boolean;
  /** DOM containment helpers for nodes, event targets, and other trees. */
  contains: DomContainsApi;
  /** Return whether this tree currently has a connected DOM element. */
  isConnected(): boolean;
  /** Bounding-rect helper for this tree's mapped element. */
  rect: DomRectApi;
  /** Resolve the nearest matching DOM ancestor-or-self back into a `LiveTree`. */
  closest: ClosestFn;
  /** Resolve this element's DOM parent back into a `LiveTree`. */
  parent: ParentFn;
  /** Return `getComputedStyle(element)`, or `undefined` when unmounted. */
  computed(): CSSStyleDeclaration | undefined;
  /** Return a computed CSS property value, or `undefined` when unmounted. */
  computedProp(name: string): string | undefined;
  /** Return `element.getClientRects()`, or `undefined` when unavailable. */
  clientRects(): DOMRectList | undefined;
  /** Return HTML scroll dimensions, or `undefined` for non-HTML/unmounted elements. */
  scrollSize(): DomSize | undefined;
  /** Return HTML client dimensions, or `undefined` for non-HTML/unmounted elements. */
  clientSize(): DomSize | undefined;
  /** Owner-document point-query helpers, or `undefined` when unmounted. */
  doc: LiveTreeDocument | undefined;
  /** Resolve a mapped DOM element back into a `LiveTree` in this host-root context. */
  treeFromEl: (domEl: Element, label?: string) => LiveTree | undefined;
  
  /** .must methods throw instead of returning undefined **/ 
  must: Readonly<{
    /** Return this tree's DOM element, or throw. */
    el: (label?: string) => Element;
    /** Return this tree's DOM element as an `HTMLElement`, or throw. */
    htmlEl: (label?: string) => HTMLElement;
    /** Return the innerHTML of this tree's DOM element as a string, or throw. */
    innerHtml: string;
    /** Return the outerHTML of this tree's DOM element as a string, or throw. */
    outerHtml: string;
    /** Return this tree's bounding client rect, or throw. */
    rect: (label?: string) => DOMRect;
    /** Strict `closest`; throws when no resolvable selector match is found. */
    closest: (sel: string, label?: string) => LiveTree;
    /** Strict `parent`; throws when no resolvable DOM parent is found. */
    parent: (label?: string) => LiveTree;
    /** Strict DOM-element-to-tree resolver; throws when `domEl` is unmapped. */
    treeFromEl: (domEl: Element, label?: string) => LiveTree;
    /** Return computed styles for this tree's element, or throw. */
    computed: (label?: string) => CSSStyleDeclaration;
    /** Return a computed property value, or throw only when styles cannot be read. */
    computedProp: (name: string, label?: string) => string;
    /** Return client rects for this tree's element, or throw. */
    clientRects: (label?: string) => DOMRectList;
    /** Return HTML scroll dimensions, or throw. */
    scrollSize: (label?: string) => DomSize;
    /** Return HTML client dimensions, or throw. */
    clientSize: (label?: string) => DomSize;
    /** Strict owner-document point-query helpers; throws when unavailable. */
    doc: LiveTreeDocument;
  }>;
}

/**
 * Width/height pair returned by DOM box-size helpers.
 *
 * Used for size reads that naturally expose dimensions rather than a full
 * `DOMRect`, such as `scrollSize()` and `clientSize()`.
 */
export type DomSize = {
  width: number;
  height: number;
};

/**
 * Callable bounding-rect helper for a tree's mapped DOM element.
 *
 * Returns `undefined` when the tree is unmounted or the mapped element cannot
 * provide `getBoundingClientRect()`.
 */
export type DomRectApi = {
  /** Return `element.getBoundingClientRect()`, or `undefined` when unavailable. */
  (): DOMRect | undefined;
};

/**
 * Chainable class-list API bound to an owning tree-like object.
 *
 * Read helpers expose the current class state. Write helpers mutate the mapped
 * DOM/class state and return the owner so calls can remain fluent.
 */
export type ClassApi<TOwner> = Readonly<{
  get: () => string | undefined;
  has: (name: string) => boolean;
  set: (cls: string | string[]) => TOwner;
  add: (...names: string[]) => TOwner;
  remove: (...names: string[]) => TOwner;
  toggle: (name: string, force?: boolean) => TOwner;
  clear: () => TOwner;
}>;

/**
 * Chainable `id` attribute API bound to an owning tree-like object.
 *
 * Reads the current id when available. Mutating calls update or remove the id
 * and return the owner so calls can remain fluent.
 */
export type IdApi<TOwner> = Readonly<{
  get: () => string | undefined;
  set: (id: string) => TOwner;
  clear: () => TOwner;
}>;
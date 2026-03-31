// dom.ts
import { LiveTree } from "../api/livetree/livetree.js";
import { TreeSelector } from "../api/livetree/tree-selector.js";

/**
 * Callable `closest` helper with a `.must` variant.
 */
export type ClosestFn = ((sel: string) => LiveTree | undefined) & {
  must: (sel: string, label?: string) => LiveTree;
};

/**
 * Callable `parent` helper with a `.must` variant.
 */
export type ParentFn = (() => LiveTree | undefined) & {
  must: (label?: string) => LiveTree;
};

export interface LiveTreeDocument {
  elementAtPoint(x: number, y: number): Element | undefined;
  elementsFromPoint(x: number, y: number): Element[];

  treeAtPoint(x: number, y: number): LiveTree | undefined;
  treesFromPoint(x: number, y: number): TreeSelector;
}
/**
 * DOM adapter surface returned by `LiveTree.dom`.
 */
export interface LiveTreeDom {
  el(): Element | undefined;
  html(): HTMLElement | undefined;
  matches(sel: string): boolean;
  contains(other: LiveTree): boolean;
  isConnected(): boolean;

  rect: DomRectApi;
  closest: ClosestFn;
  parent: ParentFn;

  // ADDED
  computed(): CSSStyleDeclaration | undefined;
  computedProp(name: string): string | undefined;

  // ADDED
  clientRects(): DOMRectList | undefined;
  scrollSize(): DomSize | undefined;
  clientSize(): DomSize | undefined;

  // ADDED
  doc: LiveTreeDocument;

  must: Readonly<{
    el: (label?: string) => Element;
    html: (label?: string) => HTMLElement;
    rect: (label?: string) => DOMRect;
    closest: (sel: string, label?: string) => LiveTree;
    parent: (label?: string) => LiveTree;
    treeFromEl?: (domEl: Element, label?: string) => LiveTree;

    // ADDED
    computed: (label?: string) => CSSStyleDeclaration;
    computedProp: (name: string, label?: string) => string;
    clientRects: (label?: string) => DOMRectList;
    scrollSize: (label?: string) => DomSize;
    clientSize: (label?: string) => DomSize;
  }>;
}

export type DomSize = {
  width: number;
  height: number;
};

export type DomRectApi = {
  (): DOMRect | undefined;
  clientRects(): DOMRectList | undefined;
  scrollSize(): DomSize | undefined;
  clientSize(): DomSize | undefined;
};

export type ClassApi<TOwner> = Readonly<{
  get: () => string | undefined;
  has: (name: string) => boolean;
  set: (cls: string | string[]) => TOwner;
  add: (...names: string[]) => TOwner;
  remove: (...names: string[]) => TOwner;
  toggle: (name: string, force?: boolean) => TOwner;
  clear: () => TOwner;
}>;

export type IdApi<TOwner> = Readonly<{
  get: () => string | undefined;
  set: (id: string) => TOwner;
  clear: () => TOwner;
}>;
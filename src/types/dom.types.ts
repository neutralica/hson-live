// dom.ts
import { LiveTree } from "../api/livetree/livetree.js";

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

/**
 * DOM adapter surface returned by `LiveTree.dom`.
 */
export interface LiveTreeDom {
  el(): Element | undefined;
  html(): HTMLElement | undefined;
  matches(sel: string): boolean;
  contains(other: LiveTree): boolean;
  isConnected(): boolean;

  must: Readonly<{
    el: (label?: string) => Element;
    html: (label?: string) => HTMLElement;
    rect: (label?: string) => DOMRect;
    closest: (sel: string, label?: string) => LiveTree;
    parent: (label?: string) => LiveTree;
    treeFromEl?: (domEl: Element, label?: string) => LiveTree;
  }>;

  rect: DomRectApi;
  closest: ClosestFn;
  parent: ParentFn;
}

export type DomSize = {
  width: number;
  height: number;
};

export type DomRectApi = {
  (): DOMRect | undefined;
  must(label?: string): DOMRect;

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
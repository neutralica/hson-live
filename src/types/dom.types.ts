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

  // CHANGED: single declarations using intersection types
  closest: ClosestFn;
  parent: ParentFn;
}

/**
 * ID helper bound to a node’s `id` attribute.
 */
export type IdApi = Readonly<{
  get: () => string | undefined;
  set: (id: string) => LiveTree;
  clear: () => LiveTree;
}>;

/**
 * Classlist helper bound to a node’s `class` attribute.
 */
export type ClassApi = Readonly<{
  get: () => string | undefined;     // raw attr
  has: (name: string) => boolean;
  set: (cls: string | string[]) => LiveTree;
  add: (...names: string[]) => LiveTree;
  remove: (...names: string[]) => LiveTree;
  toggle: (name: string, force?: boolean) => LiveTree;
  clear: () => LiveTree;
}>;

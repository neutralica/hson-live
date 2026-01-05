// dom.ts
import { LiveTree } from "../api/livetree/livetree";

// helper types for “callable with .must”
export type ClosestFn = ((sel: string) => LiveTree | undefined) & {
  must: (sel: string, label?: string) => LiveTree;
};

export type ParentFn = (() => LiveTree | undefined) & {
  must: (label?: string) => LiveTree;
};

export interface LiveTreeDom {
  el(): Element | undefined;
  html(): HTMLElement | undefined;
  matches(sel: string): boolean;
  contains(other: LiveTree): boolean;

  // CHANGED: single declarations using intersection types
  closest: ClosestFn;
  parent: ParentFn;
}

// types
export type IdApi = Readonly<{
  get: () => string | undefined;
  set: (id: string) => LiveTree;
  clear: () => LiveTree;
}>;

export type ClassApi = Readonly<{
  get: () => string | undefined;     // raw attr
  has: (name: string) => boolean;
  set: (cls: string | string[]) => LiveTree;
  add: (...names: string[]) => LiveTree;
  remove: (...names: string[]) => LiveTree;
  toggle: (name: string, force?: boolean) => LiveTree;
  clear: () => LiveTree;
}>;

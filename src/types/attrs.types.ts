// attrs.types.ts

import type {
  LiveMapDocumentAttrs,
  LiveMapDocumentAttributeValue,
} from "./livemap.types.js";

export type LiveTreeAttrsMustHandle = Readonly<{
  get: (name: string) => LiveMapDocumentAttributeValue;
}>;

export type AttrHandle<TOwner> = Readonly<{
  get: (name: string) => LiveMapDocumentAttributeValue | undefined;
  must: LiveTreeAttrsMustHandle;
  has: (name: string) => boolean;
  keys: () => readonly string[];
  drop: (name: string) => TOwner;
  dropMany: (names: readonly string[]) => TOwner;
  clear: () => TOwner;
  replace: (values: LiveMapDocumentAttrs) => TOwner;
  set: (name: string, value: LiveMapDocumentAttributeValue) => TOwner;
  setMany: (values: LiveMapDocumentAttrs) => TOwner;
}>;

export type FlagHandle<TOwner> = Readonly<{
  has: (name: string) => boolean;
  set: (...names: string[]) => TOwner;
  clear: (...names: string[]) => TOwner;
}>;

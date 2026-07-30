// types.ts

import type { HSON_META_INDEX, HSON_META_QUID } from "./constants.js";
import type { PersistedQuid } from "./persisted-quid.js";

export type Primitive = string | boolean | number | null;
type CanonicalStyleValue =
  | Primitive
  | undefined
  | Readonly<{ value: string | number; unit?: string }>;
interface CanonicalStyleMap {
  readonly [key: string]: CanonicalStyleValue | CanonicalStyleMap;
}
export type CanonicalPublicAttrValue = Primitive | CanonicalStyleMap;
export type CanonicalPublicAttrs = Readonly<Record<string, CanonicalPublicAttrValue>>;
export type BasicValue = boolean | number | null;

export type JsonObj = { [key: string]: JsonValue };

export type JsonValue =
  Primitive |
  JsonObj |
  JsonValue[];

export interface HsonNode {
  $_tag: string;
  $_meta?: HsonMeta;
  $_attrs?: HsonAttrs;
  $_content: NodeContent;
}

export type NodeContent = (HsonNode | Primitive)[];

/** Ordinary attributes plus the one structured `style` attribute. */
export interface HsonAttrs {
  [key: string]: Primitive | CanonicalStyleMap | undefined;
  style?: CanonicalStyleMap;
}
export type AttrValue = Primitive | undefined;
export type AttrMap = Readonly<Record<string, AttrValue>>;

export interface HsonMeta {
  [HSON_META_INDEX]?: string;
  [HSON_META_QUID]?: PersistedQuid;
}

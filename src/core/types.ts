// types.ts

import type { _DATA_INDEX, _DATA_QUID } from "./constants.js";
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

export type HsonMeta = {
  [_DATA_INDEX]?: string;
  [_DATA_QUID]?: PersistedQuid;
} & Record<string, string>;

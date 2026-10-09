// types.ts

import type { HSON_META_INDEX, HSON_META_QUID } from "./constants.js";
import type { PersistedQuid } from "./persisted-quid.js";
import type { HsonNumber } from "./hson-number.js";

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

/** Primitive value after semantic Hson numeric admission. */
export type HsonSemanticPrimitive = string | boolean | HsonNumber | null;

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

type ObservedStyle = {
  readonly [key: string]: Primitive | undefined | ObservedStyle;
};

/**
 * Detached, deeply frozen inspection of actual LiveTree runtime storage.
 * This is an observation type, not a mutable authoring or admission type.
 */
export interface ReadonlyHsonNode {
  readonly $_tag: string;
  readonly $_meta?: Readonly<HsonMeta>;
  readonly $_attrs?: {
    readonly [key: string]: Primitive | undefined | readonly Primitive[] | ObservedStyle;
    readonly style?: Primitive | ObservedStyle;
  };
  readonly $_content: readonly (ReadonlyHsonNode | Primitive)[];
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

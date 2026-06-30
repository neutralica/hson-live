// types.ts

import type { _DATA_INDEX, _DATA_QUID } from "./constants.js";
import type { CssMap } from "./style.types.js";

export type Primitive = string | boolean | number | null;
export type BasicValue = boolean | number | null;

export type JsonObj = { [key: string]: JsonValue };

export type JsonValue =
  Primitive |
  JsonObj |
  JsonValue[];

export interface HsonNode {
  $_tag: string;
  $_meta: HsonMeta;
  $_attrs: HsonAttrs;
  $_content: NodeContent;
}

export type NodeContent = (HsonNode | Primitive)[];

export type HsonAttrs = { "style"?: CssMap } & Record<string, Primitive>;
export type AttrValue = Primitive | undefined;
export type AttrMap = Readonly<Record<string, AttrValue>>;

export type HsonMeta = {
  [_DATA_INDEX]?: string;
  [_DATA_QUID]?: string;
} & Record<string, string>;

import { LiveTree } from "../api/livetree/livetree.js";
import { Primitive } from "./core.types.js";
import { AttrMap, AttrValue } from "./node.types.js";

export type AttrHandle<TOwner> = Readonly<{
  get: (name: string) => Primitive | undefined;
  has: (name: string) => boolean;
  drop: (name: string) => TOwner;
  set: (name: string, value: AttrValue) => TOwner;
  setMany: (map: AttrMap) => TOwner;
}>;

export type FlagHandle<TOwner> = Readonly<{
  has: (name: string) => boolean;
  set: (...names: string[]) => TOwner;
  clear: (...names: string[]) => TOwner;
}>;

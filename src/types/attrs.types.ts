import { LiveTree } from "../api/livetree/livetree.js";
import { Primitive } from "./core.types.js";

export type AttrHandle<TOwner> = Readonly<{
  get: (name: string) => Primitive | undefined;
  has: (name: string) => boolean;

  // explicit remove
  drop: (name: string) => TOwner;

  // set 1 / many
  set: (name: string, value: Primitive | null | false) => TOwner;
  setMany: (map: Record<string, Primitive | null | false>) => TOwner;
}>;

export type FlagHandle = Readonly<{
  has: (name: string) => boolean;
  set: (...names: string[]) => LiveTree;
  clear: (...names: string[]) => LiveTree;
}>;

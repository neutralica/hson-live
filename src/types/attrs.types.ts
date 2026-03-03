import { LiveTree } from "../api/livetree/livetree.js";
import { Primitive } from "./core.types.js";

export type AttrHandle = Readonly<{
  get: (name: string) => Primitive | undefined;
  has: (name: string) => boolean;

  // explicit remove
  drop: (name: string) => LiveTree;

  // set 1 / many
  set: (name: string, value: Primitive | null | false) => LiveTree;
  setMany: (map: Record<string, Primitive | null | false>) => LiveTree;
}>;

export type FlagHandle = Readonly<{
  has: (name: string) => boolean;
  set: (...names: string[]) => LiveTree;
  clear: (...names: string[]) => LiveTree;
}>;

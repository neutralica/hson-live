/**
 * fill out more 
 **/

import { LiveTree } from "../api/livetree/livetree.js";
import { DataManager } from "../api/livetree/managers/data-manager.js";
import { LiveTextApi } from "../api/livetree/managers/text-form-values.js";
import { AttrHandle, FlagHandle } from "./attrs.types.js";
import { StyleHandle, CssTreeHandle } from "./css.types.js";
import { IdApi, ClassApi } from "./dom.types.js";
import { SvgCreateHelper } from "./livetree.types.js";


export interface LiveTreeSvgDom {
  bbox(): SvgBox | undefined;
  must: Readonly<{
    bbox: (label?: string) => SvgBox;
  }>;
}

export type SvgBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type SvgLiveTree = Omit<
  LiveTree, "create" | "id" | "classlist" | "style" | "css" | "attr" | "flag" | "data" | "text" | "empty"
> & {
  create: SvgCreateHelper;
  id: IdApi<SvgLiveTree>;
  classlist: ClassApi<SvgLiveTree>;
  style: StyleHandle<SvgLiveTree>;
  css: CssTreeHandle<SvgLiveTree>;
  attr: AttrHandle<SvgLiveTree>;
  flag: FlagHandle<SvgLiveTree>;
  data: DataManager<SvgLiveTree>;
  text: LiveTextApi<SvgLiveTree>;
  empty: () => SvgLiveTree;
};

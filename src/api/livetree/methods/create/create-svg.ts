import { SVG_TAGS } from "../../../../consts/html-tags.js";
import { SvgCreateHelper, SvgTag } from "../../../../types/livetree.types.js";
import { SvgLiveTree } from "../../../../types/svg.types.js";
import { LiveTree } from "../../livetree.js";
import { make_create_core } from "./create-core.js";


export function make_svg_tree_create(tree: LiveTree): SvgCreateHelper {
  const core = make_create_core(tree);

  const helper: Partial<SvgCreateHelper> & {
    prepend(): SvgCreateHelper;
    at(index: number): SvgCreateHelper;
  } = {
    prepend() {
      core.setNextIndex(0);
      return helper as SvgCreateHelper;
    },

    at(index: number) {
      core.setNextIndex(index);
      return helper as SvgCreateHelper;
    },
  };

  for (const rawTag of SVG_TAGS) {
    const tag = rawTag as SvgTag;
    if (tag === "svg") continue;

    (helper as any)[tag] = (source?: string): SvgLiveTree => {
      const ix = core.consumeIndex();

      if (typeof source === "string") {
        return core.createSvgTagFromString(tag, source, ix);
      }

      return core.createSingleTag(tag, ix) as unknown as SvgLiveTree;
    };
  }

  (helper as any).svg = (source?: string): SvgLiveTree => {
    const ix = core.consumeIndex();

    if (typeof source === "string") {
      return core.createSvgTagFromString("svg", source, ix);
    }

    return core.createSingleTag("svg", ix) as unknown as SvgLiveTree;
  };

  return helper as SvgCreateHelper;
}

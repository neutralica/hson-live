import { HTML_TAGS, SVG_TAGS } from "../../../../consts/html-tags.js";
import { HtmlCreateHelper, TagName, HtmlTag, SvgCreateHelper, SvgTag } from "../../../../types/livetree.types.js";
import { SvgLiveTree } from "../../../../types/svg.types.js";
import { LiveTree } from "../../livetree.js";
import { TreeSelector } from "../../tree-selector.js";
import { make_create_core, assert_valid_tag_name } from "./create-core.js";


export function make_html_tree_create(tree: LiveTree): HtmlCreateHelper {
  const core = make_create_core(tree);

  const helper: Partial<HtmlCreateHelper> & {
    prepend(): HtmlCreateHelper;
    at(index: number): HtmlCreateHelper;
  } = {
    tag(tag: TagName, source?: string): LiveTree {
      const ix = core.consumeIndex();

      assert_valid_tag_name(tag, "create.tag");

      if (typeof source === "string") {
        if (tag === "svg") {
          return core.createSvgTagFromString("svg", source, ix) as unknown as LiveTree;
        }

        return core.createHtmlTagFromString(tag as HtmlTag, source, ix);
      }

      return core.createSingleTag(tag, ix);
    },

    tags(tags: TagName[]): TreeSelector {
      return core.createForTags(tags, core.consumeIndex()) as TreeSelector;
    },

    prepend() {
      core.setNextIndex(0);
      return helper as HtmlCreateHelper;
    },

    at(index: number) {
      core.setNextIndex(index);
      return helper as HtmlCreateHelper;
    },
  };

  for (const rawTag of HTML_TAGS) {
    const tag = rawTag as HtmlTag;

    (helper as any)[tag] = (source?: string): LiveTree => {
      const ix = core.consumeIndex();

      if (typeof source === "string") {
        return core.createHtmlTagFromString(tag, source, ix);
      }

      return core.createSingleTag(tag, ix);
    };

  }
  (helper as any).svg = (source?: string): SvgLiveTree => {
    const ix = core.consumeIndex();

    if (typeof source === "string") {
      return core.createSvgTagFromString("svg", source, ix);
    }

    return core.createSingleTag("svg", ix) as unknown as SvgLiveTree;
  };

  return helper as HtmlCreateHelper;
}

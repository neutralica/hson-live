import { CREATE_NODE } from "../../consts/factories.js";
import { SVG_TAGS, HTML_TAGS } from "../../consts/html-tags.js";
import { HtmlCreateHelper, TagName, SvgTag, SvgCreateHelper, HtmlTag } from "../../types/livetree.types.js";
import { HsonNode } from "../../types/node.types.js";
import { SvgLiveTree } from "../../types/svg.types.js";
import { create_livetree } from "../livetree/create-livetree.js";
import { LiveTree } from "../livetree/livetree.js";
import { TreeSelector } from "../livetree/tree-selector.js";

export function make_detached_livetree_create(): HtmlCreateHelper {
  // CHANGED: keep API shape consistent with normal create helper
  let nextIndex: number | undefined = undefined;

  const consumeIndex = (): number | undefined => {
    const ix = nextIndex;
    nextIndex = undefined;
    return ix;
  };

  // CHANGED: mint a fresh detached HTML host per call
  function makeHtmlHost(): LiveTree {
    const node = CREATE_NODE({
      _tag: "div",
      _content: [],
    }) as HsonNode;

    return create_livetree(node);
  }

  // CHANGED: mint a fresh detached SVG host per call
  function makeSvgHost(): SvgLiveTree {
    const node = CREATE_NODE({
      _tag: "svg",
      _attrs: {
        xmlns: "http://www.w3.org/2000/svg",
      },
      _content: [],
    }) as HsonNode;

    return create_livetree(node) as unknown as SvgLiveTree;
  }

  const helper: Partial<HtmlCreateHelper> & {
    prepend(): HtmlCreateHelper;
    at(index: number): HtmlCreateHelper;
  } = {
    tag(tag: TagName, source?: string): LiveTree {
      const ix = consumeIndex();

      // CHANGED: detached svg root creation gets its own host
      if (tag === "svg") {
        const host = makeHtmlHost();
        const create = typeof ix === "number" ? host.create.at(ix) : host.create;
        return typeof source === "string"
          ? (create.svg(source) as unknown as LiveTree)
          : (create.svg() as unknown as LiveTree);
      }

      // CHANGED: allow detached SVG child-tag creation via tag("circle"), etc.
      if (SVG_TAGS.includes(tag as SvgTag)) {
        const host = makeSvgHost();
        const create = typeof ix === "number" ? host.create.at(ix) : host.create;
        const fn = (create as SvgCreateHelper)[tag as Exclude<SvgTag, "svg">];

        return typeof source === "string"
          ? (fn(source) as unknown as LiveTree)
          : (fn() as unknown as LiveTree);
      }

      const host = makeHtmlHost();
      const create = typeof ix === "number" ? host.create.at(ix) : host.create;

      return typeof source === "string"
        ? create.tag(tag, source)
        : create.tag(tag);
    },

    tags(tags: TagName[]): TreeSelector {
      const ix = consumeIndex();
      const host = makeHtmlHost();
      const create = typeof ix === "number" ? host.create.at(ix) : host.create;
      return create.tags(tags);
    },

    prepend(): HtmlCreateHelper {
      nextIndex = 0;
      return helper as HtmlCreateHelper;
    },

    at(index: number): HtmlCreateHelper {
      nextIndex = index;
      return helper as HtmlCreateHelper;
    },
  };

  // CHANGED: wire native HTML tag helpers through fresh detached hosts
  for (const rawTag of HTML_TAGS) {
    const tag = rawTag as HtmlTag;

    (helper as Record<string, unknown>)[tag] = (source?: string): LiveTree => {
      const ix = consumeIndex();
      const host = makeHtmlHost();
      const create = typeof ix === "number" ? host.create.at(ix) : host.create;
      const fn = create[tag];

      return typeof source === "string"
        ? fn(source)
        : fn();
    };
  }

  // CHANGED: explicit detached svg root helper
  (helper as Record<string, unknown>).svg = (source?: string): SvgLiveTree => {
    const ix = consumeIndex();
    const host = makeHtmlHost();
    const create = typeof ix === "number" ? host.create.at(ix) : host.create;

    return typeof source === "string"
      ? create.svg(source)
      : create.svg();
  };

  return helper as HtmlCreateHelper;
}
import { CREATE_NODE } from "../../consts/factories.js";
import { SVG_TAGS, HTML_TAGS } from "../../consts/html-tags.js";
import { HtmlCreateHelper, TagName, SvgTag, SvgCreateHelper, HtmlTag, DetachedCreateHelper } from "../../types/livetree.types.js";
import { HsonNode } from "../../types/node.types.js";
import { SvgLiveTree } from "../../types/svg.types.js";
import { create_livetree } from "../livetree/create-livetree.js";
import { LiveTree } from "../livetree/livetree.js";
import { TreeSelector } from "../livetree/tree-selector.js";

export function make_detached_livetree_create(): DetachedCreateHelper {
  let nextIndex: number | undefined = undefined;

  const consumeIndex = (): number | undefined => {
    const ix = nextIndex;
    nextIndex = undefined;
    return ix;
  };

  // CHANGED: local detached html host
  function makeHtmlHost(): LiveTree {
    const node = CREATE_NODE({
      _tag: "div",
      _content: [],
    }) as HsonNode;

    return create_livetree(node);
  }

  // CHANGED: local detached svg host
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

  // CHANGED: central per-call html dispatch
  function createDetachedHtmlTag(tag: HtmlTag, source?: string, ix?: number): LiveTree {
    const host = makeHtmlHost();
    const create = typeof ix === "number" ? host.create.at(ix) : host.create;
    const fn = create[tag];

    return typeof source === "string"
      ? fn(source)
      : fn();
  }

  // CHANGED: central per-call svg dispatch
  function createDetachedSvgTag(tag: SvgTag, source?: string, ix?: number): SvgLiveTree {
    // svg root is created from an html host, just like normal tree.create.svg()
    if (tag === "svg") {
      const host = makeHtmlHost();
      const create = typeof ix === "number" ? host.create.at(ix) : host.create;

      return typeof source === "string"
        ? create.svg(source)
        : create.svg();
    }

    // svg child tags need svg namespace context
    const host = makeSvgHost();
    const create = typeof ix === "number" ? host.create.at(ix) : host.create;
    const fn = (create as SvgCreateHelper)[tag as Exclude<SvgTag, "svg">];

    return typeof source === "string"
      ? fn(source)
      : fn();
  }

  const helper: Partial<DetachedCreateHelper> & {
    prepend(): DetachedCreateHelper;
    at(index: number): DetachedCreateHelper;
  } = {
    // CHANGED: detached generic tag dispatcher
    tag(tag: TagName, source?: string): LiveTree {
      const ix = consumeIndex();

      if (SVG_TAGS.includes(tag as SvgTag)) {
        return createDetachedSvgTag(tag as SvgTag, source, ix) as unknown as LiveTree;
      }

      return createDetachedHtmlTag(tag as HtmlTag, source, ix);
    },

    // CHANGED: preserve existing detached tags() behavior (html host)
    tags(tags: TagName[]): TreeSelector {
      const ix = consumeIndex();
      const host = makeHtmlHost();
      const create = typeof ix === "number" ? host.create.at(ix) : host.create;
      return create.tags(tags);
    },

    prepend(): DetachedCreateHelper {
      nextIndex = 0;
      return helper as DetachedCreateHelper;
    },

    at(index: number): DetachedCreateHelper {
      nextIndex = index;
      return helper as DetachedCreateHelper;
    },
  };

  // CHANGED: wire all html direct helpers
  for (const rawTag of HTML_TAGS) {
    const tag = rawTag as HtmlTag;

    (helper as Record<string, unknown>)[tag] = (source?: string): LiveTree => {
      const ix = consumeIndex();
      return createDetachedHtmlTag(tag, source, ix);
    };
  }

  // CHANGED: wire all svg direct helpers, including svg root
  for (const rawTag of SVG_TAGS) {
    const tag = rawTag as SvgTag;

    (helper as Record<string, unknown>)[tag] = (source?: string): SvgLiveTree => {
      const ix = consumeIndex();
      return createDetachedSvgTag(tag, source, ix);
    };
  }

  return helper as DetachedCreateHelper;
}
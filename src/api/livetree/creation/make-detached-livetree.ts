import { default_livetree_runtime, subject_for_tree } from "../runtime/livetree-runtime.js";
import { ensure_quid } from "../quid/data-quid.js";
import { dispose_node_deep } from "../utils/dispose-node.js";
// make-detached-livetree.ts

import { CREATE_NODE } from "../../../core/factories.js";
import { SVG_TAGS, HTML_TAGS } from "../../../core/all-html-tags.js";
import { TagName, SvgTag, HtmlTag, DetachedCreateHelper } from "../../../types/livetree.types.js";
import { HsonNode } from "../../../core/types.js";
import { SvgLiveTree } from "../../../types/svg.types.js";
import { create_staged_livetree_in_runtime, create_livetree } from "./create-livetree.js";
import { LiveTree } from "../livetree.js";
import { TreeSelector } from "./tree-selector.js";
import { prepare_public_html_branch, prepare_public_svg_branch } from "../methods/create/create-core.js";


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
      $_tag: "div",
      $_content: [],
    }) as HsonNode;

    return create_staged_livetree_in_runtime(node, default_livetree_runtime());
  }

  // CHANGED: central per-call html dispatch
  function createDetachedHtmlTag(tag: HtmlTag, source?: string): LiveTree {
    if (source === undefined) {
      return create_livetree(CREATE_NODE({ $_tag: tag, $_content: [] }));
    }
    return create_livetree(prepare_public_html_branch(tag, source, () => DOMParser));
  }

  // CHANGED: central per-call svg dispatch
  function createDetachedSvgTag(tag: SvgTag, source?: string): SvgLiveTree {
    if (source === undefined) {
      return create_livetree(CREATE_NODE({
        $_tag: tag,
        $_content: [],
        ...(tag === "svg" ? { $_attrs: { xmlns: "http://www.w3.org/2000/svg" } } : {}),
      })) as unknown as SvgLiveTree;
    }
    return create_livetree(prepare_public_svg_branch(tag, source, () => DOMParser)) as unknown as SvgLiveTree;
  }

  const helper: Partial<DetachedCreateHelper> & {
    prepend(): DetachedCreateHelper;
    at(index: number): DetachedCreateHelper;
  } = {
    // CHANGED: detached generic tag dispatcher
    tag(tag: TagName, source?: string): LiveTree {
      consumeIndex();

      if (SVG_TAGS.includes(tag as SvgTag)) {
        return createDetachedSvgTag(tag as SvgTag, source) as unknown as LiveTree;
      }

      return createDetachedHtmlTag(tag as HtmlTag, source);
    },

    // CHANGED: preserve existing detached tags() behavior (html host)
    tags(tags: TagName[]): TreeSelector {
      const ix = consumeIndex();
      const host = makeHtmlHost();
      const create = typeof ix === "number" ? host.create.at(ix) : host.create;
      try {
        const result = create.tags(tags);
        ensure_quid(subject_for_tree(host), undefined, default_livetree_runtime());
        return result;
      } catch (cause) {
        dispose_node_deep(subject_for_tree(host), default_livetree_runtime(), false);
        throw cause;
      }
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
      consumeIndex();
      return createDetachedHtmlTag(tag, source);
    };
  }

  // CHANGED: wire all svg direct helpers, including svg root
  for (const rawTag of SVG_TAGS) {
    const tag = rawTag as SvgTag;

    (helper as Record<string, unknown>)[tag] = (source?: string): SvgLiveTree => {
      consumeIndex();
      return createDetachedSvgTag(tag, source);
    };
  }

  return helper as DetachedCreateHelper;
}

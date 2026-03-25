import { HTML_TAGS, is_svg_context_tag, SVG_TAGS } from "../../../consts/html-tags.js";
import { hson } from "../../../hson.js";
import { HsonNode } from "../../../types/index.js";
import { TagName, HtmlTag, SvgTag, SvgLiveTree, HtmlCreateHelper, SvgCreateHelper } from "../../../types/livetree.types.js";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
import { create_livetree } from "../create-livetree.js";
import { make_tree_selector } from "../creation/make-tree-selector.js";
import { LiveTree } from "../livetree.js";
import { TreeSelector } from "../tree-selector.js";
import { assert_valid_tag_name } from "./create-node.js";

export type CreateNs = "html" | "svg";

type CreateCore = {
  setNextIndex: (index: number) => void;
  consumeIndex: () => number | undefined;
  createForTags: (tagOrTags: TagName | TagName[], index?: number) => LiveTree | TreeSelector;
  createSingleTag: (tag: TagName, index?: number) => LiveTree;
  createHtmlTagFromString: (expectedTag: HtmlTag, source: string, index?: number) => LiveTree;
  createSvgTagFromString: (expectedTag: SvgTag, source: string, index?: number) => SvgLiveTree;
};

export function inferCreateNs(tree: LiveTree, tag: string): CreateNs {
  if (is_svg_context_tag(tag)) return "svg";

  const ownTag = tree.node._tag; // or however you access canonical tag
  if (typeof ownTag === "string" && is_svg_context_tag(ownTag)) return "svg";

  return "html";
}
export function build_markup_stub(tag: string, ns: CreateNs): string {
  if (ns === "svg" && tag === "svg") {
    return `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
  }
  return `<${tag}></${tag}>`;
}

function make_create_core(tree: LiveTree): CreateCore {
  let nextIndex: number | undefined = undefined;

  const setNextIndex = (index: number): void => {
    nextIndex = index;
  };

  const consumeIndex = (): number | undefined => {
    const ix = nextIndex;
    nextIndex = undefined;
    return ix;
  };

  function createForTags(tagOrTags: TagName | TagName[], index?: number): LiveTree | TreeSelector {
    const tags: TagName[] = Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags];

    const created: LiveTree[] = [];
    let insertIx: number | undefined = index;

    for (const t of tags) {
      assert_valid_tag_name(t, "createForTags");

      const ns = inferCreateNs(tree, t);
      const markup = build_markup_stub(t, ns);
      const parsed = hson.fromTrustedHtml(markup).toHson().parse();
      const root0: HsonNode = Array.isArray(parsed) ? parsed[0] : parsed;

      const branch = create_livetree(root0);

      if (typeof insertIx === "number") tree.append(branch, insertIx);
      else tree.append(branch);

      const appended = unwrap_root_elem(root0);

      for (const child of appended) {
        const childTree = create_livetree(child);
        childTree.adoptRoots(tree.hostRootNode());
        created.push(childTree);
      }

      if (typeof insertIx === "number") insertIx += appended.length;
    }

    if (!Array.isArray(tagOrTags)) {
      if (!created.length) throw new Error("[LiveTree.create] no children created");
      return created[0];
    }

    return make_tree_selector(created);
  }

  function createSingleTag(tag: TagName, index?: number): LiveTree {
    return createForTags(tag, index) as LiveTree;
  }

  function createHtmlTagFromString(
    expectedTag: HtmlTag,
    source: string,
    index?: number,
  ): LiveTree {
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected non-empty markup string`,
      );
    }

    let parsed: HsonNode | HsonNode[];
    try {
      parsed = hson.fromTrustedHtml(source).toHson().parse();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[LiveTree.create.${expectedTag}] failed to parse markup: ${msg}`,
      );
    }

    const roots: HsonNode[] = Array.isArray(parsed) ? parsed : [parsed];
    const createdChildren = roots.flatMap((n) => unwrap_root_elem(n));

    if (createdChildren.length !== 1) {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
      );
    }

    const node = createdChildren[0];
    if (!node || node._tag !== expectedTag) {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
      );
    }

    const branch = create_livetree(node);

    if (typeof index === "number") tree.append(branch, index);
    else tree.append(branch);

    branch.adoptRoots(tree.hostRootNode());
    return branch;
  }

  function hasParserError(node: HsonNode): boolean {
    if (node._tag === "parsererror") return true;

    const kids = Array.isArray(node._content) ? node._content : [];
    for (const child of kids) {
      if (child && typeof child === "object" && "_tag" in child) {
        if (hasParserError(child as HsonNode)) return true;
      }
    }
    return false;
  }

  function createSvgTagFromString(
    expectedTag: SvgTag,
    source: string,
    index?: number,
  ): SvgLiveTree {
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected non-empty markup string`,
      );
    }

    let parsed: HsonNode | HsonNode[];
    try {
      parsed = hson.fromTrustedHtml(source).toHson().parse();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[LiveTree.create.${expectedTag}] failed to parse markup: ${msg}`,
      );
    }

    const roots: HsonNode[] = Array.isArray(parsed) ? parsed : [parsed];
    const createdChildren = roots.flatMap((n) => unwrap_root_elem(n));

    if (createdChildren.length !== 1) {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
      );
    }

    const node = createdChildren[0];
    if (!node || node._tag !== expectedTag) {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
      );
    }

    if (hasParserError(node)) {
      throw new Error(
        `[LiveTree.create.${expectedTag}] failed to parse markup: parsererror`,
      );
    }

    const branch = create_livetree(node);

    if (typeof index === "number") tree.append(branch, index);
    else tree.append(branch);

    branch.adoptRoots(tree.hostRootNode());
    return branch as unknown as SvgLiveTree;
  }

  return {
    setNextIndex,
    consumeIndex,
    createForTags,
    createSingleTag,
    createHtmlTagFromString,
    createSvgTagFromString,
  };
}

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

export function make_tree_create2(tree: LiveTree): HtmlCreateHelper {
  return make_html_tree_create(tree);
}
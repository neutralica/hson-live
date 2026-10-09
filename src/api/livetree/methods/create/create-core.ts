// create-core.ts

import { qualify_exact_hson_graph } from "../../../../internal/exact-node-qualification.js";
import { ELEM_TAG } from "../../../../core/constants.js";
import { is_svg_context_tag } from "../../../../core/all-html-tags.js";
import { parse_html } from "../../../transform/parsers/parse-html.js";
import { TagName, HtmlTag, SvgTag, HtmlCreateHelper } from "../../../../types/livetree.types.js";
import { SvgLiveTree } from "../../../../types/svg.types.js";
import { HsonNode } from "../../../../core/types.js";
import { admit_public_livetree_branch, admit_public_livetree_source } from "../../livetree.node-admission.js";
import { decode_public_svg_source, standalone_svg_source } from "../../../transform/utils/html-utils/decode-public-svg-source.js";
import { node_from_svg } from "../../../transform/utils/node-utils/node-from-svg.js";
import { is_Node } from "../../../../core/node-guards.js";
import { create_livetree_in_runtime } from "../../creation/create-livetree.js";
import {
  runtime_for_tree,
  active_subject_for_tree,
  inherit_tree_historic_root,
  subject_for_tree,
} from "../../runtime/livetree-runtime.js";
import { make_tree_selector } from "../../creation/make-tree-selector.js";
import { LiveTree } from "../../livetree.js";
import { TreeSelector } from "../../creation/tree-selector.js";
import { make_html_tree_create } from "./create-html.js";
import { CREATE_NODE } from "../../../../core/factories.js";
import { parent_for_node, release_subtree_ownership } from "../../lifecycle/graph-ownership.js";
import { dispose_node_deep } from "../../utils/dispose-node.js";

export type CreateNs = "html" | "svg";

type CreateCore = {
  setNextIndex: (index: number) => void;
  consumeIndex: () => number | undefined;
  createForTags: (tagOrTags: TagName | TagName[], index?: number) => LiveTree | TreeSelector;
  createSingleTag: (tag: TagName, index?: number) => LiveTree;
  createHtmlTagFromString: (expectedTag: HtmlTag, source: string, index?: number) => LiveTree;
  createSvgTagFromString: (expectedTag: SvgTag, source: string, index?: number) => SvgLiveTree;
};

function is_valid_tag_name(name: unknown): name is TagName {
  if (typeof name !== "string") return false;

  const t = name.trim();
  if (t.length === 0) return false;

  // reserve xml / XML / Xml...
  if (/^xml/i.test(t)) return false;

  // XML allows more Unicode than this; we are choosing a conservative subset.
  // Start: letter or underscore
  // Rest: letters/digits/underscore/dot/dash
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(t)) return false;

  // forbid ":"; no namespaces for now
  if (t.includes(":")) return false;

  return true;
}


/** Throws early with a clean message (prevents XML parser spam). */
export function assert_valid_tag_name(name: unknown, ctx?: string): asserts name is TagName {
  if (is_valid_tag_name(name)) return;
  const where = ctx ? ` (${ctx})` : "";
  throw new Error(`[LiveTree.create] invalid tag name${where}: ${String(name)}`);
}


export function inferCreateNs(tree: LiveTree, tag: string): CreateNs {
  if (is_svg_context_tag(tag)) return "svg";

  const ownTag = active_subject_for_tree(tree).$_tag; // or however you access canonical tag
  if (typeof ownTag === "string" && is_svg_context_tag(ownTag)) return "svg";

  return "html";
}

export function build_markup_stub(tag: string, ns: CreateNs): string {
  if (ns === "svg") {
    if (tag === "svg") {
      return `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg"><${tag}></${tag}></svg>`;
  }

  return `<${tag}></${tag}>`;
}

type DomParserConstructor = new () => DOMParser;

function parse_trusted_markup_to_hson(
  source: string,
  parserForTree: () => DomParserConstructor,
): HsonNode {
  if (standalone_svg_source(source)) {
    return node_from_svg(decode_public_svg_source(source, parserForTree(), "LiveTree.create"));
  }
  return parse_html(source);
}

export function make_create_core(tree: LiveTree): CreateCore {
  let nextIndex: number | undefined = undefined;

  const setNextIndex = (index: number): void => {
    nextIndex = index;
  };

  const consumeIndex = (): number | undefined => {
    const ix = nextIndex;
    nextIndex = undefined;
    return ix;
  };

  const parserForTree = (): DomParserConstructor => {
    const mapped = tree.dom.el();
    if (mapped !== undefined) {
      const Parser = mapped.ownerDocument.defaultView?.DOMParser;
      if (Parser === undefined) {
        throw new Error("[LiveTree.create] mapped DOM realm has no DOMParser");
      }
      return Parser;
    }
    if (typeof DOMParser !== "undefined") return DOMParser;
    throw new Error("[LiveTree.create] DOMParser is unavailable");
  };

  const attachPrivateBranch = <TBranch extends LiveTree>(
    branch: TBranch,
    index?: number,
  ): TBranch => {
    try {
      if (typeof index === "number") tree.append(branch, index);
      else tree.append(branch);
    } catch (cause) {
      // A branch that never entered the destination graph is still exclusively
      // owned by this factory and cannot be returned to the caller.
      const subject = subject_for_tree(branch);
      if (parent_for_node(subject) === undefined) {
        dispose_node_deep(subject, runtime_for_tree(branch));
        release_subtree_ownership(subject);
      }
      throw cause;
    }

    inherit_tree_historic_root(branch, tree);
    return branch;
  };

  function createForTags(tagOrTags: TagName | TagName[], index?: number): LiveTree | TreeSelector {
    const tags: TagName[] = Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags];

    const created: LiveTree[] = [];
    let insertIx: number | undefined = index;

    for (const t of tags) {
      assert_valid_tag_name(t, "createForTags");

      const ns = inferCreateNs(tree, t);
      const node = CREATE_NODE({
        $_tag: t,
        $_content: [],
        ...(ns === "svg" && t === "svg" ? { $_attrs: { xmlns: "http://www.w3.org/2000/svg" } } : {}),
      });
      const branch = create_livetree_in_runtime(node, runtime_for_tree(tree));

      created.push(attachPrivateBranch(branch, insertIx));

      if (typeof insertIx === "number") insertIx += 1;
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
    const node = prepare_public_html_branch(expectedTag, source, parserForTree);
    const branch = create_livetree_in_runtime(node, runtime_for_tree(tree));

    return attachPrivateBranch(branch, index);
  }

  function createSvgTagFromString(
    expectedTag: SvgTag,
    source: string,
    index?: number,
  ): SvgLiveTree {
    const node = prepare_public_svg_branch(expectedTag, source, parserForTree);
    const branch = create_livetree_in_runtime(node, runtime_for_tree(tree));

    return attachPrivateBranch(branch, index) as unknown as SvgLiveTree;
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

export function make_tree_create(tree: LiveTree): HtmlCreateHelper {
  return make_html_tree_create(tree);
}

function parse_svg_fragment_to_hson(source: string, Parser: DomParserConstructor): HsonNode {
  return node_from_svg(decode_public_svg_source(source, Parser, "LiveTree.create.svg"));
}

/** Source preparation precedes any owner construction, including detached creation. @internal */
export function prepare_public_html_branch(expectedTag: HtmlTag, source: string,
  parserForTree: () => DomParserConstructor): HsonNode {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error(
      `[LiveTree.create.${expectedTag}] expected non-empty markup string`,
    );
  }

  const node = admit_public_livetree_source(
    parse_trusted_markup_to_hson(source, parserForTree), `LiveTree.create.${expectedTag}`);
  if (node.$_tag !== expectedTag) {
    throw new Error(`[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`);
  }

  return node;
}

/** Public SVG fragment receiver; all wrapper contents are qualified before selection. @internal */
export function prepare_public_svg_branch(expectedTag: SvgTag, source: string,
  parserForTree: () => DomParserConstructor): HsonNode {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error(
      `[LiveTree.create.${expectedTag}] expected non-empty markup string`,
    );
  }

  const wrapped =
    expectedTag === "svg"
      ? source
      : `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`;

  const svgRoot = admit_public_livetree_branch(
    parse_svg_fragment_to_hson(wrapped, parserForTree()), `LiveTree.create.${expectedTag}`);
  qualify_exact_hson_graph(svgRoot, `LiveTree.create.${expectedTag}`, "branch", true);
  let node = svgRoot;
  if (expectedTag !== "svg") {
    const relationship = svgRoot.$_content[0];
    if (svgRoot.$_tag !== "svg" || svgRoot.$_content.length !== 1 || !is_Node(relationship)
      || relationship.$_tag !== ELEM_TAG || relationship.$_content.length !== 1
      || !is_Node(relationship.$_content[0])) {
      throw new Error(`[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`);
    }
    node = relationship.$_content[0];
  }
  if (node.$_tag !== expectedTag) {
    throw new Error(`[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`);
  }

  return node;
}

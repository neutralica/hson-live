import { hson } from "../../../hson.js";
import { HsonNode } from "../../../types/node.types.js";
import { CreateHelper, HtmlCreateHelper, HtmlTag, LiveTreeCreateHelper, SvgCreateHelper, SvgLiveTree, SvgTag, TagName, TreeSelectorCreateHelper } from "../../../types/livetree.types.js";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
import { LiveTree } from "../livetree.js";
import { make_tree_selector } from "../creation/make-tree-selector.js";
import { TreeSelector } from "../tree-selector.js";
import { HTML_TAGS, is_svg_context_tag, SVG_TAGS } from "../../../consts/html-tags.js";
import { create_livetree } from "../create-livetree.js";
import { StyleGetter } from "../managers/style-getter.js";

type CreateNs = "html" | "svg";

function inferCreateNs(tree: LiveTree, tag: string): CreateNs {
  if (is_svg_context_tag(tag)) return "svg";

  const ownTag = tree.node._tag; // or however you access canonical tag
  if (typeof ownTag === "string" && is_svg_context_tag(ownTag)) return "svg";

  return "html";
}
function build_markup_stub(tag: string, ns: CreateNs): string {
  if (ns === "svg" && tag === "svg") {
    return `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
  }
  return `<${tag}></${tag}>`;
}

function is_valid_tag_name(name: unknown): name is TagName {
  if (typeof name !== "string") return false;

  const t = name.trim();
  if (t.length === 0) return false;

  // reserve xml / XML / Xml...
  if (/^xml/i.test(t)) return false;

  // CHANGE: keep it simple & strict (works for your underscore tags)
  // XML allows more Unicode than this; we are choosing a conservative subset.
  // Start: letter or underscore
  // Rest: letters/digits/underscore/dot/dash
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(t)) return false;

  // CHANGE: forbid ":" unless you explicitly want namespaces
  if (t.includes(":")) return false;

  return true;
}

/** Throws early with a clean message (prevents XML parser spam). */
export function assert_valid_tag_name(name: unknown, ctx?: string): asserts name is TagName {
  if (is_valid_tag_name(name)) return;
  const where = ctx ? ` (${ctx})` : "";
  throw new Error(`[LiveTree.create] invalid tag name${where}: ${String(name)}`);
}

/**
 * Construct the `.create` helper for a single `LiveTree` instance.
 *
 * Semantics:
 * - New elements are created as *children* of `tree.node`.
 * - HSON nodes are produced via the canonical HTML → HSON pipeline:
 *   `hson.fromTrustedHtml(html).toHson().parse()`.
 * - Any `_elem` wrapper at the root is unwrapped via `unwrap_root_elem`,
 *   so created nodes are real element nodes, not virtual containers.
 * - For each call:
 *   - Per-tag methods (e.g. `tree.create.div(index?)`) create one or more
 *     element children and return a `LiveTree` anchored at the first new
 *     child created for that tag.
 *   - The batch form (`tree.create.tags([...], index?)`) creates children
 *     for each tag and returns a `TreeSelector` of all new children.
 *   - Fluent placement helpers (`prepend()`, `at(index)`) apply to the next
 *     per-tag call only; batch calls use their explicit `index` argument.
 *
 * Index semantics:
 * - `index` is interpreted as the insertion index in the current node's
 *   child list (after `_elem` unwrapping), consistent with your `append`
 *   behavior. When multiple tags are created in one call, the index is
 *   incremented by the number of children created so the next tag is
 *   inserted after the previous ones.
 *
 * @param tree - The `LiveTree` whose node will act as parent for all
 *               elements created via the helper.
 * @returns A `LiveTreeCreateHelper` bound to `tree`.
 */
export function make_tree_create(tree: LiveTree): HtmlCreateHelper {
  // CHANGED: placement config for *next* create call only
  let nextIndex: number | undefined = undefined;

  const consumeIndex = (): number | undefined => {
    const ix = nextIndex;
    nextIndex = undefined; // CHANGED: one-shot
    return ix;
  };


  function createForTags(tagOrTags: TagName | TagName[], index?: number): LiveTree | TreeSelector {
    const tags: TagName[] = Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags];

    const created: LiveTree[] = [];
    let insertIx: number | undefined = index;

    for (const t of tags) {
      // CHANGE: validate BEFORE generating any markup (prevents XML parser errors)
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

  const helper: Partial<HtmlCreateHelper> & {
    prepend(): HtmlCreateHelper;
    at(index: number): HtmlCreateHelper;
  } = {
    tags(tags: TagName[]): TreeSelector {
      return createForTags(tags, consumeIndex()) as TreeSelector;
    },

    prepend() {
      nextIndex = 0;
      return helper as HtmlCreateHelper;
    },

    at(index: number) {
      nextIndex = index;
      return helper as HtmlCreateHelper;
    },
  };
  function createSingleTag(tag: TagName, index?: number): LiveTree {
    return createForTags(tag, index) as LiveTree;
  }
  function createHtmlTagFromString(
    expectedTag: HtmlTag,
    source: string,
    index?: number,
  ): LiveTree {
    const parsed = hson.fromTrustedHtml(source).toHson().parse();
    const roots: HsonNode[] = Array.isArray(parsed) ? parsed : [parsed];

    // CHANGED: validate against actual created children, not parser wrappers
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

  function createSvgTagFromString(
    expectedTag: SvgTag,
    source: string,
    index?: number,
  ): SvgLiveTree {
    const parsed = hson.fromTrustedHtml(source).toHson().parse();
    const roots: HsonNode[] = Array.isArray(parsed) ? parsed : [parsed];

    // CHANGED: validate against the actual unwrapped created children,
    // not the parser wrapper/root node.
    const createdChildren = roots.flatMap((n) => unwrap_root_elem(n));

    if (createdChildren.length !== 1) {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`
      );
    }

    const node = createdChildren[0];
    if (!node || node._tag !== expectedTag) {
      throw new Error(
        `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`
      );
    }

    const branch = create_livetree(node);

    if (typeof index === "number") tree.append(branch, index);
    else tree.append(branch);

    branch.adoptRoots(tree.hostRootNode());
    return branch as unknown as SvgLiveTree;
  }

  for (const rawTag of HTML_TAGS) {
    const tag = rawTag as HtmlTag;
    if (tag === "svg") continue;

    (helper as any)[tag] = (source?: string): LiveTree => {
      const ix = consumeIndex();

      if (typeof source === "string") {
        return createHtmlTagFromString(tag, source, ix);
      }

      return createSingleTag(tag, ix);
    };
  }

  for (const rawTag of SVG_TAGS) {
    const tag = rawTag as TagName;
    if (tag === "svg") continue;

    (helper as any)[tag] = (arg?: number | string): SvgLiveTree => {
      const ix = typeof arg === "number" ? arg : consumeIndex();

      if (typeof arg === "string") {
        return createSvgTagFromString(tag as SvgTag, arg, ix);
      }

      return createSingleTag(tag, ix) as unknown as SvgLiveTree;
    };
  }
  (helper as any).svg = (source?: string): SvgLiveTree => {
    const ix = consumeIndex();

    if (typeof source === "string") {
      return createSvgTagFromString("svg", source, ix);
    }

    return createSingleTag("svg", ix) as unknown as SvgLiveTree;
  };

  return helper as HtmlCreateHelper;
}
/**
 * Construct the `.create` helper for a `TreeSelector`, providing the same
 * surface API as `LiveTree.create` but broadcasting across the selection.
 *
 * Semantics:
 * - For each `LiveTree` in `items`:
 *   - Forward to that tree's `.create` helper (e.g. `tree.create.div(index?)`).
 *   - Collect the returned `LiveTree`/`TreeSelector` handles for the newly
 *     created children.
 * - Flatten all created children into a single `TreeSelector` that becomes
 *   the result of each call.
 *
 * Index semantics:
 * - The optional `index` argument is currently reserved and ignored; each
 *   call appends to the end of each parent tree.
 *
 * @param items - The `LiveTree` instances comprising the selector.
 * @returns A `TreeSelectorCreateHelper` bound to those items.
 */
export function make_selector_create(items: LiveTree[]): TreeSelectorCreateHelper {
  const helper: TreeSelectorCreateHelper = {
    // Batch: selector.create.tags(["div","span"], index?)
    tags(tags: TagName[]): TreeSelector {
      const created: LiveTree[] = [];

      for (const tree of items) {
        // For each tree, delegate to its own create.tags()
        const childSelector = tree.create.tags(tags/* , index */); // omitted index until relevant
        created.push(...childSelector.toArray());
      }

      return make_tree_selector(created);
    },
  } as TreeSelectorCreateHelper;

  // Per-tag sugar: selector.create.div(index?), selector.create.span(index?), …
  for (const tag of HTML_TAGS) {
    (helper as any)[tag] = (index?: number): TreeSelector => {
      const created: LiveTree[] = [];

      for (const tree of items) {
        if (!can_create_tag_on_tree(tree, tag as TagName)) {
          throw new Error(
            `[TreeSelector.create.${String(tag)}] incompatible parent tag <${String(tree.node._tag)}>`
          );
        }

        const childTree = (tree.create as any)[tag](/* index */);
        created.push(childTree);
      }

      return make_tree_selector(created);
    };
  }

  return helper;
}
/* 
export function make_svg_create(tree: LiveTree): SvgCreateHelper {
  let nextIndex: number | undefined = undefined;

  const consumeIndex = (): number | undefined => {
    const ix = nextIndex;
    nextIndex = undefined;
    return ix;
  };

  function createForSvgTags(tagOrTags: SvgTag | SvgTag[], index?: number): SvgLiveTree | TreeSelector {
    const tags: SvgTag[] = Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags];

    const created: LiveTree[] = [];
    let insertIx: number | undefined = index;

    for (const t of tags) {
      assert_valid_tag_name(t, "createForSvgTags");

      const markup = build_markup_stub(t, "svg");
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
      if (!created.length) throw new Error("[LiveTree.create(svg)] no children created");
      return created[0] as SvgLiveTree;
    }

    return make_tree_selector(created);
  }

  const helper: Partial<SvgCreateHelper> & {
    prepend(): SvgCreateHelper;
    at(index: number): SvgCreateHelper;
  } = {
    tags(tags: TagName[], index?: number): TreeSelector {
      return createForSvgTags(tags as SvgTag[], index) as TreeSelector;
    },

    prepend() {
      nextIndex = 0;
      return helper as SvgCreateHelper;
    },

    at(index: number) {
      nextIndex = index;
      return helper as SvgCreateHelper;
    },
  };

  for (const rawTag of SVG_TAGS) {
    const tag = rawTag as SvgTag;
    if (tag === "svg") continue;

    (helper as any)[tag] = (index?: number): SvgLiveTree => {
      const ix = typeof index === "number" ? index : consumeIndex();
      return createForSvgTags(tag, ix) as SvgLiveTree;
    };
  }

  (helper as any).svg = (source?: string): SvgLiveTree => {
    const ix = consumeIndex();

    if (typeof source === "string") {
      const parsed = hson.fromTrustedHtml(source).toHson().parse();
      const root0: HsonNode = Array.isArray(parsed) ? parsed[0] : parsed;

      if (!root0 || root0._tag !== "svg") {
        throw new Error(`[LiveTree.create.svg] expected exactly one <svg> root`);
      }

      const branch = create_livetree(root0);

      if (typeof ix === "number") tree.append(branch, ix);
      else tree.append(branch);

      const appended = unwrap_root_elem(root0);
      if (!appended.length) {
        throw new Error(`[LiveTree.create.svg] no svg root created`);
      }

      const out = create_livetree(appended[0]);
      out.adoptRoots(tree.hostRootNode());
      return out as SvgLiveTree;
    }

    return createForSvgTags("svg", ix) as SvgLiveTree;
  };

  return helper as SvgCreateHelper;
}
*/
function can_create_tag_on_tree(tree: LiveTree, tag: TagName): boolean {
  const parentTag = String(tree.node._tag);
  const parentIsSvg = is_svg_context_tag(parentTag);
  const childIsSvg = is_svg_context_tag(String(tag));

  if (parentIsSvg) {
    return childIsSvg;
  }

  // HTML context may create HTML tags, and may also create svg roots
  return !childIsSvg || tag === "svg";
} 
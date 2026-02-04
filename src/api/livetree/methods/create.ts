import { hson } from "../../../hson";
import { HsonNode } from "../../../types/node.types";
import { CreateHelper, LiveTreeCreateHelper, TagName, TreeSelectorCreateHelper } from "../../../types/livetree.types";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem";
import { LiveTree } from "../livetree";
import { make_tree_selector } from "../creation/make-tree-selector";
import { TreeSelector } from "../tree-selector";
import { HTML_TAGS } from "../../../consts/html-tags";
import { create_livetree } from "../create-livetree";

export function is_valid_tag_name(name: unknown): name is TagName {
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
export function make_tree_create(tree: LiveTree): LiveTreeCreateHelper {
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

      const html = `<${t}></${t}>`;

      const parsed = hson.fromTrustedHtml(html).toHson().parse();
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

  const helper: Partial<CreateHelper<LiveTree, TreeSelector>> & {
    prepend(): CreateHelper<LiveTree, TreeSelector>;
    at(index: number): CreateHelper<LiveTree, TreeSelector>;
  } = {
    tags(tags: TagName[], index?: number): TreeSelector {
      return createForTags(tags, index) as TreeSelector;
    },

    prepend() {
      nextIndex = 0;
      return helper as CreateHelper<LiveTree, TreeSelector>;
    },

    at(index: number) {
      nextIndex = index;
      return helper as CreateHelper<LiveTree, TreeSelector>;
    },
  };

  for (const tag of HTML_TAGS) {
    (helper as any)[tag] = (index?: number): LiveTree => {
      const ix = typeof index === "number" ? index : consumeIndex();
      return createForTags(tag, ix) as LiveTree;
    };
  }

  return helper as CreateHelper<LiveTree, TreeSelector>;
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
    tags(tags: TagName[], index?: number): TreeSelector {
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
        const childTree = tree.create[tag](/* index */);
        created.push(childTree);
      }

      return make_tree_selector(created);
    };
  }

  return helper;
}

// import { hson } from "../../../hson.js";
// import { HsonNode } from "../../../types/node.types.js";
// import { CreateHelper, HtmlCreateHelper, HtmlTag, LiveTreeCreateHelper, SvgCreateHelper, SvgLiveTree, SvgTag, TagName, TreeSelectorCreateHelper } from "../../../types/livetree.types.js";
// import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
// import { LiveTree } from "../livetree.js";
// import { make_tree_selector } from "../creation/make-tree-selector.js";
// import { TreeSelector } from "../tree-selector.js";
// import { HTML_TAGS, is_svg_context_tag, SVG_TAGS } from "../../../consts/html-tags.js";
// import { create_livetree } from "../create-livetree.js";
// import { StyleGetter } from "../managers/style-getter.js";
// import { CreateNs } from "./create2.js";


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
// export function make_tree_create(tree: LiveTree): HtmlCreateHelper {
//   // CHANGED: placement config for *next* create call only
//   let nextIndex: number | undefined = undefined;

//   const consumeIndex = (): number | undefined => {
//     const ix = nextIndex;
//     nextIndex = undefined; // CHANGED: one-shot
//     return ix;
//   };


//   function createForTags(tagOrTags: TagName | TagName[], index?: number): LiveTree | TreeSelector {
//     const tags: TagName[] = Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags];

//     const created: LiveTree[] = [];
//     let insertIx: number | undefined = index;

//     for (const t of tags) {
//       // CHANGE: validate BEFORE generating any markup (prevents XML parser errors)
//       assert_valid_tag_name(t, "createForTags");
//       const ns = inferCreateNs(tree, t);
//       const markup = build_markup_stub(t, ns);
//       const parsed = hson.fromTrustedHtml(markup).toHson().parse();
//       const root0: HsonNode = Array.isArray(parsed) ? parsed[0] : parsed;

//       const branch = create_livetree(root0);

//       if (typeof insertIx === "number") tree.append(branch, insertIx);
//       else tree.append(branch);

//       const appended = unwrap_root_elem(root0);

//       for (const child of appended) {
//         const childTree = create_livetree(child);
//         childTree.adoptRoots(tree.hostRootNode());
//         created.push(childTree);
//       }

//       if (typeof insertIx === "number") insertIx += appended.length;
//     }

//     if (!Array.isArray(tagOrTags)) {
//       if (!created.length) throw new Error("[LiveTree.create] no children created");
//       return created[0];
//     }

//     return make_tree_selector(created);
//   }

//   const helper: Partial<HtmlCreateHelper> & {
//     prepend(): HtmlCreateHelper;
//     at(index: number): HtmlCreateHelper;
//   } = {
//     tag(tag: TagName, source?: string): LiveTree {
//       const ix = consumeIndex();

//       // CHANGED: validate dynamic tag before doing anything
//       assert_valid_tag_name(tag, "create.tag");

//       if (typeof source === "string") {
//         if (tag === "svg") {
//           return createSvgTagFromString("svg", source, ix) as unknown as LiveTree;
//         }

//         if (SVG_TAGS.includes(tag as SvgTag)) {
//           return createSvgTagFromString(tag as SvgTag, source, ix) as unknown as LiveTree;
//         }

//         return createHtmlTagFromString(tag as HtmlTag, source, ix);
//       }

//       return createSingleTag(tag, ix);
//     },

//     tags(tags: TagName[]): TreeSelector {
//       return createForTags(tags, consumeIndex()) as TreeSelector;
//     },

//     prepend() {
//       nextIndex = 0;
//       return helper as HtmlCreateHelper;
//     },

//     at(index: number) {
//       nextIndex = index;
//       return helper as HtmlCreateHelper;
//     },
//   };

//   function createSingleTag(tag: TagName, index?: number): LiveTree {
//     return createForTags(tag, index) as LiveTree;
//   }
//   function createHtmlTagFromString(
//     expectedTag: HtmlTag,
//     source: string,
//     index?: number,
//   ): LiveTree {
//     if (typeof source !== "string" || source.trim() === "") {
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] expected non-empty markup string`,
//       );
//     }

//     let parsed: HsonNode | HsonNode[];
//     try {
//       parsed = hson.fromTrustedHtml(source).toHson().parse();
//     } catch (err) {
//       const msg = err instanceof Error ? err.message : String(err);
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] failed to parse markup: ${msg}`,
//       );
//     }

//     const roots: HsonNode[] = Array.isArray(parsed) ? parsed : [parsed];
//     const createdChildren = roots.flatMap((n) => unwrap_root_elem(n));

//     if (createdChildren.length !== 1) {
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
//       );
//     }

//     const node = createdChildren[0];
//     if (!node || node._tag !== expectedTag) {
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
//       );
//     }

//     const branch = create_livetree(node);

//     if (typeof index === "number") tree.append(branch, index);
//     else tree.append(branch);

//     branch.adoptRoots(tree.hostRootNode());
//     return branch;
//   }
//   function hasParserError(node: HsonNode): boolean {
//     if (node._tag === "parsererror") return true;

//     const kids = Array.isArray(node._content) ? node._content : [];
//     for (const child of kids) {
//       if (child && typeof child === "object" && "_tag" in child) {
//         if (hasParserError(child as HsonNode)) return true;
//       }
//     }
//     return false;
//   }
//   function createSvgTagFromString(
//     expectedTag: SvgTag,
//     source: string,
//     index?: number,
//   ): SvgLiveTree {

//     if (typeof source !== "string" || source.trim() === "") {
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] expected non-empty markup string`,
//       );
//     }

//     let parsed: HsonNode | HsonNode[];
//     try {
//       parsed = hson.fromTrustedHtml(source).toHson().parse();
//     } catch (err) {
//       const msg = err instanceof Error ? err.message : String(err);
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] failed to parse markup: ${msg}`,
//       );
//     }

//     const roots: HsonNode[] = Array.isArray(parsed) ? parsed : [parsed];
//     const createdChildren = roots.flatMap((n) => unwrap_root_elem(n));

//     if (createdChildren.length !== 1) {
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
//       );
//     }

//     const node = createdChildren[0];
//     if (!node || node._tag !== expectedTag) {
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`,
//       );
//     }
//     if (hasParserError(node)) {
//       throw new Error(
//         `[LiveTree.create.${expectedTag}] failed to parse markup: parsererror`
//       );
//     }
//     const branch = create_livetree(node);

//     if (typeof index === "number") tree.append(branch, index);
//     else tree.append(branch);

//     branch.adoptRoots(tree.hostRootNode());
//     return branch as unknown as SvgLiveTree;
//   }

//   for (const rawTag of HTML_TAGS) {
//     const tag = rawTag as HtmlTag;
//     if (tag === "svg") continue;

//     (helper as any)[tag] = (source?: string): LiveTree => {
//       const ix = consumeIndex();

//       if (typeof source === "string") {
//         return createHtmlTagFromString(tag, source, ix);
//       }

//       return createSingleTag(tag, ix);
//     };
//   }

//   for (const rawTag of SVG_TAGS) {
//     const tag = rawTag as TagName;
//     if (tag === "svg") continue;

//     (helper as any)[tag] = (arg?: number | string): SvgLiveTree => {
//       const ix = typeof arg === "number" ? arg : consumeIndex();

//       if (typeof arg === "string") {
//         return createSvgTagFromString(tag as SvgTag, arg, ix);
//       }

//       return createSingleTag(tag, ix) as unknown as SvgLiveTree;
//     };
//   }
//   (helper as any).svg = (source?: string): SvgLiveTree => {
//     const ix = consumeIndex();

//     if (typeof source === "string") {
//       return createSvgTagFromString("svg", source, ix);
//     }

//     return createSingleTag("svg", ix) as unknown as SvgLiveTree;
//   };

//   return helper as HtmlCreateHelper;
// }

import { construct_source_1 } from "./api/constructors/construct-source-1.js";
import type { GraftConstructor, OutputConstructor_2 } from "./types/constructor.types.js";
import type { HsonNode } from "./types/node.types.js";
import type { JsonValue } from "./types/core.types.js";
import { LiveTree } from "./api/livetree/livetree.js";
import { make_branch_from_node } from "./api/livetree/creation/create-branch.js";
import { graft } from "./api/livetree/creation/graft.js";
import { make_detached_livetree_create } from "./api/constructors/make-detached-livetree.js";


(globalThis as any)._test_ON = () => { (globalThis as any).test = true; location.reload(); };
(globalThis as any)._test_OFF = () => { (globalThis as any).test = false; location.reload(); };
const SAFE_SOURCE = construct_source_1({ unsafe: false });
const UNSAFE_SOURCE = construct_source_1({ unsafe: true });

/**
 * Public entrypoint for hson-live.
 *
 * The API is split into two layers:
 * - transformer constructors (`fromTrustedHtml`, `fromUntrustedHtml`,
 *   `fromJson`, `fromHson`, `fromNode`) which return the serialization /
 *   parse pipeline
 * - LiveTree, which constructs or grafts LiveTree instances directly
 *
 * Use the transformer pipeline when the goal is data or a data string.
 * Use `hson.liveTree.*` to create a mutable LiveTree interface.
 */
export const hson = {
  /**
   * Parse untrusted HTML or an existing `Element` into a detached LiveTree.
   *
   * HTML is sanitized before conversion. The returned tree is detached and
   * does not mutate the live DOM by itself.
   */
  fromUntrustedHtml(input: string | Element): OutputConstructor_2 {
    return SAFE_SOURCE.fromHtml(input, { sanitize: true });
  },

  /**
   * Parse trusted HTML or an existing `Element` into a detached LiveTree.
   *
   * No sanitization is applied. The returned tree is off-DOM until it is
   * appended or otherwise grafted into a mounted tree.
   */

  fromTrustedHtml(input: string | Element): OutputConstructor_2 {
    return UNSAFE_SOURCE.fromHtml(input, { sanitize: false });
  },

  fromJson(input: string | JsonValue): OutputConstructor_2 {
    return UNSAFE_SOURCE.fromJson(input);
  },

  fromHson(input: string): OutputConstructor_2 {
    return UNSAFE_SOURCE.fromHson(input);
  },

  fromNode(node: HsonNode): OutputConstructor_2 {
    return UNSAFE_SOURCE.fromNode(node);
  },

  /**
   * Direct LiveTree construction API.
   *
   * These methods bypass the transformer finalization chain and return either:
   * - detached LiveTree branches (`fromTrustedHtml`, `fromJson`, etc.),
   * - `graft()` handles for existing DOM targets (`queryDom`, `queryBody`),
   * - or detached creation helpers via `create`.
   *
   * This is the current public construction surface for LiveTree.
   * Detached branches are created off-DOM; grafting is explicit.
   */

  liveTree: {
    /* see docs above */
    fromUntrustedHtml(input: string | Element): LiveTree {
      const out = SAFE_SOURCE.fromHtml(input, { sanitize: true });
      return make_branch_from_node(out.toHson().parse());
    },

    fromTrustedHtml(input: string | Element): LiveTree {
      const out = UNSAFE_SOURCE.fromHtml(input, { sanitize: false });
      return make_branch_from_node(out.toHson().parse());
    },

    fromJson(input: string | JsonValue): LiveTree {
      const out = UNSAFE_SOURCE.fromJson(input);
      return make_branch_from_node(out.toHson().parse());
    },

    fromHson(input: string): LiveTree {
      const out = UNSAFE_SOURCE.fromHson(input);
      return make_branch_from_node(out.toHson().parse());
    },

    fromNode(node: HsonNode): LiveTree {
      return make_branch_from_node(node);
    },

    /**
     * Create a graft handle for an existing DOM subtree selected by CSS selector.
     *
     * Call `.graft()` to parse that subtree into HSON, re-project it as a
     * managed LiveTree, and return the controlling tree.
     */

    queryDom(selector: string): GraftConstructor {
      return {
        graft(): LiveTree {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) {
            throw new Error(`hson.liveTree.queryDom: selector "${selector}" not found.`);
          }
          return graft(element, { unsafe: false });
        },
      };
    },

    /**
     * Convenience graft handle for `document.body`.
     *
     * Call `.graft()` to replace the current body subtree with an equivalent
     * LiveTree-managed projection and return the controlling tree.
     */
    queryBody(): GraftConstructor {
      return {
        graft(): LiveTree {
          const element = document.body;
          if (!element) {
            throw new Error("hson.liveTree.queryBody: document.body is not available.");
          }
          return graft(element, { unsafe: false });
        },
      };
    },

    /**
     * Detached node-creation helper.
     *
     * Use this to create off-DOM LiveTree nodes directly without a parent tree. Supports HTML and SVG tag helpers plus
     * insertion-position helpers such as `.prepend()` and `.at(index)`.
     */
    create: make_detached_livetree_create(),
  },
};

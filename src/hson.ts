
import { construct_source_1 } from "./api/constructors/construct-source-1.js";
import {  DomQueryLiveTreeConstructor, GraftConstructor, OutputConstructor_2 } from "./types/constructor.types.js";
import { DomQuerySourceConstructor } from "./types/constructor.types.js";
import { HsonNode } from "./types/node.types.js";
import { JsonValue } from "./types/core.types.js";
import { LiveTree } from "./api/livetree/livetree.js";
import { construct_tree } from "./api/constructors/construct-tree.js";
import { make_branch_from_node } from "./api/livetree/creation/create-branch.js";
import { graft } from "./api/livetree/creation/graft.js";
import { make_detached_livetree_create } from "./api/constructors/make-detached-livetree.js";


(globalThis as any)._test_ON = () => { (globalThis as any).test = true; location.reload(); };
(globalThis as any)._test_OFF = () => { (globalThis as any).test = false; location.reload(); };
const SAFE_SOURCE = construct_source_1({ unsafe: false });
const UNSAFE_SOURCE = construct_source_1({ unsafe: true });

export const hson = {
  fromUntrustedHtml(input: string | Element): OutputConstructor_2 {
    return SAFE_SOURCE.fromHtml(input, { sanitize: true });
  },

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

  liveTree: {
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

    create: make_detached_livetree_create(), // placeholder for your existing/new detached factory
  },
};
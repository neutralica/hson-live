import type { GraftConstructor } from "../../types/constructor.types.js";
import type { JsonValue } from "../../core/types.js";
import type { HsonNode } from "../../types/node.types.js";
import { UNSAFE_TRANSFORM_SOURCE } from "../transform/transform.browser.js";
import { parse_external_html } from "../transform/parsers/parse-external-html.transform.js";
import { create_livetree, create_livetree_in_runtime } from "./creation/create-livetree.js";
import { admit_public_livetree_source } from "./livetree.node-admission.js";
import { graft } from "./creation/graft.js";
import { make_detached_livetree_create } from "./creation/make-detached-livetree.js";
import { LiveTree } from "./livetree.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { create_livetree_runtime } from "./runtime/livetree-runtime.js";

type LiveTreeConstructionOptions = Readonly<{ isolated?: boolean }>;

/** Canonical browser-oriented LiveTree construction facade. */
export const hsonLiveTree = Object.freeze({
  fromUntrustedHtml(input: string | Element): LiveTree {
    return create_livetree(admit_public_livetree_source(
      parse_external_html(typeof input === "string" ? input : input.outerHTML), "LiveTree.fromUntrustedHtml"));
  },
  fromTrustedHtml(input: string | Element): LiveTree {
    return create_livetree(admit_public_livetree_source(
      UNSAFE_TRANSFORM_SOURCE.fromHtml(input).toNode(), "LiveTree.fromTrustedHtml"));
  },
  fromJson(input: string | JsonValue): LiveTree {
    return create_livetree(admit_public_livetree_source(
      UNSAFE_TRANSFORM_SOURCE.fromJson(input).toNode(), "LiveTree.fromJson"));
  },
  fromHson(input: string, options?: LiveTreeConstructionOptions): LiveTree {
    const branch = admit_public_livetree_source(parse_hson(input), "LiveTree.fromHson");
    return options?.isolated ? create_livetree_in_runtime(branch, create_livetree_runtime()) : create_livetree(branch);
  },
  fromNode(node: HsonNode, options?: LiveTreeConstructionOptions): LiveTree {
    const branch = admit_public_livetree_source(node, "LiveTree.fromNode");
    return options?.isolated ? create_livetree_in_runtime(branch, create_livetree_runtime()) : create_livetree(branch);
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
  create: make_detached_livetree_create(),
});

// create-branch.ts

import { HsonNode } from "../../../core/types.js";
import { unwrap_root_elem } from "../../transform/utils/html-utils/unwrap-root-elem.js";
import { _throw_transform_err } from "../../transform/utils/sys-utils/throw-transform-err.utils.js";
import { project_livetree } from "./project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { create_livetree, create_livetree_in_runtime } from "./create-livetree.js";
import { scan_ingested_hson_node_quids } from "../../transform/utils/hson-utils/quid-ingress.js";
import type { LiveTreeRuntime } from "../runtime/livetree-runtime.js";
import { normalize_hson_array_index_order } from "../../../core/hson-array-indexes.js";

/**
 * Normalize a parsed HSON root into a detached `LiveTree` branch.
 *
 * Structural wrapper nodes such as `_hson_root` and `_hson_elem` are unwrapped first so
 * the returned tree always points at one concrete branch root. Exactly one
 * concrete root element must remain after unwrapping.
 *
 * This is the detached-branch path used by `hson.liveTree.from*` entrypoints.
 * It does not graft into the existing live DOM.
 *
 * @param rootNode - Raw HSON root to validate and normalize.
 * @param opts - Internal proof that an immediately preceding parser or clone
 *               boundary already completed canonical QUID graph validation.
 * @returns A detached `LiveTree` rooted at the unwrapped concrete node.
 */
export function make_branch_from_node(
  rootNode: HsonNode,
  opts?: { quidGraphValidated?: boolean; runtime?: LiveTreeRuntime },
): LiveTree {
  const normalizedRoot = normalize_hson_array_index_order(
    rootNode,
    "createBranchFromNode",
  );
  if (!opts?.quidGraphValidated) {
    scan_ingested_hson_node_quids(normalizedRoot, "createBranchFromNode");
  }
  const unwrapped = unwrap_root_elem(normalizedRoot);
  if (unwrapped.length === 0) {
    console.warn("createBranchFromNode: nothing to unwrap; falling back to rootNode");
    unwrapped.push(normalizedRoot);
  }
  if (unwrapped.length !== 1) {
    _throw_transform_err(
      `createBranchFromNode: expected exactly 1 root for LiveTree.asBranch(), got ${unwrapped.length}`,
      "createBranchFromNode",
    );
  }

  const actualRoot = unwrapped[0];
  return opts?.runtime === undefined
    ? create_livetree(actualRoot)
    : create_livetree_in_runtime(actualRoot, opts.runtime);

}

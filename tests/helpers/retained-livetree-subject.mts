import type { HsonNode } from "../../src/core/types.ts";
import { subject_for_tree, historic_root_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";

// Confined test access for exact identity, mounted fixtures and deliberate
// corruption. Public semantic assertions should continue using observations.
export function retained_subject(tree: object): HsonNode;
export function retained_subject(tree: object | undefined): HsonNode | undefined;
export function retained_subject(tree: object | undefined): HsonNode | undefined {
  return tree === undefined ? undefined : subject_for_tree(tree);
}
export const retained_historic_root = historic_root_for_tree;

import { materialize_owned_graph } from "./runtime/materialize-occurrences.js";
import { ELEM_TAG, ROOT_TAG } from "../../core/constants.js";
import { _throw_transform_err } from "../../core/errors.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import { capture_exact_hson_graph, qualify_exact_hson_graph } from "../../internal/exact-node-qualification.js";

/** Newly supplied public raw branches become private mutable runtime material.
 * Structural qualification conveys no runtime identity authority. */
export function admit_public_livetree_branch(input: unknown, operation: string): HsonNode {
  const node = capture_exact_hson_graph(input, operation, true);
  qualify_exact_hson_graph(node, operation, "runtime-branch", true);
  return materialize_owned_graph(node);
}

/** Public source selection proves the entire carrier before extracting its
 * sole branch. No filtering, ordering repair or first-child fallback occurs. */
export function admit_public_livetree_source(input: unknown, operation: string): HsonNode {
  const source = capture_exact_hson_graph(input, operation, true);
  if (source.$_tag !== ROOT_TAG) {
    qualify_exact_hson_graph(source, operation, "runtime-branch", true);
    return materialize_owned_graph(source);
  }
  qualify_exact_hson_graph(source, operation, "document-source", true);
  const relationship = source.$_content[0];
  const branch = is_Node(relationship) ? relationship.$_content[0] : undefined;
  if (source.$_content.length !== 1 || !is_Node(relationship) || relationship.$_tag !== ELEM_TAG
    || relationship.$_content.length !== 1 || !is_Node(branch)) {
    return _throw_transform_err("LiveTree source requires exactly one named branch in its ROOT/ELEM carrier", operation,
      undefined, undefined, { code: "HSON_CANONICAL_INVARIANT_VIOLATION", stage: "source-admission", path: "$" });
  }
  qualify_exact_hson_graph(branch, operation, "runtime-branch", true);
  return materialize_owned_graph(branch);
}

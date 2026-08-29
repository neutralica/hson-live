import { ARR_TAG, ELEM_TAG, EVERY_VSN, OBJ_TAG, STR_TAG, VAL_TAG } from "./constants.js";
import { is_Node } from "./node-guards.js";
import type { HsonNode } from "./types.js";

export type OrdinaryHsonStructure =
  | Readonly<{ kind: "empty-element" }>
  | Readonly<{ kind: "legacy-empty-element-wrapper"; cluster: HsonNode }>
  | Readonly<{ kind: "element"; cluster: HsonNode }>
  | Readonly<{ kind: "object"; cluster: HsonNode }>
  | Readonly<{ kind: "object-scalar"; cluster: HsonNode }>
  | Readonly<{ kind: "array"; cluster: HsonNode }>
  | Readonly<{ kind: "invalid"; reason: string }>;

/**
 * Classify the structural relationship retained by one ordinary Hson node.
 *
 * This is deliberately shallow: descendants are validated by the invariant
 * walker in their parent branch. The classifier never mutates, normalizes, or
 * infers structure from names, attributes, metadata, or source spelling.
 */
export function classify_ordinary_hson_structure(node: HsonNode): OrdinaryHsonStructure {
  if (EVERY_VSN.includes(node.$_tag)) {
    return { kind: "invalid", reason: "structural classification requires an ordinary node" };
  }

  const content = node.$_content;
  if (content.length === 0) return { kind: "empty-element" };
  if (content.length !== 1 || !is_Node(content[0])) {
    return {
      kind: "invalid",
      reason: "ordinary node must contain no content or exactly one structural wrapper",
    };
  }

  const cluster = content[0];
  if (cluster.$_tag === STR_TAG || cluster.$_tag === VAL_TAG) {
    return { kind: "object-scalar", cluster };
  }
  if (cluster.$_tag === ELEM_TAG) {
    return cluster.$_content.length === 0
      ? { kind: "legacy-empty-element-wrapper", cluster }
      : { kind: "element", cluster };
  }
  if (cluster.$_tag === OBJ_TAG) return { kind: "object", cluster };
  if (cluster.$_tag === ARR_TAG) return { kind: "array", cluster };
  return {
    kind: "invalid",
    reason: `ordinary node content must be ${ELEM_TAG}, ${OBJ_TAG}, or ${ARR_TAG}`,
  };
}

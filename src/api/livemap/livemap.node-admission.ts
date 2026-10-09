import { ARR_TAG, ELEM_TAG, OBJ_TAG, ROOT_TAG, STR_TAG, VAL_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import {
  capture_exact_hson_graph,
  qualify_exact_hson_graph,
  type ExactHsonRole,
} from "../../internal/exact-node-qualification.js";

type Family = "data" | "document";

function root_role(root: HsonNode, family?: Family): ExactHsonRole {
  if (family === "data") return "data-root";
  if (family === "document") return "document-source";
  const first = root.$_content[0];
  return root.$_tag === OBJ_TAG || root.$_tag === ARR_TAG
    || (root.$_tag === ROOT_TAG && is_Node(first) && (first.$_tag === OBJ_TAG || first.$_tag === ARR_TAG))
    ? "data-root" : "document-source";
}

/** Public raw ownership: exact storage, contextual roles, and no QUID claims. */
export function admit_public_livemap_root(input: unknown, family: Family, operation: string): HsonNode {
  const root = capture_exact_hson_graph(input, operation, true);
  qualify_exact_hson_graph(root, operation, root_role(root, family), true);
  return root;
}

/** Structural proof only. The calling owner still supplies identity authority. */
export function admit_owned_livemap_root(input: unknown, family?: Family, operation = "LiveMap.root"): HsonNode {
  const root = capture_exact_hson_graph(input, operation, false);
  qualify_exact_hson_graph(root, operation, root_role(root, family), true);
  return root;
}

/** Qualify a private node in an existing document content receiver. */
export function qualify_livemap_content(node: HsonNode, endpoint: HsonNode, operation: string, rootCarrier: boolean): void {
  const role: ExactHsonRole = endpoint.$_tag === ELEM_TAG || endpoint.$_tag === ROOT_TAG
    ? rootCarrier && endpoint.$_tag === ROOT_TAG && node.$_tag === ELEM_TAG ? "element-content" : "document-item"
    : "element-content";
  qualify_exact_hson_graph(node, operation, role, true);
}

/** Before reconciliation/publication, qualify an already private document candidate. */
export function qualify_livemap_document(root: HsonNode, operation: string): void {
  qualify_exact_hson_graph(root, operation, "document-root", true);
}

/** Primitive slot construction is explicit, never a node relationship repair. */
export function is_livemap_primitive_slot(endpoint: HsonNode, value: unknown): boolean {
  if (endpoint.$_tag === STR_TAG) return typeof value === "string";
  if (endpoint.$_tag === VAL_TAG) return value === null || typeof value === "boolean"
    || typeof value === "number" && Number.isFinite(value);
  return (endpoint.$_tag === ROOT_TAG || endpoint.$_tag === ELEM_TAG) && typeof value === "string";
}

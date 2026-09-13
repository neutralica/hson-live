import type { HsonNode, Primitive } from "../../../core/types.js";
import { is_Node, is_ordinary_element_node } from "../../../core/node-guards.js";
import { ensure_quid, register_supplied_livetree_quid } from "../quid/data-quid.js";
import {
  default_livetree_runtime,
  notify_livetree_realizations_internal,
  register_runtime_document,
  runtime_for_node,
  type LiveTreeRuntime,
} from "../runtime/livetree-runtime.js";
import { document_binding_for_node } from "../lifecycle/document-binding-state.js";
import { record_livetree_materialization } from "../debug/materialization-profile.js";
import {
  materialize_browser_realization,
  type BrowserProjectionIdentityAuthority,
} from "../../../internal/browser-realization/browser-realization-dom.js";
import { plan_browser_realization, type BrowserNamespace } from "../../../internal/browser-realization/browser-realization-plan.js";

/** Materialize canonical state through the shared browser-realization plan. */
export function project_livetree(
  node: HsonNode | Primitive,
  parentNs: BrowserNamespace = "html",
  runtime: LiveTreeRuntime = is_Node(node)
    ? runtime_for_node(node) ?? default_livetree_runtime()
    : default_livetree_runtime(),
  ownerDocument: Document = document,
): Node {
  const identityAuthority: BrowserProjectionIdentityAuthority = is_Node(node)
    && subtree_has_document_binding(node)
    ? "linked"
    : "standalone";
  return project_with_authority(node, parentNs, runtime, ownerDocument, identityAuthority);
}

/** Project one Reflection-owned subtree without minting missing QUIDs. @internal */
export function project_linked_livetree(
  node: HsonNode | Primitive,
  parentNs: BrowserNamespace,
  runtime: LiveTreeRuntime,
  ownerDocument: Document,
): Node {
  return project_with_authority(node, parentNs, runtime, ownerDocument, "linked");
}

function project_with_authority(
  node: HsonNode | Primitive,
  parentNs: BrowserNamespace,
  runtime: LiveTreeRuntime,
  ownerDocument: Document,
  identityAuthority: BrowserProjectionIdentityAuthority,
): Node {
  register_runtime_document(runtime, ownerDocument);
  if (is_Node(node)) admit_projection_identities(node, runtime, identityAuthority);
  const plan = plan_browser_realization(node, { parentNamespace: parentNs, capability: "dom" });
  record_livetree_materialization("domProjectionCalls");
  const projected = materialize_browser_realization(plan, runtime, ownerDocument, identityAuthority);
  notify_livetree_realizations_internal(runtime);
  return projected;
}

function admit_projection_identities(
  node: HsonNode,
  runtime: LiveTreeRuntime,
  authority: BrowserProjectionIdentityAuthority,
): void {
  if (is_ordinary_element_node(node)) {
    if (authority === "standalone") ensure_quid(node, undefined, runtime);
    else register_supplied_livetree_quid(node, runtime);
  }
  for (const child of node.$_content) {
    if (is_Node(child)) admit_projection_identities(child, runtime, authority);
  }
}

function subtree_has_document_binding(node: HsonNode): boolean {
  if (document_binding_for_node(node) !== undefined) return true;
  return node.$_content.some((child) => is_Node(child) && subtree_has_document_binding(child));
}

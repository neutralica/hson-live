import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentTarget,
} from "../../../types/livemap.types.js";
import type { HsonNode } from "../../../core/types.js";

export type DocumentBoundAttrsMutation =
  | Readonly<{ kind: "set"; name: string; value: LiveMapDocumentAttributeValue }>
  | Readonly<{ kind: "setMany"; values: LiveMapDocumentAttrs }>
  | Readonly<{ kind: "drop"; name: string }>
  | Readonly<{ kind: "dropMany"; names: readonly string[] }>
  | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "replace"; values: LiveMapDocumentAttrs }>;

export type DocumentBoundTextMutation =
  | Readonly<{ kind: "set"; value: string | boolean | number | null }>
  | Readonly<{ kind: "add"; value: string | boolean | number | null }>
  | Readonly<{ kind: "insert"; index: number; value: string | boolean | number | null }>
  | Readonly<{ kind: "overwrite"; value: string | boolean | number | null }>;

export type DocumentBindingNodeRegistration = Readonly<{
  owner: object;
  canonicalTarget: LiveMapDocumentTarget;
  canonicalPath: readonly number[];
  persistedQuid?: string;
  delegateAttrs: (mutation: DocumentBoundAttrsMutation) => void;
  delegateText: (mutation: DocumentBoundTextMutation) => void;
  delegateEmpty: () => void;
  delegateRemove: () => 1;
  rejectStructuralMutation: (operation: string) => never;
}>;

const DOCUMENT_BINDING_FOR_NODE = new WeakMap<HsonNode, DocumentBindingNodeRegistration>();

export function register_document_binding_node(
  node: HsonNode,
  registration: DocumentBindingNodeRegistration,
): void {
  const existing = DOCUMENT_BINDING_FOR_NODE.get(node);
  if (existing !== undefined && existing.owner !== registration.owner) {
    throw new Error("Projected LiveTree node already belongs to an active document binding.");
  }
  DOCUMENT_BINDING_FOR_NODE.set(node, registration);
}

export function document_binding_for_node(
  node: HsonNode,
): DocumentBindingNodeRegistration | undefined {
  return DOCUMENT_BINDING_FOR_NODE.get(node);
}

export function unregister_document_binding_node(node: HsonNode, owner: object): void {
  if (DOCUMENT_BINDING_FOR_NODE.get(node)?.owner === owner) {
    DOCUMENT_BINDING_FOR_NODE.delete(node);
  }
}

/** Reject a public canonical structural write while a projected node is bound. */
export function assert_document_structural_mutation_allowed(node: HsonNode, operation: string): void {
  document_binding_for_node(node)?.rejectStructuralMutation(operation);
}

export function delegate_document_text_mutation_if_bound(
  node: HsonNode,
  mutation: DocumentBoundTextMutation,
): boolean {
  const registration = document_binding_for_node(node);
  if (registration === undefined) return false;
  registration.delegateText(mutation);
  return true;
}

export function delegate_document_empty_if_bound(node: HsonNode): boolean {
  const registration = document_binding_for_node(node);
  if (registration === undefined) return false;
  registration.delegateEmpty();
  return true;
}

export function delegate_document_remove_if_bound(node: HsonNode): 1 | undefined {
  return document_binding_for_node(node)?.delegateRemove();
}

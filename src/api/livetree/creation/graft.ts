import {
  ARR_TAG,
  ELEM_TAG,
  HSON_SYS_PREFIX,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "../../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../../core/node-guards.js";
import type { HsonNode, Primitive } from "../../../core/types.js";
import { parse_html_with_element_provenance } from "../../transform/parsers/parse-html.js";
import { _throw_transform_err } from "../../transform/utils/sys-utils/throw-transform-err.utils.js";
import { SVG_NS } from "../../transform/utils/node-utils/node-from-svg.js";
import { LiveTree } from "../livetree.js";
import {
  HSON_QUID_MARKUP_NAME,
  plan_full_livetree_quid_graph,
} from "../quid/data-quid.js";
import {
  assert_runtime_document_available,
  default_livetree_runtime,
  release_runtime_document_claim,
  register_runtime_document,
  runtime_for_node,
  runtime_owns_document,
} from "../runtime/livetree-runtime.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import {
  get_el_for_node,
  get_node_for_el,
  link_node_to_el,
  unlinkNode,
} from "../utils/node-map-helpers.js";
import { create_livetree_in_runtime } from "./create-livetree.js";

const HTML_NS = "http://www.w3.org/1999/xhtml";

type CanonicalDomChild =
  | Readonly<{ kind: "element"; node: HsonNode; element: Element }>
  | Readonly<{ kind: "text"; value: string }>;

type ElementNormalization = Readonly<{
  node: HsonNode;
  element: Element;
  children: readonly CanonicalDomChild[];
  originalChildren: readonly ChildNode[];
}>;

type QuidDomWrite = Readonly<{
  element: Element;
  prior: string | null;
}>;

const ACTIVE_GRAFT_ROOTS = new Set<Element>();

function render_items(
  value: HsonNode | Primitive,
  elements: ReadonlyMap<HsonNode, Element>,
): CanonicalDomChild[] {
  if (!is_Node(value)) return [{ kind: "text", value: String(value ?? "") }];
  if (value.$_tag === STR_TAG || value.$_tag === VAL_TAG) {
    return [{ kind: "text", value: String(value.$_content[0] ?? "") }];
  }
  if (value.$_tag === ARR_TAG) {
    return value.$_content.flatMap((item) => {
      if (!is_Node(item)) return [];
      const payload = item.$_content[0];
      return payload == null ? [] : render_items(payload, elements);
    });
  }
  if (value.$_tag === ROOT_TAG || value.$_tag === OBJ_TAG || value.$_tag === ELEM_TAG) {
    return value.$_content.flatMap((child) => render_items(child, elements));
  }
  const element = elements.get(value);
  if (element === undefined) {
    throw new Error(`graft provenance is missing ordinary element <${value.$_tag}>.`);
  }
  return [{ kind: "element", node: value, element }];
}

function contains_physical_hson_carrier(root: Element): boolean {
  const visit = (element: Element): boolean => {
    if (element.tagName.toLowerCase().startsWith(HSON_SYS_PREFIX)) return true;
    return Array.from(element.children).some(visit);
  };
  return visit(root);
}

function namespace_of(element: Element): "html" | "svg" | undefined {
  if (element.namespaceURI === SVG_NS) return "svg";
  if (element.namespaceURI === HTML_NS) return "html";
  return undefined;
}

function validate_namespaces(
  node: HsonNode,
  elements: ReadonlyMap<HsonNode, Element>,
  parentNamespace: "html" | "svg",
): void {
  const namespace = node.$_tag === "svg" ? "svg" : parentNamespace;
  const element = elements.get(node);
  const tagMatches = element !== undefined && (
    namespace === "html"
      ? element.localName.toLowerCase() === node.$_tag
      : element.localName === node.$_tag
  );
  if (element === undefined || namespace_of(element) !== namespace || !tagMatches) {
    throw new Error(`graft cannot preserve the current namespace realization for <${node.$_tag}>.`);
  }
  validate_child_namespaces(node, elements, namespace);
}

function validate_child_namespaces(
  node: HsonNode,
  elements: ReadonlyMap<HsonNode, Element>,
  parentNamespace: "html" | "svg",
): void {
  for (const child of node.$_content) {
    if (!is_Node(child)) continue;
    if (is_ordinary_element_node(child)) validate_namespaces(child, elements, parentNamespace);
    else validate_child_namespaces(child, elements, parentNamespace);
  }
}

function plan_normalization(
  root: HsonNode,
  elements: ReadonlyMap<HsonNode, Element>,
): readonly ElementNormalization[] {
  const ordinaryNodes = collect_subtree_nodes(root, "post").filter(is_ordinary_element_node);
  const plan: ElementNormalization[] = [];

  for (const node of ordinaryNodes) {
    const element = elements.get(node);
    if (element === undefined) throw new Error(`graft provenance is incomplete for <${node.$_tag}>.`);
    if (get_el_for_node(node) !== undefined) {
      throw new Error("graft parsed node unexpectedly already has a DOM mapping.");
    }
    if (get_node_for_el(element) !== undefined) {
      throw new Error("graft subtree contains an Element already managed by LiveTree.");
    }

    const children = node.$_content.flatMap((child) => render_items(child, elements));
    const expectedElements = children
      .filter((child): child is Extract<CanonicalDomChild, { kind: "element" }> => child.kind === "element")
      .map((child) => child.element);
    const actualElements = Array.from(element.children);
    if (
      expectedElements.length !== actualElements.length
      || expectedElements.some((child, index) => actualElements[index] !== child)
    ) {
      throw new Error(`graft cannot adopt the realized child structure of <${node.$_tag}>.`);
    }
    plan.push(Object.freeze({
      node,
      element,
      children,
      originalChildren: Array.from(element.childNodes),
    }));
  }
  return plan;
}

function restore_removed_non_elements(entry: ElementNormalization): void {
  const parent = entry.element;
  for (let index = 0; index < entry.originalChildren.length; index += 1) {
    const node = entry.originalChildren[index];
    if (node?.nodeType === 1 || node?.parentNode === parent) continue;
    if (node?.parentNode !== null) continue;

    const nextOriginal = entry.originalChildren
      .slice(index + 1)
      .find((candidate) => candidate.parentNode === parent);
    if (nextOriginal !== undefined) {
      parent.insertBefore(node, nextOriginal);
      continue;
    }

    const previousOriginal = entry.originalChildren
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.parentNode === parent);
    parent.insertBefore(node, previousOriginal?.nextSibling ?? null);
  }
}

function apply_normalization(plan: readonly ElementNormalization[]): () => void {
  const insertedTextNodes: Text[] = [];
  const rollback = (): void => {
    const failures: unknown[] = [];
    for (const text of insertedTextNodes) {
      try {
        text.parentNode?.removeChild(text);
      } catch (cause) {
        failures.push(cause);
      }
    }
    for (const entry of plan) {
      try {
        restore_removed_non_elements(entry);
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "graft DOM rollback failed");
  };

  try {
    for (const entry of plan) {
      for (const child of Array.from(entry.element.childNodes)) {
        if (child.nodeType !== 1) entry.element.removeChild(child);
      }
      for (let index = 0; index < entry.children.length; index += 1) {
        const child = entry.children[index];
        if (child?.kind !== "text") continue;
        const nextElement = entry.children
          .slice(index + 1)
          .find((candidate) => candidate.kind === "element");
        const text = entry.element.ownerDocument.createTextNode(child.value);
        entry.element.insertBefore(
          text,
          nextElement?.kind === "element" ? nextElement.element : null,
        );
        insertedTextNodes.push(text);
      }
    }
  } catch (cause) {
    try {
      rollback();
    } catch (rollbackCause) {
      throw new AggregateError([cause, rollbackCause], "graft normalization and rollback failed");
    }
    throw cause;
  }
  return rollback;
}

function selected_root_node(
  target: Element,
  elements: ReadonlyMap<HsonNode, Element>,
): HsonNode {
  const matches = [...elements].filter(([, element]) => element === target);
  if (matches.length !== 1 || !is_ordinary_element_node(matches[0]?.[0])) {
    throw new Error("graft provenance does not identify one ordinary selected root.");
  }
  return matches[0][0];
}

function begin_graft_transaction(target: Element): () => void {
  for (const active of ACTIVE_GRAFT_ROOTS) {
    if (active === target || active.contains(target) || target.contains(active)) {
      throw new Error("graft cannot overlap another graft transaction in progress.");
    }
  }
  ACTIVE_GRAFT_ROOTS.add(target);
  return (): void => {
    ACTIVE_GRAFT_ROOTS.delete(target);
  };
}

function verify_canonical_children(entry: ElementNormalization): void {
  const actual = Array.from(entry.element.childNodes);
  if (actual.length !== entry.children.length) {
    throw new Error(`graft realization changed during adoption for <${entry.node.$_tag}>.`);
  }
  for (let index = 0; index < entry.children.length; index += 1) {
    const expected = entry.children[index];
    const realized = actual[index];
    if (expected?.kind === "element") {
      if (realized !== expected.element) {
        throw new Error(`graft retained Element correspondence changed for <${entry.node.$_tag}>.`);
      }
    } else if (expected?.kind === "text") {
      if (realized?.nodeType !== 3 || realized.nodeValue !== expected.value) {
        throw new Error(`graft canonical text correspondence changed for <${entry.node.$_tag}>.`);
      }
    }
  }
}

function write_planned_quids(
  identities: ReadonlyMap<HsonNode, string>,
  elements: ReadonlyMap<HsonNode, Element>,
  writes: QuidDomWrite[],
): void {
  for (const [node, quid] of identities) {
    const sourceElement = elements.get(node);
    if (sourceElement === undefined) throw new Error("graft identity provenance is incomplete.");
    const prior = sourceElement.getAttribute(HSON_QUID_MARKUP_NAME);
    if (prior === quid) continue;
    writes.push(Object.freeze({ element: sourceElement, prior }));
    sourceElement.setAttribute(HSON_QUID_MARKUP_NAME, quid);
  }
}

function rollback_quid_writes(writes: readonly QuidDomWrite[]): void {
  const failures: unknown[] = [];
  for (const write of [...writes].reverse()) {
    try {
      if (write.prior === null) write.element.removeAttribute(HSON_QUID_MARKUP_NAME);
      else write.element.setAttribute(HSON_QUID_MARKUP_NAME, write.prior);
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length !== 0) throw new AggregateError(failures, "graft QUID rollback failed");
}

function verify_proposed_realization(
  target: Element,
  root: HsonNode,
  elements: ReadonlyMap<HsonNode, Element>,
  normalization: readonly ElementNormalization[],
  identities: ReadonlyMap<HsonNode, string>,
): void {
  if (elements.get(root) !== target) throw new Error("graft selected-root provenance changed during adoption.");
  if (contains_physical_hson_carrier(target)) {
    throw new Error("graft realization gained a physical _hson_* carrier during adoption.");
  }
  const rootNamespace = namespace_of(target);
  if (rootNamespace === undefined) throw new Error("graft supports HTML and SVG namespace realizations only.");
  validate_namespaces(root, elements, rootNamespace);

  const ordinaryNodes = collect_subtree_nodes(root, "post").filter(is_ordinary_element_node);
  if (
    ordinaryNodes.length !== normalization.length
    || ordinaryNodes.some((node, index) => node !== normalization[index]?.node)
  ) {
    throw new Error("graft graph changed during adoption.");
  }
  for (const entry of normalization) {
    if (elements.get(entry.node) !== entry.element) {
      throw new Error("graft provenance changed during adoption.");
    }
    if (get_el_for_node(entry.node) !== undefined || get_node_for_el(entry.element) !== undefined) {
      throw new Error("graft mapping ownership changed during adoption.");
    }
    verify_canonical_children(entry);
  }
  for (const [node, quid] of identities) {
    const sourceElement = elements.get(node);
    if (sourceElement?.getAttribute(HSON_QUID_MARKUP_NAME) !== quid) {
      throw new Error("graft QUID markup changed during adoption.");
    }
  }
}

/** Adopt one ordinary realized DOM subtree without replacing its Elements. */
export function graft(
  element?: HTMLElement,
  options: { unsafe: boolean } = { unsafe: false },
): LiveTree {
  void options;
  const targetElement = element;
  if (!targetElement) _throw_transform_err("error getting target element", "graft", element);

  const existingNode = get_node_for_el(targetElement);
  if (existingNode) {
    return create_livetree_in_runtime(
      existingNode,
      runtime_for_node(existingNode) ?? default_livetree_runtime(),
    );
  }

  const parsed = parse_html_with_element_provenance(targetElement);
  const root = selected_root_node(targetElement, parsed.elements);
  if (contains_physical_hson_carrier(targetElement)) {
    throw new Error("graft cannot adopt physical _hson_* carrier Elements without replacing them.");
  }

  const rootNamespace = namespace_of(targetElement);
  if (rootNamespace === undefined) throw new Error("graft supports HTML and SVG namespace realizations only.");
  validate_namespaces(root, parsed.elements, rootNamespace);
  const normalization = plan_normalization(root, parsed.elements);

  const runtime = default_livetree_runtime();
  assert_runtime_document_available(runtime, targetElement.ownerDocument);
  const quidPlan = plan_full_livetree_quid_graph(root, runtime);

  const linkedNodes: HsonNode[] = [];
  const quidWrites: QuidDomWrite[] = [];
  let rollbackNormalization: (() => void) | undefined;
  let documentRegistered = false;
  let documentWasRegistered = false;
  const endGraftTransaction = begin_graft_transaction(targetElement);
  try {
    rollbackNormalization = apply_normalization(normalization);
    write_planned_quids(quidPlan.identities, parsed.elements, quidWrites);
    verify_proposed_realization(
      targetElement,
      root,
      parsed.elements,
      normalization,
      quidPlan.identities,
    );
    assert_runtime_document_available(runtime, targetElement.ownerDocument);
    quidPlan.revalidate();

    quidPlan.publish();
    for (const entry of normalization) {
      link_node_to_el(entry.node, entry.element);
      linkedNodes.push(entry.node);
    }
    documentWasRegistered = runtime_owns_document(runtime, targetElement.ownerDocument);
    register_runtime_document(runtime, targetElement.ownerDocument);
    documentRegistered = true;
    return create_livetree_in_runtime(root, runtime);
  } catch (cause) {
    const rollbackFailures: unknown[] = [];
    if (documentRegistered && !documentWasRegistered) {
      try {
        release_runtime_document_claim(runtime, targetElement.ownerDocument);
      } catch (rollbackCause) {
        rollbackFailures.push(rollbackCause);
      }
    }
    for (const node of linkedNodes) unlinkNode(node);
    try {
      quidPlan.rollback();
    } catch (rollbackCause) {
      rollbackFailures.push(rollbackCause);
    }
    try {
      rollback_quid_writes(quidWrites);
    } catch (rollbackCause) {
      rollbackFailures.push(rollbackCause);
    }
    try {
      rollbackNormalization?.();
    } catch (rollbackCause) {
      rollbackFailures.push(rollbackCause);
    }
    if (rollbackFailures.length !== 0) {
      throw new AggregateError([cause, ...rollbackFailures], "graft failed and rollback was incomplete");
    }
    throw cause;
  } finally {
    endGraftTransaction();
  }
}

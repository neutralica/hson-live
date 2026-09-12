import {
  ARR_TAG,
  ELEM_TAG,
  HSON_META_QUID,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import { serialize_style } from "../transform/utils/attrs-utils/serialize-style.js";
import { SVG_NS } from "../transform/utils/node-utils/node-from-svg.js";
import { create_linked_livetree_in_runtime } from "../livetree/creation/create-livetree.js";
import type { LiveTree } from "../livetree/livetree.js";
import { release_subtree_ownership } from "../livetree/lifecycle/graph-ownership.js";
import {
  HSON_QUID_MARKUP_NAME,
  preflight_livetree_quid_graph,
} from "../livetree/quid/data-quid.js";
import {
  assert_runtime_document_available,
  bind_graph_runtime,
  default_livetree_runtime,
  register_runtime_document,
  release_runtime_document_claim,
  release_nodes_runtime,
  runtime_owns_document,
  type LiveTreeRuntime,
} from "../livetree/runtime/livetree-runtime.js";
import { collect_subtree_nodes } from "../livetree/utils/subtree-traversal.js";
import {
  get_el_for_node,
  get_node_for_el,
  link_node_to_el,
  unlinkNode,
} from "../livetree/utils/node-map-helpers.js";

const HTML_NS = "http://www.w3.org/1999/xhtml";

type ExpectedDomChild = HsonNode | string;
type PlannedElement = Readonly<{ node: HsonNode; element: Element }>;

export type ExactDocumentAdoption = Readonly<{
  tree: LiveTree;
  commit: () => void;
  abort: () => void;
}>;

type AdoptionFaultPoint = "after-first-link" | "after-links" | "after-runtime" | "after-tree";
let adoptionFaultHook: ((point: AdoptionFaultPoint) => void) | undefined;

/** @internal Deterministic transaction fault seam; never exported by a package entrypoint. */
export function set_document_adoption_fault_hook_for_tests(
  hook: ((point: AdoptionFaultPoint) => void) | undefined,
): void {
  adoptionFaultHook = hook;
}

const ADOPTED_ROOTS = new WeakMap<Element, LiveTree>();

function expected_dom_children(value: HsonNode | Primitive): ExpectedDomChild[] {
  if (!is_Node(value)) return [String(value ?? "")];
  if (value.$_tag === STR_TAG || value.$_tag === VAL_TAG) {
    return [String(value.$_content[0] ?? "")];
  }
  if (value.$_tag === ARR_TAG) {
    return value.$_content.flatMap((item) => {
      if (!is_Node(item)) return [];
      const payload = item.$_content[0];
      return payload == null ? [] : expected_dom_children(payload);
    });
  }
  if (value.$_tag === ROOT_TAG || value.$_tag === OBJ_TAG || value.$_tag === ELEM_TAG) {
    return value.$_content.flatMap(expected_dom_children);
  }
  return [value];
}

function namespace_of(element: Element): "html" | "svg" {
  if (element.namespaceURI === SVG_NS) return "svg";
  if (element.namespaceURI === HTML_NS) return "html";
  throw new Error("Existing document root is outside the supported HTML/SVG namespaces.");
}

function validate_attrs(node: HsonNode, element: Element): void {
  const expectedNames = new Set<string>();
  for (const [name, value] of Object.entries(node.$_attrs ?? {})) {
    const styleText = name === "style" && typeof value === "object"
      && value !== null
      ? serialize_style(value)
      : undefined;
    const expected = styleText === "" ? null : styleText ?? String(value);
    if (expected !== null) expectedNames.add(name);
    if (element.getAttribute(name) !== expected) {
      throw new Error(`Existing <${node.$_tag}> attribute ${JSON.stringify(name)} does not match canonical state.`);
    }
  }
  for (const name of element.getAttributeNames()) {
    if (name === HSON_QUID_MARKUP_NAME) continue;
    if (!expectedNames.has(name)) {
      throw new Error(`Existing <${node.$_tag}> contains non-canonical attribute ${JSON.stringify(name)}.`);
    }
  }
}

function plan_node(
  node: HsonNode,
  element: Element,
  ownerDocument: Document,
  parentNamespace: "html" | "svg",
  plan: PlannedElement[],
  seen: Set<Element>,
): void {
  if (!is_ordinary_element_node(node)) throw new Error("Exact adoption requires an ordinary canonical root.");
  if (seen.has(element)) throw new Error("Existing DOM Element corresponds to more than one canonical node.");
  seen.add(element);
  if (element.ownerDocument !== ownerDocument) throw new Error("Existing realization spans more than one owner Document.");

  const namespace: "html" | "svg" = node.$_tag === "svg" ? "svg" : parentNamespace;
  const expectedNamespace = namespace === "svg" ? SVG_NS : HTML_NS;
  const tagMatches = namespace === "html"
    ? element.localName.toLowerCase() === node.$_tag.toLowerCase()
    : element.localName === node.$_tag;
  if (element.namespaceURI !== expectedNamespace || !tagMatches) {
    throw new Error(`Existing Element namespace or tag does not match canonical <${node.$_tag}>.`);
  }
  const quid = node.$_meta?.[HSON_META_QUID];
  if (element.getAttribute(HSON_QUID_MARKUP_NAME) !== (quid ?? null)) {
    throw new Error(`Existing <${node.$_tag}> QUID presence or value does not match canonical state.`);
  }
  validate_attrs(node, element);
  plan.push(Object.freeze({ node, element }));

  const expected = node.$_content.flatMap(expected_dom_children);
  const actual = Array.from(element.childNodes);
  if (actual.length !== expected.length) {
    throw new Error(`Existing <${node.$_tag}> child count or text boundaries do not match canonical state.`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const realized = actual[index];
    if (typeof wanted === "string") {
      if (realized?.nodeType !== 3 || realized.nodeValue !== wanted) {
        throw new Error(`Existing <${node.$_tag}> text boundary or value does not match canonical state.`);
      }
      continue;
    }
    if (realized?.nodeType !== 1) {
      throw new Error(`Existing <${node.$_tag}> child ordering does not match canonical state.`);
    }
    plan_node(wanted, realized as Element, ownerDocument, namespace, plan, seen);
  }
}

function cleanup_new_adoption(
  root: HsonNode,
  plan: readonly PlannedElement[],
  runtime: LiveTreeRuntime,
  ownerDocument: Document,
  documentWasOwned: boolean,
): void {
  for (const entry of [...plan].reverse()) unlinkNode(entry.node);
  for (const node of collect_subtree_nodes(root, "post")) {
    const quid = runtime.nodeToQuid.get(node);
    if (quid !== undefined) {
      if (runtime.quidToNode.get(quid) === node) runtime.quidToNode.delete(quid);
      runtime.nodeToQuid.delete(node);
      runtime.issuedQuids.delete(quid);
    }
  }
  release_nodes_runtime(collect_subtree_nodes(root, "post"), runtime);
  release_subtree_ownership(root);
  if (!documentWasOwned) {
    release_runtime_document_claim(runtime, ownerDocument);
  }
}

/** Exact, no-write admission of one canonical document root into existing DOM. @internal */
export function adopt_exact_existing_document(
  canonicalDocumentRoot: HsonNode,
  target: Element,
): ExactDocumentAdoption {
  const priorTree = ADOPTED_ROOTS.get(target);
  if (priorTree !== undefined) {
    return Object.freeze({ tree: priorTree, commit: () => {}, abort: () => {} });
  }
  if (get_node_for_el(target) !== undefined) {
    throw new Error("Existing document root is already managed outside document continuation.");
  }
  if (canonicalDocumentRoot.$_tag !== ROOT_TAG
    || canonicalDocumentRoot.$_content.length !== 1
    || !is_ordinary_element_node(canonicalDocumentRoot.$_content[0])) {
    throw new Error("Document continuation requires exactly one ordinary canonical document root.");
  }

  // The projection graph derives from canonical authority, never by parsing or
  // normalizing the existing DOM.
  const canonicalOrdinaryRoot = canonicalDocumentRoot.$_content[0];
  const projectedRoot: HsonNode = clone_node(canonicalOrdinaryRoot);
  const plan: PlannedElement[] = [];
  const rootNamespace = namespace_of(target);
  plan_node(projectedRoot, target, target.ownerDocument, rootNamespace, plan, new Set());

  const runtime = default_livetree_runtime();
  assert_runtime_document_available(runtime, target.ownerDocument);
  const claims = preflight_livetree_quid_graph(projectedRoot, runtime);
  for (const entry of plan) {
    if (get_el_for_node(entry.node) !== undefined || get_node_for_el(entry.element) !== undefined) {
      throw new Error("Exact adoption conflicts with an active node-to-Element ownership claim.");
    }
  }

  const documentWasOwned = runtime_owns_document(runtime, target.ownerDocument);
  let tree: LiveTree | undefined;
  let finished = false;
  try {
    for (let index = 0; index < plan.length; index += 1) {
      const entry = plan[index]!;
      link_node_to_el(entry.node, entry.element);
      if (index === 0) adoptionFaultHook?.("after-first-link");
    }
    adoptionFaultHook?.("after-links");
    register_runtime_document(runtime, target.ownerDocument);
    bind_graph_runtime(projectedRoot, runtime);
    for (const claim of claims) {
      runtime.quidToNode.set(claim.quid, claim.node);
      runtime.nodeToQuid.set(claim.node, claim.quid);
      runtime.issuedQuids.add(claim.quid);
    }
    adoptionFaultHook?.("after-runtime");
    tree = create_linked_livetree_in_runtime(projectedRoot, runtime);
    adoptionFaultHook?.("after-tree");
  } catch (cause) {
    cleanup_new_adoption(projectedRoot, plan, runtime, target.ownerDocument, documentWasOwned);
    throw cause;
  }

  const adoptedTree = tree;
  if (adoptedTree === undefined) throw new Error("Exact document adoption did not construct a LiveTree.");
  return Object.freeze({
    tree: adoptedTree,
    commit(): void {
      if (finished) return;
      ADOPTED_ROOTS.set(target, adoptedTree);
      finished = true;
    },
    abort(): void {
      if (finished) return;
      finished = true;
      cleanup_new_adoption(projectedRoot, plan, runtime, target.ownerDocument, documentWasOwned);
    },
  });
}

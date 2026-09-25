import type { HsonNode } from "../../core/types.js";
import {
  BROWSER_HTML_NAMESPACE,
  BROWSER_SVG_NAMESPACE,
  plan_browser_realization,
  type BrowserNamespace,
  type BrowserRealizationElement,
  type BrowserRealizationNode,
  type BrowserRealizationPlan,
  type BrowserRealizationWrapper,
} from "./browser-realization-plan.js";
import {
  ensure_quid,
  register_supplied_livetree_quid,
} from "../../api/livetree/quid/data-quid.js";
import type { LiveTreeRuntime } from "../../api/livetree/runtime/livetree-runtime.js";
import {
  get_dom_for_node,
  get_el_for_node,
  get_node_for_dom,
  link_node_to_dom,
  link_node_to_el,
} from "../../api/livetree/utils/node-map-helpers.js";
import { record_livetree_materialization } from "../../api/livetree/debug/materialization-profile.js";

export type BrowserProjectionIdentityAuthority = "standalone" | "linked";

export type BrowserRealizationMatch = Readonly<{
  links: readonly Readonly<{ canonicalNode: HsonNode; domNode: Node }>[];
}>;

const RUNTIME_INFRASTRUCTURE = new WeakSet<Node>();

/** Classify an exact runtime-owned support subtree without tolerating arbitrary DOM. @internal */
export function mark_runtime_infrastructure(node: Node): void {
  RUNTIME_INFRASTRUCTURE.add(node);
}

/** Roll back an infrastructure claim when exact continuation construction aborts. @internal */
export function unmark_runtime_infrastructure(node: Node): void {
  RUNTIME_INFRASTRUCTURE.delete(node);
}

/** Whether a node was explicitly claimed by runtime infrastructure. @internal */
export function is_runtime_infrastructure(node: Node): boolean {
  return RUNTIME_INFRASTRUCTURE.has(node);
}

/** Materialize one immutable plan through native DOM factories. @internal */
export function materialize_browser_realization(
  plan: BrowserRealizationPlan,
  runtime: LiveTreeRuntime,
  ownerDocument: Document,
  identityAuthority: BrowserProjectionIdentityAuthority,
): Node {
  if (plan.roots.length === 1) return materialize_node(plan.roots[0]!, runtime, ownerDocument, identityAuthority);
  const fragment = ownerDocument.createDocumentFragment();
  record_livetree_materialization("domFragmentsCreated");
  for (const root of plan.roots) fragment.appendChild(materialize_node(root, runtime, ownerDocument, identityAuthority));
  return fragment;
}

/** Verify exact parser output against a plan without writing. @internal */
export function match_browser_realization_root(
  plan: BrowserRealizationPlan,
  target: Element,
  options: Readonly<{ allowRuntimeInfrastructure?: boolean; retainRuntimeInfrastructure?: Node }> = {},
): BrowserRealizationMatch {
  if (plan.roots.length !== 1 || plan.roots[0]?.kind !== "element") {
    throw new Error("Exact browser realization requires one planned Element root.");
  }
  const links: Array<Readonly<{ canonicalNode: HsonNode; domNode: Node }>> = [];
  match_node(plan.roots[0], target, target.ownerDocument, links,
    options.allowRuntimeInfrastructure === true, options.retainRuntimeInfrastructure);
  return Object.freeze({ links: Object.freeze(links) });
}

/** Verify that every canonical-backed plan node retains the exact admitted mapping. @internal */
export function assert_browser_realization_mappings(match: BrowserRealizationMatch): void {
  for (const link of match.links) {
    if (get_dom_for_node(link.canonicalNode) !== link.domNode
      || get_node_for_dom(link.domNode) !== link.canonicalNode) {
      throw new Error("Browser realization mapping no longer matches its canonical plan.");
    }
  }
}

/** Rebuild one ordinary owner's realized children from the same plan, retaining mapped nodes. @internal */
export function reconcile_browser_realization_children(
  owner: HsonNode,
  runtime: LiveTreeRuntime,
): void {
  const element = get_el_for_node(owner);
  if (element === undefined) return;
  const parentNamespace = namespace_for_element(element);
  const plan = plan_browser_realization(owner, { parentNamespace, capability: "dom" });
  const root = plan.roots[0];
  if (root?.kind !== "element") throw new Error("Mounted owner did not produce one Element plan.");
  const target = child_target(element, root);
  const desired = root.children.map((child) => materialize_node(child, runtime, target.ownerDocument, "linked"));
  replace_realization_children(target, desired);
}

/** Determine the namespace context required to plan an already-existing root. @internal */
export function browser_parent_namespace_for_target(target: Element, canonicalTag: string): BrowserNamespace {
  if (canonicalTag.toLowerCase() === "svg") return "html";
  return namespace_for_element(target);
}

function materialize_node(
  plan: BrowserRealizationNode,
  runtime: LiveTreeRuntime,
  ownerDocument: Document,
  identityAuthority: BrowserProjectionIdentityAuthority,
): Node {
  if (plan.canonicalNode !== undefined) {
    const retained = get_dom_for_node(plan.canonicalNode);
    if (retained !== undefined) {
      if ((retained as { ownerDocument?: Document }).ownerDocument !== ownerDocument) {
        throw new Error("A retained browser realization cannot move between documents implicitly.");
      }
      if (plan.kind === "text") {
        if (retained.nodeType !== 3) throw new Error("Retained text realization has the wrong native kind.");
        if (retained.nodeValue !== plan.value) retained.nodeValue = plan.value;
      } else if (plan.kind === "marker") {
        if (retained.nodeType !== 8) throw new Error("Retained empty-text evidence has the wrong native kind.");
        if (retained.nodeValue !== plan.value) retained.nodeValue = plan.value;
      }
      return retained;
    }
  }
  if (plan.kind === "text") {
    const text = ownerDocument.createTextNode(plan.value);
    record_livetree_materialization("domTextNodesCreated");
    if (plan.canonicalNode !== undefined) link_node_to_dom(plan.canonicalNode, text);
    return text;
  }
  if (plan.kind === "marker") {
    const marker = ownerDocument.createComment(plan.value);
    if (plan.canonicalNode !== undefined) link_node_to_dom(plan.canonicalNode, marker);
    return marker;
  }
  const element = plan.namespace === "svg"
    ? ownerDocument.createElementNS(BROWSER_SVG_NAMESPACE, plan.localName)
    : ownerDocument.createElement(plan.localName);
  record_livetree_materialization("domElementsCreated");
  if (plan.kind === "element") {
    link_node_to_el(plan.canonicalNode, element);
    if (identityAuthority === "standalone") ensure_quid(plan.canonicalNode, undefined, runtime);
    else register_supplied_livetree_quid(plan.canonicalNode, runtime);
  }
  for (const attr of plan.attrs) element.setAttribute(attr.name, attr.value);
  const target = child_target(element, plan);
  for (const child of plan.children) target.appendChild(materialize_node(child, runtime, ownerDocument, identityAuthority));
  return element;
}

function match_node(
  plan: BrowserRealizationNode,
  actual: Node,
  ownerDocument: Document,
  links: Array<Readonly<{ canonicalNode: HsonNode; domNode: Node }>>,
  allowRuntimeInfrastructure: boolean,
  retainRuntimeInfrastructure?: Node,
): void {
  if ((actual as { ownerDocument?: Document }).ownerDocument !== ownerDocument) {
    throw new Error("Existing browser realization spans more than one owner Document.");
  }
  if (plan.kind === "text") {
    if (actual.nodeType !== 3 || actual.nodeValue !== plan.value) {
      throw new Error("Existing browser text boundary or value does not match its realization plan.");
    }
    if (plan.canonicalNode !== undefined) links.push(Object.freeze({ canonicalNode: plan.canonicalNode, domNode: actual }));
    return;
  }
  if (plan.kind === "marker") {
    if (actual.nodeType !== 8 || actual.nodeValue !== plan.value) {
      throw new Error("Existing Hson boundary marker is missing, malformed, reordered, or belongs to another plan.");
    }
    if (plan.canonicalNode !== undefined) links.push(Object.freeze({ canonicalNode: plan.canonicalNode, domNode: actual }));
    return;
  }
  if (actual.nodeType !== 1) throw new Error("Existing browser child kind does not match its realization plan.");
  const element = actual as Element;
  const expectedNamespace = plan.namespace === "svg" ? BROWSER_SVG_NAMESPACE : BROWSER_HTML_NAMESPACE;
  const tagMatches = plan.namespace === "html"
    ? element.localName.toLowerCase() === plan.localName
    : element.localName === plan.localName;
  if (element.namespaceURI !== expectedNamespace || !tagMatches) {
    throw new Error(`Existing Element namespace or tag does not match planned <${plan.localName}>.`);
  }
  validate_attrs(plan, element, allowRuntimeInfrastructure);
  if (plan.kind === "element") links.push(Object.freeze({ canonicalNode: plan.canonicalNode, domNode: element }));
  const target = child_target(element, plan);
  const actualChildren = Array.from(target.childNodes).filter((child) => (
    !allowRuntimeInfrastructure || !is_runtime_infrastructure(child) || child === retainRuntimeInfrastructure
  ));
  if (actualChildren.length !== plan.children.length) {
    throw new Error(`Existing <${plan.localName}> child count does not match its realization plan.`);
  }
  const childOwnerDocument = plan.childTarget === "template-content"
    ? target.ownerDocument
    : ownerDocument;
  for (let index = 0; index < plan.children.length; index += 1) {
    match_node(plan.children[index]!, actualChildren[index]!, childOwnerDocument, links,
      allowRuntimeInfrastructure, retainRuntimeInfrastructure);
  }
}

function validate_attrs(plan: BrowserRealizationElement | BrowserRealizationWrapper, element: Element, allowRuntimeInfrastructure: boolean): void {
  // Initial SSR admission rejects foreign identity markup. An already bound
  // browser runtime may carry its own QUID metadata, checked by Mirror.
  const ignoreRuntimeQuid = allowRuntimeInfrastructure && plan.kind === "element";
  const expected = new Map(plan.attrs.filter((attr) => !ignoreRuntimeQuid || attr.name !== "hson:quid").map((attr) => [attr.name, attr.value]));
  for (const [name, value] of expected) {
    if (element.getAttribute(name) !== value) {
      throw new Error(`Existing <${plan.localName}> attribute ${JSON.stringify(name)} does not match its realization plan.`);
    }
  }
  for (const name of element.getAttributeNames()) {
    if ((!ignoreRuntimeQuid || name !== "hson:quid") && !expected.has(name)) {
      throw new Error(`Existing <${plan.localName}> contains unplanned attribute ${JSON.stringify(name)}.`);
    }
  }
}

function child_target(element: Element, plan: BrowserRealizationElement | BrowserRealizationWrapper): Element | DocumentFragment {
  if (plan.childTarget !== "template-content") return element;
  const content = (element as HTMLTemplateElement).content;
  if (content === undefined) throw new Error("The DOM implementation does not expose template.content.");
  return content;
}

function replace_realization_children(target: Element | DocumentFragment, desired: readonly Node[]): void {
  const replaceChildren = (target as { replaceChildren?: (...nodes: Node[]) => void }).replaceChildren;
  if (typeof replaceChildren === "function") {
    replaceChildren.call(target, ...desired);
    return;
  }
  while (target.childNodes.length > 0) target.removeChild(target.childNodes[0]!);
  for (const child of desired) target.appendChild(child);
}

function namespace_for_element(element: Element): BrowserNamespace {
  if (element.namespaceURI === BROWSER_SVG_NAMESPACE) return "svg";
  if (element.namespaceURI === BROWSER_HTML_NAMESPACE) return "html";
  throw new Error("Existing root is outside the supported HTML/SVG namespaces.");
}

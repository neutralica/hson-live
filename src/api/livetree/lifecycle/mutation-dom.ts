import { browser_realization_content_target } from "../../../internal/browser-realization/browser-realization-dom.js";
import { prepare_native_listener_release } from "../managers/listener-builder.js";
import { runtime_for_node, default_livetree_runtime, type LiveTreeRuntime } from "../runtime/livetree-runtime.js";
import type { HsonNode } from "../../../core/types.js";
import { get_dom_for_node, get_el_for_node } from "../utils/node-map-helpers.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import { HSON_QUID_MARKUP_NAME } from "../quid/data-quid.js";

/** Use the existing browser realization receiver, including template.content. */
export function content_target_for_owner(owner: HsonNode): Element | DocumentFragment | undefined {
  const element = get_el_for_node(owner);
  return element && browser_realization_content_target(element);
}

/** Restore native placement after an operation-local staging failure. Instance
 * methods may be the source of the failure; restoration uses the owning realm. */
export function restore_dom_children(parent: Node, children: readonly Node[]): void {
  const native = parent.ownerDocument?.defaultView?.Node.prototype;
  const remove = native?.removeChild ?? parent.removeChild;
  const insert = native?.insertBefore ?? parent.insertBefore;
  while (parent.childNodes.length) remove.call(parent, parent.childNodes[0]!);
  for (const child of children) {
    if (typeof insert === "function") insert.call(parent, child, null);
    else parent.appendChild(child);
  }
}

/** Restore attributes without re-entering an instance method that failed staging. */
export function restore_dom_attrs(element: Element, attrs: readonly (readonly [string, string])[]): void {
  const native = element.ownerDocument?.defaultView?.Element.prototype;
  const remove = native?.removeAttribute ?? element.removeAttribute;
  const set = native?.setAttribute ?? element.setAttribute;
  for (const name of element.getAttributeNames()) if (!attrs.some(([key]) => key === name)) remove.call(element, name);
  for (const [name, value] of attrs) set.call(element, name, value);
}

/** The same snapshot supplies both restoration and its exact native footprint.
 * No ownership or identity is issued. @internal */
export function capture_dom_placement(nodes: readonly HsonNode[]): (() => void) & { readonly containers: readonly Node[] } {
  const parents = new Map<Node, readonly Node[]>();
  const detached: Node[] = [];
  for (const node of nodes) {
    const dom = get_dom_for_node(node);
    if (dom?.parentNode && !parents.has(dom.parentNode)) parents.set(dom.parentNode, Array.from(dom.parentNode.childNodes));
    else if (dom && !dom.parentNode) detached.push(dom);
  }
  const restore = () => {
    for (const [parent, children] of parents) restore_dom_children(parent, children);
    for (const dom of detached) if (dom.parentNode) {
      const remove = dom.ownerDocument?.defaultView?.Node.prototype.removeChild ?? dom.parentNode.removeChild;
      remove.call(dom.parentNode, dom);
    }
  };
  return Object.assign(restore, { containers: [...parents.keys()] });
}

/** Finish fallible native removal and identity-attribute cleanup before graph,
 * listener, resource or identity retirement. Roll back all native work on error. */
export function prepare_terminal_dom(roots: readonly HsonNode[], runtime: LiveTreeRuntime =
  (roots[0] && runtime_for_node(roots[0])) || default_livetree_runtime()): () => void {
  const nodes = roots.flatMap(root => collect_subtree_nodes(root, "post"));
  const restorePlacement = capture_dom_placement(nodes);
  const attrs = nodes.flatMap(node => {
    const element = get_el_for_node(node), value = element?.getAttribute(HSON_QUID_MARKUP_NAME);
    return element && value != null ? [{ element, value }] : [];
  });
  let restoreListeners: (() => void) | undefined;
  const restore = (): void => {
    restoreListeners?.();
    restorePlacement();
    for (const { element, value } of attrs) {
      const set = element.ownerDocument?.defaultView?.Element.prototype.setAttribute ?? element.setAttribute;
      set.call(element, HSON_QUID_MARKUP_NAME, value);
    }
  };
  try {
    for (const node of nodes) {
      const dom = get_dom_for_node(node);
      if (dom?.parentNode) {
        if (dom.nodeType === 1) (dom as Element).remove();
        else dom.parentNode.removeChild(dom);
      }
    }
    for (const { element } of attrs) element.removeAttribute(HSON_QUID_MARKUP_NAME);
    restoreListeners = prepare_native_listener_release(nodes, runtime);
  } catch (cause) { restore(); throw cause; }
  return restore;
}

import { ELEM_TAG, ROOT_TAG } from "../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../core/node-guards.js";
import type { HsonNode, NodeContent } from "../core/types.js";
import { resolve_document_path, validate_document_path } from "../api/livemap/livemap.document.path.js";
import type { PortableDocumentQuads } from "../types/livemap.types.js";
import { plan_browser_realization } from "./browser-realization/browser-realization-plan.js";
import { plan_managed_document_css } from "./browser-realization/managed-document-css.js";

/** Structural diagnostics use canonical paths, never invented source offsets. */
export class CompleteDocumentError extends TypeError {
  readonly code = "HSON_DOCUMENT_STRUCTURE";
  constructor(message: string, readonly path: readonly number[] = []) {
    super(`Document structure at ${JSON.stringify(path)}: ${message}`);
    this.name = "CompleteDocumentError";
  }
}

export function single_document_element(root: HsonNode): HsonNode {
  const element = root.$_content[0];
  if (root.$_tag !== ROOT_TAG || root.$_content.length !== 1 || !is_ordinary_element_node(element)) {
    throw new CompleteDocumentError("expected exactly one authored element or root Part invocation; empty, text-only, and multiple roots are unsupported");
  }
  return element;
}

function element(tag: string, children: NodeContent = []): HsonNode {
  return { $_tag: tag, $_content: children.length ? [{ $_tag: ELEM_TAG, $_content: children }] : [] };
}

/** Pure authored completion. Only new scaffolding and changed ancestor carriers
 * are allocated. Existing subjects, including an already complete html, survive.
 * Call after composition and before finalizing its construction coordinates.
 * Internal structural arguments and detached representations do not call this.
 */
export function complete_document(root: HsonNode): HsonNode {
  const authored = single_document_element(root);
  const tag = authored.$_tag.toLowerCase();
  let html: HsonNode;
  if (tag !== "html") {
    html = element("html", tag === "head" ? [authored, element("body")]
      : [element("head"), tag === "body" ? authored : element("body", [authored])]);
  } else {
    const cluster = authored.$_content[0];
    if (authored.$_content.length && (authored.$_content.length !== 1 || !is_Node(cluster) || cluster.$_tag !== ELEM_TAG)) {
      throw new CompleteDocumentError("html requires ordinary element content", [0]);
    }
    const children = is_Node(cluster) ? cluster.$_content : [];
    const name = (child: NodeContent[number]) => is_ordinary_element_node(child) ? child.$_tag.toLowerCase() : undefined;
    const heads = children.filter(child => name(child) === "head"), bodies = children.filter(child => name(child) === "body");
    if (heads.length > 1 || bodies.length > 1 || children.some(child => name(child) === "html")) {
      throw new CompleteDocumentError("duplicate document structural elements", [0]);
    }
    if (heads.length && children[0] !== heads[0]) throw new CompleteDocumentError("head must precede body content", [0, 0]);
    const rest = children.slice(heads.length);
    if (bodies.length && (rest.length !== 1 || rest[0] !== bodies[0])) {
      throw new CompleteDocumentError("explicit body conflicts with loose html children", [0, 0]);
    }
    if (!bodies.length && rest.some(child => {
      const tag = name(child);
      return tag === undefined || ["base", "basefont", "bgsound", "link", "meta", "title", "noframes", "style", "script", "template"].includes(tag);
    })) throw new CompleteDocumentError("missing body has ambiguous content; author head/body explicitly", [0, 0]);
    if (heads.length && bodies.length) html = authored;
    else html = { ...authored, $_content: [{ $_tag: ELEM_TAG, $_content: [heads[0] ?? element("head"), bodies[0] ?? element("body", rest)] }] };
  }
  const completed = html === authored ? root : { ...root, $_content: [html] };
  assert_complete_document(completed);
  return completed;
}

/** Non-repairing canonical boundary for admission, atomic commits and restore.
 * CSS uses the same derived style planner as HTML capture, including raw text
 * and reserved marker checks. No graph mutation or identity issuance occurs.
 */
export function assert_complete_document(root: HsonNode, css: readonly string[] = []): void {
  const html = single_document_element(root);
  if (html.$_tag.toLowerCase() !== "html") {
    throw new CompleteDocumentError("canonical state requires complete html/head/body; re-admit historical source as an authored Document", [0]);
  }
  plan_managed_document_css(plan_browser_realization(root), css);
}

/** Construction associations follow subjects, including the copied html ancestor.
 * This is never a persisted-path migration: both graphs belong to one admission.
 */
export function completed_document_paths(before: HsonNode, after: HsonNode) {
  const paths = new Map<HsonNode, readonly number[]>();
  if (before !== after) {
    const pending: { node: HsonNode; path: readonly number[] }[] = [{ node: after, path: [] }];
    while (pending.length) {
      const { node, path } = pending.pop()!;
      paths.set(node, path);
      node.$_content.forEach((child, index) => { if (is_Node(child)) pending.push({ node: child, path: [...path, index] }); });
    }
    const original = before.$_content[0];
    if (is_Node(original) && original.$_tag.toLowerCase() === "html") paths.set(original, [0]);
  }
  return (path: readonly number[]) => {
    if (before === after) return validate_document_path(path);
    const subject = resolve_document_path(before, "document", validate_document_path(path));
    const final = is_Node(subject) ? paths.get(subject) : undefined;
    if (final === undefined) throw new Error("Document completion lost a construction subject.");
    return validate_document_path(final);
  };
}

/** Non-composing authored ingress keeps its existing resource and QUAD policy. */
export function complete_document_source(source: Readonly<{ root: HsonNode; quads?: PortableDocumentQuads }>) {
  const root = complete_document(source.root), finalize = completed_document_paths(source.root, root);
  return { root, ...(source.quads === undefined ? {} : { quads: Object.freeze(source.quads.map(binding =>
    Object.freeze({ ...binding, path: finalize(binding.path) }))) }) };
}

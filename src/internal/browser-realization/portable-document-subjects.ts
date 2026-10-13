import type { HsonNode } from "../../core/types.js";
import type { PortableDocumentQuads } from "../../types/livemap.types.js";
import { decode_document_quads } from "../../api/livemap/livemap.document.quad.js";
import { resolve_document_path } from "../../api/livemap/livemap.document.path.js";
import type { BrowserRealizationNode, BrowserRealizationPlan } from "./browser-realization-plan.js";
import { PORTABLE_DOCUMENT_QUAD_ATTRIBUTE } from "../document-quad-name.js";

/** Derived SSR metadata only: match canonical objects after exact path/uniqueness validation. */
export function plan_portable_document_subjects(
  plan: BrowserRealizationPlan, root: HsonNode, input: PortableDocumentQuads | undefined,
): BrowserRealizationPlan {
  const subjects = new Map<HsonNode, string>();
  for (const entry of decode_document_quads(input, root, "document") ?? []) {
    const subject = resolve_document_path(root, "document", entry.path);
    // The QUAD decoder proves an ordinary element at each coordinate.
    if (typeof subject !== "object" || subject === null) throw new Error("Portable subject is unavailable.");
    subjects.set(subject, entry.name);
  }
  const matched = new Set<HsonNode>();
  const visit = (node: BrowserRealizationNode): BrowserRealizationNode => {
    if (node.kind === "text" || node.kind === "marker") return node;
    if (node.attrs.some(attr => attr.name.toLowerCase() === PORTABLE_DOCUMENT_QUAD_ATTRIBUTE)) {
      throw new Error("Authored markup uses the reserved portable document subject carrier.");
    }
    const name = node.kind === "element" ? subjects.get(node.canonicalNode) : undefined;
    if (name !== undefined && node.kind === "element") {
      if (matched.has(node.canonicalNode)) throw new Error("Portable subject has multiple browser realizations.");
      matched.add(node.canonicalNode);
    }
    return Object.freeze({ ...node,
      attrs: name === undefined ? node.attrs : Object.freeze([...node.attrs,
        Object.freeze({ name: PORTABLE_DOCUMENT_QUAD_ATTRIBUTE, value: name })]
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
      children: Object.freeze(node.children.map(visit)),
    });
  };
  const roots = Object.freeze(plan.roots.map(visit));
  if (matched.size !== subjects.size) throw new Error("Portable subject has no exact browser realization.");
  return Object.freeze({ ...plan, roots });
}

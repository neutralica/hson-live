import {
  assert_browser_rawtext_text,
  type BrowserRealizationElement,
  type BrowserRealizationNode,
  type BrowserRealizationPlan,
} from "./browser-realization-plan.js";

/** Reserved only in derived HTML. Authored use is rejected when managed CSS is present. */
export const MANAGED_DOCUMENT_CSS_MARKER = "data-hson-managed-document-css";

/** Add a parser-safe derived style after authored head content without changing Hson state. */
export function plan_managed_document_css(plan: BrowserRealizationPlan, css: string): BrowserRealizationPlan {
  if (!css) return plan;
  assert_browser_rawtext_text(css, "style", "managed-document-css");
  const root = plan.roots.length === 1 ? plan.roots[0] : undefined;
  if (root?.kind !== "element" || root.namespace !== "html" || root.localName !== "html") {
    throw new Error("Nonempty document CSS requires an explicit html/head document root.");
  }
  const hasCollision = (node: BrowserRealizationNode): boolean => {
    if (node.kind === "text" || node.kind === "marker") return false;
    return node.attrs.some((attr) => attr.name === MANAGED_DOCUMENT_CSS_MARKER)
      || node.children.some(hasCollision);
  };
  if (hasCollision(root)) throw new Error("Authored markup uses the reserved managed document CSS marker.");
  const headIndex = root.children.findIndex((node) => node.kind === "element"
    && node.namespace === "html" && node.localName === "head");
  const head = root.children[headIndex];
  if (head?.kind !== "element") {
    throw new Error("Nonempty document CSS requires an explicit head element.");
  }
  const derivedStyle: BrowserRealizationNode = Object.freeze({
    kind: "wrapper", path: "managed-document-css", namespace: "html", localName: "style",
    attrs: Object.freeze([{ name: MANAGED_DOCUMENT_CSS_MARKER, value: "v1" }]),
    children: Object.freeze([{ kind: "text" as const, path: "managed-document-css.text", value: css,
      parserContext: "rawtext" as const }]),
    childTarget: "element", parserContext: "ordinary",
  });
  const updatedHead: BrowserRealizationElement = Object.freeze({ ...head,
    children: Object.freeze([...head.children, derivedStyle]) });
  const children = [...root.children];
  children[headIndex] = updatedHead;
  return Object.freeze({ ...plan, roots: Object.freeze([Object.freeze({ ...root, children: Object.freeze(children) })]) });
}

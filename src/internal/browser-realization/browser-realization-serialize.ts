import type {
  BrowserRealizationElement,
  BrowserRealizationNode,
  BrowserRealizationPlan,
  BrowserRealizationText,
  BrowserRealizationWrapper,
} from "./browser-realization-plan.js";

const HTML_VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** Serialize only derived browser realization data; this module has no DOM dependency. @internal */
export function serialize_browser_realization(plan: BrowserRealizationPlan): string {
  const body = plan.roots.map(serialize_node).join("");
  const root = plan.roots.length === 1 ? plan.roots[0] : undefined;
  return root?.kind === "element" && root.namespace === "html" && root.localName === "html"
    ? `<!doctype html>${body}`
    : body;
}

function serialize_node(node: BrowserRealizationNode): string {
  if (node.kind === "text") return serialize_text(node);
  if (node.kind === "marker") return `<!--${node.value}-->`;
  return serialize_element(node);
}

function serialize_element(node: BrowserRealizationElement | BrowserRealizationWrapper): string {
  const attrs = node.attrs.map((attr) => ` ${attr.name}="${escape_attr(attr.value)}"`).join("");
  const open = `<${node.localName}${attrs}>`;
  if (node.namespace === "html" && HTML_VOID.has(node.localName)) return open;
  return `${open}${node.children.map(serialize_node).join("")}</${node.localName}>`;
}

function serialize_text(node: BrowserRealizationText): string {
  if (node.parserContext === "rawtext") return node.value;
  let value = node.value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  value = value.replace(/\r/g, "&#13;");
  if (node.parserContext === "rcdata") value = value.replace(/\n/g, "&#10;");
  return value;
}

function escape_attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

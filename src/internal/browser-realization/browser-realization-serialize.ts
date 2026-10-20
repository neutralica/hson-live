import type {
  BrowserRealizationElement,
  BrowserRealizationNode,
  BrowserRealizationPlan,
  BrowserRealizationText,
  BrowserRealizationWrapper,
} from "./browser-realization-plan.js";
import { is_html_void_element } from "./browser-realization-plan.js";

/** Serialize only derived browser realization data; this module has no DOM dependency. @internal */
export function serialize_browser_realization(plan: BrowserRealizationPlan): string {
  if (plan.parserClosure !== "verified") {
    throw new Error("Internal invariant: SSR serialization requires a parser-closed browser realization plan.");
  }
  const body = plan.roots.map(node => serialize_node(node)).join("");
  const root = plan.roots.length === 1 ? plan.roots[0] : undefined;
  return root?.kind === "element" && root.namespace === "html" && root.localName === "html"
    ? `<!doctype html>${body}`
    : body;
}

/** Natural markup shares the serializer, but makes no parser-closure/identity claim. @internal */
export function serialize_browser_snapshot(nodes: readonly BrowserRealizationNode[]): string {
  return nodes.map(node => serialize_node(node, true)).join("");
}

function serialize_node(node: BrowserRealizationNode, snapshot = false): string {
  if (node.kind === "text") return serialize_text(node);
  if (node.kind === "marker") return `<!--${node.value}-->`;
  return serialize_element(node, snapshot);
}

function serialize_element(node: BrowserRealizationElement | BrowserRealizationWrapper, snapshot: boolean): string {
  const attrs = node.attrs.map((attr) => ` ${attr.name}="${escape_attr(attr.value)}"`).join("");
  const open = `<${node.localName}${attrs}>`;
  if (node.namespace === "html" && is_html_void_element(node.localName)) {
    if (!snapshot && node.children.length !== 0) {
      throw new Error(`Internal invariant: parser-closed void <${node.localName}> retained planned children.`);
    }
    return open;
  }
  const body = node.children.map(child => serialize_node(child, snapshot)).join("");
  // HTML suppresses one initial LF in these hosts, even when character-referenced.
  const first = node.children.find(child => child.kind !== "text" || child.value !== "");
  const leading = snapshot && node.namespace === "html" && ["textarea", "pre", "listing"].includes(node.localName)
    && first?.kind === "text" && first.value.startsWith("\n") ? "\n" : "";
  return `${open}${leading}${body}</${node.localName}>`;
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

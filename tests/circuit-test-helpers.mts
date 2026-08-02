import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import { hsonTransform } from "../src/api/transform/index.ts";
import { create_circuit_transform_boundary } from "../src/diagnostics/circuit-transform-boundary.ts";
import type { CircuitTransformBoundary } from "../src/diagnostics/circuit-engine.ts";
import type { HsonNode } from "../src/core/types.ts";

export const universalCircuitBoundary = create_circuit_transform_boundary(
  "universal-htmlparser2",
  {
    parseJson: (text) => hsonTransform.fromJson(text).toNode(),
    parseHtml: (text) => hsonTransform.fromTrustedHtml(text).toNode(),
    parseHson: (text) => hsonTransform.fromHson(text).toNode(),
    serializeJson: (node) => hsonTransform.fromNode(node).toJson().serialize(),
    serializeHtml: (node) => hsonTransform.fromNode(node).toHtml().serialize(),
    serializeHson: (node) => hsonTransform.fromNode(node).toHson().serialize(),
  },
);

export function boundary_with_hooks(hooks: Readonly<{
  beforeParse?: (ordinal: number, format: "json" | "html" | "hson", text: string) => void;
  afterParse?: (ordinal: number, format: "json" | "html" | "hson", node: HsonNode) => HsonNode;
  beforeSerialize?: (ordinal: number, format: "json" | "html" | "hson", node: HsonNode) => void;
}>): CircuitTransformBoundary {
  let parses = 0;
  let serializations = 0;
  return Object.freeze({
    identity: "instrumented-universal",
    parse(format: "json" | "html" | "hson", text: string): HsonNode {
      parses += 1;
      hooks.beforeParse?.(parses, format, text);
      const node = universalCircuitBoundary.parse(format, text);
      return hooks.afterParse?.(parses, format, node) ?? node;
    },
    serialize(format: "json" | "html" | "hson", node: HsonNode): string {
      serializations += 1;
      hooks.beforeSerialize?.(serializations, format, node);
      return universalCircuitBoundary.serialize(format, node);
    },
  });
}

export function json_graph(source = '{"a":1,"b":2}'): HsonNode {
  return hsonTransform.fromJson(source).toNode();
}

export function first_scalar(root: HsonNode): HsonNode {
  const pending: HsonNode[] = [root];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (node.$_tag === "_hson_val" || node.$_tag === "_hson_str") return node;
    for (const value of node.$_content) {
      if (typeof value === "object" && value !== null && "$_tag" in value) pending.push(value);
    }
  }
  throw new Error("fixture contains no scalar node");
}

type DomAttr = Readonly<{ name: string; value: string }>;
const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

function prepare_parser_element(node: Record<string, unknown>, inheritedNamespace = HTML_NS): void {
  if (node.nodeType === 3) {
    Object.defineProperty(node, "textContent", { configurable: true, value: String(node.data ?? "") });
    return;
  }
  if (node.nodeType !== 1) return;
  const tagName = String(node.name ?? node.tagName ?? "");
  const namespace = inheritedNamespace === SVG_NS || tagName.toLowerCase() === "svg" ? SVG_NS : HTML_NS;
  Object.defineProperty(node, "namespaceURI", { configurable: true, value: namespace });
  Object.defineProperty(node, "hasAttribute", {
    configurable: true,
    value(name: string): boolean {
      return (node.attributes as DomAttr[]).some((attr) => attr.name === name);
    },
  });
  for (const child of node.childNodes as Record<string, unknown>[]) prepare_parser_element(child, namespace);
}

function parser_document(source: string): { documentElement: Element; querySelector(selector: string): null } {
  const parsed = parseDocument(source, {
    xmlMode: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  });
  const root = parsed.childNodes.find((node) => node.nodeType === 1);
  assert.ok(root);
  prepare_parser_element(root as unknown as Record<string, unknown>);
  return { documentElement: root as unknown as Element, querySelector: () => null };
}

export function with_browser_parser<T>(run: () => T): T {
  const parserDescriptor = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  const nodeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
  class TestDOMParser {
    parseFromString(source: string): ReturnType<typeof parser_document> {
      return parser_document(source);
    }
  }
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, writable: true, value: TestDOMParser });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  });
  try {
    return run();
  } finally {
    if (parserDescriptor === undefined) Reflect.deleteProperty(globalThis, "DOMParser");
    else Object.defineProperty(globalThis, "DOMParser", parserDescriptor);
    if (nodeDescriptor === undefined) Reflect.deleteProperty(globalThis, "Node");
    else Object.defineProperty(globalThis, "Node", nodeDescriptor);
  }
}

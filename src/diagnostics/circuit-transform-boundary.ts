import type { HsonNode } from "../core/types.js";
import { ELEM_TAG, STR_TAG } from "../core/constants.js";
import { is_Node } from "../core/node-guards.js";
import { normalize_detached_hson_semantic_value } from "../core/normalize-hson-semantic-value.js";
import { detach_hson_root_value } from "../api/transform/utils/node-utils/detach-hson-root-value.js";
import type { CircuitEntry, CircuitTransformBoundary } from "./circuit-engine.js";

export type CircuitTransformAdapter = Readonly<{
  parseJson(text: string): HsonNode;
  parseHtml(text: string): HsonNode;
  parseHson(text: string): HsonNode;
  serializeJson(node: HsonNode): string;
  serializeHtml(node: HsonNode): string;
  serializeHson(node: HsonNode): string;
}>;

function normalize_parse_result(format: CircuitEntry, node: HsonNode): HsonNode {
  if (format === "hson") return node;
  const detached = detach_hson_root_value(node);
  // JSON retains the carrier physically; canonical Hson normalizes only this
  // complete singleton text value. Compare strictly after that boundary.
  const only = detached.$_content.length === 1 ? detached.$_content[0] : undefined;
  if (format === "json" && detached.$_tag === ELEM_TAG && is_Node(only) && only.$_tag === STR_TAG) {
    return only;
  }
  return format === "html"
    ? normalize_detached_hson_semantic_value(detached, "diagnostics.html-transport")
    : detached;
}

/**
 * Bind the semantic circuit to an environment-specific Transform surface.
 * Browser diagnostics inject the DOMParser-backed HTML constructor; a later
 * Node worker can inject the DOM-free universal constructor instead.
 */
export function create_circuit_transform_boundary(
  identity: string,
  adapter: CircuitTransformAdapter,
): CircuitTransformBoundary {
  return Object.freeze({
    identity,
    parse(format: CircuitEntry, text: string): HsonNode {
      const parsed = format === "json"
        ? adapter.parseJson(text.trim())
        : format === "html"
          ? adapter.parseHtml(text)
          : adapter.parseHson(text);
      return normalize_parse_result(format, parsed);
    },
    serialize(format: CircuitEntry, node: HsonNode): string {
      if (format === "json") return adapter.serializeJson(node);
      if (format === "html") return adapter.serializeHtml(node);
      return adapter.serializeHson(node);
    },
  });
}

import type { HsonNode, Primitive } from "../core/types.js";
import { is_Node } from "../core/node-guards.js";
import { STR_TAG } from "../core/constants.js";
import { serialize_hson_owned_document_content } from "../api/transform/serializers/serialize-hson.js";
import type { HsonDocument } from "../api/transform/transform.types.js";
import { read_livemap_document_logical_location } from "../api/livemap/livemap.document.location.js";
import { plan_browser_snapshot } from "./browser-realization/browser-realization-plan.js";
import { serialize_browser_snapshot } from "./browser-realization/browser-realization-serialize.js";

/** Public representation only. Internal graph observations retain their structural boundary. */
export function document_markup(root: HsonNode, path?: readonly number[]): string | undefined {
  const selected = path === undefined ? root : read_livemap_document_logical_location(root, "document", path);
  if (selected === undefined) return undefined;
  const ancestors: HsonNode[] = [];
  if (path !== undefined) {
    for (let depth = 0; depth < path.length; depth += 1) {
      const ancestor = read_livemap_document_logical_location(root, "document", path.slice(0, depth));
      if (is_Node(ancestor)) ancestors.push(ancestor);
    }
  }
  return serialize_browser_snapshot(plan_browser_snapshot(selected, ancestors));
}

/** Serialize governed canonical content; portable egress omits QUIDs and rejects empty documents. */
export function document_hson(value: HsonNode | Primitive | undefined): HsonDocument | undefined {
  if (value === undefined) return undefined;
  const node: HsonNode = is_Node(value) ? value : { $_tag: STR_TAG, $_content: [String(value ?? "")] };
  return serialize_hson_owned_document_content(node) as HsonDocument;
}

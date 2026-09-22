import { ELEM_TAG, ROOT_TAG, STR_TAG } from "./constants.js";
import { is_Node } from "./node-guards.js";
import type { HsonNode } from "./types.js";

/** Document-only semantics; canonical Hson validation stays tag-independent. */
export function assert_document_special_tags(root: HsonNode): void {
  if (root.$_tag !== ROOT_TAG) throw new TypeError("Document semantics require an _hson_root.");

  const visit = (node: HsonNode, path: string): void => {
    const tag = node.$_tag.toLowerCase();
    if (tag === "style" || tag === "script") {
      const content = node.$_content;
      const cluster = content.length === 1 && is_Node(content[0]) && content[0].$_tag === ELEM_TAG
        ? content[0].$_content
        : content;
      if (tag === "style") {
        const valid = cluster.length === 0
          || (cluster.length === 1 && is_Node(cluster[0]) && cluster[0].$_tag === STR_TAG
            && typeof cluster[0].$_content[0] === "string" && cluster[0].$_content[0] !== "");
        if (!valid) throw new TypeError("Document <style> at " + path + " requires zero content or one nonempty string leaf.");
      } else if (!Object.hasOwn(node.$_attrs ?? {}, "src") || cluster.length !== 0) {
        throw new TypeError("Document <script> at " + path + " requires src and no content.");
      }
    }
    if (node.$_content.length !== 1) return;
    const only = node.$_content[0];
    if (!is_Node(only) || only.$_tag !== ELEM_TAG) return;
    for (let index = 0; index < only.$_content.length; index += 1) {
      const child = only.$_content[index];
      if (is_Node(child) && child.$_tag !== STR_TAG) visit(child, path + "." + index);
    }
  };

  for (let index = 0; index < root.$_content.length; index += 1) {
    const child = root.$_content[index];
    if (is_Node(child) && child.$_tag !== STR_TAG) visit(child, "$[" + index + "]");
  }
}

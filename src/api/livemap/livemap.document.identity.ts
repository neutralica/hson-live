import { _DATA_QUID } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";

/** Per-map persisted identity index for ordinary document elements. */
export type LiveMapDocumentIdentityIndex = ReadonlyMap<string, HsonNode>;

/**
 * Preserve and index valid persisted document QUIDs while permitting absence.
 *
 * This index is intentionally local to one LiveMap. It does not participate in
 * either LiveTree's global node registry or LiveMap path-handle `lmq` identity.
 */
export function index_livemap_document_elements(root: HsonNode): LiveMapDocumentIdentityIndex {
  const index = new Map<string, HsonNode>();
  const stack: HsonNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;

    if (is_ordinary_element_node(node)) {
      const persisted = node.$_meta?.[_DATA_QUID];
      if (persisted !== undefined && persisted.length === 0) {
        throw new Error(`LiveMap document element <${node.$_tag}> has an invalid empty data-_quid.`);
      }

      if (persisted !== undefined) {
        const duplicate = index.get(persisted);
        if (duplicate !== undefined && duplicate !== node) {
          throw new Error(
            `LiveMap document contains duplicate data-_quid "${persisted}" on <${duplicate.$_tag}> and <${node.$_tag}>.`,
          );
        }
        index.set(persisted, node);
      }
    }

    for (let childIndex = node.$_content.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = node.$_content[childIndex];
      if (is_Node(child)) stack.push(child);
    }
  }

  return index;
}

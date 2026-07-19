import { _DATA_QUID } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { ensure_node_meta } from "../../core/node-storage.js";
import type { HsonNode } from "../../core/types.js";

const DOCUMENT_QUID_RANDOM_BYTES = 8;
let fallbackQuidCounter = 0;

/** Per-map persisted identity index for ordinary document elements. */
export type LiveMapDocumentIdentityIndex = ReadonlyMap<string, HsonNode>;

/**
 * Preserve valid document QUIDs, mint missing QUIDs, and reject duplicates.
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

      const quid = persisted ?? mint_document_quid(index);
      const duplicate = index.get(quid);
      if (duplicate !== undefined && duplicate !== node) {
        throw new Error(
          `LiveMap document contains duplicate data-_quid "${quid}" on <${duplicate.$_tag}> and <${node.$_tag}>.`,
        );
      }

      if (persisted === undefined) ensure_node_meta(node)[_DATA_QUID] = quid;
      index.set(quid, node);
    }

    for (let childIndex = node.$_content.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = node.$_content[childIndex];
      if (is_Node(child)) stack.push(child);
    }
  }

  return index;
}

function mint_document_quid(index: ReadonlyMap<string, HsonNode>): string {
  let quid = random_document_quid();
  while (index.has(quid)) quid = random_document_quid();
  return quid;
}

function random_document_quid(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues !== undefined) {
    const buffer = new Uint8Array(DOCUMENT_QUID_RANDOM_BYTES);
    cryptoObject.getRandomValues(buffer);
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  const counter = fallbackQuidCounter;
  fallbackQuidCounter += 1;
  return `q-${Date.now().toString(36)}-${counter.toString(36)}`;
}

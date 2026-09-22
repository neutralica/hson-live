import { hsonTransform } from "../../src/api/transform/transform.facade.ts";
import { HSON_META_QUID } from "../../src/core/constants.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";

/**
 * Admit a QUID-free local node first, then exercise the public terminals after
 * local runtime metadata appears. This is an egress fixture, never ingress.
 */
export function source_before_local_identity(
  root: HsonNode,
  construct: (node: HsonNode) => ReturnType<typeof hsonTransform.fromNode> = hsonTransform.fromNode,
): ReturnType<typeof hsonTransform.fromNode> {
  const claims: Array<{ node: HsonNode; meta: NonNullable<HsonNode["$_meta"]> }> = [];
  const visited = new WeakSet<HsonNode>();
  const visit = (node: HsonNode): void => {
    if (visited.has(node)) return;
    visited.add(node);
    const meta = node.$_meta;
    if (meta !== undefined && Object.hasOwn(meta, HSON_META_QUID)) {
      claims.push({ node, meta });
      const descriptors = Object.getOwnPropertyDescriptors(meta);
      delete descriptors[HSON_META_QUID];
      if (Reflect.ownKeys(descriptors).length === 0) delete node.$_meta;
      else node.$_meta = Object.create(Object.getPrototypeOf(meta), descriptors);
    }
    for (const child of node.$_content) if (is_Node(child)) visit(child);
  };
  visit(root);
  try {
    return construct(root);
  } finally {
    for (const { node, meta } of claims) node.$_meta = meta;
  }
}

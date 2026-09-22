import {
  HsonNodeQuidValidationError,
  assign_hson_node_quid,
  collect_hson_node_quid_claims,
  type PersistedQuid,
} from "../../../../core/hson-node-quid.js";
import type { HsonNode } from "../../../../core/types.js";
import { HSON_META_QUID } from "../../../../core/constants.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

function throw_quid_ingress_error(
  cause: HsonNodeQuidValidationError,
  boundary: string,
): never {
  const description = cause.code === "MALFORMED_QUID"
    ? "quid must be a canonical persisted QUID"
    : cause.code === "INELIGIBLE_QUID"
      ? "persisted QUID on an ineligible Hson structural node"
      : `duplicate quid "${String(cause.value)}" (Duplicate QUID claim)`;
  _throw_transform_err(
    `${description}: ${cause.message}`,
    boundary,
    cause.path,
    cause,
  );
}

/** Attach one parser-recognized QUID through the canonical metadata primitive. */
export function assign_ingested_hson_node_quid(
  node: HsonNode,
  value: unknown,
  boundary: string,
): PersistedQuid {
  try {
    return assign_hson_node_quid(node, value);
  } catch (cause) {
    if (cause instanceof HsonNodeQuidValidationError) {
      return throw_quid_ingress_error(cause, boundary);
    }
    throw cause;
  }
}

/**
 * Validate canonical QUID format and placement across one cold ingress graph.
 *
 * Equal canonical values on distinct nodes are preserved here. Identity
 * uniqueness belongs to the active LiveTree or LiveMap ownership boundary.
 */
export function scan_ingested_hson_node_quids(
  root: HsonNode,
  boundary: string,
): void {
  try {
    collect_hson_node_quid_claims(root);
  } catch (cause) {
    if (cause instanceof HsonNodeQuidValidationError) {
      throw_quid_ingress_error(cause, boundary);
    }
    throw cause;
  }
}

/** Reject runtime identity evidence before any public node constructor can publish it. */
export function admit_portable_hson_node(root: HsonNode, boundary: string): void {
  const visited = new WeakSet<HsonNode>();
  const tag = Object.getOwnPropertyDescriptor(root, "$_tag")?.value;
  const stack: { node: HsonNode; path: string }[] = [{
    node: root,
    path: `$<${typeof tag === "string" ? tag : "unknown"}>`,
  }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current.node)) continue;
    visited.add(current.node);
    const meta = Object.getOwnPropertyDescriptor(current.node, "$_meta")?.value;
    if (meta !== null && typeof meta === "object"
      && Object.prototype.hasOwnProperty.call(meta, HSON_META_QUID)) {
      _throw_transform_err(
        "generated runtime QUID metadata is invalid in portable node input",
        boundary,
        current.path,
        undefined,
        {
          code: "PORTABLE_RUNTIME_QUID_FORBIDDEN",
          stage: "source-admission",
          path: `${current.path}.$_meta.${HSON_META_QUID}`,
        },
      );
    }
    const content = Object.getOwnPropertyDescriptor(current.node, "$_content")?.value;
    if (!Array.isArray(content)) continue;
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const child = Object.getOwnPropertyDescriptor(content, String(index))?.value;
      if (child !== null && typeof child === "object") {
        const childTag = Object.getOwnPropertyDescriptor(child, "$_tag")?.value;
        if (typeof childTag === "string") stack.push({
          node: child,
          path: `${current.path}.$_content[${index}]<${childTag}>`,
        });
      }
    }
  }
}

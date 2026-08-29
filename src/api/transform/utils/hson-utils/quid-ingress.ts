import {
  HsonNodeQuidValidationError,
  assign_hson_node_quid,
  collect_hson_node_quid_claims,
  type PersistedQuid,
} from "../../../../core/hson-node-quid.js";
import type { HsonNode } from "../../../../core/types.js";
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

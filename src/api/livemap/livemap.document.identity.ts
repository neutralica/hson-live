import {
  HsonNodeQuidValidationError,
  scan_hson_node_quids,
} from "../../core/hson-node-quid.js";
import type { HsonNode } from "../../core/types.js";

/** Per-map persisted identity index for ordinary document elements. */
export type LiveMapDocumentIdentityIndex = ReadonlyMap<string, HsonNode>;

export class LiveMapDocumentIdentityError extends Error {
  readonly code: "MALFORMED_QUID" | "DUPLICATE_QUID";

  constructor(
    code: LiveMapDocumentIdentityError["code"],
    message: string,
    cause?: HsonNodeQuidValidationError,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LiveMapDocumentIdentityError";
    this.code = code;
  }
}

/**
 * Preserve and index valid persisted document QUIDs while permitting absence.
 *
 * This index is intentionally local to one LiveMap. It does not participate in
 * either LiveTree's global node registry or LiveMap path-handle `lmq` identity.
 */
export function index_livemap_document_elements(root: HsonNode): LiveMapDocumentIdentityIndex {
  try {
    return scan_hson_node_quids(root);
  } catch (cause) {
    if (!(cause instanceof HsonNodeQuidValidationError)) throw cause;

    if (cause.code === "DUPLICATE_QUID" && cause.conflictingNode !== undefined) {
      throw new LiveMapDocumentIdentityError(
        "DUPLICATE_QUID",
        `LiveMap document contains duplicate data-_quid "${String(cause.value)}" on <${cause.conflictingNode.$_tag}> at ${cause.conflictingPath ?? "<unknown>"} and <${cause.node.$_tag}> at ${cause.path ?? "<unknown>"}.`,
        cause,
      );
    }

    const malformedKind = cause.value === "" ? "empty" : "malformed";
    throw new LiveMapDocumentIdentityError(
      "MALFORMED_QUID",
      cause.code === "INELIGIBLE_QUID"
        ? `LiveMap cannot own a malformed canonical HSON root: node <${cause.node.$_tag}> is ineligible for data-_quid.`
        : `LiveMap cannot own a malformed canonical HSON root: element <${cause.node.$_tag}> has an invalid ${malformedKind} data-_quid.`,
      cause,
    );
  }
}

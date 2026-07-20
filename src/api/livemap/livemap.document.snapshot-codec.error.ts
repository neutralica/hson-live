/** @internal */
export type CanonicalDocumentSnapshotCodecErrorCode =
  | "CANONICAL_SNAPSHOT_FORMAT_UNKNOWN"
  | "CANONICAL_SNAPSHOT_VERSION_UNSUPPORTED"
  | "CANONICAL_SNAPSHOT_PAYLOAD_TOO_LARGE"
  | "CANONICAL_SNAPSHOT_SYNTAX_INVALID"
  | "CANONICAL_SNAPSHOT_REPRESENTATION_INVALID"
  | "CANONICAL_SNAPSHOT_GRAPH_INVALID"
  | "CANONICAL_SNAPSHOT_MODE_MISMATCH"
  | "CANONICAL_SNAPSHOT_IDENTITY_INVALID"
  | "CANONICAL_SNAPSHOT_NON_FINITE_NUMBER"
  | "CANONICAL_SNAPSHOT_DEPTH_LIMIT"
  | "CANONICAL_SNAPSHOT_NODE_LIMIT"
  | "CANONICAL_SNAPSHOT_ROUND_TRIP_MISMATCH";

/** @internal Internal, payload-safe failure from the canonical document snapshot codec. */
export class CanonicalDocumentSnapshotCodecError extends Error {
  public constructor(
    public readonly code: CanonicalDocumentSnapshotCodecErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CanonicalDocumentSnapshotCodecError";
  }
}

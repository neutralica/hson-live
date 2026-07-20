/** @internal */
export type ViewStateSnapshotCodecErrorCode =
  | "VIEW_STATE_SNAPSHOT_FORMAT_UNKNOWN"
  | "VIEW_STATE_SNAPSHOT_VERSION_UNSUPPORTED"
  | "VIEW_STATE_SNAPSHOT_PAYLOAD_TOO_LARGE"
  | "VIEW_STATE_SNAPSHOT_SYNTAX_INVALID"
  | "VIEW_STATE_SNAPSHOT_REPRESENTATION_INVALID"
  | "VIEW_STATE_SNAPSHOT_GRAPH_INVALID"
  | "VIEW_STATE_SNAPSHOT_MODE_MISMATCH"
  | "VIEW_STATE_SNAPSHOT_IDENTITY_INVALID"
  | "VIEW_STATE_SNAPSHOT_NON_FINITE_NUMBER"
  | "VIEW_STATE_SNAPSHOT_DEPTH_LIMIT"
  | "VIEW_STATE_SNAPSHOT_NODE_LIMIT"
  | "VIEW_STATE_SNAPSHOT_ROUND_TRIP_MISMATCH";

/** @internal Internal, payload-safe failure from the view-state snapshot codec. */
export class ViewStateSnapshotCodecError extends Error {
  public constructor(
    public readonly code: ViewStateSnapshotCodecErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ViewStateSnapshotCodecError";
  }
}

import { hson } from "../../hson.js";
import type { DocumentLiveMapCapture } from "../../types/livemap.types.js";
import type {
  LiveHostServerMessage,
  LiveHostServerRecoverySnapshotMessage,
  LiveHostSnapshotEnvelope,
} from "../../types/livehost.types.js";
import {
  decode_canonical_document_snapshot,
} from "../livemap/livemap.document.snapshot-codec.js";
import { CanonicalDocumentSnapshotCodecError } from "../livemap/livemap.document.snapshot-codec.error.js";

/** @internal Common outer recovery fields shared by both accepted snapshot bodies. */
export type LiveHostSnapshotCommonFields = Pick<
  LiveHostSnapshotEnvelope,
  "logicalMapId" | "incarnationId" | "rev" | "mode"
>;

/** @internal The established ordinary-HSON snapshot body and host emission shape. */
export type LiveHostLegacySnapshotEnvelope = LiveHostSnapshotEnvelope;

/** @internal Incoming-only canonical document snapshot body. */
export type LiveHostCanonicalDocumentSnapshotEnvelope = LiveHostSnapshotCommonFields & Readonly<{
  format: "canonical-hson";
  formatVersion: 1;
  payload: string;
}>;

/** @internal Fully validated incoming snapshot representation. */
export type LiveHostValidatedSnapshotEnvelope =
  | LiveHostLegacySnapshotEnvelope
  | LiveHostCanonicalDocumentSnapshotEnvelope;

/** @internal Client-side decoded recovery message; host emission remains legacy-only. */
export type LiveHostDecodedServerRecoverySnapshotMessage = Readonly<{
  type: "recovery-snapshot";
  id: string;
  snapshot: LiveHostValidatedSnapshotEnvelope;
}>;

/** @internal Server messages accepted by the client-side transport decoder. */
export type LiveHostDecodedServerMessage =
  | Exclude<LiveHostServerMessage, LiveHostServerRecoverySnapshotMessage>
  | LiveHostDecodedServerRecoverySnapshotMessage;

/** @internal */
export type LiveHostDocumentSnapshotDecodeErrorCode =
  | "LIVEHOST_RECOVERY_SNAPSHOT_DECODE_FAILED"
  | "LIVEHOST_RECOVERY_SNAPSHOT_MODE_MISMATCH"
  | "LIVEHOST_RECOVERY_SNAPSHOT_REVISION_MISMATCH";

/** @internal Payload-safe document snapshot failure owned by the LiveHost boundary. */
export class LiveHostDocumentSnapshotDecodeError extends Error {
  public constructor(
    public readonly code: LiveHostDocumentSnapshotDecodeErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LiveHostDocumentSnapshotDecodeError";
  }
}

/** @internal Decode either accepted document snapshot body into one detached capture. */
export function decode_livehost_document_snapshot(
  snapshot: LiveHostValidatedSnapshotEnvelope,
): DocumentLiveMapCapture {
  if ("hson" in snapshot) {
    const node = hson.fromHson(snapshot.hson).toNode();
    const staged = hson.liveMap.fromNode(node);
    if (staged.mode !== "element" && staged.mode !== "fragment") {
      throw new Error("Legacy LiveHost document snapshot reconstructed a non-document root.");
    }
    if (staged.mode !== snapshot.mode) {
      throw new Error("Legacy LiveHost document snapshot mode does not match its envelope.");
    }
    return Object.freeze({ ...staged.capture(), rev: snapshot.rev });
  }

  let capture: DocumentLiveMapCapture;
  try {
    capture = decode_canonical_document_snapshot({
      format: snapshot.format,
      formatVersion: snapshot.formatVersion,
      payload: snapshot.payload,
    });
  } catch (cause) {
    if (cause instanceof CanonicalDocumentSnapshotCodecError) {
      throw new LiveHostDocumentSnapshotDecodeError(
        "LIVEHOST_RECOVERY_SNAPSHOT_DECODE_FAILED",
        "Canonical LiveHost document snapshot could not be decoded.",
        cause,
      );
    }
    throw cause;
  }

  if (capture.mode !== snapshot.mode) {
    throw new LiveHostDocumentSnapshotDecodeError(
      "LIVEHOST_RECOVERY_SNAPSHOT_MODE_MISMATCH",
      "Canonical LiveHost snapshot mode does not match its envelope.",
    );
  }
  if (capture.rev !== snapshot.rev) {
    throw new LiveHostDocumentSnapshotDecodeError(
      "LIVEHOST_RECOVERY_SNAPSHOT_REVISION_MISMATCH",
      "Canonical LiveHost snapshot revision does not match its envelope.",
    );
  }
  return capture;
}

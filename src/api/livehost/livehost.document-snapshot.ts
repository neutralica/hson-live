import { hson } from "../../hson.js";
import type { DocumentLiveMapCapture } from "../../types/livemap.types.js";
import type {
  LiveHostServerMessage,
  LiveHostServerRecoverySnapshotMessage,
  LiveHostSnapshotEnvelope,
} from "../../types/livehost.types.js";
import {
  decode_canonical_document_snapshot,
  encode_canonical_document_snapshot,
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

/** @internal Explicit host-side document snapshot wire selection. */
export type LiveHostDocumentSnapshotEncoding = "legacy-hson" | "canonical-hson";

/** @internal Outbound document snapshot body selected from one capture. */
export type LiveHostOutboundDocumentSnapshotEnvelope =
  | LiveHostLegacySnapshotEnvelope
  | LiveHostCanonicalDocumentSnapshotEnvelope;

/** @internal Client-side decoded recovery message for either accepted document snapshot format. */
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

/** @internal */
export type LiveHostDocumentSnapshotEncodeErrorCode =
  "LIVEHOST_RECOVERY_SNAPSHOT_ENCODE_FAILED";

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

/** @internal Payload-safe host-side canonical snapshot construction failure. */
export class LiveHostDocumentSnapshotEncodeError extends Error {
  public constructor(
    public readonly code: LiveHostDocumentSnapshotEncodeErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LiveHostDocumentSnapshotEncodeError";
  }
}

/** @internal Encode one detached capture without independently supplied mode or revision. */
export function encode_livehost_document_snapshot(
  common: Pick<LiveHostSnapshotCommonFields, "logicalMapId" | "incarnationId">,
  capture: DocumentLiveMapCapture,
  encoding: LiveHostDocumentSnapshotEncoding,
): LiveHostOutboundDocumentSnapshotEnvelope {
  if (encoding === "legacy-hson") {
    return Object.freeze({
      ...common,
      rev: capture.rev,
      mode: capture.mode,
      hson: hson.fromNode(capture.root).toHson().noBreak().serialize(),
    });
  }

  try {
    return Object.freeze({
      ...common,
      rev: capture.rev,
      mode: capture.mode,
      ...encode_canonical_document_snapshot(capture),
    });
  } catch (cause) {
    if (cause instanceof CanonicalDocumentSnapshotCodecError) {
      throw new LiveHostDocumentSnapshotEncodeError(
        "LIVEHOST_RECOVERY_SNAPSHOT_ENCODE_FAILED",
        "Canonical LiveHost document snapshot could not be encoded.",
        cause,
      );
    }
    throw cause;
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

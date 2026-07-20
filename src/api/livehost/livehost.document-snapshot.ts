import { hson } from "../../hson.js";
import type { DocumentLiveMapCapture } from "../../types/livemap.types.js";
import type {
  LiveHostServerMessage,
  LiveHostServerRecoverySnapshotMessage,
  LiveHostSnapshotEnvelope,
} from "../../types/livehost.types.js";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../livemap/livemap.document.view-state-codec.js";
import { ViewStateSnapshotCodecError } from "../livemap/livemap.document.view-state-codec.error.js";

/** @internal Common outer recovery fields shared by both accepted snapshot bodies. */
export type LiveHostSnapshotCommonFields = Pick<
  LiveHostSnapshotEnvelope,
  "logicalMapId" | "incarnationId" | "rev" | "mode"
>;

/** @internal The established ordinary-HSON snapshot body and compatibility shape. */
export type LiveHostHsonSnapshotEnvelope = LiveHostSnapshotEnvelope;

/** @internal Incoming exact document-state snapshot body. */
export type LiveHostViewStateSnapshotEnvelope = LiveHostSnapshotCommonFields & Readonly<{
  format: "view-state";
  formatVersion: 1;
  payload: string;
}>;

/** @internal Fully validated incoming snapshot representation. */
export type LiveHostValidatedSnapshotEnvelope =
  | LiveHostHsonSnapshotEnvelope
  | LiveHostViewStateSnapshotEnvelope;

/** @internal Closed host-side document snapshot wire selection. */
export type LiveHostDocumentSnapshotEncoding =
  | Readonly<{ format: "hson" }>
  | Readonly<{ format: "view-state"; formatVersion: 1 }>;

/** @internal Outbound document snapshot body selected from one capture. */
export type LiveHostOutboundDocumentSnapshotEnvelope =
  | LiveHostHsonSnapshotEnvelope
  | LiveHostViewStateSnapshotEnvelope;

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

/** @internal Payload-safe host-side view-state snapshot construction failure. */
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

function is_view_state_encoding(value: unknown): value is Extract<
  LiveHostDocumentSnapshotEncoding,
  { format: "view-state" }
> {
  return typeof value === "object"
    && value !== null
    && "format" in value
    && value.format === "view-state"
    && "formatVersion" in value
    && value.formatVersion === 1
    && Object.keys(value).length === 2;
}

function is_hson_encoding(value: unknown): value is Extract<
  LiveHostDocumentSnapshotEncoding,
  { format: "hson" }
> {
  return typeof value === "object"
    && value !== null
    && "format" in value
    && value.format === "hson"
    && Object.keys(value).length === 1;
}

/** @internal Encode one detached capture without independently supplied mode or revision. */
export function encode_livehost_document_snapshot(
  common: Pick<LiveHostSnapshotCommonFields, "logicalMapId" | "incarnationId">,
  capture: DocumentLiveMapCapture,
  encoding: LiveHostDocumentSnapshotEncoding,
): LiveHostOutboundDocumentSnapshotEnvelope {
  if (is_hson_encoding(encoding)) {
    return Object.freeze({
      ...common,
      rev: capture.rev,
      mode: capture.mode,
      hson: hson.fromNode(capture.root).toHson().noBreak().serialize(),
    });
  }
  if (!is_view_state_encoding(encoding)) {
    throw new LiveHostDocumentSnapshotEncodeError(
      "LIVEHOST_RECOVERY_SNAPSHOT_ENCODE_FAILED",
      "LiveHost document snapshot encoding is unsupported.",
    );
  }

  try {
    return Object.freeze({
      ...common,
      rev: capture.rev,
      mode: capture.mode,
      ...encode_view_state_snapshot(capture),
    });
  } catch (cause) {
    if (cause instanceof ViewStateSnapshotCodecError) {
      throw new LiveHostDocumentSnapshotEncodeError(
        "LIVEHOST_RECOVERY_SNAPSHOT_ENCODE_FAILED",
        "LiveHost view-state snapshot could not be encoded.",
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
      throw new Error("LiveHost HSON document snapshot reconstructed a non-document root.");
    }
    if (staged.mode !== snapshot.mode) {
      throw new Error("LiveHost HSON document snapshot mode does not match its envelope.");
    }
    return Object.freeze({ ...staged.capture(), rev: snapshot.rev });
  }

  let capture: DocumentLiveMapCapture;
  try {
    capture = decode_view_state_snapshot({
      format: snapshot.format,
      formatVersion: snapshot.formatVersion,
      payload: snapshot.payload,
    });
  } catch (cause) {
    if (cause instanceof ViewStateSnapshotCodecError) {
      throw new LiveHostDocumentSnapshotDecodeError(
        "LIVEHOST_RECOVERY_SNAPSHOT_DECODE_FAILED",
        "LiveHost view-state snapshot could not be decoded.",
        cause,
      );
    }
    throw cause;
  }

  if (capture.mode !== snapshot.mode) {
    throw new LiveHostDocumentSnapshotDecodeError(
      "LIVEHOST_RECOVERY_SNAPSHOT_MODE_MISMATCH",
      "LiveHost view-state snapshot mode does not match its envelope.",
    );
  }
  if (capture.rev !== snapshot.rev) {
    throw new LiveHostDocumentSnapshotDecodeError(
      "LIVEHOST_RECOVERY_SNAPSHOT_REVISION_MISMATCH",
      "LiveHost view-state snapshot revision does not match its envelope.",
    );
  }
  return capture;
}

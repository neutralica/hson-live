import type { DocumentLiveMapCapture } from "../../types/livemap.types.js";
import type {
  LocusServerMessage,
  LocusServerCanonicalCommitMessage,
  LocusServerRecoveryCommitMessage,
  LocusServerRecoverySnapshotMessage,
} from "../../types/locus.protocol.types.js";
import type { LocusSnapshotEnvelope } from "../../types/locus.representation.types.js";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../livemap/livemap.document.view-state-codec.js";
import { ViewStateSnapshotCodecError } from "../livemap/livemap.document.view-state-codec.error.js";
import { make_classified_livemap } from "../livemap/livemap.core.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { serialize_hson_owned_element_text_fragment } from "../transform/serializers/serialize-hson.js";
import { detach_hson_root_value } from "../transform/utils/node-utils/detach-hson-root-value.js";

/** @internal Common outer recovery fields shared by both snapshot bodies. */
export type LocusSnapshotCommonFields = Pick<
  LocusSnapshotEnvelope,
  "logicalMapId" | "incarnationId" | "rev" | "mode"
>;

/** @internal Ordinary-Hson snapshot body. */
export type LocusHsonSnapshotEnvelope = Extract<LocusSnapshotEnvelope, { hson: string }>;

/** @internal Exact document-state snapshot body. */
export type LocusViewStateSnapshotEnvelope = Extract<LocusSnapshotEnvelope, { format: "view-state" }>;

/** @internal Fully validated incoming snapshot representation. */
export type LocusValidatedSnapshotEnvelope =
  LocusSnapshotEnvelope;

/** Closed Locus-side document snapshot wire selection. */
export type LocusDocumentSnapshotEncoding =
  | Readonly<{ format: "hson" }>
  | Readonly<{ format: "view-state" }>;

/** @internal Outbound document snapshot body selected from one capture. */
export type LocusOutboundDocumentSnapshotEnvelope =
  | LocusHsonSnapshotEnvelope
  | LocusViewStateSnapshotEnvelope;

/** @internal Current decoded server-message aliases. */
export type LocusDecodedServerRecoverySnapshotMessage = LocusServerRecoverySnapshotMessage;
export type LocusDecodedServerRecoveryCommitMessage = LocusServerRecoveryCommitMessage;
export type LocusDecodedServerCanonicalCommitMessage = LocusServerCanonicalCommitMessage;
export type LocusDecodedServerMessage = LocusServerMessage;

/** @internal */
export type LocusDocumentSnapshotDecodeErrorCode =
  | "LOCUS_RECOVERY_SNAPSHOT_DECODE_FAILED"
  | "LOCUS_RECOVERY_SNAPSHOT_MODE_MISMATCH"
  | "LOCUS_RECOVERY_SNAPSHOT_REVISION_MISMATCH";

/** @internal */
export type LocusDocumentSnapshotEncodeErrorCode =
  "LOCUS_RECOVERY_SNAPSHOT_ENCODE_FAILED";

/** @internal Payload-safe document snapshot failure owned by the Locus boundary. */
export class LocusDocumentSnapshotDecodeError extends Error {
  public constructor(
    public readonly code: LocusDocumentSnapshotDecodeErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocusDocumentSnapshotDecodeError";
  }
}

/** @internal Payload-safe Locus-side view-state snapshot construction failure. */
export class LocusDocumentSnapshotEncodeError extends Error {
  public constructor(
    public readonly code: LocusDocumentSnapshotEncodeErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocusDocumentSnapshotEncodeError";
  }
}

function is_view_state_encoding(value: unknown): value is Extract<
  LocusDocumentSnapshotEncoding,
  { format: "view-state" }
> {
  return typeof value === "object"
    && value !== null
    && "format" in value
    && value.format === "view-state"
    && Object.keys(value).length === 1;
}

function is_hson_encoding(value: unknown): value is Extract<
  LocusDocumentSnapshotEncoding,
  { format: "hson" }
> {
  return typeof value === "object"
    && value !== null
    && "format" in value
    && value.format === "hson"
    && Object.keys(value).length === 1;
}

/** @internal Encode one detached capture without independently supplied mode or revision. */
export function encode_locus_document_snapshot(
  common: Pick<LocusSnapshotCommonFields, "logicalMapId" | "incarnationId">,
  capture: DocumentLiveMapCapture,
  encoding: LocusDocumentSnapshotEncoding,
): LocusOutboundDocumentSnapshotEnvelope {
  if (is_hson_encoding(encoding)) {
    return Object.freeze({
      ...common,
      rev: capture.rev,
      mode: capture.mode,
      hson: serialize_hson_owned_element_text_fragment(
        detach_hson_root_value(capture.root),
        { noBreak: true },
      ),
    });
  }
  if (!is_view_state_encoding(encoding)) {
    throw new LocusDocumentSnapshotEncodeError(
      "LOCUS_RECOVERY_SNAPSHOT_ENCODE_FAILED",
      "Locus document snapshot encoding is unsupported.",
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
      throw new LocusDocumentSnapshotEncodeError(
        "LOCUS_RECOVERY_SNAPSHOT_ENCODE_FAILED",
        "Locus view-state snapshot could not be encoded.",
        cause,
      );
    }
    throw cause;
  }
}

/** @internal Decode either accepted document snapshot body into one detached capture. */
export function decode_locus_document_snapshot(
  snapshot: LocusValidatedSnapshotEnvelope,
): DocumentLiveMapCapture {
  if ("hson" in snapshot) {
    const staged = make_classified_livemap(parse_hson(
      snapshot.hson,
      { allowTopLevelTextFragment: true },
    ));
    if (staged.mode !== "element" && staged.mode !== "fragment") {
      throw new Error("Locus Hson document snapshot reconstructed a non-document root.");
    }
    if (staged.mode !== snapshot.mode) {
      throw new Error("Locus Hson document snapshot mode does not match its envelope.");
    }
    return Object.freeze({ ...staged.capture(), rev: snapshot.rev });
  }

  let capture: DocumentLiveMapCapture;
  try {
    capture = decode_view_state_snapshot({
      format: snapshot.format,
      payload: snapshot.payload,
    });
  } catch (cause) {
    if (cause instanceof ViewStateSnapshotCodecError) {
      throw new LocusDocumentSnapshotDecodeError(
        "LOCUS_RECOVERY_SNAPSHOT_DECODE_FAILED",
        "Locus view-state snapshot could not be decoded.",
        cause,
      );
    }
    throw cause;
  }

  if (capture.mode !== snapshot.mode) {
    throw new LocusDocumentSnapshotDecodeError(
      "LOCUS_RECOVERY_SNAPSHOT_MODE_MISMATCH",
      "Locus view-state snapshot mode does not match its envelope.",
    );
  }
  if (capture.rev !== snapshot.rev) {
    throw new LocusDocumentSnapshotDecodeError(
      "LOCUS_RECOVERY_SNAPSHOT_REVISION_MISMATCH",
      "Locus view-state snapshot revision does not match its envelope.",
    );
  }
  return capture;
}

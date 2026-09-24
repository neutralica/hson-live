import type { DocumentLiveMapCapture } from "../../src/types/livemap.types.js";
import type {
  LocusServerMessage,
  LocusServerCanonicalCommitMessage,
  LocusServerRecoveryCommitMessage,
  LocusServerRecoverySnapshotMessage,
} from "./solo-locus-protocol.types.js";
import type { LocusClientSnapshotEnvelope, LocusSnapshotEnvelope } from "./solo-locus-representation.types.js";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../../src/api/livemap/livemap.document.view-state-codec.js";
import { ViewStateSnapshotCodecError } from "../../src/api/livemap/livemap.document.view-state-codec.error.js";
import { make_classified_livemap } from "../../src/api/livemap/livemap.core.js";
import { parse_hson_exact_runtime, serialize_hson_owned_document_content_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.js";
import { admit_portable_hson_node } from "../../src/api/transform/utils/hson-utils/quid-ingress.js";

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
  LocusClientSnapshotEnvelope;

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
      hson: serialize_hson_owned_document_content_exact_runtime(
        capture.root,
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
  snapshot: LocusSnapshotEnvelope,
): DocumentLiveMapCapture {
  if ("hson" in snapshot) {
    const staged = make_classified_livemap(parse_hson_exact_runtime(
      snapshot.hson,
      { allowTopLevelDocumentText: true },
    ));
    if (staged.mode !== "document") {
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

/** Current Echo admission is separate from legacy exact authority snapshot decoding. */
export function decode_locus_client_document_snapshot(snapshot: LocusClientSnapshotEnvelope): DocumentLiveMapCapture {
  if (snapshot.format === "hson-client-snapshot-v1") {
    assert_no_hson_runtime_quid_sigil(snapshot.payload);
    const root = parse_hson_exact_runtime(snapshot.payload, { allowTopLevelDocumentText: true });
    admit_portable_hson_node(root, "Locus client snapshot");
    const staged = make_classified_livemap(root);
    if (staged.mode !== "document" || staged.mode !== snapshot.mode) {
      throw new LocusDocumentSnapshotDecodeError("LOCUS_RECOVERY_SNAPSHOT_MODE_MISMATCH", "Locus client snapshot mode is incompatible.");
    }
    return Object.freeze({ ...staged.capture({ identity: "strip" }), rev: snapshot.rev });
  }
  let capture: DocumentLiveMapCapture;
  try {
    capture = decode_view_state_snapshot({ format: "view-state", payload: snapshot.payload });
  } catch (cause) {
    if (cause instanceof ViewStateSnapshotCodecError) {
      throw new LocusDocumentSnapshotDecodeError("LOCUS_RECOVERY_SNAPSHOT_DECODE_FAILED", "Locus client view-state snapshot could not be decoded.", cause);
    }
    throw cause;
  }
  admit_portable_hson_node(capture.root, "Locus client snapshot");
  if (capture.mode !== snapshot.mode) throw new LocusDocumentSnapshotDecodeError("LOCUS_RECOVERY_SNAPSHOT_MODE_MISMATCH", "Locus client snapshot mode is incompatible.");
  if (capture.rev !== snapshot.rev) throw new LocusDocumentSnapshotDecodeError("LOCUS_RECOVERY_SNAPSHOT_REVISION_MISMATCH", "Locus client snapshot revision is incompatible.");
  return capture;
}

/** A bounded-memory guard for the canonical Hson QUID sigil. Full graph and
 * Schema admission still occurs when the client snapshot is installed. */
export function assert_no_hson_runtime_quid_sigil(payload: string): void {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "@") throw new TypeError("Client snapshot contains a runtime QUID sigil.");
  }
}

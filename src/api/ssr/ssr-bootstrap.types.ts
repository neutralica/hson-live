import type {
  DocumentLiveMapCapture,
  HostedLiveMapLibrariesSnapshot,
  LiveMapLibrariesSnapshot,
} from "../../types/livemap.types.js";
import type { LocusSnapshotEnvelope } from "../../types/locus.representation.types.js";

declare const ENCODED_SSR_BOOTSTRAP: unique symbol;

/** The four semantic families carried by the version-one SSR bootstrap wire format. */
export type SsrBootstrapKind =
  | "document"
  | "hosted-document"
  | "libraries"
  | "hosted-libraries";

/**
 * A deterministic hson-live SSR bootstrap string for one semantic family.
 *
 * The brand means only that the encoder produced the string. It does not imply
 * trust, authenticity, authorization, encryption, sanitization, freshness,
 * same origin, or server provenance.
 */
export type EncodedSsrBootstrap<TKind extends SsrBootstrapKind = SsrBootstrapKind> = string & Readonly<{
  [ENCODED_SSR_BOOTSTRAP]: TKind;
}>;

/** A decoded family discriminator paired with its detached semantic bootstrap. */
export type DecodedSsrBootstrap =
  | Readonly<{ kind: "document"; bootstrap: DocumentLiveMapCapture<"document"> }>
  | Readonly<{
    kind: "hosted-document";
    bootstrap: Extract<LocusSnapshotEnvelope, { hson: string }> & Readonly<{ mode: "document" }>;
  }>
  | Readonly<{ kind: "libraries"; bootstrap: LiveMapLibrariesSnapshot }>
  | Readonly<{ kind: "hosted-libraries"; bootstrap: HostedLiveMapLibrariesSnapshot }>;

/** Outer encoded-size admission for SSR bootstrap transport. */
export type SsrBootstrapCodecOptions = Readonly<{
  maxEncodedBytes?: number;
}>;

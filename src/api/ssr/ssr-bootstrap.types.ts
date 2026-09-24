import type {
  DocumentLiveMapCapture,
  LocalLibrariesContinuationSnapshot,
} from "../../types/livemap.types.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";

declare const ENCODED_SSR_BOOTSTRAP: unique symbol;

/** Local version-two families and the projected hosted version-three family. */
export type SsrBootstrapKind =
  | "document"
  | "libraries"
  | "hosted-projection";

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
  | Readonly<{ kind: "libraries"; bootstrap: LocalLibrariesContinuationSnapshot }>
  | Readonly<{ kind: "hosted-projection"; bootstrap: AuthorityProjectionSnapshot }>;

/** Outer encoded-size admission for SSR bootstrap transport. */
export type SsrBootstrapCodecOptions = Readonly<{
  maxEncodedBytes?: number;
}>;

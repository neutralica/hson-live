import type { LocalLibrariesContinuationSnapshot } from "../../types/livemap.types.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";

declare const ENCODED_SSR_BOOTSTRAP: unique symbol;

/** Local registry and projected hosted bootstrap families. */
export type SsrBootstrapKind =
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
  | Readonly<{ kind: "libraries"; bootstrap: LocalLibrariesContinuationSnapshot }>
  | Readonly<{ kind: "hosted-projection"; bootstrap: AuthorityProjectionSnapshot }>;

/** Outer encoded-size admission for SSR bootstrap transport. */
export type SsrBootstrapCodecOptions = Readonly<{
  maxEncodedBytes?: number;
}>;

// Shared current Locus contracts.

import type { LivePath } from "./livemap.types.js";

export type LocusClientId = string;
export type LocusSelector = string;
export type LocusSessionId = string;
export type LocusActionId = string;
export type LocusActionRequestId = string;
export type LocusActionStatusId = string;
export type LocusActionName = string;
export type LocusSeq = number;
export type LocusRecoveryId = string;
export type LocusSessionRequestId = string;
export type LocusSessionCredential = string;
export type LocusConnectionEpoch = number;
export type LocusLogicalMapId = string;
export type LocusIncarnationId = string;

export type LocusDisposer = () => void;
export type LocusSchemaIssue = string;

export type LocusResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: LocusError }>;

export type LocusError = Readonly<{
  message: string;
  code?: string;
  path?: LivePath;
  cause?: unknown;
}>;

/** Stable errors for projected APIs requested against document authorities. */
export type LocusModeErrorCode =
  | "LOCUS_PROJECTED_SUBSCRIPTION_UNSUPPORTED"
  | "LOCUS_DOCUMENT_RECOVERY_REQUIRED";

export type LocusValidator<TValue> = (value: unknown) => value is TValue;

export type LocusSchemaResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; issues: readonly LocusSchemaIssue[] }>;

export type LocusSchemaDecoder<TValue> = (value: unknown) => LocusSchemaResult<TValue>;

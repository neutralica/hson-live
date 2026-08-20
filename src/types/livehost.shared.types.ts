// Shared current LiveHost contracts. ID/key semantics remain intentionally deferred to U4.

import type { LivePath } from "./livemap.types.js";

export type LiveHostId = string;
export type LiveHostStoreId = string;
export type LiveHostSessionId = string;
export type LiveHostActionId = string;
export type LiveHostActionRequestId = string;
export type LiveHostActionStatusId = string;
export type LiveHostActionName = string;
export type LiveHostSeq = number;
export type LiveHostRecoveryId = string;
export type LiveHostSessionRequestId = string;
export type LiveHostSessionCredential = string;
export type LiveHostConnectionEpoch = number;
export type LiveHostLogicalMapId = string;
export type LiveHostIncarnationId = string;

/** @internal Application-defined route selector; public fields retain their current spellings. */
export type LiveHostRoutingSelector = string;

export type LiveHostDisposer = () => void;
export type LiveHostSchemaIssue = string;

export type LiveHostResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: LiveHostError }>;

export type LiveHostError = Readonly<{
  message: string;
  code?: string;
  path?: LivePath;
  cause?: unknown;
}>;

/** Stable errors for projected APIs requested against document authorities. */
export type LiveHostModeErrorCode =
  | "LIVEHOST_PROJECTED_SUBSCRIPTION_UNSUPPORTED"
  | "LIVEHOST_DOCUMENT_RECOVERY_REQUIRED";

export type LiveHostValidator<TValue> = (value: unknown) => value is TValue;

export type LiveHostSchemaResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; issues: readonly LiveHostSchemaIssue[] }>;

export type LiveHostSchemaDecoder<TValue> = (value: unknown) => LiveHostSchemaResult<TValue>;

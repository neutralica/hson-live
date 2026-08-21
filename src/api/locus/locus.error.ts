import type { LocusRecoveryRuntimeErrorCode } from "../../types/locus.types.js";

export class LocusDisconnectedError extends Error {
  readonly code = "LOCUS_DISCONNECTED" as const;

  constructor() {
    super("Locus client disconnected before the action completed.");
    this.name = "LocusDisconnectedError";
  }
}

export class LocusRecoveryError extends Error {
  readonly code: LocusRecoveryRuntimeErrorCode;
  readonly cause?: unknown;

  constructor(code: LocusRecoveryRuntimeErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "LocusRecoveryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class LocusClientRecoveryError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "LocusClientRecoveryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class LocusClientSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocusClientSessionError";
    this.code = code;
  }
}

export class LocusDuplicateActionIdError extends Error {
  readonly code = "LOCUS_DUPLICATE_ACTION_ID" as const;
  readonly actionId: string;

  constructor(actionId: string) {
    super(`Locus action ID is already pending: ${actionId}`);
    this.name = "LocusDuplicateActionIdError";
    this.actionId = actionId;
  }
}

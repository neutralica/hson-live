import type { LiveHostRecoveryRuntimeErrorCode } from "../../types/livehost.types.js";

export class LiveHostDisconnectedError extends Error {
  readonly code = "LIVEHOST_DISCONNECTED" as const;

  constructor() {
    super("LiveHost client disconnected before the action completed.");
    this.name = "LiveHostDisconnectedError";
  }
}

export class LiveHostRecoveryError extends Error {
  readonly code: LiveHostRecoveryRuntimeErrorCode;
  readonly cause?: unknown;

  constructor(code: LiveHostRecoveryRuntimeErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "LiveHostRecoveryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class LiveHostClientRecoveryError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "LiveHostClientRecoveryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class LiveHostClientSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LiveHostClientSessionError";
    this.code = code;
  }
}

export class LiveHostDuplicateActionIdError extends Error {
  readonly code = "LIVEHOST_DUPLICATE_ACTION_ID" as const;
  readonly actionId: string;

  constructor(actionId: string) {
    super(`LiveHost action ID is already pending: ${actionId}`);
    this.name = "LiveHostDuplicateActionIdError";
    this.actionId = actionId;
  }
}

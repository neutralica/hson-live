export class EchoSyncError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "EchoSyncError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class EchoSessionError extends Error {
  readonly code: string;
  readonly delivery?: "not-submitted" | "uncertain";

  constructor(code: string, message: string, delivery?: "not-submitted" | "uncertain") {
    super(message);
    this.name = "EchoSessionError";
    this.code = code;
    if (delivery !== undefined) this.delivery = delivery;
  }
}

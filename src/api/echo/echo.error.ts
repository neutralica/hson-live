export class EchoRecoveryError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "EchoRecoveryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class EchoSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EchoSessionError";
    this.code = code;
  }
}

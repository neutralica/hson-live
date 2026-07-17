export const LIVETREE_DISPOSED_ERROR_CODE = "LIVETREE_DISPOSED" as const;
export const LIVETREE_ALREADY_ATTACHED_ERROR_CODE = "LIVETREE_ALREADY_ATTACHED" as const;
export const LIVETREE_PROTECTED_ROOT_ERROR_CODE = "LIVETREE_PROTECTED_ROOT" as const;
export const LIVETREE_BATCH_VALIDATION_ERROR_CODE = "LIVETREE_BATCH_VALIDATION_FAILED" as const;
export const LIVETREE_BATCH_ATTACHMENT_ERROR_CODE = "LIVETREE_BATCH_ATTACHMENT_FAILED" as const;

export class LiveTreeBatchError extends Error {
  public readonly cause: unknown;

  public constructor(
    public readonly code: typeof LIVETREE_BATCH_VALIDATION_ERROR_CODE | typeof LIVETREE_BATCH_ATTACHMENT_ERROR_CODE,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "LiveTreeBatchError";
    this.cause = cause;
  }
}

export class LiveTreeDisposedError extends Error {
  readonly code = LIVETREE_DISPOSED_ERROR_CODE;
  readonly operation: string;
  readonly formerQuid: string | undefined;

  constructor(operation: string, formerQuid?: string) {
    super(
      formerQuid
        ? `LiveTree node ${formerQuid} is disposed; cannot ${operation}.`
        : `LiveTree node is disposed; cannot ${operation}.`,
    );
    this.name = "LiveTreeDisposedError";
    this.operation = operation;
    this.formerQuid = formerQuid;
  }
}

export class LiveTreeAlreadyAttachedError extends Error {
  readonly code = LIVETREE_ALREADY_ATTACHED_ERROR_CODE;
  readonly operation: string;

  constructor(operation: string) {
    super(`LiveTree branch is already attached; cannot ${operation}. Detach it first.`);
    this.name = "LiveTreeAlreadyAttachedError";
    this.operation = operation;
  }
}

export class LiveTreeProtectedRootError extends Error {
  readonly code = LIVETREE_PROTECTED_ROOT_ERROR_CODE;
  readonly operation: string;
  readonly rootName: string;

  constructor(operation: string, rootName: string) {
    super(`Cannot ${operation} browser-owned root ${rootName}.`);
    this.name = "LiveTreeProtectedRootError";
    this.operation = operation;
    this.rootName = rootName;
  }
}

export const LIVETREE_DISPOSED_ERROR_CODE = "LIVETREE_DISPOSED" as const;

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

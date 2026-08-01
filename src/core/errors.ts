// errors.ts

export type TransformErrorSource = Readonly<{
  /** Zero-based absolute source offset. */
  index: number;
  /** One-based source line. */
  line: number;
  /** One-based source column. */
  column: number;
}>;

export type TransformErrorRelated = Readonly<{
  role: string;
  source: TransformErrorSource;
}>;

export type TransformErrorDetails = Readonly<{
  operation: string;
  code: string;
  stage?: string;
  source?: TransformErrorSource;
  path?: string;
  related?: readonly TransformErrorRelated[];
}>;

export type TransformErrorOptions = Readonly<{
  code?: string;
  stage?: string;
  source?: TransformErrorSource;
  path?: string;
  related?: readonly TransformErrorRelated[];
}>;

/** Portable structured identity for Transform-owned failures. */
export class TransformError extends Error {
  readonly operation: string;
  readonly code: string;
  readonly stage: string | undefined;
  readonly source: TransformErrorSource | undefined;
  readonly path: string | undefined;
  readonly related: readonly TransformErrorRelated[] | undefined;

  constructor(
    message: string,
    details: TransformErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    // Retain the historical `Error: ...` stack heading while adding a
    // machine-readable subclass and ordinary readable fields.
    this.operation = details.operation;
    this.code = details.code;
    this.stage = details.stage;
    this.source = details.source === undefined ? undefined : Object.freeze({ ...details.source });
    this.path = details.path;
    this.related = details.related === undefined
      ? undefined
      : Object.freeze(details.related.map((item) => Object.freeze({
        role: item.role,
        source: Object.freeze({ ...item.source }),
      })));
  }
}

export function is_transform_error(error: unknown): error is TransformError {
  return error instanceof TransformError;
}

export function read_transform_error_details(
  error: unknown,
): TransformErrorDetails | undefined {
  if (!is_transform_error(error)) return undefined;
  return Object.freeze({
    operation: error.operation,
    code: error.code,
    ...(error.stage === undefined ? {} : { stage: error.stage }),
    ...(error.source === undefined ? {} : { source: error.source }),
    ...(error.path === undefined ? {} : { path: error.path }),
    ...(error.related === undefined ? {} : { related: error.related }),
  });
}

export function _throw_transform_err(
  message: string,
  functionName: string,
  ctx?: string,
  cause?: unknown,
  options: TransformErrorOptions = {},
): never {
  const ctxLine = ctx ? `\n  :: ${ctx}` : "";
  const errorMessage = `[ERR: transform = ${functionName}()]:\n  -> ${message}${ctxLine}`;
  throw new TransformError(
    errorMessage,
    {
      operation: functionName,
      code: options.code ?? "TRANSFORM_ERROR",
      ...(options.stage === undefined ? {} : { stage: options.stage }),
      ...(options.source === undefined ? {} : { source: options.source }),
      ...(options.path === undefined ? {} : { path: options.path }),
      ...(options.related === undefined ? {} : { related: options.related }),
    },
    cause,
  );
}

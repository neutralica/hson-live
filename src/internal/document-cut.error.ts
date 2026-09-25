/** Failure to compose browser-realization HTML with its semantic state. */
export class DocumentSsrError extends Error {
  public constructor(
    public readonly phase: "select" | "capture" | "realize" | "bootstrap",
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DocumentSsrError";
  }
}

/** Failure to compose one exact document cut into its browser-realization pair. */
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

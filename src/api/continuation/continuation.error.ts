type DocumentContinuationPhase = "adopt" | "mirror" | "recover" | "interactions";

/** One failed construction phase; the lower-level failure remains available as `cause`. */
export class DocumentContinuationError extends Error {
  public constructor(
    public readonly phase: DocumentContinuationPhase,
    public override readonly cause: unknown,
  ) {
    super(`Document continuation failed during ${phase}.`, { cause });
    this.name = "DocumentContinuationError";
  }
}

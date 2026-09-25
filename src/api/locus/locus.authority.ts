/** Structured errors retained by the public Locus authority surface. */
export type LocusAuthorityErrorCode =
  | "LOCUS_AUTHORITY_ALREADY_MANAGED"
  | "LOCUS_AUTHORITY_CLOSED"
  | "LOCUS_AUTHORITY_GATE_REJECTED"
  | "LOCUS_AUTHORITY_TERMINAL"
  | "LOCUS_AUTHORITY_ACCEPTED_INGESTION_FAILED";

export class LocusAuthorityError extends Error {
  constructor(
    readonly code: LocusAuthorityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocusAuthorityError";
  }
}

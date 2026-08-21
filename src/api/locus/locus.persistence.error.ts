export type LocusPersistenceErrorCode =
  | "LOCUS_PERSISTENCE_REQUIRES_EXCLUSIVE"
  | "LOCUS_PERSISTENCE_MAP_KIND_UNSUPPORTED"
  | "LOCUS_PERSISTENCE_INITIAL_CHECKPOINT_FAILED"
  | "LOCUS_PERSISTENCE_APPEND_FAILED"
  | "LOCUS_PERSISTENCE_CHECKPOINT_FAILED"
  | "LOCUS_PERSISTENCE_LOAD_FAILED"
  | "LOCUS_PERSISTED_STATE_INVALID"
  | "LOCUS_PERSISTENCE_REGISTRY_CONFLICT";

/** Content-safe persistence-boundary failure. */
export class LocusPersistenceError extends Error {
  constructor(
    readonly code: LocusPersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocusPersistenceError";
  }
}

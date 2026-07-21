export type LiveHostPersistenceErrorCode =
  | "LIVEHOST_PERSISTENCE_REQUIRES_EXCLUSIVE"
  | "LIVEHOST_PERSISTENCE_MAP_KIND_UNSUPPORTED"
  | "LIVEHOST_PERSISTENCE_INITIAL_CHECKPOINT_FAILED"
  | "LIVEHOST_PERSISTENCE_APPEND_FAILED"
  | "LIVEHOST_PERSISTENCE_CHECKPOINT_FAILED"
  | "LIVEHOST_PERSISTENCE_LOAD_FAILED"
  | "LIVEHOST_PERSISTED_STATE_INVALID"
  | "LIVEHOST_PERSISTENCE_REGISTRY_CONFLICT";

/** Content-safe persistence-boundary failure. */
export class LiveHostPersistenceError extends Error {
  constructor(
    readonly code: LiveHostPersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveHostPersistenceError";
  }
}

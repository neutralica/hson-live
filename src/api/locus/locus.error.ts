export class LocusDisconnectedError extends Error {
  readonly code = "LOCUS_DISCONNECTED" as const;

  constructor() {
    super("Locus client disconnected before the action completed.");
    this.name = "LocusDisconnectedError";
  }
}

export class LocusDuplicateActionIdError extends Error {
  readonly code = "LOCUS_DUPLICATE_ACTION_ID" as const;
  readonly actionId: string;

  constructor(actionId: string) {
    super(`Locus action ID is already pending: ${actionId}`);
    this.name = "LocusDuplicateActionIdError";
    this.actionId = actionId;
  }
}
